// The Calendar page's rules (#1102): which nights exist, what each raider's
// status is for a night, and what the night page groups and counts. Pure
// functions of rows already read, so the behaviour recorded from the current
// site (tests/behavior/calendar.js) is checked here as well as in a browser.

import { isoDate } from './nights';
import { ROLE_LABELS, ROLE_ORDER, type PlayerRow, type Role } from '../roster/roster';

export type ScheduleRule = {
  weekday: number;
  start_time: string | null;
  duration_minutes: number | null;
  is_optional: boolean;
};

export type ScheduleChange = {
  raid_date: string;
  exception_type: string;
  start_time: string | null;
  duration_minutes: number | null;
  is_optional: boolean;
  note: string | null;
};

// A raider's answer for a night. Officers read the note; raiders read it only
// on their own answers (team_rsvp_answers() leaves it out).
export type Answer = {
  player_id: number;
  raid_date: string;
  status: string;
  updated_at: string;
  note?: string | null;
};

export type RaidNight = {
  date: string;
  start: string | null;
  durationMinutes: number | null;
  optional: boolean;
  // Added for this date only, rather than from the weekly schedule.
  extra: boolean;
  note: string;
};

export type CancelledNight = { date: string; start: string | null; durationMinutes: number | null };

const dayOf = (date: string) => new Date(`${date}T00:00:00`);

// Every raid night between two dates (inclusive), and the scheduled nights a
// one-off change cancelled. A cancelled date drops that day's usual nights;
// an added night on the same date still happens.
export function nightsBetween(
  schedule: ScheduleRule[],
  changes: ScheduleChange[],
  from: string,
  to: string
): { nights: RaidNight[]; cancelled: CancelledNight[] } {
  const cancelledDates = new Set(changes.filter((c) => c.exception_type === 'cancelled').map((c) => c.raid_date));
  const added = new Map(changes.filter((c) => c.exception_type === 'added').map((c) => [c.raid_date, c]));
  const nights: RaidNight[] = [];
  const cancelled: CancelledNight[] = [];
  for (let d = dayOf(from); d <= dayOf(to); d.setDate(d.getDate() + 1)) {
    const date = isoDate(d);
    for (const rule of schedule) {
      if (rule.weekday !== d.getDay()) continue;
      const night = { date, start: rule.start_time, durationMinutes: rule.duration_minutes };
      if (cancelledDates.has(date)) cancelled.push(night);
      else nights.push({ ...night, optional: rule.is_optional, extra: false, note: '' });
    }
    const extra = added.get(date);
    if (extra) {
      nights.push({
        date,
        start: extra.start_time,
        durationMinutes: extra.duration_minutes,
        optional: extra.is_optional,
        extra: true,
        note: extra.note ?? ''
      });
    }
  }
  return { nights, cancelled };
}

export const firstOfMonth = (year: number, month: number) => isoDate(new Date(year, month, 1));
export const lastOfMonth = (year: number, month: number) => isoDate(new Date(year, month + 1, 0));

// "2026-05" <-> year and month.
export function parseMonth(value: string | null, today: Date): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? '');
  if (match) {
    const month = Number(match[2]) - 1;
    if (month >= 0 && month < 12) return { year: Number(match[1]), month };
  }
  return { year: today.getFullYear(), month: today.getMonth() };
}

export const monthParam = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`;

export const isDateParam = (value: string | null): value is string =>
  !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && isoDate(dayOf(value)) === value;

// Raid times are the team's own, which are Eastern for every team today.
function clock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m === 0) return 'midnight';
  if (m === 720) return 'noon';
  const hours = Math.floor(m / 60);
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

export function startTime(night: { start: string | null }): string {
  return night.start ? clock(minutesOf(night.start)) : 'Time not set';
}

export function timeRange(night: { start: string | null; durationMinutes: number | null }): string {
  if (!night.start) return 'Time not set';
  const start = minutesOf(night.start);
  const end = night.durationMinutes ? ` to ${clock(start + night.durationMinutes)}` : '';
  return `${clock(start)}${end} Eastern`;
}

export const nightTitle = (night: Pick<RaidNight, 'optional' | 'extra'>) =>
  night.optional ? 'Optional night' : night.extra ? 'Extra night' : 'Raid night';

// Statuses

// How a status reads at a glance, in shape and colour as well as its word.
export type Kind = 'in' | 'flag' | 'out' | 'apart';

export type NightStatus = {
  label: string;
  kind: Kind;
  // The raider (or an officer) set it, rather than it being the default.
  answered: boolean;
};

// The answers a raider can give. Present is not stored: choosing it clears the
// answer. Attending is only for an optional night, which has no default.
export const ANSWERS = ['Late', 'Leaving Early', 'Tentative', 'Absent'] as const;
export const PRESENT = 'Present';
export const ATTENDING = 'Attending';

const LABELS: Record<string, string> = { 'Leaving Early': 'Leaving early', 'Rotator-In': 'In this week' };
export const answerLabel = (status: string) => LABELS[status] ?? status;

const kindOf = (status: string): Kind =>
  status === 'Absent' ? 'out' : status === 'Attending' || status === 'Rotator-In' || status === PRESENT ? 'in' : 'flag';

// A raider's status for a night: their answer when there is one; otherwise the
// bench and rotators sit apart on a normal night, nobody is expected on an
// optional night until they say so, and everyone else is Present.
export function statusFor(player: PlayerRow, night: Pick<RaidNight, 'optional'>, answer?: Answer): NightStatus {
  if (answer) return { label: answerLabel(answer.status), kind: kindOf(answer.status), answered: true };
  if (!night.optional && player.is_bench) return { label: 'Bench', kind: 'apart', answered: false };
  if (!night.optional && player.is_rotator) return { label: 'Rotator', kind: 'apart', answered: false };
  if (night.optional) return { label: 'No answer', kind: 'flag', answered: false };
  return { label: PRESENT, kind: 'in', answered: false };
}

// The night page

export type NightRow = {
  player: PlayerRow;
  name: string;
  character: string;
  role: Role;
  status: NightStatus;
  note: string;
  updatedAt: string | null;
};

export type NightView = {
  groups: { role: Role; label: string; coming: number; total: number; rows: NightRow[]; apart: NightRow[] }[];
  // Who is out, and who is late, leaving early or tentative. These raiders
  // leave the role columns, so the columns list who is coming as normal.
  headsUp: { out: NightRow[]; flagged: NightRow[] };
  counts: { in: number; flagged: number; out: number; apart: number };
  // The newest answers for the night.
  latest: NightRow[];
};

export const displayName = (p: Pick<PlayerRow, 'nickname' | 'name_realm'>) =>
  p.nickname?.trim() || p.name_realm.split('-')[0]!.trim();

const isRole = (role: string | null | undefined): role is Role => ROLE_ORDER.includes(role as Role);

// The roster: characters with a role, as the Roster page lists them.
export const rosterOf = (players: PlayerRow[]) => players.filter((p) => isRole(p.classes_specs?.role));

export function nightView(players: PlayerRow[], night: RaidNight, answers: Answer[]): NightView {
  const byPlayer = new Map(answers.filter((a) => a.raid_date === night.date).map((a) => [a.player_id, a]));
  const rows: NightRow[] = rosterOf(players)
    .map((player) => {
      const answer = byPlayer.get(player.id);
      return {
        player,
        name: displayName(player),
        character: player.name_realm.split('-')[0]!.trim(),
        role: player.classes_specs!.role as Role,
        status: statusFor(player, night, answer),
        note: answer?.note?.trim() ?? '',
        updatedAt: answer?.updated_at ?? null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Heads up is for answers someone gave; an optional night's "No answer" is
  // everyone's default, not news.
  const movedUp = (r: NightRow) => r.status.answered && (r.status.kind === 'out' || r.status.kind === 'flag');
  const coming = (r: NightRow) => r.status.kind === 'in' || (r.status.kind === 'flag' && r.status.answered);

  return {
    groups: ROLE_ORDER.map((role) => {
      const inRole = rows.filter((r) => r.role === role);
      const expected = inRole.filter((r) => r.status.kind !== 'apart');
      return {
        role,
        label: ROLE_LABELS[role],
        coming: expected.filter(coming).length,
        total: expected.length,
        rows: expected.filter((r) => !movedUp(r)),
        apart: inRole.filter((r) => r.status.kind === 'apart')
      };
    }).filter((g) => g.total + g.apart.length > 0),
    headsUp: {
      out: rows.filter((r) => movedUp(r) && r.status.kind === 'out'),
      flagged: rows.filter((r) => movedUp(r) && r.status.kind === 'flag')
    },
    counts: {
      in: rows.filter(coming).length,
      flagged: rows.filter((r) => r.status.answered && r.status.kind === 'flag').length,
      out: rows.filter((r) => r.status.kind === 'out').length,
      apart: rows.filter((r) => r.status.kind === 'apart').length
    },
    latest: rows
      .filter((r) => r.updatedAt)
      .sort((a, b) => (a.updatedAt! < b.updatedAt! ? 1 : -1))
      .slice(0, 5)
  };
}

// The month page: a night's count and the reader's own answer.
export function monthCounts(players: PlayerRow[], night: RaidNight, answers: Answer[]) {
  const counts = nightView(players, night, answers).counts;
  return { in: counts.in, out: counts.out };
}

// The previous and next raid nights around a date, from a list in date order.
export function neighbours(nights: RaidNight[], date: string) {
  const dates = [...new Set(nights.map((n) => n.date))].sort();
  return {
    previous: dates.filter((d) => d < date).at(-1) ?? null,
    next: dates.find((d) => d > date) ?? null
  };
}

// The Sunday that starts the week a date falls in, which is what putting a
// rotator in "for the week" means.
export function weekStart(date: string): string {
  const d = dayOf(date);
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}

// "2 hours ago", for when an answer changed. The reader's own clock.
export function ago(instant: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(instant).getTime()) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(instant));
}

const LONG_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const SHORT_DAY = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });

export const longDay = (date: string) => LONG_DAY.format(dayOf(date));
export const shortDay = (date: string) => SHORT_DAY.format(dayOf(date));
export const monthLabel = (year: number, month: number) => MONTH.format(new Date(year, month, 1));
