import { createContext, useContext, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Client } from '../lib/supabase';
import { reportError } from '../lib/errors';

const SupabaseContext = createContext<Client | null>(null);

export function useSupabase(): Client {
  const client = useContext(SupabaseContext);
  if (!client) throw new Error('useSupabase needs a DataProvider above it');
  return client;
}

// One cache for the whole app (#1101): moving from the roster to a profile and
// back reuses what was already read instead of fetching it again (#1017).
export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => reportError(error, { where: 'read', key: query.queryKey })
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) =>
        reportError(error, {
          where: 'write',
          ...(mutation.options.mutationKey ? { key: mutation.options.mutationKey } : {})
        })
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: false
      }
    }
  });
}

export function DataProvider({
  client,
  queryClient,
  children
}: {
  client: Client;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [cache] = useState(() => queryClient ?? createQueryClient());
  return (
    <SupabaseContext.Provider value={client}>
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    </SupabaseContext.Provider>
  );
}
