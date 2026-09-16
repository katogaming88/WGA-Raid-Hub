import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from './routes';
import { DataProvider } from './data/DataProvider';
import { createSupabaseClient } from './lib/supabase';
import { errorMessage, reportError } from './lib/errors';
import { loadInitialSession, SessionProvider } from './auth/session';
import { StatusProvider } from './components/Status';
import './styles/base.css';
import './pages/pages.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

let app;
try {
  const client = createSupabaseClient();
  const { user, authReturn, battlenetToken } = await loadInitialSession(client);
  app = (
    <DataProvider client={client}>
      <SessionProvider initialUser={user} initialAuthReturn={authReturn} initialBattlenetToken={battlenetToken}>
        <StatusProvider>
          <RouterProvider router={createBrowserRouter(routes)} />
        </StatusProvider>
      </SessionProvider>
    </DataProvider>
  );
} catch (error) {
  // A build with no Supabase settings shows why instead of a blank page.
  reportError(error, { where: 'startup' });
  app = (
    <main className="content" role="alert">
      <h1>WGA Raid Hub could not start</h1>
      <p>{errorMessage(error)}</p>
    </main>
  );
}

createRoot(root).render(<StrictMode>{app}</StrictMode>);
