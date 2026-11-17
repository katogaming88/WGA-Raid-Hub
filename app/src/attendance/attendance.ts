import { calendarDay } from '../lib/dates';
import { firstName, type PlayerRow } from '../roster/roster';

// Manage (#1103 row 1), ported from js/tabs/tab-attendance.js and
// js/common.js. The current tab's rules, not new ones.
//
// The old tab's Attendance Scores sub-tab (a below-threshold list with each
// raider's penalty history) isn't ported: Roster already shows attendance
// pct per raider, and Profile shows the same pct plus flagged nights this
// list would (Kat, 2026-09-27) -- a dedicated page had nothing those two
// didn't already cover a click away.

export const ATTENDANCE_STATUSES = [
  'Present',
  'Bench',
  'Late (with notice)',
  'Excused',
  'Late (no notice)',
  'No Show',
  'Extended Leave',
  'Medical Leave',
  'Not on Roster'
] as const;

export type FullAttendanceRow = {
  id: number;
  player_id: number | null;
  raid_date: string;
  status: string | null;
  report_excluded: boolean;
  report_title: string | null;
  source: string | null;
};

export type NightPlayer = { playerId: number; name: string; status: string | null; source: string | null };
export type Night = { date: string; title: string; excluded: boolean; players: NightPlayer[] };

// Groups the team's raw attendance rows into one row per raid night, newest
// first, with every roster player present even if this night has no row for
// them yet (an officer can still fill one in from the grid).
export function buildGrid(rows: FullAttendanceRow[], roster: PlayerRow[]): Night[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const nights = new Map<string, Night>();

  for (const row of rows) {
    if (row.player_id === null) continue;
    const player = byId.get(row.player_id);
    if (!player) continue;
    let night = nights.get(row.raid_date);
    if (!night) {
      night = {
        date: row.raid_date,
        title: row.report_title || row.raid_date,
        excluded: row.report_excluded,
        players: []
      };
      nights.set(row.raid_date, night);
    }
    night.players.push({ playerId: player.id, name: nameOf(player), status: row.status, source: row.source });
  }

  const dates = [...nights.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  return dates.map((date) => {
    const night = nights.get(date)!;
    const seen = new Set(night.players.map((p) => p.playerId));
    for (const player of roster) {
      if (!seen.has(player.id))
        night.players.push({ playerId: player.id, name: nameOf(player), status: null, source: null });
    }
    night.players.sort((a, b) => a.name.localeCompare(b.name));
    return night;
  });
}

// #1846: what the hourly refresh left for an officer. A night's row with no
// status under a Late? or Absent? flag, this season, on a night not excluded:
// the rows attendance_items_waiting() counts, so the list and the count agree.
export const LATE_FLAG = 'WCL (Late?)';
export const ABSENT_FLAG = 'WCL (Absent?)';

export type LookItem = {
  playerId: number;
  name: string;
  className: string;
  date: string;
  kind: 'Late?' | 'Absent?';
  reason: string;
};

// What the reason line can name: the first boss a late raider was lined up
// for, and a Calendar RSVP made before the start (attendance_rsvps_before_start),
// both keyed `${playerId}|${date}`.
export type LookContext = { firstBoss: Map<string, string>; rsvps: Map<string, string> };

export function needsALook(
  rows: FullAttendanceRow[],
  roster: PlayerRow[],
  seasonStart: string | null,
  context: LookContext
): LookItem[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const items: LookItem[] = [];
  for (const row of rows) {
    if (row.status !== null || row.report_excluded || row.player_id === null) continue;
    if (row.source !== LATE_FLAG && row.source !== ABSENT_FLAG) continue;
    if (seasonStart && row.raid_date < seasonStart) continue;
    const player = byId.get(row.player_id);
    if (!player) continue;
    const key = `${player.id}|${row.raid_date}`;
    let reason: string;
    if (row.source === LATE_FLAG) {
      const boss = context.firstBoss.get(key);
      reason = boss ? `Missed ${boss}, the first boss they were in the lineup for.` : 'Missed the first pull.';
    } else {
      reason =
        context.rsvps.get(key) === 'Tentative'
          ? 'Said Tentative in the Calendar, not in the log.'
          : 'On the roster, not in the log.';
    }
    items.push({
      playerId: player.id,
      name: nameOf(player),
      className: player.classes_specs?.class ?? '',
      date: row.raid_date,
      kind: row.source === LATE_FLAG ? 'Late?' : 'Absent?',
      reason
    });
  }
  return items.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
}

// The first boss, in pull order and not skipped, each raider was lined up for
// on each night: the same reference the sync's Late? check uses.
export function firstLineupBoss(
  bosses: { raid_date: string; encounter_id: number; position: number; skipped: boolean }[],
  places: { raid_date: string; encounter_id: number; player_id: number }[],
  bossName: (encounterId: number) => string | undefined
): Map<string, string> {
  const order = new Map<string, number>();
  for (const b of bosses) if (!b.skipped) order.set(`${b.raid_date}|${b.encounter_id}`, b.position);
  const best = new Map<string, { position: number; encounterId: number }>();
  for (const p of places) {
    const position = order.get(`${p.raid_date}|${p.encounter_id}`);
    if (position === undefined) continue;
    const key = `${p.player_id}|${p.raid_date}`;
    const seen = best.get(key);
    if (!seen || position < seen.position) best.set(key, { position, encounterId: p.encounter_id });
  }
  const names = new Map<string, string>();
  for (const [key, { encounterId }] of best) {
    const name = bossName(encounterId);
    if (name) names.set(key, name);
  }
  return names;
}

// "Tue Nov 10" for a night's YYYY-MM-DD, read as a calendar day (no time zone shift).
export function nightLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return calendarDay(new Date(y!, m! - 1, d!), 'short').replace(',', '');
}

// The last hourly run, as team_settings.attendance_sync_last_run saves it.
export type LastRun = {
  started_at: string;
  finished_at: string;
  main_nights: number;
  waiting: number | null;
  committed: number | null;
  error: string | null;
};

function nameOf(player: PlayerRow): string {
  return player.nickname?.trim() || firstName(player.name_realm);
}
