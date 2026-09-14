import { useQuery, type UseQueryResult } from '@tanstack/react-query';
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
