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
  channelName,
  handle,
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
  applied_before: true,
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
      ticket: (uid, id) => Promise.resolve(uid === 'u1' && ticket && id === ticket.id ? ticket : null),
      saveMade: (_id, _actor, made, detail) => {
        if (saveFails) return Promise.reject(new Error('db down'));
        saved.push({ made: { ...made }, detail });
        return Promise.resolve();
      }
    },
    env: { get: (n) => env[n] }
  };
  return { deps, calls, saved };
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
    'Applied before': 'Yes'
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
