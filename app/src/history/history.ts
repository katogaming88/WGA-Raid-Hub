// The History page (#1102): past seasons' progression and rosters, ported
// from the current site's buildSeasonRecap() (js/roster.js) and
// toggleSeasonSnapshot() (js/tabs/tab-season.js, officer-only there). Both
// read the same team_settings.config.seasonHistory entry each
// archive_current_season() call appends (20260806210047_...sql); the roster
// snapshot moves onto this public page on purpose (#1102), since a raider
// could not see a past season's roster before.

export type HistoryBoss = {
  name?: string | null;
  mythicDate?: string | null;
  mythicPulls?: number | null;
  mythicBestPct?: number | null;
};

export type HistoryRaid = { bosses?: HistoryBoss[] | null };

export type HistoryRosterRow = {
  nameRealm: string;
  role: string | null;
  isTrial: boolean;
  isBench: boolean;
  joinDate: string;
  attendance: string | number;
};

export type SeasonHistoryEntry = {
  name?: string | null;
  raids?: HistoryRaid[] | null;
  roster?: HistoryRosterRow[] | null;
};

export type SeasonRecap = {
  name: string;
  killed: number;
  total: number;
  lastKillDate: string | null;
  currentBoss: { name: string; pulls: number; bestPct: number | null } | null;
  roster: HistoryRosterRow[];
};

// One season's Mythic recap: how many bosses are down, the latest kill date,
// and the boss the team was working on when the season ended -- the last
// unkilled boss with recorded pulls, in raid/boss order, same as the
// current site (guilds progress roughly in order, so this is what was
// actually current, not just whichever boss sorts last).
export function seasonRecap(season: SeasonHistoryEntry): SeasonRecap {
  let killed = 0;
  let total = 0;
  let lastKillDate: string | null = null;
  let currentBoss: SeasonRecap['currentBoss'] = null;
  for (const raid of season.raids ?? []) {
    for (const boss of raid.bosses ?? []) {
      total++;
      if (boss.mythicDate) {
        killed++;
        if (!lastKillDate || boss.mythicDate > lastKillDate) lastKillDate = boss.mythicDate;
      } else if (boss.mythicPulls) {
        currentBoss = { name: boss.name ?? '', pulls: boss.mythicPulls, bestPct: boss.mythicBestPct ?? null };
      }
    }
  }
  return {
    name: season.name?.trim() || 'Unnamed Season',
    killed,
    total,
    lastKillDate,
    roster: season.roster ?? [],
    currentBoss
  };
}

// Newest season first, same as the current site's reverse iteration over the
// array archive_current_season() appends to.
export function seasonHistory(entries: SeasonHistoryEntry[] | null | undefined): SeasonRecap[] {
  return (entries ?? []).map(seasonRecap).reverse();
}

const ROLE_ORDER: Record<string, number> = { Tank: 0, Heal: 1, Melee: 2, Ranged: 3 };

// The roster snapshot's row order: role group, then name -- the same order
// the officer-only toggle used on the current site.
export function rosterRows(roster: HistoryRosterRow[]): HistoryRosterRow[] {
  return [...roster].sort((a, b) => {
    const ra = ROLE_ORDER[a.role ?? ''] ?? 9;
    const rb = ROLE_ORDER[b.role ?? ''] ?? 9;
    return ra !== rb ? ra - rb : a.nameRealm.localeCompare(b.nameRealm);
  });
}

export const rosterStatus = (row: HistoryRosterRow): string =>
  row.isBench ? 'Bench' : row.isTrial ? 'Trial' : 'Roster';
