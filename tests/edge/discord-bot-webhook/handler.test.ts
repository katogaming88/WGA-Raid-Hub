// discord-bot-webhook's handler (#959): who may ask for each notice, that the
// post goes to the channel and role the team picked and only inside its own
// server, and what it answers when Discord or the settings say no.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  CANT_SEE,
  NOT_IN_SERVER,
  NO_RECORD,
  type Deps,
  type OwnAdd,
  type PostSetting,
  type RelayDb,
  handle
} from '../../../supabase/functions/discord-bot-webhook/handler.ts';
import { PRODUCTION_HOST } from '../../../supabase/functions/_shared/discord-destination.ts';
import { VERSION } from '../../../supabase/functions/discord-bot-webhook/version.ts';
import { PAYLOADS } from './posts.test.ts';

const URL = 'http://edge.test/functions/v1/discord-bot-webhook';
const SERVER = '100000000000000001';
const CHANNEL = '200000000000000002';
const ROLE = '300000000000000003';
const TEST_WEBHOOK_URL = 'https://discord.test/api/webhooks/1/x';

const PROD_ENV: Record<string, string> = {
  SUPABASE_URL: `https://${PRODUCTION_HOST}`,
  DISCORD_BOT_TOKEN: 'bot-token',
  OPTIONAL_RSVP_REMINDERS_SECRET: 'cron-secret'
};
const LOCAL_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  DISCORD_TEST_WEBHOOK_URL: TEST_WEBHOOK_URL
};

const ADD: OwnAdd = {
  auditId: 41,
  team: 'phoenix',
  member: 'Kat',
  nameRealm: 'Katorrí-Stormrage',
  classSpec: 'Warlock Demonology DPS',
  addedAt: '2026-10-27T19:59:58Z'
};

type State = {
  user?: { id: string } | null;
  setting?: PostSetting | null;
  record?: boolean;
  team?: { id: number } | 'ambiguous' | null;
  add?: OwnAdd | null;
};

function fakeDb(state: State = {}) {
  const log: string[] = [];
  const db: RelayDb = {
    getUser: () => Promise.resolve(state.user === undefined ? { id: 'u1' } : state.user),
    latestOwnAdd: (_auth, team) => {
      log.push('latestOwnAdd ' + team);
      return Promise.resolve(state.add === undefined ? ADD : state.add);
    },
    team: (key) => {
      log.push('team ' + key);
      return Promise.resolve(state.team === undefined ? { id: 1 } : state.team);
    },
    postSetting: (_team, kind) => {
      log.push('postSetting ' + kind);
      return Promise.resolve(
        state.setting === undefined ? { serverId: SERVER, channelId: CHANNEL, roleId: ROLE } : state.setting
      );
    },
    serverOf: () => Promise.resolve(SERVER),
    recentRecord: (table, _team, nameRealm) => {
      log.push(`recentRecord ${table} ${nameRealm}`);
      return Promise.resolve(state.record ?? true);
    },
    markPosted: (_team, kind) => {
      log.push('markPosted ' + kind);
      return Promise.resolve();
    }
  };
  return { db, log };
}

// Discord, answered by "METHOD path"; anything unscripted is a 404.
type Route = () => Response;
const ok =
  (body: unknown): Route =>
  () =>
    new Response(JSON.stringify(body), { status: 200 });
const status =
  (code: number, body: unknown = {}): Route =>
  () =>
    new Response(JSON.stringify(body), { status: code });

const DISCORD: Record<string, Route> = {
  [`GET /channels/${CHANNEL}`]: ok({ id: CHANNEL, guild_id: SERVER, name: 'phoenix-officers', type: 0 }),
  [`GET /guilds/${SERVER}/roles`]: ok([{ id: SERVER }, { id: ROLE }]),
  [`POST /channels/${CHANNEL}/messages`]: ok({ id: 'm1' })
};

async function run(
  body: unknown,
  {
    state = {},
    routes = DISCORD,
    env = PROD_ENV,
    headers = { Authorization: 'Bearer user-jwt' } as Record<string, string>
  } = {}
) {
  const { db, log } = fakeDb(state);
  const calls: Array<{ key: string; body: any }> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const key = req.url.startsWith(API) ? `${req.method} ${req.url.slice(API.length)}` : `${req.method} ${req.url}`;
    const text = await req.text();
    calls.push({ key, body: text ? JSON.parse(text) : null });
    const route = routes[key] ?? (key.startsWith('POST https://discord.test') ? ok({}) : status(404));
    return route();
  };
  const slept: number[] = [];
  const deps: Deps = {
    fetch: fetch as typeof globalThis.fetch,
    env: { get: (name) => env[name] },
    db,
    now: () => new Date('2026-11-01T14:00:00.000Z'),
    sleep: (ms) => {
      slept.push(ms);
      return Promise.resolve();
    }
  };
  const res = await handle(
    new Request(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    deps
  );
  return { status: res.status, body: await res.json(), calls, log, slept };
}

const notice = (action: string, payload: unknown = PAYLOADS[action]) => ({ action, team: 'phoenix', payload });
const posted = (calls: Array<{ key: string; body: any }>) => calls.filter((c) => c.key.startsWith('POST /channels/'));

// -- The gate ---------------------------------------------------------------

Deno.test('every signed-in action refuses a request with no sign-in, and calls Discord for none', async () => {
  for (const action of ['signup', 'addCharacter', 'rsvp', 'signupSheetSync', 'verifyChannel']) {
    for (const headers of [{}, { Authorization: 'Bearer anon-key' }]) {
      const { status: code, calls } = await run(notice(action, PAYLOADS[action] ?? {}), {
        headers,
        state: { user: 'Authorization' in headers ? null : undefined }
      });
      assertEquals([code, calls.length], [401, 0], `${action} ${JSON.stringify(headers)}`);
    }
  }
});

Deno.test('the reminder takes only the job secret, and an unset secret refuses everything', async () => {
  const reminder = {
    action: 'optionalReminder',
    team: 'phoenix',
    payload: { discordId: '400000000000000004', checkpoint: '24h', raidDate: '2026-11-04' }
  };
  assertEquals((await run(reminder)).status, 401);
  assertEquals((await run(reminder, { headers: { 'x-cron-secret': 'wrong' } })).status, 401);
  const unset = { ...PROD_ENV, OPTIONAL_RSVP_REMINDERS_SECRET: '' };
  assertEquals((await run(reminder, { headers: { 'x-cron-secret': '' }, env: unset })).status, 401);

  const sent = await run(reminder, {
    headers: { 'x-cron-secret': 'cron-secret' },
    routes: { 'POST /users/@me/channels': ok({ id: '900000000000000009' }) }
  });
  assertEquals(sent.status, 200);
  assertEquals(
    sent.calls.map((c) => c.key),
    ['POST /users/@me/channels', 'POST /channels/900000000000000009/messages']
  );
  assertEquals(sent.calls[1].body.allowed_mentions, { parse: [], roles: [], users: [] });
});

Deno.test('a request form posts only after its row was just written, for that character', async () => {
  for (const [action, table] of [
    ['selfreceived', 'self_received_requests'],
    ['bis', 'bis_requests'],
    ['mplus', 'mplus_exclusion_requests']
  ]) {
    const none = await run(notice(action), { headers: {}, state: { record: false } });
    assertEquals([none.status, none.body.error, posted(none.calls).length], [403, NO_RECORD, 0], action);
    const real = await run(notice(action), { headers: {} });
    assertEquals([real.status, posted(real.calls).length], [200, 1], action);
    assertEquals(real.log.includes(`recentRecord ${table} Katorrí-Stormrage`), true, action);
  }
});

Deno.test('an unknown action is refused, and so is a key two teams share', async () => {
  assertEquals((await run({ action: 'everything', team: 'phoenix' })).status, 400);
  const shared = await run(notice('rsvp'), { state: { team: 'ambiguous' } });
  assertEquals([shared.status, shared.calls.length], [400, 0]);
});

// -- The post ---------------------------------------------------------------

Deno.test("posts in the team's channel, pinging only its role, and records when", async () => {
  const { status: code, calls, log } = await run(notice('rsvp'));
  assertEquals(code, 200);
  assertEquals(
    calls.map((c) => c.key),
    [`GET /channels/${CHANNEL}`, `GET /guilds/${SERVER}/roles`, `POST /channels/${CHANNEL}/messages`]
  );
  const message = posted(calls)[0].body;
  assertEquals(message.content, `<@&${ROLE}> @everyone marked themselves Late for 2026-11-04`);
  assertEquals(message.allowed_mentions, { parse: [], roles: [ROLE], users: [] });
  assertEquals(log.includes('postSetting rsvp_changes'), true);
  assertEquals(log.at(-1), 'markPosted rsvp_changes');
});

Deno.test('each action reads its own setting', async () => {
  for (const [action, kind] of [
    ['signup', 'officer_requests'],
    ['selfreceived', 'officer_requests'],
    ['bis', 'officer_requests'],
    ['mplus', 'mplus_requests'],
    ['rsvp', 'rsvp_changes']
  ]) {
    const { log } = await run(notice(action));
    assertEquals(log.includes('postSetting ' + kind), true, action);
  }
});

Deno.test("a channel in another guild's server is refused, and nothing posts", async () => {
  const {
    status: code,
    body,
    calls,
    log
  } = await run(notice('rsvp'), {
    routes: { ...DISCORD, [`GET /channels/${CHANNEL}`]: ok({ guild_id: '100000000000000777' }) }
  });
  assertEquals([code, body.error, posted(calls).length], [409, NOT_IN_SERVER, 0]);
  assertEquals(log.includes('markPosted rsvp_changes'), false);
});

Deno.test("a channel the bot can't see is refused", async () => {
  const { status: code, body } = await run(notice('rsvp'), {
    routes: { ...DISCORD, [`GET /channels/${CHANNEL}`]: status(403) }
  });
  assertEquals([code, body.error], [409, CANT_SEE]);
});

Deno.test("a ping role from outside the team's server is dropped, and the notice still posts", async () => {
  const { calls } = await run(notice('rsvp'), {
    routes: { ...DISCORD, [`GET /guilds/${SERVER}/roles`]: ok([{ id: SERVER }]) }
  });
  const message = posted(calls)[0].body;
  assertEquals(message.content, undefined);
  assertEquals(message.allowed_mentions, { parse: [], roles: [], users: [] });
});

Deno.test('a kind of post that is off, or a team with no server, posts nothing', async () => {
  for (const setting of [null, { serverId: SERVER, channelId: null, roleId: null }]) {
    const { status: code, body, calls } = await run(notice('rsvp'), { state: { setting } });
    assertEquals([code, body.posted, calls.length], [200, false, 0]);
  }
});

Deno.test("a 429 waits Discord's retry_after and posts once", async () => {
  let tries = 0;
  const {
    status: code,
    calls,
    slept
  } = await run(notice('rsvp'), {
    routes: {
      ...DISCORD,
      [`POST /channels/${CHANNEL}/messages`]: () =>
        ++tries === 1 ? new Response(JSON.stringify({ retry_after: 0.4 }), { status: 429 }) : ok({ id: 'm1' })()
    }
  });
  assertEquals([code, posted(calls).length, slept], [200, 2, [400]]);
});

Deno.test('Discord refusing the post is a 502, and when is not recorded', async () => {
  const { status: code, log } = await run(notice('rsvp'), {
    routes: { ...DISCORD, [`POST /channels/${CHANNEL}/messages`]: status(403) }
  });
  assertEquals(code, 502);
  assertEquals(log.includes('markPosted rsvp_changes'), false);
});

Deno.test("addCharacter posts the caller's own add as recorded, never their text", async () => {
  const { calls, log } = await run({
    ...notice('addCharacter'),
    payload: { member: 'Faker', nameRealm: 'Fake-Illidan' }
  });
  assertEquals(log.includes('latestOwnAdd phoenix'), true);
  const embed = posted(calls)[0].body.embeds[0];
  assertEquals(embed.fields[1], { name: 'Character', value: 'Katorrí-Stormrage', inline: true });
  const none = await run(notice('addCharacter'), { state: { add: null } });
  assertEquals([none.status, posted(none.calls).length], [404, 0]);
});

Deno.test('a post missing what it needs is a 400, and nothing posts', async () => {
  const { status: code, calls } = await run(notice('rsvp', { charName: 'Katorrí-Stormrage' }));
  assertEquals([code, posted(calls).length], [400, 0]);
});

Deno.test('no bot token on production is a plain refusal', async () => {
  const { status: code, calls } = await run(notice('rsvp'), { env: { ...PROD_ENV, DISCORD_BOT_TOKEN: '' } });
  assertEquals([code, calls.length], [500, 0]);
});

// -- verifyChannel, the signup sheet, a local stack --------------------------

Deno.test(
  'verifyChannel answers ok and the name for a channel in the team server, and says why otherwise',
  async () => {
    const good = await run(notice('verifyChannel', { channelId: CHANNEL }));
    assertEquals(good.body, { success: true, ok: true, name: 'phoenix-officers' });
    const elsewhere = await run(notice('verifyChannel', { channelId: CHANNEL }), {
      routes: { [`GET /channels/${CHANNEL}`]: ok({ guild_id: '100000000000000777', type: 0 }) }
    });
    assertEquals(elsewhere.body, { success: true, ok: false, error: NOT_IN_SERVER });
    const bad = await run(notice('verifyChannel', { channelId: '../users/@me' }));
    assertEquals([bad.body.ok, bad.calls.length], [false, 0]);
  }
);

Deno.test('signupSheetSync answers OK and posts nothing until #960', async () => {
  const { status: code, body, calls } = await run(notice('signupSheetSync', { raidDate: '2026-11-04' }));
  assertEquals([code, body.posted, calls.length], [200, false, 0]);
});

Deno.test('a local stack posts to the test webhook, marked and pinging nobody, never as the bot', async () => {
  const { calls } = await run(notice('rsvp'), { env: LOCAL_ENV });
  assertEquals(
    calls.map((c) => c.key),
    [`POST ${TEST_WEBHOOK_URL}`]
  );
  assertEquals(calls[0].body.content, '[local] ');
  assertEquals(calls[0].body.allowed_mentions, { parse: [], roles: [], users: [] });
  const quiet = await run(notice('rsvp'), { env: { SUPABASE_URL: 'http://127.0.0.1:54321' } });
  assertEquals([quiet.body.posted, quiet.calls.length], [false, 0]);
});

Deno.test('answers its preflight with the stamped version', async () => {
  const res = await handle(new Request(URL, { method: 'OPTIONS' }), {
    fetch: globalThis.fetch,
    env: { get: () => undefined },
    db: fakeDb().db
  });
  assertEquals(res.headers.get('X-WGA-Version'), VERSION);
});
