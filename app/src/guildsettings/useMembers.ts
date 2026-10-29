import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

// The guild's Members tab (#1650). Each database function behind these three
// calls refuses anyone the guild grid does not allow, so the page only decides
// what to show.
export type GuildRank = 'owner' | 'admin' | 'team_lead' | 'member';

export type GuildMember = { person_id: number; display_name: string; rank: GuildRank; is_you: boolean };

export const RANK_LABELS: Record<GuildRank, string> = {
  owner: 'Owner',
  admin: 'Admin',
  team_lead: 'Team Lead',
  member: 'Member'
};

const membersKey = (guildId: number) => ['guild-members', guildId] as const;

export function useGuildMembers(guildId: number) {
  return useSupabaseQuery<GuildMember[]>(membersKey(guildId), async (client) => {
    const { data, error } = await client.rpc('guild_members', { p_guild_id: guildId });
    if (error) return { data: null, error };
    // The database's rank check holds it to the four GuildRank values.
    return { data: data as GuildMember[], error: null };
  });
}

// Promote or demote to Admin, Team Lead or Member. Never to Owner: that is
// useTransferOwnership.
export function useSetGuildRank(guildId: number) {
  return useSupabaseMutation<void, { personId: number; rank: Exclude<GuildRank, 'owner'> }>(
    (client, v) => client.rpc('set_guild_rank', { p_guild_id: guildId, p_person_id: v.personId, p_rank: v.rank }),
    { key: ['set-guild-rank', guildId], refreshes: [membersKey(guildId), ['permissions']] }
  );
}

// The caller becomes an Admin; the person picked becomes the Owner.
export function useTransferOwnership(guildId: number) {
  return useSupabaseMutation<void, { personId: number }>(
    (client, v) => client.rpc('transfer_guild_ownership', { p_guild_id: guildId, p_person_id: v.personId }),
    { key: ['transfer-guild-ownership', guildId], refreshes: [membersKey(guildId), ['permissions']] }
  );
}
