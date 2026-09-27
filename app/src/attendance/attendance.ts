import { attendance as playerAttendance, type AttendanceRow, type SeasonWindow } from '../profile/profile';
import { firstName, type PlayerRow } from '../roster/roster';

// Manage and Scores (#1103 row 1), ported from js/tabs/tab-attendance.js and
// js/common.js. The current tab's rules, not new ones.

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

export function attendColor(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) return 'var(--text-muted)';
  return pct >= 95 ? 'var(--good)' : pct >= 75 ? 'var(--warn)' : 'var(--bad)';
}

export type BelowThresholdRow = { player: PlayerRow; pct: number; flagged: { date: string; status: string }[] };

// Sorted worst-first, matching the current tab's below.sort((a, b) => a.pct - b.pct).
export function belowThreshold(
  players: PlayerRow[],
  rowsByPlayer: Map<number, AttendanceRow[]>,
  season: SeasonWindow,
  threshold: number
): BelowThresholdRow[] {
  return players
    .map((player) => {
      const { pct, flagged } = playerAttendance(rowsByPlayer.get(player.id) ?? [], season, player.join_date ?? null);
      return { player, pct, flagged };
    })
    .filter((r) => r.pct <= threshold)
    .sort((a, b) => a.pct - b.pct);
}

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

function nameOf(player: PlayerRow): string {
  return player.nickname?.trim() || firstName(player.name_realm);
}

export type ScoreRow = { player_id: number; season: string; attendance_score: number; attendance_pct: number };

// executeCommitScores()'s aggregation: each player's own recorded, non-excluded
// nights average their status weight, written as both a 0-10 score and a
// percentage. A player with zero eligible nights gets no row at all (nothing
// to score), same as the current tab.
export function commitScores(
  rows: FullAttendanceRow[],
  weights: Record<string, number>,
  season: string
): { rows: ScoreRow[]; totalNights: number } {
  const byPlayer = new Map<number, { sum: number; nights: number }>();
  const nightSet = new Set<string>();
  for (const row of rows) {
    if (row.report_excluded || row.player_id === null) continue;
    const weight = row.status ? weights[row.status] : undefined;
    if (weight === undefined) continue;
    const agg = byPlayer.get(row.player_id) ?? { sum: 0, nights: 0 };
    agg.sum += weight;
    agg.nights += 1;
    byPlayer.set(row.player_id, agg);
    nightSet.add(row.raid_date);
  }
  const scoreRows = [...byPlayer.entries()].map(([playerId, agg]) => {
    const ratio = agg.sum / agg.nights;
    return {
      player_id: playerId,
      season,
      attendance_score: Math.min(Math.round(ratio * 10 * 100) / 100, 10),
      attendance_pct: Math.round(ratio * 1000) / 10
    };
  });
  return { rows: scoreRows, totalNights: nightSet.size };
}
