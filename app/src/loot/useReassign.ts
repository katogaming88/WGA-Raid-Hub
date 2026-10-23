import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { resolveActorNames, type AuditRow } from '../settings/useAudit';
import { countedLoot } from '../settings/useSettings';

export const REASSIGN_ACTION = 'Loot Reassigned';

type LinkItem = { name: string; wow_item_id: number | null; is_ptr: boolean | null; icon: string | null };

export type ReassignHistory = {
  rows: AuditRow[];
  actorNames: Record<string, string>;
  items: Record<string, LinkItem>;
};

// "Voidbound Cinch: Kat (Katorrí) -> Brakkus", as useReassign() and the
// current site write it. Anything else shows as written.
export function parseMove(detail: unknown): { item: string; from: string; to: string } | null {
  const m = typeof detail === 'string' ? /^(.*): (.*) -> (.*)$/.exec(detail) : null;
  return m ? { item: m[1]!, from: m[2]!, to: m[3]! } : null;
}

// Every move so far, newest first, from the audit entry each one writes (the
// current site's moves included: same action, same detail).
export function useReassignHistory(teamId: number) {
  return useSupabaseQuery<ReassignHistory>(['loot-reassign-history', teamId], async (client) => {
    const rows = await readAll<AuditRow>((from, to) =>
      client
        .from('audit_log')
        .select('id, actor_id, action, target_type, target_id, detail, created_at')
        .eq('team_id', teamId)
        .eq('action', REASSIGN_ACTION)
        .order('id')
        .range(from, to)
    );
    if (rows.error) return { data: null, error: rows.error };
    // The entry keeps only the item's name, so its tooltip comes from the
    // catalog by name, the live copy before a PTR one.
    const names = [...new Set(rows.data!.map((r) => parseMove(r.detail)?.item).filter((n): n is string => !!n))];
    const [actorNames, found] = await Promise.all([
      resolveActorNames(client, rows.data!, teamId),
      names.length
        ? // team-read-guard: only the items named in this team's reassignments, a handful
          client.from('items').select('name, wow_item_id, is_ptr, icon').in('name', names)
        : { data: [] as LinkItem[], error: null }
    ]);
    if (found.error) return { data: null, error: found.error };
    const items: Record<string, LinkItem> = {};
    for (const item of (found.data ?? []) as LinkItem[]) {
      const had = items[item.name];
      if (item.wow_item_id && (!had || (had.is_ptr && !item.is_ptr))) items[item.name] = item;
    }
    return { data: { rows: rows.data!.sort((a, b) => b.id - a.id), actorNames, items }, error: null };
  });
}

export type ReassignRow = {
  id: number;
  player_id: number | null;
  track: string | null;
  season: string | null;
  awarded_at: string;
  team_id: number | null;
  response: string | null;
  items: { name: string; wow_item_id: number | null; is_ptr: boolean | null; icon: string | null } | null;
  // Set by countedLoot() (#1561), as on the profile.
  offSpec?: boolean;
  counted?: boolean;
};

// Every raid award on the team, from any season: a trade an officer corrects
// could be from an earlier one, and the item search looks across every
// raider. countedLoot() shows them as each raider's profile does (Off spec
// tagged, Hidden left out).
export function useTeamLoot(teamId: number) {
  return useSupabaseQuery<ReassignRow[]>(['loot-reassign', teamId], async (client) => {
    const rows = await readAll<ReassignRow>((from, to) =>
      client
        .from('rclc_loot')
        .select('id, player_id, team_id, response, track, season, awarded_at, items(name, wow_item_id, is_ptr, icon)')
        .eq('team_id', teamId)
        .order('id')
        .range(from, to)
    );
    if (rows.error) return rows;
    return countedLoot(client, rows.data!);
  });
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
          p_action: REASSIGN_ACTION,
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
        ['loot-reassign-history', teamId],
        ['loot'],
        ['home-loot', teamId],
        ['priority-data', teamId],
        ['roster-officer-data', teamId]
      ]
    }
  );
}
