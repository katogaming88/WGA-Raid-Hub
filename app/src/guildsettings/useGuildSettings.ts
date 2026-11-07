import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

// Guild settings' writes (#1644). Each function asks the guild grid's
// Create teams or Rename and archive teams (#1647); the page gate only
// decides what to show.
// Every one refreshes the guild's team list, which the sidebar and the Teams
// list both read.
const teamsKey = ['guild-teams'] as const;

// The caller becomes the new team's leader, so the access read is refreshed
// too: without it the new team's officer pages stay closed until a reload.
export function useCreateTeam(guildId: number) {
  return useSupabaseMutation<{ team_id: number; team_key: string }[], { name: string }>(
    (client, v) => client.rpc('create_team', { p_guild_id: guildId, p_name: v.name }),
    { key: ['create-team', guildId], refreshes: [teamsKey, ['access']] }
  );
}

// A new address leaves the old one working (retired_url_keys). The address
// lookup is refreshed too, so a page on the renamed team moves to its new
// address and the sidebar's links follow.
export function useUpdateTeam() {
  return useSupabaseMutation<void, { teamId: number; name: string; key: string }>(
    (client, v) => client.rpc('update_team', { p_team_id: v.teamId, p_name: v.name, p_key: v.key }),
    { key: ['update-team'], refreshes: [teamsKey, ['address']] }
  );
}

export function useSetTeamArchived() {
  return useSupabaseMutation<void, { teamId: number; archived: boolean }>(
    (client, v) => client.rpc('set_team_archived', { p_team_id: v.teamId, p_archived: v.archived }),
    { key: ['set-team-archived'], refreshes: [teamsKey] }
  );
}

export function useSetTeamUnlisted() {
  return useSupabaseMutation<void, { teamId: number; unlisted: boolean }>(
    (client, v) => client.rpc('set_team_unlisted', { p_team_id: v.teamId, p_unlisted: v.unlisted }),
    { key: ['set-team-unlisted'], refreshes: [teamsKey] }
  );
}

// The guild's rank permissions grid (#1652).
export type GridRank = 'member' | 'team_lead' | 'admin';
type GridCell = { rank: GridRank; permission: string };
export type GuildGrid = { on: GridCell[]; defaults: GridCell[] };

const gridKey = (guildId: number) => ['guild-grid', guildId] as const;

// Both tables are public reads: the guild's own ticks, and the ranks a new
// guild starts with, which Reset to defaults goes back to.
export function useGuildGrid(guildId: number) {
  return useSupabaseQuery<GuildGrid>(gridKey(guildId), async (client) => {
    const [on, defaults] = await Promise.all([
      client.from('guild_rank_permissions').select('rank, permission').eq('guild_id', guildId),
      client.from('rank_permissions').select('permission, default_ranks').eq('scope', 'guild')
    ]);
    if (on.error) return { data: null, error: on.error };
    if (defaults.error) return { data: null, error: defaults.error };
    return {
      data: {
        // The database's rank check holds these to the three GridRank values.
        on: on.data as GridCell[],
        defaults: defaults.data.flatMap((d) =>
          (d.default_ranks as GridRank[]).map((rank) => ({ rank, permission: d.permission }))
        )
      },
      error: null
    };
  });
}

// A saved switch changes what the Owner's own screens read too.
export function useSetGuildGrid(guildId: number) {
  return useSupabaseMutation<void, { changes: (GridCell & { on: boolean })[] }>(
    (client, v) => client.rpc('set_guild_rank_permissions', { p_guild_id: guildId, p_changes: v.changes }),
    { key: ['set-guild-grid', guildId], refreshes: [gridKey(guildId), ['permissions'], ['permission-teams']] }
  );
}
