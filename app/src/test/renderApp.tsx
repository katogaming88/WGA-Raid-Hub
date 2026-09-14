import { render } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from '../routes';
import { createQueryClient, DataProvider } from '../data/DataProvider';
import { fakeClient, seededHandlers, type FakeHandlers } from './fakeSupabase';

// Renders the whole app at an address, against a fake Supabase, with the same
// cache settings and error reporting the app uses. Retries are off so an
// error state shows on the first failure.
export function renderApp(path: string, handlers: FakeHandlers = seededHandlers()) {
  const client = fakeClient(handlers);
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const queryClient = createQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false }
  });
  const view = render(
    <DataProvider client={client} queryClient={queryClient}>
      <RouterProvider router={router} />
    </DataProvider>
  );
  return { client, router, view };
}
