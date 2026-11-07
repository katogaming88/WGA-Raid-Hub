import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

export type TeamRank = 'owner' | 'officer' | 'assistant' | 'raider';
export type SettableTeamRank = Exclude<TeamRank, 'owner'>;
export type TeamMemberRank = {
  team_member_id: number;
  display_name: string;
  rank: TeamRank;
  signed_in: boolean;
  is_you: boolean;
};

const ranksKey = (teamId: number) => ['team-member-ranks', teamId];

// A team's current members and their ranks (#1651), for Settings > Ranks and
// the Team Owner picker. A function, since the names include Discord names,
// which the app can't read, and change_team_owner alone doesn't read a team.
export function useTeamMemberRanks(teamId: number) {
  return useSupabaseQuery<TeamMemberRank[]>(ranksKey(teamId), async (client) => {
    const { data, error } = await client.rpc('team_member_ranks', { p_team_id: teamId });
    // The column is text; team_members_rank_matches_role holds it to these four.
    return { data: data as TeamMemberRank[] | null, error };
  });
}

// What each rank can do on this team, from its own grid (#1645).
export function useTeamRankGrid(teamId: number) {
  return useSupabaseQuery<Map<TeamRank, Set<string>>>(['team-rank-grid', teamId], async (client) => {
    // team-read-guard: three ranks times the grid's 14 permissions, per team
    const { data, error } = await client.from('team_rank_permissions').select('rank, permission').eq('team_id', teamId);
    if (error) return { data: null, error };
    const grid = new Map<TeamRank, Set<string>>();
    for (const row of (data ?? []) as { rank: TeamRank; permission: string }[]) {
      grid.set(row.rank, (grid.get(row.rank) ?? new Set()).add(row.permission));
    }
    return { data: grid, error: null };
  });
}

// The team's rank permissions grid (#1653), the Team Owner's to change.
export type TeamGridRank = 'raider' | 'assistant' | 'officer';
export type TeamGridCell = { rank: TeamGridRank; permission: string };
export type TeamGrid = { on: TeamGridCell[]; defaults: TeamGridCell[] };

const teamGridKey = (teamId: number) => ['team-grid', teamId] as const;

// Both tables are public reads: the team's own ticks, and the ranks a new team
// starts with, which Reset to defaults goes back to.
export function useTeamGrid(teamId: number) {
  return useSupabaseQuery<TeamGrid>(teamGridKey(teamId), async (client) => {
    const [on, defaults] = await Promise.all([
      // team-read-guard: three ranks times the grid's 14 permissions, per team
      client.from('team_rank_permissions').select('rank, permission').eq('team_id', teamId),
      client.from('rank_permissions').select('permission, default_ranks').eq('scope', 'team')
    ]);
    if (on.error) return { data: null, error: on.error };
    if (defaults.error) return { data: null, error: defaults.error };
    return {
      data: {
        // The database's rank check holds these to the three TeamGridRank values.
        on: on.data as TeamGridCell[],
        defaults: defaults.data.flatMap((d) =>
          (d.default_ranks as TeamGridRank[]).map((rank) => ({ rank, permission: d.permission }))
        )
      },
      error: null
    };
  });
}

// A saved switch changes what the Owner's own screens read too.
export function useSetTeamGrid(teamId: number) {
  return useSupabaseMutation<void, { changes: (TeamGridCell & { on: boolean })[] }>(
    (client, v) => client.rpc('set_team_rank_permissions', { p_team_id: teamId, p_changes: v.changes }),
    { key: ['set-team-grid', teamId], refreshes: [teamGridKey(teamId), ['team-rank-grid', teamId], ['permissions']] }
  );
}

export function useSetTeamRank(teamId: number) {
  return useSupabaseMutation<void, { teamMemberId: number; rank: SettableTeamRank }>(
    (client, v) => client.rpc('set_team_rank', { p_team_id: teamId, p_team_member_id: v.teamMemberId, p_rank: v.rank }),
    { key: ['set-team-rank', teamId], refreshes: [ranksKey(teamId), ['permissions']] }
  );
}

export function useChangeTeamOwner(teamId: number) {
  return useSupabaseMutation<void, { teamMemberId: number }>(
    (client, v) => client.rpc('change_team_owner', { p_team_id: teamId, p_team_member_id: v.teamMemberId }),
    { key: ['change-team-owner', teamId], refreshes: [ranksKey(teamId), ['permissions']] }
  );
}
