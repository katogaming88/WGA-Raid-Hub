import type { ReactElement } from 'react';
import { Navigate, useLocation, type RouteObject } from 'react-router';
import { RosterPage } from './roster/RosterPage';
import { MyProfilePage, PlayerProfilePage } from './profile/ProfilePage';
import { AppShell } from './layout/AppShell';
import { HomePage } from './home/HomePage';
import { CalendarPage } from './calendar/CalendarPage';
import { BossGroupsPage } from './calendar/BossGroupsPage';
import { AttendanceManagePage } from './attendance/AttendanceManagePage';
import { BenchFairnessPage, LootFairnessPage } from './reports/FairnessPages';
import { RaidNightsPage, TierSetsPage } from './reports/TableReports';
import { BisDemandPage, LootPacePage, PriorityHealthPage } from './reports/SeasonReports';
import { LineupReportPage } from './reports/LineupReport';
import { PriorityPage } from './priority/PriorityPage';
import { GeneralSettingsPage } from './settings/GeneralSettingsPage';
import { SeasonSettingsPage } from './settings/SeasonSettingsPage';
import { ProgressionSettingsPage } from './settings/ProgressionSettingsPage';
import { LootSettingsPage } from './settings/LootSettingsPage';
import { AuditLogPage } from './settings/AuditLogPage';
import { DangerZonePage } from './settings/DangerZonePage';
import { GuildHomePage } from './guild/GuildHomePage';
import { BoePage } from './boe/BoePage';
import { NewsPage } from './news/NewsPage';
import { StreamsPage } from './streams/StreamsPage';
import { HelpPage } from './help/HelpPage';
import { AboutPage } from './about/AboutPage';
import { HistoryPage } from './history/HistoryPage';
import { SignUpPage } from './signup/SignUpPage';
import { GuildOfficersPage } from './officers/GuildOfficersPage';
import { TeamOfficersPage } from './officers/TeamOfficersPage';
import { InviteLinkPage } from './invite/InviteLinkPage';
import { SiteAdminPage } from './siteadmin/SiteAdminPage';
import { CreateGuildPage } from './front/CreateGuildPage';
import { FrontPage } from './front/FrontPage';
import { JoinRoute } from './join/JoinRoute';
import { ImportLootPage } from './loot/ImportLootPage';
import { ReviewsPage } from './loot/ReviewsPage';
import { ReassignPage } from './loot/ReassignPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ErrorPage } from './pages/ErrorPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { RequireAbility } from './auth/RequireAbility';
import { GUILD_PAGES, SITE_PAGES, TEAM_PAGES } from './layout/nav';

export type RouteHandle = { title: string };

// Team pages rebuilt so far (#1102). Every other page in TEAM_PAGES is still a
// placeholder.
const BUILT_PAGES: Record<string, ReactElement> = {
  roster: <RosterPage />,
  calendar: <CalendarPage />,
  me: <MyProfilePage />,
  'officer/priority': <PriorityPage />,
  'officer/import': <ImportLootPage />,
  'officer/reviews': <ReviewsPage />,
  'officer/reassign': <ReassignPage />,
  'officer/groups': <BossGroupsPage />,
  // 'officer/attendance/scores' stays a placeholder (Kat, 2026-09-27): Profile
  // already shows a raider's attendance pct and flagged nights, so a
  // dedicated Scores page has nothing Roster -> Profile doesn't.
  'officer/attendance': <AttendanceManagePage />,
  'officer/reports/loot-fairness': <LootFairnessPage />,
  'officer/reports/bench-fairness': <BenchFairnessPage />,
  'officer/reports/boss-lineups': <LineupReportPage />,
  'officer/reports/raid-nights': <RaidNightsPage />,
  'officer/reports/tier-sets': <TierSetsPage />,
  'officer/reports/bis-demand': <BisDemandPage />,
  'officer/reports/loot-pace': <LootPacePage />,
  'officer/reports/priority-health': <PriorityHealthPage />,
  history: <HistoryPage />,
  officers: <TeamOfficersPage />,
  signup: <SignUpPage />,
  'officer/invite': <InviteLinkPage />,
  'officer/settings': <GeneralSettingsPage />,
  'officer/settings/season': <SeasonSettingsPage />,
  'officer/settings/progression': <ProgressionSettingsPage />,
  'officer/settings/loot': <LootSettingsPage />,
  'officer/settings/audit-log': <AuditLogPage />,
  'officer/settings/danger': <DangerZonePage />
};

// Guild pages rebuilt so far (#1102), beside Guild home itself.
const BUILT_GUILD_PAGES: Record<string, ReactElement> = {
  boe: <BoePage />,
  streams: <StreamsPage />,
  officers: <GuildOfficersPage />
};

// The site pages (#1482), in the frame of the guild last visited.
const BUILT_SITE_PAGES: Record<string, ReactElement> = {
  news: <NewsPage />,
  about: <AboutPage />,
  help: <HelpPage />,
  'site-admin': (
    <RequireAbility ability="adminSite" title={SITE_PAGES['site-admin']!} forWhom="Staff">
      <SiteAdminPage />
    </RequireAbility>
  )
};

// An old /g/<guild>/news address, posted in Discord before #1482, keeps working.
function ToSitePage({ path }: { path: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={`/${path}${search}${hash}`} replace />;
}

// Addresses from #1100: /g/<guild key>/t/<team key>/... for team pages,
// /g/<guild key>/... for guild-wide ones. The keys are not looked up yet; that
// arrives with the data layer (resolve_address(), #1114), along with the
// redirect for retired keys.
// A crash outside the frame, or in the frame itself, shows the crash screen
// on its own (#1477).
const standalone = (page: ReactElement) => (
  <main id="main" className="page-standalone">
    {page}
  </main>
);
const crashed = standalone(<ErrorPage />);

export const routes: RouteObject[] = [
  { path: '/join/:code', element: <JoinRoute />, errorElement: crashed },
  {
    element: <AppShell />,
    errorElement: crashed,
    children: [
      {
        errorElement: <ErrorPage siteFrame />,
        children: [
          // The site front page (#1226), inside the frame like the other site
          // pages, for everyone (Kat, 2026-10-15).
          { path: '/', element: <FrontPage />, handle: { title: 'Front page' } satisfies RouteHandle },
          {
            path: '/new-guild',
            element: <CreateGuildPage />,
            handle: { title: 'Create your guild' } satisfies RouteHandle
          },
          ...Object.entries(SITE_PAGES).map(([path, title]) => ({
            // A guide open over the Help page has its own address, to post in
            // Discord (#1526); one route, so the page stays put as guides open.
            path: path === 'help' ? '/help/:guideId?' : `/${path}`,
            element: BUILT_SITE_PAGES[path],
            handle: { title } satisfies RouteHandle
          }))
        ]
      }
    ]
  },
  {
    path: '/g/:guildKey',
    element: <AppShell />,
    errorElement: crashed,
    children: [
      // A crash in a page shows inside the frame, so the sidebar still works.
      {
        errorElement: <ErrorPage />,
        children: [
          { index: true, element: <GuildHomePage />, handle: { title: 'Guild home' } satisfies RouteHandle },
          ...Object.entries(GUILD_PAGES).map(([path, title]) => ({
            path,
            element: BUILT_GUILD_PAGES[path] ?? <PlaceholderPage title={title} />,
            handle: { title } satisfies RouteHandle
          })),
          ...Object.keys(SITE_PAGES).map((path) => ({ path, element: <ToSitePage path={path} /> })),
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
                    {BUILT_PAGES[path] ?? <PlaceholderPage title={title} />}
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
              },
              // Here too, so a wrong team page offers the team's home.
              { path: '*', element: <NotFoundPage />, handle: { title: 'Page not found' } satisfies RouteHandle }
            ]
          },
          { path: '*', element: <NotFoundPage />, handle: { title: 'Page not found' } satisfies RouteHandle }
        ]
      }
    ]
  },
  { path: '*', element: standalone(<NotFoundPage />), errorElement: crashed }
];
