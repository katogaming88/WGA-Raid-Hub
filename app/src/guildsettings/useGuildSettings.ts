import { useSupabaseMutation } from '../data/query';

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
