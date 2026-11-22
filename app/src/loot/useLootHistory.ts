import { readAll, useSupabaseQuery } from '../data/query';
import { countedLoot } from '../settings/useSettings';
import type { HistoryDrop } from './lootHistory';

// Every season of the team's loot through team_loot_history() (no player), paged (a team's log runs past the 1000 rows
// one request returns), minus the responses the team hides from loot history.
// The tier token ids come along so a token family is one pick.
type HistoryRow = Omit<HistoryDrop, 'items'> & {
  item_name: string | null;
  slot: string | null;
  armor_type: string | null;
  wow_item_id: number | null;
  is_ptr: boolean | null;
  icon: string | null;
};

const asDrop = ({ item_name, slot, armor_type, wow_item_id, is_ptr, icon, ...row }: HistoryRow): HistoryDrop => ({
  ...row,
  items:
    item_name === null ? null : { name: item_name, slot: slot ?? '', armor_type, wow_item_id, is_ptr: !!is_ptr, icon }
});

// `locked`: the team keeps loot history to officers (#1560) and the reader
// isn't one; team_loot_history() refused.
export type LootHistory = { locked: boolean; drops: HistoryDrop[]; tokenIds: Set<number> };

export function useLootHistory(teamId: number) {
  return useSupabaseQuery<LootHistory>(['loot', 'history', teamId], async (client) => {
    const [read, tokens] = await Promise.all([
      readAll<HistoryRow>((from, to) => client.rpc('team_loot_history', { p_team_id: teamId }).range(from, to)),
      // team-read-guard: the tier token map, a few rows per season, no team
      client.from('tier_token_map').select('token_item_id')
    ]);
    if (read.error?.message.includes('Not authorized')) {
      return { data: { locked: true, drops: [], tokenIds: new Set<number>() }, error: null };
    }
    const error = read.error ?? tokens.error;
    if (error) return { data: null, error };
    const counted = await countedLoot(client, read.data!.map(asDrop));
    if (counted.error) return { data: null, error: counted.error };
    return {
      data: { locked: false, drops: counted.data!, tokenIds: new Set(tokens.data!.map((t) => t.token_item_id)) },
      error: null
    };
  });
}
