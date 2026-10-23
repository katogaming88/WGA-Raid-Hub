import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';

export type ReassignRow = {
  id: number;
  track: string | null;
  season: string | null;
  awarded_at: string;
  items: { name: string; wow_item_id: number | null; is_ptr: boolean | null; icon: string | null } | null;
};

const lootKey = (teamId: number, playerId: number) => ['loot-reassign', teamId, playerId] as const;

// Every raid award for one raider, newest first, from any season: a trade an
// officer corrects could be from an earlier one.
export function useRaiderLoot(teamId: number, playerId: number | null) {
  return useSupabaseQuery<ReassignRow[]>(
    lootKey(teamId, playerId ?? 0),
    async (client) => {
      const rows = await readAll<ReassignRow>((from, to) =>
        client
          .from('rclc_loot')
          .select('id, track, season, awarded_at, items(name, wow_item_id, is_ptr, icon)')
          .eq('team_id', teamId)
          .eq('player_id', playerId!)
          .order('id')
          .range(from, to)
      );
      if (rows.error) return rows;
      return { data: rows.data!.sort((a, b) => (a.awarded_at < b.awarded_at ? 1 : -1)), error: null };
    },
    { enabled: playerId !== null }
  );
}

export type Reassign = { row: ReassignRow; to: number; detail: string };

// A plain update, as on the current site (#1029): officers may write their
// team's rclc_loot rows. Received counts are worked out from rclc_loot when
// read, so every page that shows them reads again.
export function useReassign(teamId: number) {
  return useSupabaseMutation<null, Reassign>(
    async (client, { row, to, detail }) => {
      const result = await client.from('rclc_loot').update({ player_id: to }).eq('id', row.id).eq('team_id', teamId);
      if (result.error) return result;
      // Best-effort, like the current site's writeAuditLog(): the move is saved
      // either way.
      try {
        await client.rpc('write_audit_log', {
          p_team_id: teamId,
          p_action: 'Loot Reassigned',
          p_target_type: 'players',
          p_target_id: to,
          p_detail: detail
        });
      } catch {
        // Already saved.
      }
      return { data: null, error: null };
    },
    {
      key: ['reassign-loot', teamId],
      refreshes: [
        ['loot-reassign', teamId],
        ['loot'],
        ['home-loot', teamId],
        ['priority-data', teamId],
        ['roster-officer-data', teamId]
      ]
    }
  );
}
