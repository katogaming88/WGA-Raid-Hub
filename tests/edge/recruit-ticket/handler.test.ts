// recruit-ticket's handler against injected dependencies, Discord stubbed:
// each mode makes the right thing with the right access, the card, the
// welcome DM (closed DMs noted), made-once, a local stack making nothing, and
// who sees a ticket (Hellfire's officers never see Phoenix's).
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  DISCORD_DOWN,
  DMS_BLOCKED,
  DMS_CLOSED,
  DM_NOT_SENT,
  type Deps,
  type Made,
  NOT_YOURS,
  PARTLY_MADE,
  type Ticket,
  channelChanges,
  channelName,
  handle,
  threadChanges,
  viewerIds
} from '../../../supabase/functions/recruit-ticket/handler.ts';

const SERVER = '111111111111111111';
const OFFICERS = '222222222222222222';
const CATEGORY = '333333333333333333';
const APPLICANT = '444444444444444444';
const BOT = '555555555555555555';
const OFFICER_A = '600000000000000001';
const OFFICER_B = '600000000000000002';
const RECRUITER_ROLE = '700000000000000001';
const TICKET = '800000000000000001';
const THREAD = '800000000000000002';
const POST = '800000000000000003';
const DM = '800000000000000004';
const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://kxgjqnpwfklbgrxdgmmv.supabase.co',
  DISCORD_BOT_TOKEN: 'bot-token',
  SITE_URL: 'https://raidhub.example/'
};

const TICKET_APP: Ticket = {
  id: 7,
  team_id: 3,
  team_name: 'Phoenix',
  guild_name: 'We Go Again',
  team_slug: 'phoenix',
  person_id: 42,
  discord_id: APPLICANT,
  name_realm: 'Katorrí-Stormrage',
  character: { name: 'Katorrí', realm_slug: 'stormrage' },
  class_name: 'Warlock',
  spec_name: 'Demonology',
  other_specs: ['Destruction'],
  item_level: 720,
  mplus_score: 3150.5,
  logs_best_average: 92.4,
  mythic_bosses_killed: 6,
  answers: [
    { key: 'about', answer: 'Warlock main, raided CE since Legion.' },
    { key: 'nights', answer: 'Every week' }
  ],
  sent_by: 'recruiter',
  sent_by_name: 'Voxle',
  applied_before: 3,
  reopened: false,
  ticket_deleted_at: null,
  discord_channel_id: null,
  discord_thread_id: null,
  discord_officer_message_id: null,
  opened_detail: null,
  mode: 'ticket',
  thread_with_ticket: false,
  server_id: SERVER,
  officer_channel_id: OFFICERS,
  ticket_category_id: CATEGORY,
  role_ids: [RECRUITER_ROLE],
  viewer_ids: [OFFICER_A, OFFICER_B]
};

type Call = { method: string; url: string; body: any };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function routes(): Record<string, () => Response> {
  return {
    ['GET ' + API + '/users/@me']: () => json({ id: BOT }),
    ['GET ' + API + '/guilds/' + SERVER + '/members/' + APPLICANT]: () => json({ user: { id: APPLICANT } }),
    ['GET ' + API + '/guilds/' + SERVER + '/channels']: () => json([{ name: 'phoenix-katorri' }, { name: 'general' }]),
    ['POST ' + API + '/guilds/' + SERVER + '/channels']: () => json({ id: TICKET }, 201),
    ['POST ' + API + '/channels/' + TICKET + '/messages']: () => json({ id: '1' }),
    ['POST ' + API + '/channels/' + OFFICERS + '/threads']: () => json({ id: THREAD }, 201),
    ['PUT ' + API + '/channels/' + THREAD + '/thread-members/' + OFFICER_A]: () => new Response(null, { status: 204 }),
    ['PUT ' + API + '/channels/' + THREAD + '/thread-members/' + OFFICER_B]: () => new Response(null, { status: 204 }),
    ['POST ' + API + '/channels/' + THREAD + '/messages']: () => json({ id: '2' }),
    ['POST ' + API + '/channels/' + OFFICERS + '/messages']: () => json({ id: POST }),
    ['POST ' + API + '/users/@me/channels']: () => json({ id: DM }),
    ['POST ' + API + '/channels/' + DM + '/messages']: () => json({ id: '3' })
  };
}

function setup(
  over: Record<string, () => Response> = {},
  app: Partial<Ticket> | null = {},
  env = ENV,
  saveFails = false
) {
  const table = { ...routes(), ...over };
  const calls: Call[] = [];
  const saved: Array<{ made: Made; detail: string | null }> = [];
  const actors: Array<number | null> = [];
  const claims: string[] = [];
  const taken = new Set<string>();
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = await req.text();
    const key = req.method + ' ' + req.url;
    calls.push({ method: req.method, url: req.url, body: text ? JSON.parse(text) : null });
    const route = table[key];
    if (!route) throw new Error('unrouted ' + key);
    return route();
  }) as typeof globalThis.fetch;
  const ticket = app === null ? null : { ...TICKET_APP, ...app };
  const deps: Deps = {
    fetch,
    db: {
      getUser: (h) => Promise.resolve(h === 'Bearer jwt' ? { id: 'u1' } : null),
      // null is the sweep's call, with the cron secret.
      ticket: (uid, id) =>
        Promise.resolve((uid === 'u1' || uid === null) && ticket && id === ticket.id ? ticket : null),
      saveMade: (_id, actor, made, detail) => {
        if (saveFails) return Promise.reject(new Error('db down'));
        saved.push({ made: { ...made }, detail });
        actors.push(actor);
        return Promise.resolve();
      },
      // Once-only claims, as the unique row in recruit_reminders_sent.
      claim: (_id, key, at) => {
        claims.push('claim ' + key);
        if (taken.has(key + at)) return Promise.resolve(false);
        taken.add(key + at);
        return Promise.resolve(true);
      },
      unclaim: (_id, key, at) => {
        claims.push('unclaim ' + key);
        taken.delete(key + at);
        return Promise.resolve();
      },
      stopFresh: () => {
        claims.push('stop');
        return Promise.resolve();
      },
      openTickets: () => Promise.resolve(ticket ? [ticket.id] : []),
      // Linked on Raid Hub: the two officers and a demoted one.
      linkedDiscordIds: (ids) => Promise.resolve(new Set(ids.filter((id) => LINKED.includes(id))))
    },
    env: { get: (n) => env[n] }
  };
  return { deps, calls, saved, claims, actors };
}

async function send(deps: Deps, body: unknown = { application: 7 }, auth = 'Bearer jwt') {
  const res = await handle(
    new Request('http://edge.test/functions/v1/recruit-ticket', {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }),
    deps
  );
  return { status: res.status, body: await res.json() };
}

const find = (calls: Call[], method: string, path: string) =>
  calls.filter((c) => c.method === method && c.url === API + path);

const VIEW = String(1n << 10n);

Deno.test('ticket: a private channel in the category, @everyone out, the applicant and team people in', async () => {
  const { deps, calls, saved } = setup();
  const { body } = await send(deps);
  assertEquals(body, {
    success: true,
    status: 'made',
    mode: 'ticket',
    ticket_url: 'https://discord.com/channels/' + SERVER + '/' + TICKET,
    welcome_dm: 'sent'
  });
  const [create] = find(calls, 'POST', '/guilds/' + SERVER + '/channels');
  // phoenix-katorri is taken, so the accent-stripped name gets -2.
  assertEquals(create.body.name, 'phoenix-katorri-2');
  assertEquals(create.body.parent_id, CATEGORY);
  const ow = create.body.permission_overwrites;
  assertEquals(ow[0], { id: SERVER, type: 0, allow: '0', deny: VIEW });
  assertEquals(
    ow.map((o: any) => o.id),
    [SERVER, BOT, APPLICANT, RECRUITER_ROLE, OFFICER_A, OFFICER_B]
  );
  // The applicant can't manage the channel or embed; officers can embed.
  const applicant = BigInt(ow[2].allow);
  assert(applicant & (1n << 10n) && applicant & (1n << 11n) && applicant & (1n << 15n) && applicant & (1n << 16n));
  assertEquals(applicant & (1n << 4n), 0n);
  assertEquals(saved, [
    { made: { discord_channel_id: TICKET, discord_thread_id: null, discord_officer_message_id: null }, detail: null }
  ]);
  assertEquals(find(calls, 'POST', '/channels/' + OFFICERS + '/threads'), []);
});

Deno.test("the answer never carries the officers' Discord ids or the team's settings", async () => {
  for (const over of [
    {},
    { thread_with_ticket: true },
    { mode: 'officer_thread' as const },
    { discord_channel_id: TICKET }
  ]) {
    const { deps } = setup({}, over);
    const { body } = await send(deps);
    const text = JSON.stringify(body);
    for (const secret of [OFFICER_A, OFFICER_B, RECRUITER_ROLE, OFFICERS, CATEGORY]) assert(!text.includes(secret));
    assertEquals(Object.keys(body).sort(), ['mode', 'status', 'success', 'ticket_url', 'welcome_dm']);
  }
});

Deno.test('ticket card: mentions only the applicant and officers, fields, links and buttons', async () => {
  const { deps, calls } = setup();
  await send(deps);
  const [msg] = find(calls, 'POST', '/channels/' + TICKET + '/messages');
  assertEquals(msg.body.allowed_mentions, { parse: [], users: [APPLICANT, OFFICER_A, OFFICER_B] });
  assertEquals(msg.body.content, '<@' + APPLICANT + '> <@' + OFFICER_A + '> <@' + OFFICER_B + '>');
  const embed = msg.body.embeds[0];
  assert(embed.description.startsWith('> Warlock main, raided CE since Legion.'));
  assert(embed.description.includes('https://raider.io/characters/us/stormrage/katorr%C3%AD'));
  const fields = Object.fromEntries(embed.fields.map((f: any) => [f.name, f.value]));
  assertEquals(fields, {
    Spec: 'Demonology Warlock',
    'Other specs': 'Destruction',
    'Item level': '720',
    'M+ score': '3150.5',
    'Best logs average': '92.4',
    'Mythic bosses killed': '6',
    'Raid nights': 'Every week',
    'Sent by': 'Voxle',
    'Applied before': '[Yes: their earlier ticket](https://raidhub.example/recruits/3)'
  });
  const buttons = msg.body.components[0].components;
  assertEquals(
    buttons.map((b: any) => b.custom_id ?? b.url),
    ['recruit:trial:7', 'recruit:decline:7', 'recruit:note:7', 'https://raidhub.example/recruits/7']
  );
});

Deno.test('ticket with officer thread: a private thread beside it, people added, roles mentioned in', async () => {
  const { deps, calls, saved } = setup({}, { thread_with_ticket: true });
  await send(deps);
  const [thread] = find(calls, 'POST', '/channels/' + OFFICERS + '/threads');
  assertEquals(thread.body.type, 12);
  assertEquals(thread.body.invitable, false);
  assertEquals(calls.filter((c) => c.url.includes('/thread-members/')).length, 2);
  const [msg] = find(calls, 'POST', '/channels/' + THREAD + '/messages');
  assertEquals(msg.body.allowed_mentions, { parse: [], users: [OFFICER_A, OFFICER_B], roles: [RECRUITER_ROLE] });
  assert(msg.body.content.includes('<#' + TICKET + '>'));
  assert(!msg.body.content.includes(APPLICANT));
  assertEquals(saved[0].made, {
    discord_channel_id: TICKET,
    discord_thread_id: THREAD,
    discord_officer_message_id: null
  });
});

Deno.test('officer_thread: a thread without the applicant, and the no-ticket welcome', async () => {
  const { deps, calls, saved } = setup({}, { mode: 'officer_thread' });
  const { body } = await send(deps);
  assertEquals(body.ticket_url, null);
  assertEquals(find(calls, 'POST', '/guilds/' + SERVER + '/channels'), []);
  assert(!calls.some((c) => c.url.endsWith('/thread-members/' + APPLICANT)));
  const [dm] = find(calls, 'POST', '/channels/' + DM + '/messages');
  assertEquals(dm.body.content, 'Your application to Phoenix is in. An officer will message you.');
  assertEquals(saved[0].made.discord_thread_id, THREAD);
});

Deno.test('officer_post: one message in the officer channel, the applicant not mentioned', async () => {
  const { deps, calls, saved } = setup({}, { mode: 'officer_post' });
  await send(deps);
  const [msg] = find(calls, 'POST', '/channels/' + OFFICERS + '/messages');
  assertEquals(msg.body.allowed_mentions, { parse: [], users: [OFFICER_A, OFFICER_B] });
  assertEquals(saved[0].made, { discord_channel_id: null, discord_thread_id: null, discord_officer_message_id: POST });
  assertEquals(find(calls, 'POST', '/channels/' + OFFICERS + '/threads'), []);
});

Deno.test('none, or settings not picked yet: nothing made', async () => {
  for (const over of [{ mode: 'none' as const }, { ticket_category_id: null }, { server_id: null }]) {
    const { deps, calls } = setup({}, over);
    const { body } = await send(deps);
    assertEquals(body, { success: true, status: 'off' });
    assertEquals(calls, []);
  }
});

Deno.test('welcome DM: links the ticket; closed DMs are noted on the record', async () => {
  let r = setup();
  await send(r.deps);
  const [dm] = find(r.calls, 'POST', '/channels/' + DM + '/messages');
  assert(dm.body.content.includes('https://discord.com/channels/' + SERVER + '/' + TICKET));
  assertEquals(
    dm.body.content,
    "Welcome to We Go Again! Your private ticket with Phoenix's officers is ready: https://discord.com/channels/" +
      SERVER +
      '/' +
      TICKET
  );
  assertEquals(dm.body.components[0].components[0].label, 'Open your ticket');

  r = setup({ ['POST ' + API + '/channels/' + DM + '/messages']: () => json({ code: 50007 }, 403) });
  const { body } = await send(r.deps);
  assertEquals(body.welcome_dm, DMS_CLOSED);
  assertEquals(body.ticket_url, 'https://discord.com/channels/' + SERVER + '/' + TICKET);
  assertEquals(r.saved[0].detail, DMS_CLOSED);
});

Deno.test('made already: answered from the record, nothing made again', async () => {
  const { deps, calls } = setup({}, { discord_channel_id: TICKET });
  const { body } = await send(deps);
  assertEquals(body.ticket_url, 'https://discord.com/channels/' + SERVER + '/' + TICKET);
  assertEquals(calls, []);
});

Deno.test('ticket: not in the server yet answers not_in_server and makes nothing', async () => {
  const { deps, calls, saved } = setup({
    ['GET ' + API + '/guilds/' + SERVER + '/members/' + APPLICANT]: () => json({ code: 10007 }, 404)
  });
  const { body } = await send(deps);
  assertEquals(body, { success: true, status: 'not_in_server' });
  assertEquals(find(calls, 'POST', '/guilds/' + SERVER + '/channels'), []);
  assertEquals(saved, []);
});

Deno.test('Discord failing after the channel exists: what was made is still recorded', async () => {
  const { deps, saved } = setup({ ['POST ' + API + '/channels/' + TICKET + '/messages']: () => json({}, 500) });
  const { status, body } = await send(deps);
  assertEquals(status, 502);
  assertEquals(body.error, DISCORD_DOWN);
  assertEquals(saved, [
    {
      made: { discord_channel_id: TICKET, discord_thread_id: null, discord_officer_message_id: null },
      detail: PARTLY_MADE
    }
  ]);
});

Deno.test('a local stack makes nothing and posts the card text to the test webhook', async () => {
  const env = { SUPABASE_URL: 'http://127.0.0.1:54321', DISCORD_TEST_WEBHOOK_URL: 'https://hook.example/x' };
  const { deps, calls, saved } = setup({ ['POST https://hook.example/x']: () => json({}) }, {}, env);
  const { body } = await send(deps);
  assertEquals(body, { success: true, status: 'local' });
  assertEquals(calls.length, 1);
  assert(calls[0].body.content.startsWith('[local] '));
  assertEquals(calls[0].body.allowed_mentions, { parse: [] });
  assertEquals(saved, []);
});

Deno.test('the gate: not signed in, not yours, bad body', async () => {
  const { deps } = setup({}, null);
  assertEquals((await send(deps, { application: 7 }, 'Bearer other')).status, 401);
  const mine = await send(deps);
  assertEquals(mine.status, 403);
  assertEquals(mine.body.error, NOT_YOURS);
  assertEquals((await send(deps, { application: 'x' })).status, 400);
});

Deno.test("who sees it: Hellfire's officers get no access to a Phoenix ticket", () => {
  const phoenix = { id: 3, guild_id: 1 };
  const members = [
    { team_id: 3, person_id: 1, rank: 'owner', archived_at: null },
    { team_id: 3, person_id: 2, rank: 'officer', archived_at: null },
    { team_id: 3, person_id: 3, rank: 'assistant', archived_at: null },
    { team_id: 3, person_id: 4, rank: 'raider', archived_at: null },
    { team_id: 3, person_id: 5, rank: 'officer', archived_at: '2026-10-01' },
    { team_id: 9, person_id: 6, rank: 'officer', archived_at: null }, // Hellfire
    { team_id: 9, person_id: 7, rank: 'owner', archived_at: null } // Hellfire
  ];
  const guild = [
    { guild_id: 1, person_id: 8, rank: 'admin' },
    { guild_id: 2, person_id: 9, rank: 'owner' }
  ];
  const discord = new Map<number, string | null>([
    [1, 'd1'],
    [2, 'd2'],
    [3, 'd3'],
    [4, 'd4'],
    [5, 'd5'],
    [6, 'd6'],
    [7, 'd7'],
    [8, 'd8'],
    [9, 'd9']
  ]);
  const officersOnly = {
    visible_to_team_officers: true,
    visible_to_team_assistants: false,
    visible_to_guild_admins: false
  };
  assertEquals(viewerIds(phoenix, officersOnly, members, guild, discord, null), ['d1', 'd2']);
  assertEquals(
    viewerIds(
      phoenix,
      { visible_to_team_officers: true, visible_to_team_assistants: true, visible_to_guild_admins: true },
      members,
      guild,
      discord,
      'd2'
    ),
    ['d1', 'd3', 'd8']
  );
  // Unlinked people can't be added.
  assertEquals(viewerIds(phoenix, officersOnly, members, guild, new Map([[1, null]]), null), []);
});

Deno.test('channel names: lowercased, accents stripped, deduplicated', () => {
  assertEquals(channelName('phoenix', 'Katorrí-Stormrage', new Set()), 'phoenix-katorri');
  assertEquals(channelName('hellfire-rollers', "Zul'jin-Area 52", new Set()), 'hellfire-rollers-zuljin');
  assertEquals(
    channelName('phoenix', 'Katorrí-Stormrage', new Set(['phoenix-katorri', 'phoenix-katorri-2'])),
    'phoenix-katorri-3'
  );
});

Deno.test('made already: the DM outcome is the one the record kept, and a partly made one never sent it', async () => {
  let r = setup({}, { discord_channel_id: TICKET, opened_detail: DMS_CLOSED });
  assertEquals((await send(r.deps)).body.welcome_dm, DMS_CLOSED);
  r = setup({}, { discord_channel_id: TICKET, opened_detail: PARTLY_MADE });
  assertEquals((await send(r.deps)).body.welcome_dm, DM_NOT_SENT);
  r = setup({}, { discord_channel_id: TICKET });
  assertEquals((await send(r.deps)).body.welcome_dm, 'sent');
});

Deno.test('ticket: the bot removed from the server is a failure, not "not in the server yet"', async () => {
  const { deps, saved } = setup({
    ['GET ' + API + '/guilds/' + SERVER + '/members/' + APPLICANT]: () => json({ code: 10004 }, 404)
  });
  const { status, body } = await send(deps);
  assertEquals(status, 502);
  assertEquals(body.error, DISCORD_DOWN);
  assertEquals(saved, []);
});

Deno.test('without a ticket, a 50007 says closed DMs or not in the server', async () => {
  const { deps, saved } = setup(
    { ['POST ' + API + '/channels/' + DM + '/messages']: () => json({ code: 50007 }, 403) },
    { mode: 'officer_post' }
  );
  assertEquals((await send(deps)).body.welcome_dm, DMS_BLOCKED);
  assertEquals(saved[0].detail, DMS_BLOCKED);
});

Deno.test('made but the record not saved: the ids go in the log, and no second save is tried', async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...a: unknown[]) => logged.push(a.join(' '));
  try {
    const { deps } = setup({}, {}, ENV, true);
    const { status } = await send(deps);
    assertEquals(status, 500);
    assertEquals(logged.length, 1);
    assert(logged[0].includes(TICKET) && logged[0].includes('"application":7'));
  } finally {
    console.error = original;
  }
});

Deno.test('the sweep makes a fresh ticket for a record reopened after its ticket was deleted (#1544)', async () => {
  const env = { ...ENV, OPTIONAL_RSVP_REMINDERS_SECRET: 'cron' };
  const { deps, calls, saved } = setup(
    {},
    { reopened: true, applied_before: null, discord_channel_id: '800000000000000099' },
    env
  );
  const res = await handle(
    new Request('http://edge.test/functions/v1/recruit-ticket', {
      method: 'POST',
      headers: { 'x-cron-secret': 'cron', 'Content-Type': 'application/json' },
      body: JSON.stringify({ application: 7 })
    }),
    deps
  );
  const body = await res.json();
  assertEquals(body.status, 'made');
  // A new channel, not the deleted one answered again.
  assertEquals(find(calls, 'POST', '/guilds/' + SERVER + '/channels').length, 1);
  assertEquals(saved[0].made.discord_channel_id, TICKET);
  const [msg] = find(calls, 'POST', '/channels/' + TICKET + '/messages');
  const fields = Object.fromEntries(msg.body.embeds[0].fields.map((f: any) => [f.name, f.value]));
  assertEquals(fields['Reopened'], '[Their earlier ticket is saved](https://raidhub.example/recruits/7)');
  assertEquals(fields['Applied before'], undefined);
  const [dm] = find(calls, 'POST', '/channels/' + DM + '/messages');
  assert(dm.body.content.startsWith('Your application to Phoenix is open again. Your new ticket with the officers: '));

  // Without the secret or a sign-in, nothing.
  const wrong = await handle(
    new Request('http://edge.test/functions/v1/recruit-ticket', {
      method: 'POST',
      headers: { 'x-cron-secret': 'nope', 'Content-Type': 'application/json' },
      body: JSON.stringify({ application: 7 })
    }),
    deps
  );
  assertEquals(wrong.status, 401);
  await wrong.body?.cancel();
});

const SWEEP_ENV = { ...ENV, OPTIONAL_RSVP_REMINDERS_SECRET: 'cron' };
const REOPENED = {
  reopened: true,
  ticket_deleted_at: '2026-11-10T15:00:00+00:00',
  applied_before: null,
  discord_channel_id: '800000000000000099'
};
const sweepCall = (deps: Deps, secret = 'cron') =>
  handle(
    new Request('http://edge.test/functions/v1/recruit-ticket', {
      method: 'POST',
      headers: { 'x-cron-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ application: 7 })
    }),
    deps
  ).then(async (res) => ({ status: res.status, body: await res.json() }));

Deno.test('a fresh ticket is claimed first: a second call at the same time makes nothing', async () => {
  const { deps, calls, actors, claims } = setup({}, REOPENED, SWEEP_ENV);
  const first = await sweepCall(deps);
  assertEquals(first.body.status, 'made');
  // The sweep's ticket names nobody as having opened it.
  assertEquals(actors, [null]);
  calls.length = 0;
  const second = await sweepCall(deps);
  assertEquals(second.body.status, 'busy');
  assertEquals(calls.length, 0);
  // The applicant's own call while it's being made: the same claim, refused.
  assertEquals((await send(deps)).body.status, 'busy');
  assertEquals(claims, ['claim fresh_ticket', 'claim fresh_ticket', 'claim fresh_ticket']);
});

Deno.test('the applicant calling on a reopened record takes the same claim', async () => {
  const { deps, actors, claims } = setup({}, REOPENED, SWEEP_ENV);
  const r = await send(deps);
  assertEquals(r.body.status, 'made');
  assertEquals(claims, ['claim fresh_ticket']);
  assertEquals(actors, [42]);
});

Deno.test('a thread made before Discord failed is saved, and the claim kept', async () => {
  const { deps, saved, claims } = setup(
    { ['POST ' + API + '/channels/' + THREAD + '/messages']: () => new Response('', { status: 503 }) },
    { ...REOPENED, mode: 'officer_thread' },
    SWEEP_ENV
  );
  const r = await sweepCall(deps);
  assertEquals(r.status, 502);
  assertEquals(saved[0].made.discord_thread_id, THREAD);
  assertEquals(saved[0].detail, PARTLY_MADE);
  assertEquals(claims, ['claim fresh_ticket']);
});

Deno.test('made but not saved keeps the claim, so a second ticket is never made', async () => {
  const { deps, claims } = setup({}, REOPENED, SWEEP_ENV, true);
  const r = await sweepCall(deps);
  assertEquals(r.status, 500);
  assertEquals(claims, ['claim fresh_ticket']);
  assertEquals((await sweepCall(deps)).body.status, 'busy');
});

Deno.test('Discord down with nothing made hands the claim back for the next sweep', async () => {
  const { deps, claims } = setup(
    { ['GET ' + API + '/users/@me']: () => new Response('', { status: 503 }) },
    REOPENED,
    SWEEP_ENV
  );
  const r = await sweepCall(deps);
  assertEquals(r.status, 502);
  assertEquals(claims, ['claim fresh_ticket', 'unclaim fresh_ticket']);
});

Deno.test(
  'a reopened applicant who left the server: the officers are told once, and the sweep keeps checking',
  async () => {
    let noticeStatus = 500;
    const { deps, calls, claims } = setup(
      {
        ['GET ' + API + '/guilds/' + SERVER + '/members/' + APPLICANT]: () =>
          new Response(JSON.stringify({ code: 10007 }), { status: 404 }),
        ['POST ' + API + '/channels/' + OFFICERS + '/messages']: () =>
          new Response(JSON.stringify({ id: '1' }), { status: noticeStatus })
      },
      REOPENED,
      SWEEP_ENV
    );
    // The notice fails: its claim is handed back, as is the ticket's.
    let r = await sweepCall(deps);
    assertEquals(r.body.status, 'not_in_server');
    assertEquals(claims, [
      'claim fresh_ticket',
      'unclaim fresh_ticket',
      'claim fresh_not_in_server',
      'unclaim fresh_not_in_server'
    ]);
    // Next sweep it posts, once.
    noticeStatus = 200;
    calls.length = 0;
    claims.length = 0;
    r = await sweepCall(deps);
    const [notice] = find(calls, 'POST', '/channels/' + OFFICERS + '/messages');
    assert(notice.body.content.startsWith("Katorrí's application was reopened, but they've left the Discord server"));
    assert(notice.body.content.endsWith('Raid Hub makes it once they rejoin.'));
    assertEquals(notice.body.allowed_mentions, { parse: [] });
    calls.length = 0;
    await sweepCall(deps);
    assertEquals(find(calls, 'POST', '/channels/' + OFFICERS + '/messages').length, 0);
  }
);

Deno.test('a team that stopped making tickets: the sweep is told to stop asking', async () => {
  const { deps, calls, claims } = setup({}, { ...REOPENED, mode: 'none' }, SWEEP_ENV);
  const r = await sweepCall(deps);
  assertEquals(r.body.status, 'off');
  assertEquals(claims, ['stop']);
  assertEquals(calls.length, 0);
});

Deno.test("the secret only makes a reopened record's fresh ticket, and only when it is set", async () => {
  const notReopened = setup({}, {}, SWEEP_ENV);
  assertEquals((await sweepCall(notReopened.deps)).status, 409);
  assertEquals(notReopened.calls.length, 0);
  // No secret on this stack: the header alone is no way in.
  const unset = setup({}, REOPENED, ENV);
  assertEquals((await sweepCall(unset.deps, '')).status, 401);
  assertEquals((await sweepCall(unset.deps, 'undefined')).status, 401);
});

// Keeping who sees a ticket in step with Raid Hub (#1545).
const DEMOTED = '600000000000000003';
const STRANGER = '600000000000000004';
const OLD_ROLE = '700000000000000002';
const ROLE_HOLDER = '600000000000000005';
const LINKED = [OFFICER_A, OFFICER_B, DEMOTED];
const PEOPLE = String((1n << 10n) | (1n << 11n) | (1n << 14n) | (1n << 15n) | (1n << 16n));
const ow = (id: string, type: number, allow = PEOPLE, deny = '0') => ({ id, type, allow, deny });

Deno.test('access: a promoted officer is let in, a demoted one and a dropped role are taken out', () => {
  const current = [
    ow(SERVER, 0, '0', VIEW),
    ow(BOT, 1, '1'),
    ow(APPLICANT, 1, String((1n << 10n) | (1n << 11n) | (1n << 15n) | (1n << 16n))),
    ow(RECRUITER_ROLE, 0),
    ow(OLD_ROLE, 0),
    ow(OFFICER_A, 1),
    ow(DEMOTED, 1)
  ];
  const { add, remove } = channelChanges(TICKET_APP, BOT, current);
  assertEquals(add, [ow(OFFICER_B, 1)]);
  assertEquals(remove, [OLD_ROLE, DEMOTED]);
});

Deno.test('access: hand-made overwrites are left alone, and nobody gets a second one', () => {
  const current = [
    // An officer someone gave more by hand, and a stranger let in by hand.
    ow(OFFICER_A, 1, String((1n << 10n) | (1n << 13n))),
    ow(STRANGER, 1, String(1n << 10n)),
    // The applicant locked or not, the bot and @everyone: never Raid Hub's to drop.
    ow(APPLICANT, 1, PEOPLE),
    ow(SERVER, 0, PEOPLE)
  ];
  const { add, remove } = channelChanges({ ...TICKET_APP, role_ids: [] }, BOT, current);
  assertEquals(add, [ow(OFFICER_B, 1)]);
  assertEquals(remove, []);
});

Deno.test('access: an officer thread adds the team people and role holders, removes only linked people', () => {
  const members = [BOT, OFFICER_A, DEMOTED, STRANGER];
  const linked = new Set([OFFICER_A, DEMOTED]);
  const { add, remove } = threadChanges(TICKET_APP, BOT, members, [ROLE_HOLDER, APPLICANT], linked);
  // The applicant never joins the officers' thread, even holding a role.
  assertEquals(add, [OFFICER_B, ROLE_HOLDER]);
  // The stranger isn't on Raid Hub: an officer added them, so they stay.
  assertEquals(remove, [DEMOTED]);
});

Deno.test('access: without the member list, nobody leaves a thread while the team lists roles', () => {
  const members = [BOT, DEMOTED];
  const linked = new Set([DEMOTED]);
  assertEquals(threadChanges(TICKET_APP, BOT, members, null, linked), { add: [OFFICER_A, OFFICER_B], remove: [] });
  // No roles listed: nothing to tell apart, so the demoted officer goes.
  assertEquals(threadChanges({ ...TICKET_APP, role_ids: [] }, BOT, members, null, linked).remove, [DEMOTED]);
});

const syncCall = (deps: Deps, secret = 'cron') =>
  handle(
    new Request('http://edge.test/functions/v1/recruit-ticket', {
      method: 'POST',
      headers: { 'x-cron-secret': secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync' })
    }),
    deps
  ).then(async (res) => ({ status: res.status, body: await res.json() }));

const NO_CONTENT = () => new Response(null, { status: 204 });
const OPEN = { discord_channel_id: TICKET, discord_thread_id: THREAD, thread_with_ticket: true };

Deno.test('sync: the sweep fixes an open ticket and its archived thread', async () => {
  const { deps, calls } = setup(
    {
      ['GET ' + API + '/channels/' + TICKET]: () =>
        json({
          permission_overwrites: [ow(SERVER, 0, '0', VIEW), ow(RECRUITER_ROLE, 0), ow(OFFICER_A, 1), ow(DEMOTED, 1)]
        }),
      ['PUT ' + API + '/channels/' + TICKET + '/permissions/' + OFFICER_B]: NO_CONTENT,
      ['DELETE ' + API + '/channels/' + TICKET + '/permissions/' + DEMOTED]: NO_CONTENT,
      ['GET ' + API + '/channels/' + THREAD]: () => json({ thread_metadata: { archived: true } }),
      ['GET ' + API + '/channels/' + THREAD + '/thread-members']: () =>
        json([{ user_id: BOT }, { user_id: OFFICER_A }, { user_id: DEMOTED }]),
      ['GET ' + API + '/guilds/' + SERVER + '/members?limit=1000&after=0']: () =>
        json([
          { user: { id: ROLE_HOLDER }, roles: [RECRUITER_ROLE] },
          { user: { id: STRANGER }, roles: [] }
        ]),
      ['PATCH ' + API + '/channels/' + THREAD]: () => json({}),
      ['PUT ' + API + '/channels/' + THREAD + '/thread-members/' + ROLE_HOLDER]: NO_CONTENT,
      ['DELETE ' + API + '/channels/' + THREAD + '/thread-members/' + DEMOTED]: NO_CONTENT
    },
    OPEN,
    SWEEP_ENV
  );
  const { body } = await syncCall(deps);
  assertEquals(body, { success: true, status: 'synced', checked: 1, changed: 5, failed: 0 });
  assertEquals(find(calls, 'PUT', '/channels/' + TICKET + '/permissions/' + OFFICER_B)[0].body, {
    type: 1,
    allow: PEOPLE,
    deny: '0'
  });
  // Brought back from archived before its members change.
  const patch = calls.findIndex((c) => c.method === 'PATCH');
  const firstMember = calls.findIndex((c) => c.url.includes('/thread-members/'));
  assert(patch >= 0 && patch < firstMember);
  assertEquals(find(calls, 'PATCH', '/channels/' + THREAD)[0].body, { archived: false });
});

Deno.test('sync: nothing to change makes no changes; a ticket deleted by hand is skipped', async () => {
  const { deps, calls } = setup(
    {
      ['GET ' + API + '/channels/' + TICKET]: () => json({}, 404),
      ['GET ' + API + '/channels/' + THREAD]: () => json({ thread_metadata: { archived: true } }),
      ['GET ' + API + '/channels/' + THREAD + '/thread-members']: () =>
        json([{ user_id: BOT }, { user_id: OFFICER_A }, { user_id: OFFICER_B }]),
      ['GET ' + API + '/guilds/' + SERVER + '/members?limit=1000&after=0']: () => json([])
    },
    { ...OPEN },
    SWEEP_ENV
  );
  const { body } = await syncCall(deps);
  assertEquals(body.changed, 0);
  // An archived thread with nothing to change stays archived.
  assertEquals(
    calls.filter((c) => c.method !== 'GET'),
    []
  );
});

Deno.test('sync: only the sweep may ask, and a local stack changes nothing', async () => {
  const wrong = setup({}, OPEN, SWEEP_ENV);
  assertEquals((await syncCall(wrong.deps, 'nope')).status, 401);
  // Signed in, an applicant's sync is just a missing application.
  const signedIn = await send(wrong.deps, { action: 'sync' });
  assertEquals(signedIn.status, 400);
  const local = setup({}, OPEN, { ...SWEEP_ENV, SUPABASE_URL: 'http://127.0.0.1:54321' });
  assertEquals((await syncCall(local.deps)).body.status, 'local');
  assertEquals(local.calls.length, 0);
});
