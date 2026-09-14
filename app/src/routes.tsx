import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { GUILD_PAGES, TEAM_PAGES } from './layout/nav';
import { defaultPath } from './config';

export type RouteHandle = { title: string };

// Addresses from #1100: /g/<guild key>/t/<team key>/... for team pages,
// /g/<guild key>/... for guild-wide ones. The keys are not looked up yet; that
// arrives with the data layer (resolve_address(), #1114), along with the
// redirect for retired keys.
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to={defaultPath()} replace /> },
  {
    path: '/g/:guildKey',
    element: <AppShell />,
    children: [
      ...Object.entries(GUILD_PAGES).map(([path, title]) => ({
        path,
        element: <PlaceholderPage title={title} />,
        handle: { title } satisfies RouteHandle
      })),
      {
        path: 't/:teamKey',
        children: [
          { index: true, element: <HomePage />, handle: { title: 'Home' } satisfies RouteHandle },
          ...Object.entries(TEAM_PAGES).map(([path, title]) => ({
            path,
            element: <PlaceholderPage title={title} />,
            handle: { title } satisfies RouteHandle
          }))
        ]
      },
      { path: '*', element: <NotFoundPage />, handle: { title: 'Page not found' } satisfies RouteHandle }
    ]
  },
  { path: '*', element: <NotFoundPage /> }
];
