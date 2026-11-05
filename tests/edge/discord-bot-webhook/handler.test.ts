// discord-bot-webhook's handler (#959, #962): who may ask for each action,
// and the queue's drain: that each queued notice goes to the channel and role
// the team picked and only inside its own server, and what a try leaves on
// its row when Discord or the settings say no.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  CANT_SEE,
  MAX_TRIES,
  NOT_IN_SERVER,
  type Deps,
  type Finish,
  type PostSetting,
  type QueuedPost,
  type RelayDb,
  handle
} from '../../../supabase/functions/discord-bot-webhook/handler.ts';
import { PRODUCTION_HOST } from '../../../supabase/functions/_shared/discord-destination.ts';
import { VERSION } from '../../../supabase/functions/discord-bot-webhook/version.ts';
import type { Kind } from '../../../supabase/functions/discord-bot-webhook/posts.ts';
import { PAYLOADS } from './posts.test.ts';
import { RAID, type SheetState, fakeSheets } from '../_support/sheets.ts';

const URL = 'http://edge.test/functions/v1/discord-bot-webhook';
const SERVER = '100000000000000001';
const CHANNEL = '200000000000000002';
const ROLE = '300000000000000003';
const TEST_WEBHOOK_URL = 'https://discord.test/api/webhooks/1/x';
const NOW = '2026-11-01T14:00:00.000Z';
const CRON = { 'x-cron-secret': 'cron-secret' };

const PROD_ENV: Record<string, string> = {
  SUPABASE_URL: `https://${PRODUCTION_HOST}`,
  DISCORD_BOT_TOKEN: 'bot-token',
  OPTIONAL_RSVP_REMINDERS_SECRET: 'cron-secret'
};
const LOCAL_ENV: Record<string, string> = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  DISCORD_TEST_WEBHOOK_URL: TEST_WEBHOOK_URL,
  OPTIONAL_RSVP_REMINDERS_SECRET: 'cron-secret'
};

const KINDS: Record<string, Kind> = {
  signup: 'officer_requests',
  addCharacter: 'officer_requests',
  selfreceived: 'officer_requests',
  bis: 'officer_requests',
  mplus: 'mplus_requests',
  rsvp: 'rsvp_changes'
};

// A row as claim_discord_posts() hands it over: queued at 1 AM, first try.
const queued = (action: string, over: Partial<QueuedPost> = {}): QueuedPost => ({
  id: 7,
  teamId: 1,
  kind: KINDS[action],
  action,
  payload: PAYLOADS[action],
  createdAt: '2026-11-01T05:00:00.000Z',
  attempts: 1,
  ...over
});

type State = {
  user?: { id: string } | null;
  setting?: PostSetting | null;
  team?: { id: number } | 'ambiguous' | null;
  officer?: boolean;
  member?: boolean;
  rows?: QueuedPost[];
  // postSetting throws on these calls (1 = the first).
  failOn?: number[];
};

function fakeDb(state: State = {}) {
  const log: string[] = [];
  const finished: Array<{ id: number } & Finish> = [];
  let settingReads = 0;
  const db: RelayDb = {
    getUser: () => Promise.resolve(state.user === undefined ? { id: 'u1' } : state.user),
    team: (key) => {
      log.push('team ' + key);
      return Promise.resolve(state.team === undefined ? { id: 1 } : state.team);
    },
    postSetting: (_team, kind) => {
      log.push('postSetting ' + kind);
      if (state.failOn?.includes(++settingReads)) return Promise.reject(new Error('database hiccup'));
      return Promise.resolve(
        state.setting === undefined ? { serverId: SERVER, channelId: CHANNEL, roleId: ROLE } : state.setting
      );
    },
    serverOf: () => Promise.resolve(SERVER),
    claimPosts: () => {
      log.push('claimPosts');
      return Promise.resolve(state.rows ?? []);
    },
    finishPost: (id, finish) => {
      finished.push({ id, ...finish });
      return Promise.resolve();
    },
    canManageDiscord: () => Promise.resolve(state.officer ?? true),
    onTeam: () => Promise.resolve(state.member ?? true),
    markPosted: (_team, kind) => {
      log.push('markPosted ' + kind);
      return Promise.resolve();
    }
  };
  return { db, log, finished };
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

type Options = {
  state?: State;
  sheets?: SheetState;
  routes?: Record<string, Route>;
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

async function run(
  body: unknown,
  {
    state = {},
    sheets: sheetState = {},
    routes = DISCORD,
    env = PROD_ENV,
    headers = { Authorization: 'Bearer user-jwt' }
  }: Options = {}
) {
  const { db, log, finished } = fakeDb(state);
  const sheets = fakeSheets(sheetState);
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
    sheets: sheets.db,
    now: () => new Date(NOW),
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
  return { status: res.status, body: await res.json(), calls, log, slept, finished, sheets };
}

const notice = (action: string, payload: unknown = {}) => ({ action, team: 'phoenix', payload });
const posted = (calls: Array<{ key: string; body: any }>) => calls.filter((c) => c.key.startsWith('POST /channels/'));
const drain = (rows: QueuedPost[], options: Options = {}) =>
  run({ action: 'drain' }, { headers: CRON, ...options, state: { rows, ...options.state } });
const minutesAfterNow = (n: number) => new Date(Date.parse(NOW) + n * 60_000).toISOString();

// -- The gate ---------------------------------------------------------------

Deno.test('every signed-in action refuses a request with no sign-in, and calls Discord for none', async () => {
  for (const action of ['signupSheetSync', 'verifyChannel']) {
    for (const headers of [{}, { Authorization: 'Bearer anon-key' }]) {
      const { status: code, calls } = await run(notice(action), {
        headers,
        state: { user: 'Authorization' in headers ? null : undefined }
      });
      assertEquals([code, calls.length], [401, 0], `${action} ${JSON.stringify(headers)}`);
    }
  }
});

Deno.test('the reminder and the drain take only the job secret, and an unset secret refuses everything', async () => {
  const reminder = {
    action: 'optionalReminder',
    team: 'phoenix',
    payload: { discordId: '400000000000000004', checkpoint: '24h', raidDate: '2026-11-04' }
  };
  for (const body of [reminder, { action: 'drain' }]) {
    assertEquals((await run(body)).status, 401);
    assertEquals((await run(body, { headers: { 'x-cron-secret': 'wrong' } })).status, 401);
    const unset = { ...PROD_ENV, OPTIONAL_RSVP_REMINDERS_SECRET: '' };
    assertEquals((await run(body, { headers: { 'x-cron-secret': '' }, env: unset })).status, 401);
  }
  const refused = await run({ action: 'drain' }, { state: { rows: [queued('rsvp')] } });
  assertEquals(refused.log.includes('claimPosts'), false);

  const sent = await run(reminder, {
    headers: CRON,
    routes: { 'POST /users/@me/channels': ok({ id: '900000000000000009' }) }
  });
  assertEquals(sent.status, 200);
  assertEquals(
    sent.calls.map((c) => c.key),
    ['POST /users/@me/channels', 'POST /channels/900000000000000009/messages']
  );
  assertEquals(sent.calls[1].body.allowed_mentions, { parse: [], roles: [], users: [] });
});

Deno.test('the notices the queue carries can no longer be asked for directly', async () => {
  for (const action of Object.keys(KINDS)) {
    const { status: code, calls } = await run(notice(action, PAYLOADS[action]), { headers: {} });
    assertEquals([code, calls.length], [400, 0], action);
  }
});

Deno.test("the channel check is only for someone who may change the team's Discord settings", async () => {
  const { status: code, calls } = await run(notice('verifyChannel', { channelId: CHANNEL }), {
    state: { officer: false }
  });
  assertEquals([code, calls.length], [403, 0]);
});

Deno.test('an unknown action is refused, and so is a key two teams share', async () => {
  assertEquals((await run({ action: 'everything', team: 'phoenix' })).status, 400);
  const shared = await run(notice('verifyChannel', { channelId: CHANNEL }), { state: { team: 'ambiguous' } });
  assertEquals([shared.status, shared.calls.length], [400, 0]);
});

// -- The drain --------------------------------------------------------------

Deno.test("posts a queued notice in the team's channel, pinging only its role, and records when", async () => {
  const { status: code, body, calls, log, finished } = await drain([queued('rsvp')]);
  assertEquals([code, body.claimed], [200, 1]);
  assertEquals(
    calls.map((c) => c.key),
    [`GET /channels/${CHANNEL}`, `GET /guilds/${SERVER}/roles`, `POST /channels/${CHANNEL}/messages`]
  );
  const message = posted(calls)[0].body;
  assertEquals(message.content, `<@&${ROLE}> @everyone marked themselves Late for 2026-11-04`);
  assertEquals(message.allowed_mentions, { parse: [], roles: [ROLE], users: [] });
  assertEquals(log.includes('postSetting rsvp_changes'), true);
  assertEquals(log.at(-1), 'markPosted rsvp_changes');
  assertEquals(finished, [{ id: 7, status: 'posted', lastError: null }]);
});

Deno.test('a notice held by quiet hours says when it was made, not when it posted', async () => {
  const { calls } = await drain([queued('mplus')]);
  const at = posted(calls)[0].body.embeds[0].fields.find((f: { name: string }) => f.name === 'Submitted At');
  assertEquals(at.value, `<t:${Date.parse('2026-11-01T05:00:00.000Z') / 1000}:f>`);
});

Deno.test('each queued notice reads its own kind of post, and every one posts', async () => {
  const rows = Object.keys(KINDS).map((action, i) => queued(action, { id: i + 1 }));
  const { log, calls, finished } = await drain(rows);
  for (const kind of new Set(Object.values(KINDS))) assertEquals(log.includes('postSetting ' + kind), true, kind);
  assertEquals(posted(calls).length, rows.length);
  assertEquals(
    finished.map((f) => f.status),
    rows.map(() => 'posted')
  );
});

Deno.test("a channel in another guild's server, or one the bot can't see, is tried again later", async () => {
  const cases: Array<[Route, string]> = [
    [ok({ guild_id: '100000000000000777' }), NOT_IN_SERVER],
    [status(403), CANT_SEE]
  ];
  for (const [route, error] of cases) {
    const { calls, log, finished } = await drain([queued('rsvp')], {
      routes: { ...DISCORD, [`GET /channels/${CHANNEL}`]: route }
    });
    assertEquals(posted(calls).length, 0);
    assertEquals(log.includes('markPosted rsvp_changes'), false);
    // The first try failed: the next waits a minute.
    assertEquals(finished, [{ id: 7, status: 'queued', lastError: error, nextTryAt: minutesAfterNow(1) }]);
  }
});

Deno.test('each failed try waits twice as long, and the fifth stays failed', async () => {
  const refuse = { routes: { ...DISCORD, [`POST /channels/${CHANNEL}/messages`]: status(403) } };
  const third = await drain([queued('rsvp', { attempts: 3 })], refuse);
  assertEquals(third.finished, [
    { id: 7, status: 'queued', lastError: 'Discord answered 403', nextTryAt: minutesAfterNow(4) }
  ]);
  const last = await drain([queued('rsvp', { attempts: MAX_TRIES })], refuse);
  assertEquals(last.finished, [{ id: 7, status: 'failed', lastError: 'Discord answered 403' }]);
  assertEquals(last.log.includes('markPosted rsvp_changes'), false);
});

Deno.test('one notice that throws does not stop the rest of the run', async () => {
  const { status: code, finished } = await drain([queued('rsvp', { id: 1 }), queued('rsvp', { id: 2 })], {
    state: { failOn: [1] }
  });
  assertEquals(code, 200);
  assertEquals(
    finished.map((f) => [f.id, f.status, f.lastError]),
    [
      [1, 'queued', 'database hiccup'],
      [2, 'posted', null]
    ]
  );
});

Deno.test("a ping role from outside the team's server is dropped, and the notice still posts", async () => {
  const { calls } = await drain([queued('rsvp')], {
    routes: { ...DISCORD, [`GET /guilds/${SERVER}/roles`]: ok([{ id: SERVER }]) }
  });
  const message = posted(calls)[0].body;
  assertEquals(message.content, undefined);
  assertEquals(message.allowed_mentions, { parse: [], roles: [], users: [] });
});

Deno.test('a kind of post turned off, or a team with no server, skips its queued notices', async () => {
  for (const setting of [null, { serverId: SERVER, channelId: null, roleId: null }]) {
    const { calls, finished } = await drain([queued('rsvp')], { state: { setting } });
    assertEquals([calls.length, finished[0].status], [0, 'skipped']);
  }
});

Deno.test("a 429 waits Discord's retry_after and posts once", async () => {
  let tries = 0;
  const { calls, slept, finished } = await drain([queued('rsvp')], {
    routes: {
      ...DISCORD,
      [`POST /channels/${CHANNEL}/messages`]: () =>
        ++tries === 1 ? new Response(JSON.stringify({ retry_after: 0.4 }), { status: 429 }) : ok({ id: 'm1' })()
    }
  });
  assertEquals([posted(calls).length, slept, finished[0].status], [2, [400], 'posted']);
});

Deno.test('a queued notice missing what it needs stays failed, since no later try can fix it', async () => {
  const { calls, finished } = await drain([queued('rsvp', { payload: { charName: 'Katorrí-Stormrage' } })]);
  assertEquals(posted(calls).length, 0);
  assertEquals(finished, [{ id: 7, status: 'failed', lastError: 'Missing required fields' }]);
});

Deno.test('no bot token on production is a plain refusal, and nothing is claimed', async () => {
  const {
    status: code,
    calls,
    log
  } = await drain([queued('rsvp')], {
    env: { ...PROD_ENV, DISCORD_BOT_TOKEN: '' }
  });
  assertEquals([code, calls.length, log.includes('claimPosts')], [500, 0, false]);
});

Deno.test('a local stack posts to the test webhook, marked and pinging nobody, never as the bot', async () => {
  const { calls, finished } = await drain([queued('rsvp')], { env: LOCAL_ENV });
  assertEquals(
    calls.map((c) => c.key),
    [`POST ${TEST_WEBHOOK_URL}`]
  );
  assertEquals(calls[0].body.content, '[local] ');
  assertEquals(calls[0].body.allowed_mentions, { parse: [], roles: [], users: [] });
  assertEquals(finished[0].status, 'posted');
  const quiet = await drain([queued('rsvp')], { env: { ...LOCAL_ENV, DISCORD_TEST_WEBHOOK_URL: '' } });
  assertEquals([quiet.calls.length, quiet.finished[0].status], [0, 'skipped']);
});

// -- verifyChannel, the signup sheet -----------------------------------------

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

// -- The signup sheets (#960); _shared/signup-sheet.test.ts has the rest ----

Deno.test('signupSheetSync edits the posted sheet for that night', async () => {
  const {
    status: code,
    body,
    calls
  } = await run(notice('signupSheetSync', { raidDate: '2026-11-05' }), {
    sheets: { nights: { '2026-11-05': RAID }, rows: { '2026-11-05': { channelId: CHANNEL, messageId: 'm9' } } },
    routes: { ...DISCORD, [`PATCH /channels/${CHANNEL}/messages/m9`]: ok({ id: 'm9' }) }
  });
  assertEquals([code, body.result], [200, 'edited']);
  // The bot's emojis are read first (unscripted here, so the sheet has no icons).
  assertEquals(
    calls.map((c) => c.key),
    ['GET /applications/@me', `PATCH /channels/${CHANNEL}/messages/m9`]
  );
});

Deno.test('signupSheetSync posts nothing for a night with no sheet up yet, and leaves no row', async () => {
  const { body, calls, sheets } = await run(notice('signupSheetSync', { raidDate: '2026-11-05' }), {
    sheets: { nights: { '2026-11-05': RAID } }
  });
  assertEquals([body.result, calls.length, sheets.rows.size], ['not posted', 0, 0]);
});

Deno.test('signupSheetSync refuses someone not on the team, and touches nothing', async () => {
  const { status: code, calls } = await run(notice('signupSheetSync', { raidDate: '2026-11-05' }), {
    state: { member: false },
    sheets: { nights: { '2026-11-05': RAID }, rows: { '2026-11-05': { channelId: CHANNEL, messageId: 'm9' } } }
  });
  assertEquals([code, calls.length], [403, 0]);
});

Deno.test('signupSheetSync refuses a missing or malformed date', async () => {
  for (const payload of [{}, { raidDate: 'tomorrow' }, { raidDate: '2026-02-31' }, { raidDate: '2026-13-01' }]) {
    const { status: code } = await run(notice('signupSheetSync', payload));
    assertEquals(code, 400, JSON.stringify(payload));
  }
});

Deno.test('the sheets run takes only the job secret', async () => {
  for (const headers of [{}, { 'x-cron-secret': 'wrong' }, { Authorization: 'Bearer user-jwt' }]) {
    const { status: code, calls } = await run({ action: 'signupSheets' }, { headers });
    assertEquals([code, calls.length], [401, 0], JSON.stringify(headers));
  }
});

Deno.test('the sheets run posts the due sheets as the bot', async () => {
  // Sunday 2026-11-01 14:00Z; Tuesday and Thursday raids, two kept posted.
  const {
    status: code,
    body,
    calls
  } = await run(
    { action: 'signupSheets' },
    { headers: CRON, sheets: { nights: { '2026-11-03': RAID, '2026-11-05': RAID, '2026-11-10': RAID } } }
  );
  assertEquals([code, body.posted, body.edited, body.failed], [200, 2, 0, 0]);
  assertEquals(posted(calls).length, 2);
  assert(calls.every((c) => !c.key.startsWith('POST https://')));
});

Deno.test('a local stack posts no sheet, since only the bot can answer its button', async () => {
  const sheets = { nights: { '2026-11-03': RAID } };
  const run1 = await run({ action: 'signupSheets' }, { headers: CRON, env: LOCAL_ENV, sheets });
  assertEquals([run1.status, run1.body.posted, run1.calls.length], [200, 0, 0]);
  const run2 = await run(notice('signupSheetSync', { raidDate: '2026-11-03' }), { env: LOCAL_ENV, sheets });
  assertEquals([run2.status, run2.calls.length], [200, 0]);
});

Deno.test('answers its preflight with the stamped version', async () => {
  const res = await handle(new Request(URL, { method: 'OPTIONS' }), {
    fetch: globalThis.fetch,
    env: { get: () => undefined },
    db: fakeDb().db,
    sheets: fakeSheets().db
  });
  assertEquals(res.headers.get('X-WGA-Version'), VERSION);
});

// -- RSVP changes in a batch (#1710) ----------------------------------------
// The raid is 2026-11-04 at 9 PM Eastern, 2026-11-05T02:00Z. NOW is 2026-11-01
// 14:00Z, and the rows were made at 05:00Z.

const BATCHED = (rsvpTiming: PostSetting['rsvpTiming']): State => ({
  setting: { serverId: SERVER, channelId: CHANNEL, roleId: ROLE, rsvpTiming }
});
const RAID_NIGHTS = { nights: { '2026-11-04': RAID } };

Deno.test(
  'a change waits for the post a set number of hours before its raid, and waiting is not a failure',
  async () => {
    const { calls, finished } = await drain([queued('rsvp')], {
      state: BATCHED({ when: 'before_raid', hours: 3 }),
      sheets: RAID_NIGHTS
    });
    assertEquals(posted(calls).length, 0);
    assertEquals(finished, [
      { id: 7, status: 'queued', lastError: null, nextTryAt: '2026-11-04T23:00:00.000Z', hold: true }
    ]);
  }
);

Deno.test("changes whose post time has come go out as one post, listing each raider's last answer", async () => {
  const rows = [
    queued('rsvp', {
      id: 7,
      payload: { charName: 'Katorrí', raidDate: '2026-11-04', status: 'Late', note: 'traffic' }
    }),
    queued('rsvp', { id: 8, payload: { charName: 'Mira', raidDate: '2026-11-04', status: 'Absent' } }),
    queued('rsvp', { id: 9, payload: { charName: 'Katorrí', raidDate: '2026-11-04', status: 'Tentative' } })
  ];
  const { calls, finished, log } = await drain(rows, {
    state: BATCHED({ when: 'before_raid', hours: 88 }),
    sheets: RAID_NIGHTS
  });
  assertEquals(posted(calls).length, 1);
  const message = posted(calls)[0].body;
  assertEquals(message.content, `<@&${ROLE}> RSVP changes`);
  assertEquals(message.embeds[0].fields, [{ name: '2026-11-04', value: 'Mira: Absent\nKatorrí: Tentative' }]);
  assertEquals(
    finished.map((f) => [f.id, f.status]),
    [
      [7, 'posted'],
      [8, 'posted'],
      [9, 'posted']
    ]
  );
  assertEquals(log.filter((l) => l === 'markPosted rsvp_changes').length, 1);
});

Deno.test('a daily post holds a change until its time, then sends it', async () => {
  const early = await drain([queued('rsvp')], {
    state: BATCHED({ when: 'daily', time: '10:00', timezone: 'America/New_York' }),
    sheets: RAID_NIGHTS
  });
  assertEquals(posted(early.calls).length, 0);
  assertEquals(early.finished[0].nextTryAt, '2026-11-01T15:00:00.000Z');
  const due = await drain([queued('rsvp')], {
    state: BATCHED({ when: 'daily', time: '09:00', timezone: 'America/New_York' }),
    sheets: RAID_NIGHTS
  });
  assertEquals(posted(due.calls)[0].body.embeds[0].title, 'Raid RSVP Updates');
});

Deno.test('a change for a raid that starts before the next batched post goes out at once, on its own', async () => {
  const today = { nights: { '2026-11-01': { ...RAID, startTime: '08:00:00' } } };
  const { calls, finished } = await drain(
    [queued('rsvp', { payload: { charName: 'Mira', raidDate: '2026-11-01', status: 'Absent' } })],
    { state: BATCHED({ when: 'daily', time: '10:00', timezone: 'America/New_York' }), sheets: today }
  );
  assertEquals(posted(calls)[0].body.embeds[0].title, 'Raid RSVP Update');
  assertEquals(finished, [{ id: 7, status: 'posted', lastError: null }]);
});

Deno.test('a failed batched post keeps every change for a later try', async () => {
  const { finished } = await drain([queued('rsvp', { id: 7 }), queued('rsvp', { id: 8 })], {
    state: BATCHED({ when: 'before_raid', hours: 88 }),
    sheets: RAID_NIGHTS,
    routes: { ...DISCORD, [`POST /channels/${CHANNEL}/messages`]: status(403) }
  });
  assertEquals(
    finished.map((f) => [f.id, f.status]),
    [
      [7, 'queued'],
      [8, 'queued']
    ]
  );
});
