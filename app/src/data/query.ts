import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import type { Client } from '../lib/supabase';
import { useSupabase } from './DataProvider';

// The { data, error } shape every Supabase call resolves to.
type Result<T> = { data: T | null; error: { message: string } | null };

export class ReadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ReadError';
  }
}

// Supabase returns failures as values ({ data, error }) rather than throwing.
// The current site's `if (result.error) return;` pattern is how a failed read
// disappeared for weeks (#1101, migration 20260913124050). Here an error is
// always turned into a throw, so the query lands in its error state and the
// page shows it.
export async function unwrap<T>(pending: PromiseLike<Result<T>>): Promise<T> {
  const result = await pending;
  if (result.error) throw new ReadError(result.error.message, result.error);
  return result.data as T;
}

// The only way a page reads from Supabase. `key` identifies the data in the
// shared cache; include every argument the read depends on.
export function useSupabaseQuery<T>(
  key: readonly unknown[],
  read: (client: Client) => PromiseLike<Result<T>>,
  options: { enabled?: boolean } = {}
): UseQueryResult<T> {
  const client = useSupabase();
  return useQuery({
    queryKey: key,
    queryFn: () => unwrap(read(client)),
    enabled: options.enabled ?? true
  });
}

// Two reads that only make sense together, as one result for DataState: loading
// until both land, an error (with one Retry for both) if either fails.
export function bothQueries<A, B>(a: UseQueryResult<A>, b: UseQueryResult<B>): UseQueryResult<[A, B]> {
  if (a.isSuccess && b.isSuccess) return { ...a, data: [a.data, b.data] } as UseQueryResult<[A, B]>;
  const failed = a.isError ? a : b.isError ? b : null;
  const refetch = () => Promise.all([a.refetch(), b.refetch()]);
  if (failed) {
    return { ...failed, refetch, isFetching: a.isFetching || b.isFetching } as unknown as UseQueryResult<[A, B]>;
  }
  return { ...(a.isPending ? a : b), refetch } as unknown as UseQueryResult<[A, B]>;
}

// The only way a page writes to Supabase. A failed write throws like a failed
// read, so the caller's error state shows it and it gets reported. Once it
// succeeds, every cached read whose key starts with one of `refreshes` is
// read again, so no page shows numbers from before the write (#1101).
export function useSupabaseMutation<T, V>(
  write: (client: Client, variables: V) => PromiseLike<Result<T>>,
  options: { key: readonly unknown[]; refreshes: readonly (readonly unknown[])[] }
): UseMutationResult<T, Error, V> {
  const client = useSupabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: options.key,
    mutationFn: (variables: V) => unwrap(write(client, variables)),
    onSuccess: () =>
      Promise.all(options.refreshes.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(() => {})
  });
}
