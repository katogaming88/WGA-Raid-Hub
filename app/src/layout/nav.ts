import type { IconName } from '../components/Icon';

// `end`: current only on its exact address. Home needs it, since every team
// page sits below it; My profile must not have it, so its tabs keep it current.
// `mark`: a dot saying there is something new behind the item (News).
// `live`: a count of who is live behind the item (Streams); nothing when 0.
// `pages`: the item is a group that opens to show these links (the Officer menu, #869).
export type NavPage = { label: string; to: string; danger?: boolean };
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
  show: { officer: boolean; newsUnread?: boolean; liveCount?: number }
): NavGroup[] {
  const groups: NavGroup[] = [
    {
      heading: 'Guild',
      items: [
        { label: 'Guild home', icon: 'home', to: base.guild, end: true },
        { label: 'BoE sales', icon: 'coin', to: `${base.guild}/boe` },
        { label: 'Streams', icon: 'tv', to: `${base.guild}/streams`, live: show.liveCount ?? 0 },
        { label: 'News', icon: 'news', to: `${base.guild}/news`, mark: show.newsUnread ?? false },
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
      items: officerMenu(`${base.team}/officer`)
    },
    {
      heading: 'Site',
      items: [
        { label: 'About', icon: 'info', to: `${base.guild}/about` },
        { label: 'Help', icon: 'help', to: `${base.guild}/help` }
      ]
    }
  ];
  // The Officer group is only for people who can open those pages.
  return show.officer ? groups : groups.filter((g) => g.heading !== 'Officer');
}

// The officer menu from the #869 decision: similar pages in one group, one
// group open at a time. Anything that changes the team as a whole is a setting.
function officerMenu(o: string): NavItem[] {
  return [
    {
      label: 'Loot',
      icon: 'loot',
      to: `${o}/priority`,
      pages: [
        { label: 'Priority', to: `${o}/priority` },
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
      pages: [
        { label: 'Loot fairness', to: `${o}/reports/loot-fairness` },
        { label: 'Bench fairness', to: `${o}/reports/bench-fairness` }
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
  'officer/settings': 'General settings',
  'officer/settings/season': 'Season settings',
  'officer/settings/progression': 'Raid progression',
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
  news: 'News',
  officers: 'Guild officers',
  about: 'About',
  help: 'Help'
};
