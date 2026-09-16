import { readAll, useSupabaseQuery } from '../data/query';
import type { SeasonWindow } from '../profile/profile';
import type { FeedLootRow } from './home';

// The team's awards for the season, for the stats row and the recent loot
// feed. Paged, since a season's loot for a whole team runs past the 1000 rows
// one request returns. The season is filtered here and again in lootFeed(), so
// the page never counts another season's items even if the filter is dropped.
export function useSeasonLoot(teamId: number, season: SeasonWindow | null) {
  return useSupabaseQuery<FeedLootRow[]>(
    ['home-loot', teamId, season?.code ?? null],
    (client) =>
      readAll<FeedLootRow>((from, to) => {
        let q = client
          .from('rclc_loot')
          .select('id, track, season, awarded_at, response, items(name), players(name_realm, nickname)')
          .eq('team_id', teamId);
        if (season?.code) q = q.eq('season', season.code);
        return q.order('id').range(from, to);
      }),
    { enabled: season !== null }
  );
}
