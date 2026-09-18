import type { IconName } from '../components/Icon';

// `end`: current only on its exact address. Home needs it, since every team
// page sits below it; My profile must not have it, so its tabs keep it current.
// `mark`: a dot saying there is something new behind the item (News).
export type NavItem = { label: string; icon: IconName; to: string; end?: boolean; mark?: boolean };
export type NavGroup = { heading: string; items: NavItem[] };

// Sidebar groups from the 2026-09-13 mockups, in one order on every page so
// nothing moves under the pointer when a link changes the page (#1228). Team
// pages hang off /g/<guild>/t/<team>, guild-wide ones off /g/<guild>, and
// officer tools sit under /officer/ (#1100).
export function navGroups(
  base: { team: string; guild: string },
  show: { officer: boolean; newsUnread?: boolean }
): NavGroup[] {
  const groups: NavGroup[] = [
    {
      heading: 'Guild',
      items: [
        { label: 'Guild home', icon: 'home', to: base.guild, end: true },
        { label: 'BoE sales', icon: 'coin', to: `${base.guild}/boe` },
        { label: 'Streams', icon: 'tv', to: `${base.guild}/streams` },
        { label: 'News', icon: 'news', to: `${base.guild}/news`, mark: show.newsUnread ?? false }
      ]
    },
    { heading: 'You', items: [{ label: 'My profile', icon: 'user', to: `${base.team}/me` }] },
    {
      heading: 'Team',
      items: [
        { label: 'Home', icon: 'home', to: base.team, end: true },
        { label: 'Roster', icon: 'roster', to: `${base.team}/roster` },
        { label: 'Calendar', icon: 'calendar', to: `${base.team}/calendar` },
        { label: 'Loot history', icon: 'loot', to: `${base.team}/loot` }
      ]
    },
    {
      heading: 'Officer',
      items: [
        { label: 'Loot priority', icon: 'list', to: `${base.team}/officer/priority` },
        { label: 'Import loot', icon: 'import', to: `${base.team}/officer/import` },
        { label: 'Reviews', icon: 'check', to: `${base.team}/officer/reviews` },
        { label: 'Attendance', icon: 'chart', to: `${base.team}/officer/attendance` },
        { label: 'Season settings', icon: 'gear', to: `${base.team}/officer/season` }
      ]
    }
  ];
  // The Officer group is only for people who can open those pages.
  return show.officer ? groups : groups.filter((g) => g.heading !== 'Officer');
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
  'officer/attendance': 'Attendance',
  'officer/season': 'Season settings'
};

export const GUILD_PAGES: Record<string, string> = {
  boe: 'BoE sales',
  streams: 'Streams',
  news: 'News'
};
