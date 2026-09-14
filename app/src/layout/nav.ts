import type { IconName } from '../components/Icon';

export type NavItem = { label: string; icon: IconName; to: string };
export type NavGroup = { heading: string; items: NavItem[] };

// Sidebar groups from the 2026-09-13 mockups. Team pages hang off
// /g/<guild>/t/<team>, guild-wide ones off /g/<guild>, and officer tools sit
// under /officer/ (#1100).
export function navGroups(base: { team: string; guild: string }, show: { officer: boolean }): NavGroup[] {
  const groups: NavGroup[] = [
    {
      heading: 'Team',
      items: [
        { label: 'Home', icon: 'home', to: base.team },
        { label: 'Roster', icon: 'roster', to: `${base.team}/roster` },
        { label: 'Calendar', icon: 'calendar', to: `${base.team}/calendar` },
        { label: 'Loot history', icon: 'loot', to: `${base.team}/loot` }
      ]
    },
    { heading: 'You', items: [{ label: 'My profile', icon: 'user', to: `${base.team}/me` }] },
    {
      heading: 'Officer',
      items: [
        { label: 'Loot priority', icon: 'list', to: `${base.team}/officer/priority` },
        { label: 'Import loot', icon: 'import', to: `${base.team}/officer/import` },
        { label: 'Reviews', icon: 'check', to: `${base.team}/officer/reviews` },
        { label: 'Attendance', icon: 'chart', to: `${base.team}/officer/attendance` },
        { label: 'Season settings', icon: 'gear', to: `${base.team}/officer/season` }
      ]
    },
    {
      heading: 'Guild',
      items: [
        { label: 'BoE sales', icon: 'coin', to: `${base.guild}/boe` },
        { label: 'Streams', icon: 'tv', to: `${base.guild}/streams` },
        { label: 'News', icon: 'news', to: `${base.guild}/news` }
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
