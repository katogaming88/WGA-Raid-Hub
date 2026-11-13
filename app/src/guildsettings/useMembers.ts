import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

// The guild's Members tab (#1650). Each database function behind these three
// calls refuses anyone the guild grid does not allow, so the page only decides
// what to show.
export type GuildRank = 'owner' | 'admin' | 'team_lead' | 'member';

export type TeamRank = 'owner' | 'officer' | 'assistant' | 'raider';

export const TEAM_RANK_LABELS: Record<TeamRank, string> = {
  owner: 'Team Owner',
  officer: 'Officer',
  assistant: 'Assistant',
  raider: 'Raider'
};

export type GuildMember = {
  person_id: number;
  display_name: string;
  rank: GuildRank;
  is_you: boolean;
  // Current teams in this guild with the person's rank on each.
  teams: { team_id: number; name: string; rank: TeamRank }[];
  // Null until they have signed in.
  last_sign_in: string | null;
  // Their characters' names, for the search box.
  characters: string[];
};

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

// The guild's recruiters, on or off (#1550), for the Members tab's Recruiter
// column. Read only by someone with manage_recruiters; the Owner and Admins
// hold it, so an Admin whose grid row was taken away just sees the column off.
export type GuildRecruiter = { person_id: number; code: string; active: boolean; in_guild: boolean };

export function useGuildRecruiters(guildId: number, enabled: boolean) {
  return useSupabaseQuery<GuildRecruiter[]>(
    ['guild-recruiters', guildId],
    async (client) => {
      const { data, error } = await client.rpc('guild_recruiter_list', { p_guild_id: guildId });
      return { data: (data ?? []) as GuildRecruiter[], error };
    },
    { enabled }
  );
}

export function useSetRecruiter(guildId: number) {
  return useSupabaseMutation<unknown, { personId: number; on: boolean }>(
    (client, v) => client.rpc('set_guild_recruiter', { p_guild_id: guildId, p_person_id: v.personId, p_on: v.on }),
    { key: ['set-recruiter', guildId], refreshes: [['guild-recruiters', guildId], ['my-recruiter-code']] }
  );
}
