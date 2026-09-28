// Officer Settings (#1357, #1103 row 1): pure rules ported from
// js/tabs/tab-season.js, so the new app's four Settings pages (General,
// Season, Raid progression, Danger zone) behave exactly like the current
// site's Season Settings tab. Kept apart from the pages so the rules are
// tested without rendering.

import { ATTENDANCE_WEIGHTS } from '../profile/profile';
import type { FullAttendanceRow } from '../attendance/attendance';
import type { PlayerRow } from '../roster/roster';
import type { HistoryRosterRow } from '../history/history';

// A seasonHistory entry as close_season() writes it: history/history.ts's
// public-page type strips this down to what the History page shows (no
// code/start/end/wclZoneId/isMiniRaid), so Settings gets its own fuller type
// for the same jsonb shape -- the WCL baseline fetch keys off code and each
// raid's wclZoneId, and the "newest entry" pick keys off start.
export type SettingsHistoryRaid = {
  name?: string | null;
  wclZoneId?: number | string | null;
  isMiniRaid?: boolean | null;
  bosses?: RaidBoss[] | null;
};
export type SettingsHistoryEntry = {
  code?: string | null;
  name?: string | null;
  start?: string | null;
  end?: string | null;
  raids?: SettingsHistoryRaid[] | null;
  roster?: HistoryRosterRow[] | null;
};

// -- General: Trial thresholds / roster targets --------------------------

// saveTrialThresholds()/saveRosterTargets()'s clamps.
export const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

// -- Raid progression ------------------------------------------------------

// One boss, kept as the full jsonb shape (extra keys like wclEncounterId
// pass through untouched) so editing a kill date here never drops a field
// only the WCL fetch on the current site writes.
export type RaidBoss = Record<string, unknown> & { name?: string | null; mythicDate?: string | null };
export type Raid = Record<string, unknown> & {
  name?: string | null;
  isMiniRaid?: boolean | null;
  aotcDate?: string | null;
  wclZoneId?: number | string | null;
  bosses?: RaidBoss[] | null;
};

// Normalizes whatever team_settings.config.raidProgression holds into arrays
// with defined name/isMiniRaid/aotcDate/bosses, so the editor never has to
// guard against a missing field -- every other key on the raid or boss is
// carried over as-is.
export function normalizeRaids(raw: unknown): Raid[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => normalizeRaid(r as Raid));
}

function normalizeRaid(raid: Raid): Raid {
  return {
    ...raid,
    name: raid.name ?? '',
    isMiniRaid: !!raid.isMiniRaid,
    aotcDate: raid.aotcDate ?? '',
    bosses: (raid.bosses ?? []).map((b) => ({ ...b, name: b.name ?? '', mythicDate: b.mythicDate ?? '' }))
  };
}

const blankRaid = (): Raid => ({ name: '', isMiniRaid: false, aotcDate: '', bosses: [] });
const blankBoss = (): RaidBoss => ({ name: '', mythicDate: '' });

export function addRaid(raids: Raid[]): Raid[] {
  return [...raids, blankRaid()];
}

export function removeRaid(raids: Raid[], raidIdx: number): Raid[] {
  return raids.filter((_, i) => i !== raidIdx);
}

export function updateRaid(raids: Raid[], raidIdx: number, patch: Partial<Raid>): Raid[] {
  return raids.map((r, i) => (i === raidIdx ? { ...r, ...patch } : r));
}

// raidToggleMini(): a mini-raid has no AOTC date, so switching one on clears
// whatever was there.
export function toggleMiniRaid(raids: Raid[], raidIdx: number, isMini: boolean): Raid[] {
  return updateRaid(raids, raidIdx, { isMiniRaid: isMini, ...(isMini ? { aotcDate: '' } : {}) });
}

export function addBoss(raids: Raid[], raidIdx: number): Raid[] {
  return raids.map((r, i) => (i === raidIdx ? { ...r, bosses: [...(r.bosses ?? []), blankBoss()] } : r));
}

export function removeBoss(raids: Raid[], raidIdx: number, bossIdx: number): Raid[] {
  return raids.map((r, i) => (i === raidIdx ? { ...r, bosses: (r.bosses ?? []).filter((_, j) => j !== bossIdx) } : r));
}

export function updateBoss(raids: Raid[], raidIdx: number, bossIdx: number, patch: Partial<RaidBoss>): Raid[] {
  return raids.map((r, i) =>
    i === raidIdx
      ? { ...r, bosses: (r.bosses ?? []).map((b, j) => (j === bossIdx ? { ...b, ...patch } : b)) }
      : r
  );
}

// raidBossDrop(): moves one boss to another position in the same raid.
export function reorderBoss(raids: Raid[], raidIdx: number, fromIdx: number, toIdx: number): Raid[] {
  if (fromIdx === toIdx || fromIdx < 0) return raids;
  return raids.map((r, i) => {
    if (i !== raidIdx) return r;
    const bosses = [...(r.bosses ?? [])];
    const moved = bosses.splice(fromIdx, 1)[0]!;
    bosses.splice(toIdx, 0, moved);
    return { ...r, bosses };
  });
}

// -- Season History / Close Season -----------------------------------------

// _newestHistoryIndex(): the entry the WCL baseline row belongs to -- the
// tier that started last, whichever order the books were closed in.
export function newestHistoryIndex(history: SettingsHistoryEntry[]): number {
  let newest = -1;
  for (let i = 0; i < history.length; i++) {
    if (newest === -1 || (history[i]!.start ?? '') >= (history[newest]!.start ?? '')) newest = i;
  }
  return newest;
}

export type ZoneGroup = { zoneId: number; label: string; bossCount: number; allMini: boolean };

// _renderSeasonPerfFetchRow()'s zone grouping: one option per distinct WCL
// zone, labeled with whichever raid in that zone has the most bosses.
export function perfZoneGroups(raids: Raid[]): ZoneGroup[] {
  type Building = ZoneGroup & { labelBossCount: number };
  const byZone = new Map<number, Building>();
  const order: number[] = [];
  for (const r of raids) {
    const zoneId = Number(r.wclZoneId);
    if (!zoneId) continue;
    const bossCount = (r.bosses ?? []).length;
    let group = byZone.get(zoneId);
    if (!group) {
      group = { zoneId, label: r.name || 'Raid', bossCount: 0, allMini: true, labelBossCount: -1 };
      byZone.set(zoneId, group);
      order.push(zoneId);
    }
    group.bossCount += bossCount;
    if (!r.isMiniRaid) group.allMini = false;
    if (bossCount > group.labelBossCount) {
      group.label = r.name || 'Raid';
      group.labelBossCount = bossCount;
    }
  }
  return order.map((zoneId) => {
    const built = byZone.get(zoneId)!;
    return { zoneId: built.zoneId, label: built.label, bossCount: built.bossCount, allMini: built.allMini };
  });
}

// The zone group index the fetch defaults to: the non-mini-raid zone with the
// most total bosses, or the last group when every zone is a mini-raid.
export function defaultZoneIndex(groups: ZoneGroup[]): number {
  let defaultIdx = groups.length - 1;
  let bestBossCount = -1;
  groups.forEach((g, j) => {
    if (!g.allMini && g.bossCount > bestBossCount) {
      bestBossCount = g.bossCount;
      defaultIdx = j;
    }
  });
  return defaultIdx;
}

// _seasonPerfStatusLabel(): whether player_wcl_season_perf already has rows
// for this team/season.
export function seasonPerfFetchedText(count: number): string {
  return count > 0
    ? `Already fetched (${count} player${count === 1 ? '' : 's'}).`
    : 'Not fetched yet -- do this before generating Heroic priority.';
}

export type SeasonRow = { code: string; display_name: string; starts_at: string; ends_at: string | null };

// closableSeasonCodes(): tiers that started before the current one and are
// not already in seasonHistory, oldest first.
export function closableSeasonCodes(
  current: SeasonRow | null,
  seasons: SeasonRow[],
  closedCodes: readonly string[]
): string[] {
  if (!current) return [];
  const closed = new Set(closedCodes);
  return seasons
    .filter((s) => s.starts_at < current.starts_at && !closed.has(s.code))
    .sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))
    .map((s) => s.code);
}

// _closeSeasonTarget(): the picked code when it is still closable, else the
// tier that started most recently among the closable ones (the default).
export function closeSeasonTarget(codes: string[], picked: string): string {
  if (codes.includes(picked)) return picked;
  return codes[codes.length - 1] ?? '';
}

// -- Close Season's roster snapshot -----------------------------------------

export type RosterSnapshotRow = {
  playerId: number;
  nameRealm: string;
  role: string | null;
  isTrial: boolean;
  isBench: boolean;
  joinDate: string;
  attendance: string;
};

// buildSeasonArchiveRosterSnapshot(): each roster player's role/status/join
// date, and their attendance over the closing tier's window -- '' rather than
// a default 100% for a player with no eligible night yet, so an empty season
// never freezes into a false "perfect attendance" (#702).
export function rosterSnapshot(
  players: PlayerRow[],
  rows: FullAttendanceRow[],
  window: { start: string | null; end: string | null }
): RosterSnapshotRow[] {
  const byPlayer = new Map<number, FullAttendanceRow[]>();
  for (const r of rows) {
    if (r.player_id === null) continue;
    byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  }
  return players.map((p) => {
    const joinDate = p.join_date ?? '';
    const effectiveStart = joinDate && (!window.start || joinDate > window.start) ? joinDate : (window.start ?? '');
    const eligible = (byPlayer.get(p.id) ?? []).filter(
      (r) =>
        !r.report_excluded &&
        !!r.status &&
        r.status !== 'Not on Roster' &&
        (!effectiveStart || r.raid_date >= effectiveStart) &&
        (!window.end || r.raid_date <= window.end)
    );
    const attendance = eligible.length
      ? `${(
          Math.round((eligible.reduce((sum, r) => sum + (ATTENDANCE_WEIGHTS[r.status!] ?? 0), 0) / eligible.length) * 1000) /
          10
        ).toFixed(1)}%`
      : '';
    return {
      playerId: p.id,
      nameRealm: p.name_realm,
      role: p.classes_specs?.role ?? null,
      isTrial: p.is_trial,
      isBench: p.is_bench,
      joinDate,
      attendance
    };
  });
}
