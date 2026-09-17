import type { ReactElement } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { RosterPage } from './roster/RosterPage';
import { MyProfilePage, PlayerProfilePage } from './profile/ProfilePage';
import { AppShell } from './layout/AppShell';
import { HomePage } from './home/HomePage';
import { CalendarPage } from './calendar/CalendarPage';
import { GuildHomePage } from './guild/GuildHomePage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { RequireAbility } from './auth/RequireAbility';
import { GUILD_PAGES, TEAM_PAGES } from './layout/nav';
import { defaultGuildPath } from './config';

export type RouteHandle = { title: string };

// Team pages rebuilt so far (#1102). Every other page in TEAM_PAGES is still a
// placeholder.
const BUILT_PAGES: Record<string, ReactElement> = {
  roster: <RosterPage />,
  calendar: <CalendarPage />,
  me: <MyProfilePage />
};

// Addresses from #1100: /g/<guild key>/t/<team key>/... for team pages,
// /g/<guild key>/... for guild-wide ones. The keys are not looked up yet; that
// arrives with the data layer (resolve_address(), #1114), along with the
// redirect for retired keys.
export const routes: RouteObject[] = [
  { path: '/', element: <Navigate to={defaultGuildPath()} replace /> },
  {
    path: '/g/:guildKey',
    element: <AppShell />,
    children: [
      { index: true, element: <GuildHomePage />, handle: { title: 'Guild home' } satisfies RouteHandle },
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
            // My profile has tabs, each with its own address (/me/gear).
            path: path === 'me' ? 'me/:tab?' : path,
            // Officer tools open only for the people who may use them (#1100: they sit under /officer/).
            element: path.startsWith('officer/') ? (
              <RequireAbility ability="viewOfficerTools" title={title}>
                <PlaceholderPage title={title} />
              </RequireAbility>
            ) : (
              (BUILT_PAGES[path] ?? <PlaceholderPage title={title} />)
            ),
            handle: { title } satisfies RouteHandle
          })),
          // A player's profile by its address code (#1100), for the raider and officers.
          {
            path: 'p/:playerCode/:tab?',
            element: <PlayerProfilePage />,
            handle: { title: 'Profile' } satisfies RouteHandle
          }
        ]
      },
      { path: '*', element: <NotFoundPage />, handle: { title: 'Page not found' } satisfies RouteHandle }
    ]
  },
  { path: '*', element: <NotFoundPage /> }
];
