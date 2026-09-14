import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { routes } from './routes';
import { DataProvider } from './data/DataProvider';
import { createSupabaseClient } from './lib/supabase';
import { errorMessage, reportError } from './lib/errors';
import './styles/base.css';
import './pages/pages.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing #root');

let app;
try {
  const client = createSupabaseClient();
  app = (
    <DataProvider client={client}>
      <RouterProvider router={createBrowserRouter(routes)} />
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
