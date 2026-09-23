import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

export type InviteLink = { code: string; expiresAt: string | null };

const key = (teamId: number) => ['invite-link', teamId] as const;

// team_invite_links (#1264): no row yet means the team has never generated a
// link. Officer/team_leader/guild officer/site admin read, same as the reset
// below -- RLS matches 'viewOfficerTools' exactly, so any officer page visitor
// can see and reset it.
export function useInviteLink(teamId: number) {
  return useSupabaseQuery<InviteLink | null>(key(teamId), async (client) => {
    const result = await client
      .from('team_invite_links')
      .select('code, expires_at')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const row = result.data as { code: string; expires_at: string | null } | null;
    return { data: row ? { code: row.code, expiresAt: row.expires_at } : null, error: null };
  });
}

// Generates (first time) or resets (after) the team's invite code via
// team_invite_link_reset(). `expiresAt` null means no expiry.
export function useResetInviteLink(teamId: number) {
  return useSupabaseMutation<InviteLink, { expiresAt: string | null }>(
    async (client, { expiresAt }) => {
      const result = await client.rpc('team_invite_link_reset', {
        p_team_id: teamId,
        ...(expiresAt ? { p_expires_at: expiresAt } : {})
      });
      if (result.error) return { data: null, error: result.error };
      const row = result.data as { code: string; expires_at: string | null };
      return { data: { code: row.code, expiresAt: row.expires_at }, error: null };
    },
    { key: ['reset-invite-link', teamId], refreshes: [key(teamId)] }
  );
}

// Deletes the team's code outright via team_invite_link_revoke(), leaving no
// replacement -- unlike reset(), which always leaves a live one.
export function useRevokeInviteLink(teamId: number) {
  return useSupabaseMutation<void, void>(
    async (client) => {
      const result = await client.rpc('team_invite_link_revoke', { p_team_id: teamId });
      return { data: null, error: result.error };
    },
    { key: ['revoke-invite-link', teamId], refreshes: [key(teamId)] }
  );
}
