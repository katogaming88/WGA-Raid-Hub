import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

// The three functions are not in js/database.types.ts until their migration
// lands, so the typed rpc() would refuse them. Drop this and call
// client.rpc() directly once npm run db:types has them.
type Reply<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
const call = <T>(client: unknown, fn: string, args: Record<string, unknown>) =>
  (client as { rpc: (fn: string, args: Record<string, unknown>) => Reply<T> }).rpc(fn, args);

// The guild's Members tab (#1650). The database functions behind these three
// calls come in a migration of their own; each refuses anyone the guild grid
// does not allow, so the page only decides what to show.
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
  return useSupabaseQuery<GuildMember[]>(membersKey(guildId), (client) =>
    call<GuildMember[]>(client, 'guild_members', { p_guild_id: guildId })
  );
}

// Promote or demote to Admin, Team Lead or Member. Never to Owner: that is
// useTransferOwnership.
export function useSetGuildRank(guildId: number) {
  return useSupabaseMutation<void, { personId: number; rank: Exclude<GuildRank, 'owner'> }>(
    (client, v) =>
      call<void>(client, 'set_guild_rank', { p_guild_id: guildId, p_person_id: v.personId, p_rank: v.rank }),
    { key: ['set-guild-rank', guildId], refreshes: [membersKey(guildId), ['permissions']] }
  );
}

// The caller becomes an Admin; the person picked becomes the Owner.
export function useTransferOwnership(guildId: number) {
  return useSupabaseMutation<void, { personId: number }>(
    (client, v) => call<void>(client, 'transfer_guild_ownership', { p_guild_id: guildId, p_person_id: v.personId }),
    { key: ['transfer-guild-ownership', guildId], refreshes: [membersKey(guildId), ['permissions']] }
  );
}
