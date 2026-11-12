// The public apply pages (#1546): what each team card and team page shows,
// from team_recruiting_page() (#1535). Pure functions of the rows read.

export const ROLES = ['tank', 'healer', 'melee', 'ranged'] as const;
export type Role = (typeof ROLES)[number];
export type RoleFilter = Role | 'any';

export const FILTER_LABELS: Record<RoleFilter, string> = {
  any: 'Anything',
  tank: 'Tank',
  healer: 'Healer',
  melee: 'Melee',
  ranged: 'Ranged'
};

const NEEDS_LABELS: Record<Role, string> = { tank: 'a tank', healer: 'a healer', melee: 'melee', ranged: 'ranged' };

export const needsTag = (role: Role) => `Needs ${NEEDS_LABELS[role]}`;

export type Priority = 'high' | 'medium' | 'low';
export const PRIORITY_LABELS: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const PRIORITY_ORDER: Priority[] = ['high', 'medium', 'low'];

export type Spot = {
  role: Role;
  class_spec_id: number | null;
  class: string | null;
  spec: string | null;
  priority: Priority;
};

export type Night = {
  weekday: number;
  start_time: string;
  timezone: string;
  duration_minutes: number;
  is_optional: boolean;
  difficulty: string | null;
};

export type ProgressLine = {
  zone: string;
  season: number | string | null;
  boss: string;
  mythic_date: string | null;
  heroic_date: string | null;
};

export type RecruitingTeam = {
  team_id: number;
  name: string;
  slug: string;
  taking_applications: boolean;
  join_method: 'application' | 'discord_ticket';
  ticket_link: string | null;
  about: string | null;
  schedule_note: string | null;
  extra_night: 'none' | 'first_two_weeks' | 'sometimes';
  raid_languages: string[];
  split_runs: string;
  alts_expected: number | null;
  ptr_testing: string;
  min_item_level: number | null;
  attendance_percent: number | null;
  trial_days: number;
  logs_required: boolean;
  other_requirements: string | null;
  exceptional_line: string | null;
  spots: Spot[];
  nights: Night[];
  progress: ProgressLine[];
};

// High first, the team's own order inside a priority.
export const sortedSpots = (spots: Spot[]): Spot[] =>
  PRIORITY_ORDER.flatMap((p) => spots.filter((s) => s.priority === p));

export const spotLabel = (s: Spot): string =>
  s.spec && s.class ? `${s.spec} ${s.class}` : `Any ${s.role === 'tank' ? 'tank' : s.role}`;

export const needsRole = (team: RecruitingTeam, role: RoleFilter): boolean =>
  role !== 'any' && team.taking_applications && team.spots.some((s) => s.role === role);

// How the team takes people, in the page's words.
export const joinNote = (team: RecruitingTeam): string =>
  team.join_method === 'application'
    ? 'Short application here, then we open your Discord ticket'
    : 'Open a ticket in our Discord and chat with the officers';

// "Mythic 4/9" and "Heroic 9/9 this season" for the newest raid the team has
// progress in: Mythic when any boss is down, else Heroic. Null with no rows.
export function progressSummary(lines: ProgressLine[]): { main: string; sub: string } | null {
  if (!lines.length) return null;
  const newest = lines.reduce((best, l) => (Number(l.season ?? 0) >= Number(best.season ?? 0) ? l : best));
  const raid = lines.filter((l) => l.zone === newest.zone);
  const mythic = raid.filter((l) => l.mythic_date).length;
  const heroic = raid.filter((l) => l.heroic_date).length;
  const total = raid.length;
  return mythic > 0
    ? { main: `Mythic ${mythic}/${total}`, sub: `Heroic ${heroic}/${total} in ${newest.zone}` }
    : { main: `Heroic ${heroic}/${total}`, sub: newest.zone };
}

const EXTRA_NIGHT: Record<RecruitingTeam['extra_night'], string | null> = {
  none: null,
  first_two_weeks: 'An extra raid night in the first two weeks of a new raid',
  sometimes: 'An extra raid night now and then'
};

const SPLITS: Record<string, string> = { early_season: 'early in a season', weekly: 'every week' };
const PTR: Record<string, string> = { optional: 'optional', expected: 'expected' };

// The quick facts under a team's page, each only when the team set it.
export function quickFacts(team: RecruitingTeam): string[] {
  const facts: string[] = [];
  if (team.raid_languages.length) facts.push(`Raid language: ${team.raid_languages.join(', ')}`);
  if (team.split_runs !== 'none') facts.push(`Split runs: ${SPLITS[team.split_runs] ?? team.split_runs}`);
  if (team.alts_expected !== null) {
    facts.push(
      team.alts_expected === 0
        ? 'No alts expected'
        : `${team.alts_expected} alt${team.alts_expected === 1 ? '' : 's'} expected`
    );
  }
  if (team.ptr_testing !== 'none') facts.push(`PTR testing: ${PTR[team.ptr_testing] ?? team.ptr_testing}`);
  const extra = EXTRA_NIGHT[team.extra_night];
  if (extra) facts.push(extra);
  if (team.schedule_note) facts.push(team.schedule_note);
  return facts;
}

// What a team asks of an applicant.
export function requirements(team: RecruitingTeam): string[] {
  const asks: string[] = [];
  if (team.min_item_level !== null) asks.push(`Item level ${team.min_item_level}+ on the character you apply with`);
  if (team.logs_required) asks.push('Warcraft Logs from this season');
  if (team.attendance_percent !== null) asks.push(`Make ${team.attendance_percent}% of raid nights`);
  asks.push(`${team.trial_days}-day trial before a full spot`);
  if (team.other_requirements) asks.push(team.other_requirements);
  return asks;
}
