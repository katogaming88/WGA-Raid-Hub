import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

export type InviteTarget = { teamId: number; teamName: string; teamSlug: string; guildName: string };

// What a /join/<code> link points at (team_invite_link_resolve, callable
// before sign-in). Null means the link is reset, expired or unknown.
export function useInviteTarget(code: string) {
  return useSupabaseQuery<InviteTarget | null>(['invite-target', code], async (client) => {
    const { data, error } = await client.rpc('team_invite_link_resolve', { p_code: code });
    if (error) return { data: null, error };
    const row = (data as { team_id: number; team_name: string; team_slug: string; guild_name: string }[] | null)?.[0];
    return {
      data: row
        ? { teamId: row.team_id, teamName: row.team_name, teamSlug: row.team_slug, guildName: row.guild_name }
        : null,
      error: null
    };
  });
}

// The character is named by its Battle.net id, not described (#1319). The join
// resolves it from the characters the person's own Battle.net account holds, so
// the roster name never comes from what the caller sent. Null joins the team
// alone, before a Member and a character are picked (#1355).
export type Chosen = { blizzardId: number | null };

// 'joined' = on the roster; 'waiting' = in the guild and team, but the team
// is at its active-character limit (#1259), so an officer is flagged.
export type JoinOutcome = 'joined' | 'waiting';

// Joins through the link (team_invite_link_join, #1264): the link is the approval. Called once with no
// character to join the team, then again with the picked one to land on the roster.
export function useJoinTeam(code: string) {
  return useSupabaseMutation<JoinOutcome, Chosen>(
    async (client, c) => {
      const { data, error } = await client.rpc('team_invite_link_join', {
        p_code: code,
        // The generated types mark every argument required; the function takes null.
        p_blizzard_id: c.blizzardId as number
      });
      if (error) return { data: null, error };
      return { data: data as JoinOutcome, error: null };
    },
    { key: ['join-team', code], refreshes: [['access'], ['roster']] }
  );
}
