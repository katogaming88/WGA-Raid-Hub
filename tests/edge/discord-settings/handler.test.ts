// discord-settings' handler against injected dependencies: the database's
// gate on the team, the servers the caller shares with the bot (and their
// record), the saved server's lists, and the test message staying inside the
// team's own server.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  CANT_POST,
  DISCORD_DOWN,
  NOT_IN_SERVER,
  NOT_SET_UP,
  NO_SERVER,
  type SettingsDb,
  handle
} from '../../../supabase/functions/discord-settings/handler.ts';
import { VERSION } from '../../../supabase/functions/discord-settings/version.ts';
import { GUILD } from './discord.test.ts';

const URL = 'http://edge.test/functions/v1/discord-settings';
const AUTH = 'Bearer caller-jwt';
const SERVER = GUILD.id;
const OTHER = '100000000000000777';
const DISCORD_ID = '400000000000000004';
const BOT = '200000000000000002';
const CHANNEL = '500000000000000005';

type State = {
  user?: { id: string } | null;
  server?: { serverId: string | null } | 'forbidden';
  person?: { id: number; discordId: string | null } | null;
};

function fakeDb(state: State = {}): SettingsDb & { recorded: string[][] } {
  const recorded: string[][] = [];
  return {
    recorded,
    getUser: () => Promise.resolve(state.user === undefined ? { id: 'u1' } : state.user),
    teamServer: () => Promise.resolve(state.server ?? { serverId: SERVER }),
    person: () => Promise.resolve(state.person === undefined ? { id: 7, discordId: DISCORD_ID } : state.person),
    recordAccess: (_person, ids) => {
      recorded.push(ids);
      return Promise.resolve();
    },
    teamName: () => Promise.resolve('Phoenix')
  };
}

// Discord, answered by "METHOD path"; anything unscripted is a 404.
function fakeDiscord(routes: Record<string, Response | (() => Response)>) {
  const calls: Array<{ key: string; body: string | null; auth: string | null }> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const key = `${req.method} ${req.url.replace(API, '')}`;
    calls.push({ key, body: (await req.text()) || null, auth: req.headers.get('Authorization') });
    const answer = routes[key];
    return typeof answer === 'function' ? answer() : (answer ?? new Response('', { status: 404 }));
  };
  return { fetch: fetch as typeof globalThis.fetch, calls };
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => () => new Response('', { status: code });

const post = (body: unknown, auth: string | null = AUTH) =>
  new Request(URL, {
    method: 'POST',
    headers: auth ? { Authorization: auth, 'Content-Type': 'application/json' } : {},
    body: JSON.stringify(body)
  });

const serverRoutes = {
  'GET /users/@me/guilds': ok([
    { id: SERVER, name: 'We Go Again' },
    { id: OTHER, name: 'Somewhere Else' }
  ]),
  [`GET /guilds/${SERVER}/members/${DISCORD_ID}`]: ok({ roles: [] }),
  [`GET /guilds/${SERVER}`]: ok(GUILD),
  [`GET /guilds/${SERVER}/channels`]: ok([{ id: CHANNEL, name: 'phoenix-officers', type: 0, position: 0 }]),
  'GET /users/@me': ok({ id: BOT }),
  [`GET /guilds/${SERVER}/members/${BOT}`]: ok({ roles: ['300000000000000003'] })
};

const run = (
  body: unknown,
  db = fakeDb(),
  routes: Record<string, () => Response> = serverRoutes,
  botToken: string | undefined = 'bot-token'
) => {
  const discord = fakeDiscord(routes);
  return handle(post(body), { fetch: discord.fetch, db, botToken }).then(async (res) => ({
    status: res.status,
    body: await res.json(),
    calls: discord.calls,
    db
  }));
};

Deno.test('load: shared servers recorded, and the saved server read with its channels and roles', async () => {
  const { status: code, body, calls, db } = await run({ teamId: 1, action: 'load' });
  assertEquals(code, 200);
  assertEquals(body.hasDiscord, true);
  assertEquals(body.servers, [{ id: SERVER, name: 'We Go Again' }]);
  assertEquals(db.recorded, [[SERVER]]);
  assertEquals(body.server.name, 'We Go Again');
  assertEquals(body.server.botIn, true);
  assertEquals(body.server.channels, [{ id: CHANNEL, name: 'phoenix-officers', category: null, missing: [] }]);
  assertEquals(
    body.server.roles.map((r: { name: string }) => r.name),
    ['Phoenix Officer', 'Phoenix Raider']
  );
  assertEquals(
    calls.every((c) => c.auth === 'Bot bot-token'),
    true
  );
});

Deno.test('load: a team with no server yet gets the shared servers and no lists', async () => {
  const { body, calls } = await run({ teamId: 1, action: 'load' }, fakeDb({ server: { serverId: null } }));
  assertEquals(body.servers.length, 1);
  assertEquals(body.server, null);
  assertEquals(
    calls.some((c) => c.key.endsWith('/channels')),
    false
  );
});

Deno.test('load: a saved server the bot has left says so, with no lists', async () => {
  const { body } = await run({ teamId: 1, action: 'load' }, fakeDb({ server: { serverId: '100000000000000999' } }));
  assertEquals(body.server, { id: '100000000000000999', name: null, botIn: false, channels: [], roles: [] });
});

Deno.test('load: no Discord on the account means no servers and nothing recorded', async () => {
  const db = fakeDb({ person: { id: 7, discordId: null } });
  const { body } = await run({ teamId: 1, action: 'load' }, db);
  assertEquals(body.hasDiscord, false);
  assertEquals(body.servers, []);
  assertEquals(db.recorded, []);
});

Deno.test("refused by the database's gate: 403, and Discord is never asked", async () => {
  const { status: code, calls } = await run({ teamId: 1, action: 'load' }, fakeDb({ server: 'forbidden' }));
  assertEquals(code, 403);
  assertEquals(calls, []);
});

Deno.test('signed out: 401', async () => {
  const res = await handle(post({ teamId: 1, action: 'load' }, null), {
    fetch: fakeDiscord({}).fetch,
    db: fakeDb(),
    botToken: 'x'
  });
  assertEquals(res.status, 401);
  const expired = await run({ teamId: 1, action: 'load' }, fakeDb({ user: null }));
  assertEquals(expired.status, 401);
});

Deno.test('no bot token on the site: a plain message', async () => {
  const { status: code, body } = await run({ teamId: 1, action: 'load' }, fakeDb(), serverRoutes, '');
  assertEquals(code, 500);
  assertEquals(body.error, NOT_SET_UP);
});

Deno.test('Discord down or rate limited: 502', async () => {
  const { status: code, body } = await run({ teamId: 1, action: 'load' }, fakeDb(), {
    ...serverRoutes,
    'GET /users/@me/guilds': status(429)
  });
  assertEquals(code, 502);
  assertEquals(body.error, DISCORD_DOWN);
});

const testRoutes = {
  [`GET /channels/${CHANNEL}`]: ok({ guild_id: SERVER }),
  [`POST /channels/${CHANNEL}/messages`]: ok({ id: '1' })
};

Deno.test('test: posts in a channel of the saved server, pinging nobody', async () => {
  const { status: code, calls } = await run(
    { teamId: 1, action: 'test', channelId: CHANNEL, kind: 'rsvp_changes' },
    fakeDb(),
    testRoutes
  );
  assertEquals(code, 200);
  const sent = calls.find((c) => c.key.startsWith('POST'));
  assertEquals(JSON.parse(sent!.body!), {
    content: "Test message from WGA Raid Hub: Phoenix's RSVP changes will post here.",
    allowed_mentions: { parse: [] }
  });
});

Deno.test('test: a channel in another server is refused, and nothing posts', async () => {
  const {
    status: code,
    body,
    calls
  } = await run({ teamId: 1, action: 'test', channelId: CHANNEL, kind: 'rsvp_changes' }, fakeDb(), {
    ...testRoutes,
    [`GET /channels/${CHANNEL}`]: ok({ guild_id: OTHER })
  });
  assertEquals(code, 404);
  assertEquals(body.error, NOT_IN_SERVER);
  assertEquals(
    calls.some((c) => c.key.startsWith('POST')),
    false
  );
});

Deno.test("test: a channel the bot can't see or post in says so", async () => {
  const hidden = await run({ teamId: 1, action: 'test', channelId: CHANNEL, kind: 'signup_sheet' }, fakeDb(), {
    [`GET /channels/${CHANNEL}`]: status(403)
  });
  assertEquals([hidden.status, hidden.body.error], [409, CANT_POST]);
  const mute = await run({ teamId: 1, action: 'test', channelId: CHANNEL, kind: 'signup_sheet' }, fakeDb(), {
    ...testRoutes,
    [`POST /channels/${CHANNEL}/messages`]: status(403)
  });
  assertEquals([mute.status, mute.body.error], [409, CANT_POST]);
});

Deno.test('test: a channel gone before the post is a failure, not a success', async () => {
  const { status: code, body } = await run(
    { teamId: 1, action: 'test', channelId: CHANNEL, kind: 'rsvp_changes' },
    fakeDb(),
    { ...testRoutes, [`POST /channels/${CHANNEL}/messages`]: status(404) }
  );
  assertEquals([code, body.error], [404, NOT_IN_SERVER]);
});

Deno.test('test: no saved server, a bad channel id or kind are refused before Discord', async () => {
  const noServer = await run(
    { teamId: 1, action: 'test', channelId: CHANNEL, kind: 'rsvp_changes' },
    fakeDb({ server: { serverId: null } }),
    testRoutes
  );
  assertEquals([noServer.status, noServer.body.error, noServer.calls.length], [409, NO_SERVER, 0]);
  const badId = await run({ teamId: 1, action: 'test', channelId: '../guilds', kind: 'rsvp_changes' });
  assertEquals([badId.status, badId.calls.length], [400, 0]);
  const badKind = await run({ teamId: 1, action: 'test', channelId: CHANNEL, kind: 'everything' });
  assertEquals([badKind.status, badKind.calls.length], [400, 0]);
});

Deno.test('answers its preflight with the stamped version', async () => {
  const res = await handle(new Request(URL, { method: 'OPTIONS' }), {
    fetch: fakeDiscord({}).fetch,
    db: fakeDb(),
    botToken: 'x'
  });
  assertEquals(res.headers.get('X-WGA-Version'), VERSION);
});
