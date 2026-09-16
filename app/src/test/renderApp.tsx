import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import type { Session } from '@supabase/supabase-js';
import { routes } from '../routes';
import { createQueryClient, DataProvider } from '../data/DataProvider';
import { SessionProvider, userFromSession, type AuthReturn } from '../auth/session';
import { StatusProvider } from '../components/Status';
import { fakeClient, seededHandlers, type FakeHandlers } from './fakeSupabase';

// Renders the whole app at an address, against a fake Supabase, with the same
// cache settings, sign-in state and error reporting the app uses. Retries are
// off so an error state shows on the first failure. The session comes from
// `handlers.session`; `authReturn` stands in for coming back from Battle.net or
// Discord, and `battlenetToken` for the Battle.net token that round trip left.
export function renderApp(
  path: string,
  handlers: FakeHandlers = seededHandlers(),
  options: { authReturn?: AuthReturn; battlenetToken?: string } = {}
) {
  const client = fakeClient(handlers);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  });
  const user = userFromSession((handlers.session ?? null) as Session | null);
  const view = render(
    <DataProvider client={client} queryClient={queryClient}>
      <SessionProvider
        initialUser={user}
        {...(options.authReturn ? { initialAuthReturn: options.authReturn } : {})}
        initialBattlenetToken={options.battlenetToken ?? null}
      >
        <StatusProvider>
          <RouterProvider router={router} />
        </StatusProvider>
      </SessionProvider>
    </DataProvider>
  );
  return { client, router, view };
}
