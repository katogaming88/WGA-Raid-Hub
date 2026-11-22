import { readAll, useSupabaseQuery } from '../data/query';
import { countedLoot } from '../settings/useSettings';
import type { HistoryDrop } from './lootHistory';

// Every season of the team's loot, paged (a team's log runs past the 1000 rows
// one request returns), minus the responses the team hides from loot history.
// The tier token ids come along so a token family is one pick.
export function useLootHistory(teamId: number) {
  return useSupabaseQuery<{ drops: HistoryDrop[]; tokenIds: Set<number> }>(
    ['loot', 'history', teamId],
    async (client) => {
      const [read, tokens] = await Promise.all([
        readAll<HistoryDrop>((from, to) =>
          client
            .from('rclc_loot')
            .select(
              'id, team_id, track, season, awarded_at, boss, response, item_id, items(name, slot, armor_type, wow_item_id, is_ptr, icon)'
            )
            .eq('team_id', teamId)
            .order('id')
            .range(from, to)
        ),
        // team-read-guard: the tier token map, a few rows per season, no team
        client.from('tier_token_map').select('token_item_id')
      ]);
      const error = read.error ?? tokens.error;
      if (error) return { data: null, error };
      const counted = await countedLoot(client, read.data!);
      if (counted.error) return { data: null, error: counted.error };
      return {
        data: { drops: counted.data!, tokenIds: new Set(tokens.data!.map((t) => t.token_item_id)) },
        error: null
      };
    }
  );
}
