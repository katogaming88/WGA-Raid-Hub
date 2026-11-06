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
