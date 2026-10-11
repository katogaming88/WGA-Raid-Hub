import { seasonLoot, type AttendanceRow, type Difficulty, type LootRow, type SeasonWindow } from '../profile/profile';
import type { RoleGroup } from '../roster/roster';

// The Loot fairness and Bench fairness reports (#1359): one bar per raider,
// grouped by role as the Roster groups them, most first, against the raid
// average. The current site's tab-fairness.js and tab-bench-fairness.js.

export type FairnessRow = {
  playerId: number;
  name: string;
  className: string;
  value: number;
  note?: string | undefined;
};
export type FairnessGroup = { role: string; label: string; rows: FairnessRow[] };
export type Fairness = { groups: FairnessGroup[]; average: number; max: number };

function grouped(
  groups: RoleGroup[],
  valueOf: (playerId: number) => { value: number; note?: string | undefined }
): Fairness {
  const out = groups.map((g) => ({
    role: g.role,
    label: g.label,
    rows: g.raiders
      .filter((r) => r.playerId !== null)
      .map((r) => ({ playerId: r.playerId!, name: r.name, className: r.className, ...valueOf(r.playerId!) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  }));
  const all = out.flatMap((g) => g.rows.map((r) => r.value));
  return {
    groups: out.filter((g) => g.rows.length > 0),
    average: all.length ? all.reduce((a, b) => a + b, 0) / all.length : 0,
    max: Math.max(0, ...all)
  };
}

// Items each raider received this season, counted the way the Roster's Items
// column counts them: loot on an earlier character counts for the row it now
// belongs to (`earlierOwner`), each award once.
export function lootFairness(
  groups: RoleGroup[],
  lootRows: (LootRow & { player_id: number | null })[],
  season: SeasonWindow,
  difficulty: Difficulty | null,
  earlierOwner: Map<number, number> = new Map()
): Fairness {
  const byPlayer = new Map<number, LootRow[]>();
  const seen = new Set<number>();
  for (const row of lootRows) {
    if (row.player_id === null || seen.has(row.id)) continue;
    seen.add(row.id);
    const owner = earlierOwner.get(row.player_id) ?? row.player_id;
    byPlayer.set(owner, [...(byPlayer.get(owner) ?? []), row]);
  }
  return grouped(groups, (id) => ({
    value: seasonLoot(byPlayer.get(id) ?? [], season).awards.filter((a) => !difficulty || a.difficulty === difficulty)
      .length
  }));
}

// Nights each raider sat on the bench this season, and their bench rate: the
// share of the nights they had a status on (Not on Roster and excluded reports
// left out, as attendance leaves them out).
export function benchFairness(
  groups: RoleGroup[],
  attendanceRows: (AttendanceRow & { player_id: number | null })[],
  season: SeasonWindow
): Fairness {
  const byPlayer = new Map<number, AttendanceRow[]>();
  for (const row of attendanceRows) {
    if (row.player_id === null) continue;
    byPlayer.set(row.player_id, [...(byPlayer.get(row.player_id) ?? []), row]);
  }
  return grouped(groups, (id) => {
    const nights = (byPlayer.get(id) ?? []).filter(
      (r) =>
        !r.report_excluded &&
        r.status &&
        r.status !== 'Not on Roster' &&
        (!season.start || r.raid_date >= season.start) &&
        (!season.end || r.raid_date <= season.end)
    );
    const benched = nights.filter((r) => r.status === 'Bench').length;
    return {
      value: benched,
      note: nights.length ? `${Math.round((benched / nights.length) * 100)}%` : undefined
    };
  });
}

// Kept so the average reads like the current site's ("4.6 items").
export const oneDecimal = (n: number) => (Math.round(n * 10) / 10).toString();
