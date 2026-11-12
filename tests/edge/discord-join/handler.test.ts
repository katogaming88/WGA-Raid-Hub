// discord-join's handler against injected dependencies, Discord stubbed: the
// gate (own open application, the signed state), already a member, the add,
// and each failure recorded, told to the officers and answered with an invite.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  type Application,
  BAD_STATE,
  type Deps,
  NOT_SET_UP,
  NOT_YOURS,
  REPEAT_FAILURE_MS,
  RETURN_PATH,
  WHY,
  handle,
  stateFor
} from '../../../supabase/functions/discord-join/handler.ts';

const SERVER = '111111111111111111';
const OFFICERS = '222222222222222222';
const WELCOME = '333333333333333333';
const APPLICANT = '444444444444444444';
const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://kxgjqnpwfklbgrxdgmmv.supabase.co',
  DISCORD_BOT_TOKEN: 'bot-token',
  DISCORD_APPLICATION_ID: 'client-id',
  DISCORD_BOT_CLIENT_SECRET: 'client-secret',
  SITE_URL: 'https://raidhub.example/'
};
const CONFIG = {
  botToken: 'bot-token',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  siteUrl: 'https://raidhub.example'
};

const APP: Application = {
  id: 7,
  team_id: 3,
  person_id: 42,
  name_realm: 'Katorrí-Stormrage',
  discord_id: APPLICANT,
  add_to_server: true,
  server_id: SERVER,
  officer_channel_id: OFFICERS
};

type Call = { method: string; url: string; headers: Record<string, string>; body: string | null };
type Route = () => Response;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const status = (code: number) => new Response(null, { status: code });

const MEMBER = API + '/guilds/' + SERVER + '/members/' + APPLICANT;

function routes(): Record<string, Route> {
  return {
    ['GET ' + MEMBER]: () => status(404),
    ['POST ' + API + '/oauth2/token']: () => json({ access_token: 'user-token', token_type: 'Bearer' }),
    ['POST ' + API + '/oauth2/token/revoke']: () => status(200),
    ['GET ' + API + '/users/@me']: () => json({ id: APPLICANT }),
    ['PUT ' + MEMBER]: () => status(201),
    ['GET ' + API + '/guilds/' + SERVER]: () => json({ id: SERVER, system_channel_id: WELCOME }),
    ['POST ' + API + '/channels/' + WELCOME + '/invites']: () => json({ code: 'abc123' }),
    ['POST ' + API + '/channels/' + OFFICERS + '/messages']: () => json({ id: '1' })
  };
}

function setup(over: Partial<Record<string, Route>> = {}, app: Application | null = APP, env = ENV) {
  const table = { ...routes(), ...over };
  const calls: Call[] = [];
  const events: Array<{ kind: string; actor: number; detail: string | null }> = [];
  const stamps: number[] = [];
  let clock = 1_000_000;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const body = await req.text();
    const key = req.method + ' ' + req.url;
    calls.push({ method: req.method, url: req.url, headers: Object.fromEntries(req.headers), body: body || null });
    const route = table[key];
    if (!route) throw new Error('unrouted ' + key);
    return route();
  }) as typeof globalThis.fetch;
  const deps: Deps = {
    fetch,
    db: {
      getUser: (h) => Promise.resolve(h === 'Bearer jwt' ? { id: 'u1' } : null),
      application: (uid, id) => Promise.resolve(uid === 'u1' && app && id === app.id ? app : null),
      addEvent: (_id, kind, actor, detail) => {
        events.push({ kind, actor, detail });
        stamps.push(clock);
        return Promise.resolve();
      },
      lastDiscordEvent: () => {
        const i = events.length - 1;
        return Promise.resolve(
          i < 0 ? null : { kind: events[i].kind as 'joined_discord', at: stamps[i], detail: events[i].detail }
        );
      }
    },
    env: { get: (n) => env[n] },
    now: () => clock
  };
  return { deps, calls, events, tick: (ms: number) => (clock += ms) };
}

async function call(deps: Deps, body: unknown, auth = 'Bearer jwt') {
  const res = await handle(
    new Request('http://edge.test/functions/v1/discord-join', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
    deps
  );
  return { status: res.status, body: await res.json(), cors: res.headers.get('Access-Control-Allow-Origin') };
}

const goodState = () => stateFor(CONFIG, APP);

Deno.test('start: not yet a member answers Discord consent for the bot app, scoped and signed', async () => {
  const { deps, events } = setup();
  const { body } = await call(deps, { action: 'start', application: 7 });
  assertEquals(body.status, 'authorize');
  const url = new URL(body.url);
  assertEquals(url.origin + url.pathname, 'https://discord.com/oauth2/authorize');
  assertEquals(url.searchParams.get('client_id'), 'client-id');
  assertEquals(url.searchParams.get('scope'), 'identify guilds.join');
  assertEquals(url.searchParams.get('redirect_uri'), 'https://raidhub.example' + RETURN_PATH);
  assertEquals(url.searchParams.get('state'), await goodState());
  assertEquals(events, []);
});

Deno.test('start: already in the server is recorded and asks nothing', async () => {
  const { deps, events } = setup({ ['GET ' + MEMBER]: () => json({ user: { id: APPLICANT } }) });
  const { body } = await call(deps, { action: 'start', application: 7 });
  assertEquals(body.status, 'already_member');
  assertEquals(events, [{ kind: 'joined_discord', actor: 42, detail: 'Already a member' }]);
});

Deno.test('start: a failed membership check still asks', async () => {
  const { deps } = setup({ ['GET ' + MEMBER]: () => status(503) });
  assertEquals((await call(deps, { action: 'start', application: 7 })).body.status, 'authorize');
});

Deno.test('finish: adds them with their own token, once, and records it', async () => {
  const { deps, calls, events } = setup();
  const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'the-code' });
  assertEquals(body.status, 'joined');
  assertEquals(events, [{ kind: 'joined_discord', actor: 42, detail: null }]);
  const put = calls.find((c) => c.method === 'PUT')!;
  assertEquals(
    [put.url, put.headers.authorization, JSON.parse(put.body!)],
    [MEMBER, 'Bot bot-token', { access_token: 'user-token' }]
  );
  const swap = new URLSearchParams(calls.find((c) => c.url.endsWith('/oauth2/token'))!.body!);
  assertEquals([swap.get('code'), swap.get('redirect_uri')], ['the-code', 'https://raidhub.example' + RETURN_PATH]);
  // The token goes to Discord only: never in the answer or the history.
  assert(!JSON.stringify(body).includes('user-token'));
  assert(!JSON.stringify(events).includes('user-token'));
});

Deno.test('finish: Discord says already a member (204)', async () => {
  const { deps, events } = setup({ ['PUT ' + MEMBER]: () => status(204) });
  const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
  assertEquals(body.status, 'already_member');
  assertEquals(events, [{ kind: 'joined_discord', actor: 42, detail: 'Already a member' }]);
});

Deno.test('finish: banned (403, 40007) is recorded, the officers told, and an invite answered', async () => {
  const { deps, calls, events } = setup({ ['PUT ' + MEMBER]: () => json({ code: 40007 }, 403) });
  const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
  assertEquals(body, {
    success: true,
    status: 'failed',
    reason: 'banned',
    invite: 'https://discord.gg/abc123'
  });
  assertEquals(events, [{ kind: 'discord_join_failed', actor: 42, detail: WHY.banned }]);
  const invite = JSON.parse(calls.find((c) => c.url.endsWith('/invites'))!.body!);
  assertEquals(invite, { max_age: 604800, max_uses: 1, unique: true });
  const notice = JSON.parse(calls.find((c) => c.url.endsWith('/messages'))!.body!);
  assert(notice.content.includes('Katorrí-Stormrage'));
  assert(notice.content.includes('They were shown an invite link.'));
  assertEquals(notice.allowed_mentions, { parse: [] });
});

Deno.test('finish: Discord down at the add, and at the code swap, both fail the same way', async () => {
  for (const over of [
    { ['PUT ' + MEMBER]: () => status(502) },
    { ['POST ' + API + '/oauth2/token']: () => json({ error: 'invalid_grant' }, 400) },
    {
      ['PUT ' + MEMBER]: () => {
        throw new TypeError('network');
      }
    }
  ]) {
    const { deps, events } = setup(over);
    const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
    assertEquals([body.status, body.reason], ['failed', 'discord_down']);
    assertEquals(
      events.map((e) => e.kind),
      ['discord_join_failed']
    );
  }
});

Deno.test('finish: a different Discord account is never added', async () => {
  const { deps, calls } = setup({ ['GET ' + API + '/users/@me']: () => json({ id: '555555555555555555' }) });
  const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
  assertEquals(body.reason, 'other_account');
  assertEquals(
    calls.some((c) => c.method === 'PUT'),
    false
  );
});

Deno.test('finish: saying no on Discord is recorded too, with no code swap', async () => {
  const { deps, calls, events } = setup();
  const { body } = await call(deps, { action: 'finish', state: await goodState(), error: 'access_denied' });
  assertEquals(body.reason, 'declined');
  assertEquals(events[0].detail, WHY.declined);
  assertEquals(
    calls.some((c) => c.url.endsWith('/oauth2/token')),
    false
  );
});

Deno.test('finish: no welcome or rules channel means no invite, and the officers are told so', async () => {
  const { deps, calls } = setup({
    ['PUT ' + MEMBER]: () => status(403),
    ['GET ' + API + '/guilds/' + SERVER]: () => json({ id: SERVER, system_channel_id: null })
  });
  const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
  assertEquals(body.invite, null);
  assert(JSON.parse(calls.find((c) => c.url.endsWith('/messages'))!.body!).content.includes('reach out to them'));
});

Deno.test('finish: a local stack tells the test webhook, marked, never the real channel', async () => {
  const env = { ...ENV, SUPABASE_URL: 'http://kong:8000', DISCORD_TEST_WEBHOOK_URL: 'http://sink.test/hook' };
  const { deps, calls } = setup(
    { ['PUT ' + MEMBER]: () => status(403), ['POST http://sink.test/hook']: () => status(204) },
    APP,
    env
  );
  await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
  assertEquals(
    calls.some((c) => c.url.endsWith('/messages')),
    false
  );
  assert(JSON.parse(calls.find((c) => c.url === 'http://sink.test/hook')!.body!).content.startsWith('[local] '));
});

Deno.test('refuses someone else’s application, or a closed one, before any Discord call', async () => {
  const { deps, calls } = setup({}, null);
  const start = await call(deps, { action: 'start', application: 7 });
  assertEquals([start.status, start.body.error], [403, NOT_YOURS]);
  const finish = await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
  assertEquals([finish.status, finish.body.error], [403, NOT_YOURS]);
  assertEquals(calls, []);
});

Deno.test('refuses a forged or altered state, before the code is swapped', async () => {
  const { deps, calls } = setup();
  const forged = '7.' + '0'.repeat(64);
  for (const state of [forged, 'nonsense', (await goodState()).toUpperCase()]) {
    const r = await call(deps, { action: 'finish', state, code: 'c' });
    assertEquals([r.status, r.body.error], [400, BAD_STATE]);
  }
  // A state for another person's application 7 does not fit this caller's.
  const other = await stateFor(CONFIG, { id: 7, person_id: 99 });
  assertEquals((await call(deps, { action: 'finish', state: other, code: 'c' })).body.error, BAD_STATE);
  assertEquals(calls, []);
});

Deno.test('the team setting off, or no server, is nothing to do', async () => {
  for (const app of [
    { ...APP, add_to_server: false },
    { ...APP, server_id: null }
  ]) {
    const { deps, calls, events } = setup({}, app);
    assertEquals((await call(deps, { action: 'start', application: 7 })).body.status, 'off');
    assertEquals([calls, events], [[], []]);
  }
});

Deno.test('not set up, not signed in, bad bodies; a throw still answers with CORS', async () => {
  const { DISCORD_BOT_CLIENT_SECRET: _, ...noSecret } = ENV;
  assertEquals((await call(setup({}, APP, noSecret).deps, { action: 'start', application: 7 })).body.error, NOT_SET_UP);
  assertEquals((await call(setup().deps, { action: 'start', application: 7 }, 'Bearer other')).status, 401);
  assertEquals((await call(setup().deps, { action: 'nope' })).status, 400);
  assertEquals((await call(setup().deps, { action: 'start', application: '7' })).body.error, 'Missing application');
  const broken = setup();
  broken.deps.db.application = () => Promise.reject(new Error('db down'));
  const r = await call(broken.deps, { action: 'start', application: 7 });
  assertEquals([r.status, r.cors], [500, '*']);
});

Deno.test('a reload after joining reuses a spent code: answered from the record, nothing new', async () => {
  const { deps, calls, events } = setup();
  const state = await goodState();
  await call(deps, { action: 'finish', state, code: 'c' });
  const before = calls.length;
  const again = await call(deps, { action: 'finish', state, code: 'c' });
  assertEquals(again.body.status, 'already_member');
  assertEquals(calls.length, before);
  assertEquals(
    events.map((e) => e.kind),
    ['joined_discord']
  );
  assertEquals((await call(deps, { action: 'start', application: 7 })).body.status, 'already_member');
  assertEquals(events.length, 1);
});

Deno.test('a spent code for someone already in the server is already a member, not a failure', async () => {
  const { deps, calls, events } = setup({
    ['POST ' + API + '/oauth2/token']: () => json({ error: 'invalid_grant' }, 400),
    ['GET ' + MEMBER]: () => json({ user: { id: APPLICANT } })
  });
  const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'spent' });
  assertEquals(body.status, 'already_member');
  assertEquals(
    events.map((e) => e.kind),
    ['joined_discord']
  );
  assertEquals(
    calls.some((c) => c.url.endsWith('/messages') || c.url.endsWith('/invites')),
    false
  );
});

Deno.test('a repeated failure within ten minutes writes, tells and invites nothing more', async () => {
  const { deps, calls, events, tick } = setup({ ['PUT ' + MEMBER]: () => status(403) });
  const state = await goodState();
  const first = await call(deps, { action: 'finish', state, code: 'c' });
  assertEquals(first.body.invite, 'https://discord.gg/abc123');
  const count = (end: string) => calls.filter((c) => c.url.endsWith(end)).length;
  for (const body of [
    { action: 'finish', state, code: 'c' },
    { action: 'finish', state }
  ]) {
    const r = await call(deps, body);
    assertEquals([r.body.status, r.body.invite, r.body.repeat], ['failed', null, true]);
  }
  assertEquals([events.length, count('/messages'), count('/invites')], [1, 1, 1]);
  tick(REPEAT_FAILURE_MS);
  await call(deps, { action: 'finish', state });
  assertEquals([events.length, count('/messages'), count('/invites')], [2, 2, 2]);
});

Deno.test('a retry after a failure can still join', async () => {
  let put = 403;
  const { deps, events } = setup({ ['PUT ' + MEMBER]: () => status(put) });
  const state = await goodState();
  await call(deps, { action: 'finish', state, code: 'c' });
  put = 201;
  assertEquals((await call(deps, { action: 'finish', state, code: 'c2' })).body.status, 'joined');
  assertEquals(
    events.map((e) => e.kind),
    ['discord_join_failed', 'joined_discord']
  );
});

Deno.test('a 403 names its cause: missing permission (50013), or just refused', async () => {
  const no = await call(setup({ ['PUT ' + MEMBER]: () => json({ code: 50013 }, 403) }).deps, {
    action: 'finish',
    state: await goodState(),
    code: 'c'
  });
  assertEquals(no.body.reason, 'no_permission');
  const other = await call(setup({ ['PUT ' + MEMBER]: () => status(403) }).deps, {
    action: 'finish',
    state: await goodState(),
    code: 'c'
  });
  assertEquals(other.body.reason, 'refused');
});

Deno.test('the applicant token is revoked once the add is done, and after a failed check too', async () => {
  for (const over of [{}, { ['GET ' + API + '/users/@me']: () => json({ id: '555555555555555555' }) }]) {
    const { deps, calls } = setup(over);
    await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
    const revoke = calls.filter((c) => c.url.endsWith('/oauth2/token/revoke'));
    assertEquals(revoke.length, 1);
    const form = new URLSearchParams(revoke[0].body!);
    assertEquals([form.get('token'), form.get('token_type_hint')], ['user-token', 'access_token']);
  }
});

Deno.test('no code and no access_denied is Discord not answering, not a no', async () => {
  const { body } = await call(setup().deps, { action: 'finish', state: await goodState(), error: 'server_error' });
  assertEquals(body.reason, 'discord_down');
  assertEquals((await call(setup().deps, { action: 'finish', state: await goodState() })).body.reason, 'discord_down');
});

Deno.test('the same failure again after the window is recorded, but the officers hear it once', async () => {
  const { deps, calls, events, tick } = setup({ ['PUT ' + MEMBER]: () => json({ code: 40007 }, 403) });
  const state = await goodState();
  await call(deps, { action: 'finish', state, code: 'c' });
  tick(REPEAT_FAILURE_MS);
  const again = await call(deps, { action: 'finish', state, code: 'c2' });
  assertEquals(again.body.invite, 'https://discord.gg/abc123');
  assertEquals(events.length, 2);
  assertEquals(calls.filter((c) => c.url.endsWith('/messages')).length, 1);
});

Deno.test('a local stack makes no invites in the server it names', async () => {
  const env = { ...ENV, SUPABASE_URL: 'http://kong:8000', DISCORD_TEST_WEBHOOK_URL: 'http://sink.test/hook' };
  const { deps, calls } = setup(
    { ['PUT ' + MEMBER]: () => status(403), ['POST http://sink.test/hook']: () => status(204) },
    APP,
    env
  );
  const { body } = await call(deps, { action: 'finish', state: await goodState(), code: 'c' });
  assertEquals(body.invite, null);
  assertEquals(
    calls.some((c) => c.url.endsWith('/invites') || c.url === API + '/guilds/' + SERVER),
    false
  );
});
