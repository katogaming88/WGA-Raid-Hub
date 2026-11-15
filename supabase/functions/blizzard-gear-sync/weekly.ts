// The roster audit's weekly row (#1636, #1261): each character's raid kills,
// M+ runs and rating, crests and delves for the current week, written to
// public.character_weeks by the gear sync's own run, with its Blizzard login.
//
// * Three reads per character, run alongside the gear read: the M+ profile,
//   the raid encounters, and the achievement statistics (crests and delves).
// * Each part is written only when its own read worked, with its own *_at, so
//   a failed read leaves that part of the row as it was and never blanks it.
// * Crest statistic ids change every season and come from season_crests.
//   The delve statistics (total 40734, Tier 1 to 11 40766 to 40776, #1261)
//   are lifetime counts with fixed ids; like crests they are saved as running
//   totals and a week's count is that row less last week's.
// * M+ runs are the profile's best run per dungeon this week: Blizzard's API
//   does not list repeat runs of the same dungeon.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const DAY_MS = 86_400_000;
// The US weekly reset, Tuesday 15:00 UTC (lockout_start_at in SQL).
const RESET_HOUR_MS = 15 * 3_600_000;

export const DELVE_TIER_STATS: Record<number, number> = Object.fromEntries(
  Array.from({ length: 11 }, (_, i) => [40766 + i, i + 1])
);

// The reset Tuesday that starts the week `at` falls in, as 'YYYY-MM-DD'.
export function weekOf(at: Date): string {
  const shifted = new Date(at.getTime() - RESET_HOUR_MS);
  const back = (shifted.getUTCDay() - 2 + 7) % 7;
  return new Date(shifted.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

export function weekStartMs(week: string): number {
  return Date.parse(week + 'T00:00:00Z') + RESET_HOUR_MS;
}

export type RaidKill = { encounter_id: number; difficulty: string };
export type MplusRun = { dungeon_id: number; level: number; timed: boolean };

// Every boss killed since the reset, per difficulty, from
// /encounters/raids's expansions -> instances -> modes -> encounters.
export function raidKillsFrom(data: any, sinceMs: number): RaidKill[] {
  const kills: RaidKill[] = [];
  for (const expansion of data?.expansions || []) {
    for (const instance of expansion?.instances || []) {
      for (const mode of instance?.modes || []) {
        const difficulty = String(mode?.difficulty?.type || '').toLowerCase();
        for (const e of mode?.progress?.encounters || []) {
          if (e?.encounter?.id && difficulty && e.last_kill_timestamp >= sinceMs) {
            kills.push({ encounter_id: e.encounter.id, difficulty });
          }
        }
      }
    }
  }
  return kills;
}

export function mplusFrom(data: any, sinceMs: number): { runs: MplusRun[]; rating: number | null } {
  const runs = (data?.current_period?.best_runs || [])
    .filter((r: any) => r?.completed_timestamp >= sinceMs && r?.dungeon?.id)
    .map((r: any) => ({ dungeon_id: r.dungeon.id, level: r.keystone_level, timed: !!r.is_completed_within_time }))
    .sort((a: MplusRun, b: MplusRun) => b.level - a.level);
  const rating = data?.current_mythic_rating?.rating;
  return { runs, rating: typeof rating === 'number' ? Math.round(rating * 10) / 10 : null };
}

// Statistic id -> quantity, from categories and their sub_categories.
function statQuantities(data: any): Map<number, number> {
  const out = new Map<number, number>();
  const walk = (cats: any[]) => {
    for (const c of cats || []) {
      for (const s of c?.statistics || []) if (s?.id) out.set(s.id, Number(s.quantity) || 0);
      walk(c?.sub_categories);
    }
  };
  walk(data?.categories);
  return out;
}

// Crests by track (every configured track, 0 when never earned) and delves by
// tier (tiers never done are left out).
export function statsFrom(
  data: any,
  crestStats: Map<number, string>
): { crests: Record<string, number>; delves: Record<string, number> } {
  const q = statQuantities(data);
  const crests: Record<string, number> = {};
  for (const [id, track] of crestStats) crests[track] = q.get(id) ?? 0;
  const delves: Record<string, number> = {};
  for (const [id, tier] of Object.entries(DELVE_TIER_STATS)) {
    const n = q.get(Number(id)) ?? 0;
    if (n > 0) delves[String(tier)] = n;
  }
  return { crests, delves };
}

// The current season's crest statistic ids, statistic_id -> track. No
// current season means no crests to read. A failed read stops the run, as a
// failed floors read does.
export async function loadCrestStats(supabase: SupabaseClient<any>): Promise<Map<number, string>> {
  const { data: season, error: seasonError } = await supabase.rpc('current_season');
  if (seasonError) throw new Error('Failed to read current_season(): ' + seasonError.message);
  if (!season) return new Map();
  const { data, error } = await supabase.from('season_crests').select('statistic_id, track').eq('season', season);
  if (error) throw new Error('Failed to load season_crests: ' + error.message);
  return new Map((data || []).filter((r) => r.statistic_id).map((r) => [r.statistic_id, r.track]));
}

export type ProfileAnswer = { status: number; data: any };
// Reads one Blizzard character profile endpoint, e.g. 'encounters/raids'.
export type ReadProfile = (endpoint: string) => Promise<ProfileAnswer>;

export type WeekResult = {
  // Blizzard statuses of the reads that failed, besides 404 (a character
  // Blizzard does not know, a plain skip).
  refused: Array<{ endpoint: string; status: number }>;
  saveError: string | null;
};

// Reads and saves one character's week. Only the parts that read are written.
export async function syncWeek(
  read: ReadProfile,
  db: SupabaseClient<any>,
  nameRealm: string,
  crestStats: Map<number, string>,
  now: Date
): Promise<WeekResult> {
  const week = weekOf(now);
  const since = weekStartMs(week);
  const at = now.toISOString();
  const [mplus, raids, stats] = await Promise.all(
    ['mythic-keystone-profile', 'encounters/raids', 'achievements/statistics'].map((e) =>
      read(e).catch(() => ({ status: 0, data: null }))
    )
  );

  const refused: WeekResult['refused'] = [];
  const ok = (endpoint: string, a: ProfileAnswer) => {
    if (a.status >= 200 && a.status < 300 && a.data) return true;
    if (a.status !== 404) refused.push({ endpoint, status: a.status });
    return false;
  };

  const row: Record<string, unknown> = { name_realm: nameRealm, week_of: week };
  if (ok('mythic-keystone-profile', mplus)) {
    const m = mplusFrom(mplus.data, since);
    Object.assign(row, { mplus_runs: m.runs, mplus_rating: m.rating, mplus_at: at });
  }
  if (ok('encounters/raids', raids)) {
    Object.assign(row, { raid_kills: raidKillsFrom(raids.data, since), raids_at: at });
  }
  if (ok('achievements/statistics', stats)) {
    const s = statsFrom(stats.data, crestStats);
    Object.assign(row, { crests: s.crests, crests_at: at, delves: s.delves, delves_at: at });
  }
  if (Object.keys(row).length === 2) return { refused, saveError: null };

  const { error } = await db.from('character_weeks').upsert(row, { onConflict: 'name_realm_key,week_of' });
  return { refused, saveError: error ? error.message : null };
}
