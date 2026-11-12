import { useSupabaseQuery } from '../data/query';
import type { RecruitingTeam } from './apply';

// team_recruiting_page() (#1535), open to anyone: the guild's listed teams, or
// one team by its key. A team that is neither taking applications nor listed
// comes back as no rows, which the page shows as not found.
export function useRecruitingTeams(guildKey: string, teamKey?: string) {
  return useSupabaseQuery<RecruitingTeam[]>(['recruiting-page', guildKey, teamKey ?? null], async (client) => {
    const { data, error } = await client.rpc('team_recruiting_page', {
      p_guild_key: guildKey,
      ...(teamKey ? { p_team_key: teamKey } : {})
    });
    return { data: (data ?? []) as unknown as RecruitingTeam[], error };
  });
}
