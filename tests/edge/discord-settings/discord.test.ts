// discord-settings' channel and role lists: Discord's permission arithmetic
// for the bot in each channel, and which roles a post may ping.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  type DiscordGuild,
  channelPermissions,
  shownCategories,
  shownChannels,
  shownRoles
} from '../../../supabase/functions/discord-settings/discord.ts';

const SERVER = '100000000000000001';
const BOT = '200000000000000002';
const BOT_ROLE = '300000000000000003';
const OFFICER = '300000000000000004';

const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const EMBED = 1n << 14n;
const HISTORY = 1n << 16n;
const POSTING = String(VIEW | SEND | EMBED | HISTORY);

export const GUILD: DiscordGuild = {
  id: SERVER,
  name: 'We Go Again',
  owner_id: '900000000000000009',
  roles: [
    { id: SERVER, name: '@everyone', permissions: String(VIEW | SEND | HISTORY), position: 0 },
    { id: BOT_ROLE, name: 'WGA Raid Hub', permissions: String(EMBED), position: 5, managed: true },
    { id: OFFICER, name: 'Phoenix Officer', permissions: '0', position: 3 },
    { id: '300000000000000005', name: 'Phoenix Raider', permissions: '0', position: 2 }
  ]
};
const bot = { roles: [BOT_ROLE] };

Deno.test('the bot gets @everyone and its own role across the server', () => {
  const perms = channelPermissions(GUILD, BOT, bot, { id: '1', name: 'general', type: 0, position: 0 });
  assertEquals(perms, VIEW | SEND | HISTORY | EMBED);
});

Deno.test("a private channel hides itself from @everyone and the bot's role puts it back", () => {
  const hidden = {
    id: '1',
    name: 'phoenix-officers',
    type: 0,
    position: 0,
    permission_overwrites: [{ id: SERVER, type: 0, allow: '0', deny: String(VIEW) }]
  };
  assertEquals(channelPermissions(GUILD, BOT, bot, hidden) & VIEW, 0n);
  const shared = {
    ...hidden,
    permission_overwrites: [...hidden.permission_overwrites, { id: BOT_ROLE, type: 0, allow: String(VIEW), deny: '0' }]
  };
  assertEquals(channelPermissions(GUILD, BOT, bot, shared) & VIEW, VIEW);
});

Deno.test("a role's allow wins over another role's deny, and the member's own overwrite wins over both", () => {
  const twoRoles = { roles: [BOT_ROLE, OFFICER] };
  const channel = {
    id: '1',
    name: 'x',
    type: 0,
    position: 0,
    permission_overwrites: [
      { id: BOT_ROLE, type: 0, allow: '0', deny: String(SEND) },
      { id: OFFICER, type: 0, allow: String(SEND), deny: '0' }
    ]
  };
  assertEquals(channelPermissions(GUILD, BOT, twoRoles, channel) & SEND, SEND);
  channel.permission_overwrites.push({ id: BOT, type: 1, allow: '0', deny: String(SEND) });
  assertEquals(channelPermissions(GUILD, BOT, twoRoles, channel) & SEND, 0n);
});

Deno.test('Administrator ignores every overwrite', () => {
  const admin = {
    ...GUILD,
    roles: GUILD.roles.map((r) => (r.id === BOT_ROLE ? { ...r, permissions: String(1n << 3n) } : r))
  };
  const channel = {
    id: '1',
    name: 'x',
    type: 0,
    position: 0,
    permission_overwrites: [{ id: BOT, type: 1, allow: '0', deny: POSTING }]
  };
  assertEquals(channelPermissions(admin, BOT, bot, channel) & VIEW, VIEW);
});

Deno.test('channels: text and announcement only, by category then position, each with what the bot lacks', () => {
  const list = shownChannels(
    GUILD,
    [
      { id: 'c2', name: 'RAIDS', type: 4, position: 2 },
      { id: 'c1', name: 'OFFICERS', type: 4, position: 1 },
      { id: 'v', name: 'Voice', type: 2, position: 0 },
      { id: 't', name: 'tuesday-raids', type: 0, position: 1, parent_id: 'c2' },
      { id: 'n', name: 'news', type: 5, position: 0, parent_id: 'c2' },
      {
        id: 'o',
        name: 'phoenix-officers',
        type: 0,
        position: 0,
        parent_id: 'c1',
        permission_overwrites: [{ id: SERVER, type: 0, allow: '0', deny: String(VIEW | EMBED) }]
      },
      { id: 'g', name: 'general', type: 0, position: 5 }
    ],
    BOT,
    bot
  );
  assertEquals(list, [
    { id: 'g', name: 'general', category: null, missing: [] },
    { id: 'o', name: 'phoenix-officers', category: 'OFFICERS', missing: ['View Channel', 'Embed Links'] },
    { id: 'n', name: 'news', category: 'RAIDS', missing: [] },
    { id: 't', name: 'tuesday-raids', category: 'RAIDS', missing: [] }
  ]);
});

// #1814: what the bot lacks in a category to make ticket channels there.
Deno.test('categories: in order, each with what the bot needs to make ticket channels', () => {
  const MANAGE_CHANNELS = 1n << 4n;
  const MANAGE_PERMISSIONS = 1n << 28n;
  const list = shownCategories(
    GUILD,
    [
      {
        id: 'c2',
        name: 'TICKETS',
        type: 4,
        position: 2,
        permission_overwrites: [
          { id: BOT_ROLE, type: 0, allow: String(MANAGE_CHANNELS | MANAGE_PERMISSIONS), deny: '0' }
        ]
      },
      {
        id: 'c1',
        name: 'OFFICERS',
        type: 4,
        position: 1,
        permission_overwrites: [{ id: SERVER, type: 0, allow: '0', deny: String(VIEW) }]
      },
      { id: 't', name: 'tuesday-raids', type: 0, position: 1, parent_id: 'c2' }
    ],
    BOT,
    bot
  );
  assertEquals(list, [
    { id: 'c1', name: 'OFFICERS', missing: ['View Channel', 'Manage Channels', 'Manage Permissions'] },
    { id: 'c2', name: 'TICKETS', missing: [] }
  ]);
});

Deno.test('categories: an Administrator bot lacks nothing', () => {
  const admin = {
    ...GUILD,
    roles: GUILD.roles.map((r) => (r.id === BOT_ROLE ? { ...r, permissions: String(1n << 3n) } : r))
  };
  assertEquals(shownCategories(admin, [{ id: 'c', name: 'T', type: 4, position: 0 }], BOT, bot)[0]!.missing, []);
});

Deno.test("roles: highest first, without @everyone or a bot's own role", () => {
  assertEquals(shownRoles(GUILD), [
    { id: OFFICER, name: 'Phoenix Officer' },
    { id: '300000000000000005', name: 'Phoenix Raider' }
  ]);
});
