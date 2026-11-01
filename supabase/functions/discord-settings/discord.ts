// What Settings › Discord (#994) shows about a server, worked out from
// Discord's own answers: the text channels with what the bot is missing in
// each, and the roles a post can ping. No I/O here; handler.ts fetches.

export type DiscordRole = { id: string; name: string; permissions: string; position: number; managed?: boolean };
export type DiscordGuild = { id: string; name: string; owner_id: string; roles: DiscordRole[] };
export type DiscordOverwrite = { id: string; type: number; allow: string; deny: string };
export type DiscordChannel = {
  id: string;
  name: string;
  type: number;
  position: number;
  parent_id?: string | null;
  permission_overwrites?: DiscordOverwrite[];
};
export type DiscordMember = { roles: string[] };

export type ShownChannel = { id: string; name: string; category: string | null; missing: string[] };
export type ShownRole = { id: string; name: string };

const ADMINISTRATOR = 1n << 3n;

// What the bot needs in a channel to post there and keep its own posts up to
// date (the signup sheet edits its message). The names are Discord's, as the
// officer sees them under Edit Channel › Permissions.
export const NEEDED: Array<[bigint, string]> = [
  [1n << 10n, 'View Channel'],
  [1n << 11n, 'Send Messages'],
  [1n << 14n, 'Embed Links'],
  [1n << 16n, 'Read Message History']
];

// Text and announcement channels: the two kinds a bot posts messages in.
const POSTABLE = new Set([0, 5]);
const CATEGORY = 4;

// Discord's permission arithmetic for one member in one channel: the server's
// @everyone role and the member's roles, then the channel's overwrites in
// order (@everyone, the member's roles together, the member). The owner and
// an Administrator have everything.
export function channelPermissions(
  guild: DiscordGuild,
  memberId: string,
  member: DiscordMember,
  channel: DiscordChannel
): bigint {
  if (guild.owner_id === memberId) return ~0n;
  const byId = new Map(guild.roles.map((r) => [r.id, BigInt(r.permissions)]));
  let perms = byId.get(guild.id) ?? 0n;
  for (const role of member.roles) perms |= byId.get(role) ?? 0n;
  if (perms & ADMINISTRATOR) return ~0n;

  const overwrites = channel.permission_overwrites ?? [];
  const everyone = overwrites.find((o) => o.id === guild.id);
  if (everyone) perms = (perms & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  let allow = 0n;
  let deny = 0n;
  for (const o of overwrites) {
    if (o.type === 0 && o.id !== guild.id && member.roles.includes(o.id)) {
      allow |= BigInt(o.allow);
      deny |= BigInt(o.deny);
    }
  }
  perms = (perms & ~deny) | allow;
  const own = overwrites.find((o) => o.type === 1 && o.id === memberId);
  if (own) perms = (perms & ~BigInt(own.deny)) | BigInt(own.allow);
  return perms;
}

// The server's text channels in the order Discord lists them (categories by
// position, channels by position inside each), each with the permissions the
// bot still needs there.
export function shownChannels(
  guild: DiscordGuild,
  channels: DiscordChannel[],
  botId: string,
  bot: DiscordMember
): ShownChannel[] {
  const categories = new Map(channels.filter((c) => c.type === CATEGORY).map((c) => [c.id, c]));
  const categoryOf = (c: DiscordChannel) => (c.parent_id ? categories.get(c.parent_id) : undefined);
  return channels
    .filter((c) => POSTABLE.has(c.type))
    .sort(
      (a, b) =>
        // Channels outside any category come first, as in Discord.
        (categoryOf(a)?.position ?? -1) - (categoryOf(b)?.position ?? -1) ||
        a.position - b.position ||
        a.name.localeCompare(b.name)
    )
    .map((c) => {
      const perms = channelPermissions(guild, botId, bot, c);
      return {
        id: c.id,
        name: c.name,
        category: categoryOf(c)?.name ?? null,
        missing: NEEDED.filter(([bit]) => !(perms & bit)).map(([, name]) => name)
      };
    });
}

// The roles a post can ping, highest first as Discord lists them: not
// @everyone (its id is the server's), and not a role Discord made for a bot.
export function shownRoles(guild: DiscordGuild): ShownRole[] {
  return guild.roles
    .filter((r) => r.id !== guild.id && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name }));
}
