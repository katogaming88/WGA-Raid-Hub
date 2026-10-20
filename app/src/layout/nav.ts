import type { IconName } from '../components/Icon';

// `end`: current only on its exact address. Home needs it, since every team
// page sits below it; My profile must not have it, so its tabs keep it current.
// `mark`: a dot saying there is something new behind the item (News).
// `live`: a count of who is live behind the item (Streams); nothing when 0.
// `pages`: the item is a group that opens to show these links (the Officer menu, #869).
// `tabs`: the page is one of several reports shown as tabs on one page; the
// item stays current on any of them.
export type NavPage = { label: string; to: string; danger?: boolean; tabs?: NavPage[] };
export type NavItem = {
  label: string;
  icon: IconName;
  to: string;
  end?: boolean;
  mark?: boolean;
  live?: number;
  pages?: NavPage[];
};
export type NavGroup = { heading: string; items: NavItem[] };

// Sidebar groups from the 2026-09-13 mockups, in one order on every page so
// nothing moves under the pointer when a link changes the page (#1228). Team
// pages hang off /g/<guild>/t/<team>, guild-wide ones off /g/<guild>, and
// officer tools sit under /officer/ (#1100).
export function navGroups(
  base: { team: string; guild: string },
  show: { officer: boolean; siteAdmin?: boolean; newsUnread?: boolean; liveCount?: number; council?: boolean }
): NavGroup[] {
  const groups: NavGroup[] = [
    {
      heading: 'Guild',
      items: [
        { label: 'Guild home', icon: 'home', to: base.guild, end: true },
        { label: 'BoE sales', icon: 'coin', to: `${base.guild}/boe` },
        { label: 'Streams', icon: 'tv', to: `${base.guild}/streams`, live: show.liveCount ?? 0 },
        { label: 'Guild officers', icon: 'shield', to: `${base.guild}/officers` }
      ]
    },
    { heading: 'You', items: [{ label: 'My profile', icon: 'user', to: `${base.team}/me` }] },
    {
      heading: 'Team',
      items: [
        { label: 'Home', icon: 'home', to: base.team, end: true },
        { label: 'Roster', icon: 'roster', to: `${base.team}/roster` },
        { label: 'Calendar', icon: 'calendar', to: `${base.team}/calendar` },
        { label: 'Loot history', icon: 'loot', to: `${base.team}/loot` },
        { label: 'History', icon: 'clock', to: `${base.team}/history` },
        { label: 'Team officers', icon: 'shield', to: `${base.team}/officers` }
      ]
    },
    {
      heading: 'Officer',
      items: officerMenu(`${base.team}/officer`, show.council ?? false)
    },
    {
      heading: 'Site',
      // News is about the site itself, not one guild (Kat, 2026-10-07), so
      // these pages have site addresses (#1482).
      items: [
        { label: 'News', icon: 'news', to: '/news', mark: show.newsUnread ?? false },
        { label: 'About', icon: 'info', to: '/about' },
        { label: 'Help', icon: 'help', to: '/help' },
        // Last in Site, for Staff only (Kat, 2026-10-14, #1364).
        ...(show.siteAdmin ? [{ label: 'Site admin', icon: 'gear' as const, to: '/site-admin' }] : [])
      ]
    }
  ];
  // The Officer group is only for people who can open those pages.
  return show.officer ? groups : groups.filter((g) => g.heading !== 'Officer');
}

const REPORT_TABS = {
  loot: [
    ['Fairness', 'loot-fairness'],
    ['Nights since last item', 'raid-nights'],
    ['BiS demand', 'bis-demand'],
    ['Loot pace', 'loot-pace'],
    ['Priority order health', 'priority-health'],
    ['Tier sets', 'tier-sets']
  ],
  bench: [
    ['Bench fairness', 'bench-fairness'],
    ['Boss lineups', 'boss-lineups']
  ]
} as const;

export type ReportKind = keyof typeof REPORT_TABS;
export const REPORT_KINDS = Object.keys(REPORT_TABS) as ReportKind[];

// Reports read from wishlists and priority orders, left out for a Loot
// council team (#1563), which uses neither.
const WISHLIST_REPORTS: string[] = ['bis-demand', 'priority-health'];

export function reportTabs(o: string, kind: ReportKind, council = false): NavPage[] {
  return REPORT_TABS[kind]
    .filter(([, path]) => !council || !WISHLIST_REPORTS.includes(path))
    .map(([label, path]) => ({ label, to: `${o}/reports/${path}` }));
}

// The page a sidebar page item stands for, when the address is it or one of its tabs.
export const pageHolds = (page: NavPage, pathname: string) =>
  page.to === pathname || !!page.tabs?.some((t) => t.to === pathname);

// The officer menu from the #869 decision: similar pages in one group, one
// group open at a time. Anything that changes the team as a whole is a setting.
// A Loot council team (#1563) has no Priority page.
function officerMenu(o: string, council: boolean): NavItem[] {
  return [
    {
      label: 'Loot',
      icon: 'loot',
      to: council ? `${o}/import` : `${o}/priority`,
      pages: [
        ...(council ? [] : [{ label: 'Priority', to: `${o}/priority` }]),
        { label: 'Import', to: `${o}/import` },
        { label: 'Reviews', to: `${o}/reviews` },
        { label: 'Reassign', to: `${o}/reassign` }
      ]
    },
    {
      label: 'Attendance',
      icon: 'chart',
      to: `${o}/attendance`,
      pages: [
        { label: 'Manage', to: `${o}/attendance` },
        { label: 'Scores', to: `${o}/attendance/scores` },
        { label: 'Boss groups', to: `${o}/groups` }
      ]
    },
    {
      label: 'Reports',
      icon: 'news',
      to: `${o}/reports/loot-fairness`,
      // Reports of a kind share one item, each a tab on its page, so the
      // sidebar stays short (Kat, 2026-10-18). Each keeps its own address.
      pages: [
        { label: 'Loot', to: `${o}/reports/loot-fairness`, tabs: reportTabs(o, 'loot', council) },
        { label: 'Bench and lineups', to: `${o}/reports/bench-fairness`, tabs: reportTabs(o, 'bench') },
        // A placeholder until #1503 decides what it shows (Kat, 2026-10-11).
        { label: 'Performance trends', to: `${o}/reports/performance` }
      ]
    },
    {
      label: 'Settings',
      icon: 'gear',
      to: `${o}/settings`,
      pages: [
        { label: 'General', to: `${o}/settings` },
        { label: 'Season', to: `${o}/settings/season` },
        { label: 'Raid progression', to: `${o}/settings/progression` },
        { label: 'Loot', to: `${o}/settings/loot` },
        { label: 'Signups', to: `${o}/settings/signups` },
        { label: 'Invite link', to: `${o}/invite` },
        { label: 'Audit log', to: `${o}/settings/audit-log` },
        { label: 'Danger zone', to: `${o}/settings/danger`, danger: true }
      ]
    }
  ];
}

// Every page the shell knows about, by path below its base, so the routes and
// the page titles come from one list.
export const TEAM_PAGES: Record<string, string> = {
  roster: 'Roster',
  calendar: 'Calendar',
  loot: 'Loot history',
  me: 'My profile',
  // Linked from Guild home's team cards; the page itself is still to come.
  signup: 'Sign up',
  'officer/priority': 'Loot priority',
  'officer/import': 'Import loot',
  'officer/reviews': 'Reviews',
  'officer/reassign': 'Reassign loot',
  'officer/attendance': 'Manage attendance',
  'officer/attendance/scores': 'Attendance scores',
  'officer/groups': 'Boss groups',
  'officer/reports/loot-fairness': 'Loot fairness',
  'officer/reports/bench-fairness': 'Bench fairness',
  'officer/reports/boss-lineups': 'Boss lineups',
  'officer/reports/raid-nights': 'Raid nights since last item',
  'officer/reports/bis-demand': 'BiS demand',
  'officer/reports/loot-pace': 'Loot pace',
  'officer/reports/priority-health': 'Priority order health',
  'officer/reports/tier-sets': 'Tier sets',
  'officer/reports/performance': 'Performance trends',
  'officer/settings': 'General settings',
  'officer/settings/season': 'Season settings',
  'officer/settings/progression': 'Raid progression',
  'officer/settings/loot': 'Loot settings',
  'officer/settings/signups': 'Signup settings',
  'officer/invite': 'Invite link',
  'officer/settings/audit-log': 'Audit log',
  'officer/settings/danger': 'Danger zone',
  history: 'History',
  officers: 'Team officers'
};

export const GUILD_PAGES: Record<string, string> = {
  boe: 'BoE sales',
  streams: 'Streams',
  officers: 'Guild officers'
};

// Pages about the site itself, at /<path> with no guild in the address (#1482).
// Their old /g/<guild>/<path> addresses forward here.
export const SITE_PAGES: Record<string, string> = {
  news: 'News',
  about: 'About',
  help: 'Help',
  'site-admin': 'Site admin'
};
