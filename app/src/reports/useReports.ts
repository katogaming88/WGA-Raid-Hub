import { readAll, useSupabaseQuery } from '../data/query';

export type RaidNightsRow = {
  // A view's columns all read as nullable.
  player_id: number | null;
  last_award_at: string | null;
  raid_nights_since_last_item: number | null;
};

// The rnlsi view (#227): per active character, when its last item came and
// how many of the team's raid nights have passed since.
export function useRaidNightsSinceItem(teamId: number) {
  return useSupabaseQuery<RaidNightsRow[]>(['raid-nights-since-item', teamId], (client) =>
    // team-read-guard: a view, one row per active character (80 on the largest team)
    client.from('rnlsi').select('player_id, last_award_at, raid_nights_since_last_item').eq('team_id', teamId)
  );
}

// The season-picked reports (#1359 part 3). Each read asks for one season, so
// a team's whole history never meets the 1000-row page limit.

export type BisDemandRow = {
  item_id: number | null;
  item_name: string | null;
  slot: string | null;
  demand_count: number | null;
  awarded_count: number | null;
};

// bis_demand_vs_awards (#1268): per item, how many raiders on the roster want
// it as BiS this season, and how many dropped for the team.
export function useBisDemand(teamId: number, season: string | null) {
  return useSupabaseQuery<BisDemandRow[]>(
    ['bis-demand', teamId, season],
    (client) =>
      // team-read-guard: one season's wishlisted raid items, a few hundred at most
      client
        .from('bis_demand_vs_awards')
        .select('item_id, item_name, slot, demand_count, awarded_count')
        .eq('team_id', teamId)
        .eq('season', season!),
    { enabled: season !== null }
  );
}

export type LootPaceRow = {
  season: string | null;
  season_week: number | null;
  track: string | null;
  slot: string | null;
  items_awarded: number | null;
};

// season_loot_pace: items awarded per week of a season (week 1 starts at the
// season's first award), by track and slot, for this season and the one before.
export function useLootPace(teamId: number, seasons: string[]) {
  return useSupabaseQuery<LootPaceRow[]>(
    ['loot-pace', teamId, seasons],
    (client) =>
      readAll<LootPaceRow>((from, to) =>
        client
          .from('season_loot_pace')
          .select('season, season_week, track, slot, items_awarded')
          .eq('team_id', teamId)
          .in('season', seasons)
          .order('season')
          .order('season_week')
          .order('track')
          .order('slot')
          .range(from, to)
      ),
    { enabled: seasons.length > 0 }
  );
}

export type StaleEntryRow = {
  priority_order_id: number | null;
  item_name: string | null;
  track: string | null;
  rank: number | null;
  name_realm: string | null;
};
export type GapRow = { player_id: number | null; name_realm: string | null };
export type StaleAfterHeroicRow = {
  priority_order_id: number | null;
  item_name: string | null;
  name_realm: string | null;
};
export type PriorityHealth = { stale: StaleEntryRow[]; gaps: GapRow[]; afterHeroic: StaleAfterHeroicRow[] };

// Priority order health: entries for raiders who have left, raiders with no
// entry at all, and Mythic #1s already given the Heroic copy.
export function usePriorityHealth(teamId: number, season: string | null) {
  return useSupabaseQuery<PriorityHealth>(
    ['priority-health', teamId, season],
    async (client) => {
      const [stale, gaps, afterHeroic] = await Promise.all([
        // team-read-guard: one season's entries for archived raiders, a handful
        client
          .from('priority_order_stale_entries')
          .select('priority_order_id, item_name, track, rank, name_realm')
          .eq('team_id', teamId)
          .eq('season', season!),
        // team-read-guard: one season's raiders with no entry, at most the roster
        client.from('priority_order_gaps').select('player_id, name_realm').eq('team_id', teamId).eq('season', season!),
        // team-read-guard: one season's Mythic #1 entries, at most one per item
        client
          .from('priority_order_stale_after_heroic')
          .select('priority_order_id, item_name, name_realm')
          .eq('team_id', teamId)
          .eq('season', season!)
      ]);
      const error = stale.error ?? gaps.error ?? afterHeroic.error;
      if (error) return { data: null, error };
      return {
        data: {
          stale: (stale.data ?? []) as StaleEntryRow[],
          gaps: (gaps.data ?? []) as GapRow[],
          afterHeroic: (afterHeroic.data ?? []) as StaleAfterHeroicRow[]
        },
        error: null
      };
    },
    { enabled: season !== null }
  );
}
