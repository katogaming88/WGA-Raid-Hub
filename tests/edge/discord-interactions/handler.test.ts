// discord-interactions' handler (#998): the signature check before anything
// else, PING, the team a command is for, and /nudge-missing answering
// "thinking" before it reads or posts anything, then DMing each raider and
// recording the cooldown only after a DM went out.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  BENCH,
  CLEARED,
  COOLDOWN_MS,
  RAID_OVER,
  SAVED,
  type Deps,
  type InteractionsDb,
  NO_TEAMS,
  NOT_IN_SERVER,
  PICK_TEAM,
  BROKE,
  type Member,
  NO_INVITE,
  NO_PROFILE,
  NOT_ON_TEAM,
  INVITE_NOT_ALLOWED,
  LINEUP_BAD_DATE,
  LINEUP_NOT_ALLOWED,
  LINEUP_POSTED,
  INVITE_POSTED,
  type Team,
  UNKNOWN_COMMAND,
  NOT_ALLOWED,
  UNKNOWN_TEAM,
  handle,
  verifySignature
} from '../../../supabase/functions/discord-interactions/handler.ts';
import type { NudgeCategory, WishlistSetupStatusRow } from '../../../supabase/functions/discord-interactions/nudge.ts';
import type { Award, Signup } from '../../../supabase/functions/discord-interactions/raider.ts';
import { VERSION } from '../../../supabase/functions/discord-interactions/version.ts';
import type { LineupDb } from '../../../supabase/functions/_shared/lineup-post.ts';
import { recordingFetch } from '../_support/fetch.ts';
import { CHANNEL, RAID, type SheetState, fakeSheets } from '../_support/sheets.ts';

const URL = 'http://edge.test/functions/v1/discord-interactions';
const SERVER = '100000000000000001';
const APP = '400000000000000004';
const NOW = new Date('2026-11-02T14:00:00.000Z');
// The officer running the command.
const OFFICER = '700000000000000007';
const PHOENIX: Team = { id: 1, name: 'Phoenix' };
const HELLFIRE: Team = { id: 2, name: 'Hellfire Rollers' };

// A test-only keypair, made fresh per run, and one made with another key.
const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const otherKeys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const PUBLIC_KEY = hex(await crypto.subtle.exportKey('raw', keys.publicKey));
const TIMESTAMP = '1762092000';

async function sign(body: string, timestamp = TIMESTAMP, key = keys.privateKey) {
  return hex(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(timestamp + body)));
}

async function signed(interaction: unknown, headers: Record<string, string | null> = {}): Promise<Request> {
  const body = JSON.stringify(interaction);
  const all: Record<string, string | null> = {
    'X-Signature-Ed25519': await sign(body),
    'X-Signature-Timestamp': TIMESTAMP,
    ...headers
  };
  const h = new Headers();
  for (const [k, v] of Object.entries(all)) if (v !== null) h.set(k, v);
  return new Request(URL, { method: 'POST', headers: h, body });
}

const command = (name: string, over: Record<string, unknown> = {}, options?: unknown[]) => ({
  type: 2,
  application_id: APP,
  token: 'interaction-token',
  guild_id: SERVER,
  member: { user: { id: OFFICER } },
  data: { name, ...(options ? { options } : {}) },
  ...over
});

// A subcommand, as Discord sends one: the group's name, the subcommand under
// it with its own options.
const sub = (group: string, name: string, over: Record<string, unknown> = {}, options: unknown[] = []) =>
  command(group, over, [{ type: 1, name, options }]);

const row = (over: Partial<WishlistSetupStatusRow> = {}): WishlistSetupStatusRow => ({
  player_id: 1,
  name_realm: 'Katorrí-Stormrage',
  discord_id: '500000000000000005',
  wishlist_count: 0,
  bis_link: 'https://example.test/bis',
  missing_bis_rows: [],
  season: 'MID1',
  season_name: 'Midnight Season 1',
  ...over
});

type State = {
  teams?: Team[];
  rows?: WishlistSetupStatusRow[];
  recent?: { discordId: string; category: NudgeCategory }[];
  statusFails?: boolean;
  // The team permissions the caller holds; both nudge ones unless set.
  held?: string[];
  // The caller's profile; on Phoenix with one character unless set.
  member?: Member | null;
  signup?: Signup;
  awards?: Award[];
  list?: unknown;
  invite?: string | null;
  posts?: { kind: string; channelId: string }[];
  // What discord_set_rsvp() answers: null when it saved.
  rsvpRefusal?: string | null;
};

const KAT: Member = {
  personId: 3,
  authUserId: 'auth-kat',
  onTeam: true,
  players: [{ id: 1, nameRealm: 'Katorrí-Stormrage', archived: false }]
};

// One log for the database and Discord both, so the order between them is
// an assertion.
function setup(state: State = {}, discord: Response[] = [], sheetState: SheetState = {}) {
  const log: string[] = [];
  const recorded: { discordId: string; categories: NudgeCategory[] }[] = [];
  const saved: unknown[][] = [];
  const pending: Promise<unknown>[] = [];
  const db: InteractionsDb = {
    teamsInServer(serverId) {
      log.push('db:teamsInServer:' + serverId);
      return Promise.resolve(state.teams ?? [PHOENIX]);
    },
    setupStatus(teamId) {
      log.push('db:setupStatus:' + teamId);
      if (state.statusFails) return Promise.reject(new Error('read failed'));
      return Promise.resolve(state.rows ?? [row()]);
    },
    nudgedSince(ids, since) {
      log.push(`db:nudgedSince:${ids.join(',')}:${since.toISOString()}`);
      return Promise.resolve(state.recent ?? []);
    },
    hasTeamPermission(discordId, teamId, permission) {
      log.push(`db:hasTeamPermission:${discordId}:${teamId}:${permission}`);
      return Promise.resolve((state.held ?? ['manage_loot', 'view_loot']).includes(permission));
    },
    recordNudge(discordId, categories) {
      log.push('db:recordNudge:' + discordId);
      recorded.push({ discordId, categories });
      return Promise.resolve();
    },
    member(discordId, teamId) {
      log.push(`db:member:${discordId}:${teamId}`);
      return Promise.resolve(state.member === undefined ? KAT : state.member);
    },
    signup(_member, teamId) {
      log.push('db:signup:' + teamId);
      return Promise.resolve(state.signup === undefined ? null : state.signup);
    },
    awards(teamId, playerIds) {
      log.push(`db:awards:${teamId}:${playerIds.join(',')}`);
      return Promise.resolve({ awards: state.awards ?? [], list: state.list ?? null });
    },
    inviteCode(teamId) {
      log.push('db:inviteCode:' + teamId);
      return Promise.resolve(state.invite === undefined ? 'phoenix-abc123' : state.invite);
    },
    posts(teamId) {
      log.push('db:posts:' + teamId);
      return Promise.resolve(state.posts ?? []);
    },
    setRsvp(...args) {
      log.push('db:setRsvp');
      saved.push(args);
      return Promise.resolve(state.rsvpRefusal ?? null);
    }
  };
  const rec = recordingFetch(discord);
  const fetch = ((input: string | URL | Request, init?: RequestInit) => {
    log.push('fetch:' + (init?.method ?? 'GET') + ' ' + String(input).replace(API, ''));
    return rec.fetch(input, init);
  }) as typeof globalThis.fetch;
  const env = new Map([
    ['DISCORD_PUBLIC_KEY', PUBLIC_KEY],
    ['DISCORD_BOT_TOKEN', 'bot-token'],
    ['SITE_URL', 'https://site.test']
  ]);
  const deps: Deps = {
    fetch,
    env: { get: (k) => env.get(k) },
    db,
    sheets: fakeSheets(sheetState).db,
    now: () => NOW,
    sleep: () => Promise.resolve(),
    waitUntil: (work) => {
      log.push('waitUntil');
      pending.push(work);
    }
  };
  return { deps, log, calls: rec.calls, recorded, saved, settle: () => Promise.all(pending) };
}

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });
const dmChannel = () => ok({ id: '600000000000000006' });

// ── The signature ─────────────────────────────────────────────────────────

Deno.test('signature: a correctly signed body verifies', async () => {
  assert(await verifySignature(PUBLIC_KEY, await sign('{"type":1}'), TIMESTAMP, '{"type":1}'));
});

const BAD: [
  string,
  (body: string) => Record<string, string | null> | Promise<Record<string, string | null>>,
  string?
][] = [
  ['a tampered body', () => ({}), '{"type":1,"x":1}'],
  ['a wrong signature', () => ({ 'X-Signature-Ed25519': 'ab'.repeat(64) })],
  ['a wrong timestamp', () => ({ 'X-Signature-Timestamp': '1762092001' })],
  [
    'a signature from another key',
    async (body) => ({ 'X-Signature-Ed25519': await sign(body, TIMESTAMP, otherKeys.privateKey) })
  ],
  ['no signature header', () => ({ 'X-Signature-Ed25519': null })],
  ['no timestamp header', () => ({ 'X-Signature-Timestamp': null })],
  ['a signature that is not hex', () => ({ 'X-Signature-Ed25519': 'not-hex' })]
];

for (const [what, headers, tampered] of BAD) {
  Deno.test(`signature: ${what} is a 401 with no body and no read`, async () => {
    const { deps, log } = setup();
    const body = JSON.stringify(sub('officer', 'nudge-missing'));
    const req = await signed(sub('officer', 'nudge-missing'), await headers(body));
    const sent = tampered ? new Request(req, { body: tampered }) : req;
    const res = await handle(sent, deps);
    assertEquals(res.status, 401);
    assertEquals(await res.text(), '');
    assertEquals(log, []);
  });
}

Deno.test('signature: no public key set refuses everything', async () => {
  const { deps, log } = setup();
  const res = await handle(await signed({ type: 1 }), { ...deps, env: { get: () => undefined } });
  assertEquals(res.status, 401);
  assertEquals(log, []);
});

// ── Routing ───────────────────────────────────────────────────────────────

Deno.test('PING answers PONG before any read', async () => {
  const { deps, log } = setup();
  const res = await handle(await signed({ type: 1, application_id: APP, token: 't' }), deps);
  assertEquals(await res.json(), { type: 1 });
  assertEquals(res.headers.get('X-WGA-Version'), VERSION);
  assertEquals(log, []);
});

for (const [what, interaction] of [
  ['an old command', command('fairness')],
  ['the retired /about', command('about')],
  ['the old top-level /nudge-missing', command('nudge-missing')],
  ['an unknown subcommand', sub('officer', 'fairness')]
] as const) {
  Deno.test(`${what} is refused, only to the caller, with nothing read`, async () => {
    const { deps, log } = setup();
    const res = await handle(await signed(interaction), deps);
    assertEquals(await res.json(), { type: 4, data: { content: UNKNOWN_COMMAND, flags: 64 } });
    assertEquals(log, []);
  });
}

Deno.test('a button this bot does not know is refused, only to the caller, with nothing read', async () => {
  const { deps, log } = setup();
  const res = await handle(await signed({ ...command('x'), type: 3, data: { custom_id: 'something-else' } }), deps);
  assertEquals(await res.json(), { type: 4, data: { content: UNKNOWN_COMMAND, flags: 64 } });
  assertEquals(log, []);
});

Deno.test("the team box lists this server's teams, filtered by what's typed", async () => {
  const { deps, log } = setup({ teams: [HELLFIRE, PHOENIX] });
  const res = await handle(
    await signed({
      ...sub('officer', 'nudge-missing', {}, [{ name: 'team', value: 'pho', focused: true }]),
      type: 4
    }),
    deps
  );
  assertEquals(await res.json(), { type: 8, data: { choices: [{ name: 'Phoenix', value: '1' }] } });
  assertEquals(log, ['db:teamsInServer:' + SERVER]);
});

Deno.test('/nudge-missing in a DM is refused at once and reads nothing', async () => {
  const { deps, log } = setup();
  const res = await handle(await signed(sub('officer', 'nudge-missing', { guild_id: undefined })), deps);
  assertEquals(await res.json(), { type: 4, data: { content: NOT_IN_SERVER, flags: 64 } });
  assertEquals(log, []);
});

// Settled after "thinking", since reading the server's teams could take
// Discord's 3 seconds: the refusal edits that answer.
const refusals: [string, Team[], unknown[] | undefined, string][] = [
  ['in a server no team has set', [], undefined, NO_TEAMS],
  ['with no team picked in a server with two', [PHOENIX, HELLFIRE], undefined, PICK_TEAM],
  ["with another server's team", [PHOENIX], [{ name: 'team', value: '9' }], UNKNOWN_TEAM]
];

for (const [what, teams, options, message] of refusals) {
  Deno.test(`/nudge-missing ${what} is refused and nudges nobody`, async () => {
    const { deps, log, calls, settle } = setup({ teams }, [ok()]);
    const res = await handle(await signed(sub('officer', 'nudge-missing', {}, options)), deps);
    assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
    await settle();
    assert(!log.some((l) => l.startsWith('db:hasTeamPermission') || l.startsWith('db:setupStatus')));
    assertEquals(calls.length, 1);
    assert(calls[0].url.endsWith('/messages/@original'));
    assertEquals(JSON.parse(calls[0].body!).content, message);
  });
}

// ── /nudge-missing ────────────────────────────────────────────────────────

Deno.test('/nudge-missing answers "thinking" before any setup read or Discord call', async () => {
  const { deps, log, settle } = setup({}, [dmChannel(), ok(), ok()]);
  const res = await handle(await signed(sub('officer', 'nudge-missing')), deps);
  // Nothing was read before the answer came back, not even the server's teams.
  assertEquals([...log], ['waitUntil']);
  assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
  await settle();
  assertEquals(log.slice(1, 6), [
    'db:teamsInServer:' + SERVER,
    `db:hasTeamPermission:${OFFICER}:1:manage_loot`,
    `db:hasTeamPermission:${OFFICER}:1:view_loot`,
    'db:setupStatus:1',
    `db:nudgedSince:500000000000000005:${new Date(NOW.getTime() - COOLDOWN_MS).toISOString()}`
  ]);
});

Deno.test('/nudge-missing uses the team picked in a server with two', async () => {
  const { deps, log, settle } = setup({ teams: [PHOENIX, HELLFIRE] }, [dmChannel(), ok(), ok()]);
  await handle(await signed(sub('officer', 'nudge-missing', {}, [{ name: 'team', value: '2' }])), deps);
  await settle();
  assert(log.includes('db:setupStatus:2'));
});

Deno.test('/nudge-missing DMs the raider, then records the cooldown, then edits the answer', async () => {
  const { deps, log, calls, recorded, settle } = setup({}, [dmChannel(), ok(), ok()]);
  await handle(await signed(sub('officer', 'nudge-missing')), deps);
  await settle();
  assertEquals(log.slice(6), [
    'fetch:POST /users/@me/channels',
    'fetch:POST /channels/600000000000000006/messages',
    'db:recordNudge:500000000000000005',
    `fetch:PATCH /webhooks/${APP}/interaction-token/messages/@original`
  ]);
  assertEquals(JSON.parse(calls[0].body!), { recipient_id: '500000000000000005' });
  assertEquals(calls[0].headers.authorization, 'Bot bot-token');
  const dm = JSON.parse(calls[1].body!);
  assertEquals(dm.allowed_mentions, { parse: [] });
  assertEquals(dm.embeds[0].title, 'Phoenix -- Setup Reminder');
  assertEquals(dm.embeds[0].fields, [
    { name: 'Update it here', value: 'https://site.test/#profile/Katorr%C3%AD/wishlist' }
  ]);
  assertEquals(recorded, [{ discordId: '500000000000000005', categories: ['no-wishlist'] }]);
  const summary = JSON.parse(calls[2].body!);
  assertEquals(summary.allowed_mentions, { parse: [] });
  assertEquals(summary.embeds[0].fields[0], { name: 'Nudged (1)', value: 'Katorrí-Stormrage' });
});

Deno.test('/nudge-missing skips a raider nudged for the same thing in the last day, whatever the team', async () => {
  const { deps, log, calls, recorded, settle } = setup(
    { recent: [{ discordId: '500000000000000005', category: 'no-wishlist' }] },
    [ok()]
  );
  await handle(await signed(sub('officer', 'nudge-missing')), deps);
  await settle();
  assert(!log.includes('fetch:POST /users/@me/channels'));
  assertEquals(recorded, []);
  assertEquals(JSON.parse(calls[0].body!).embeds[0].fields[1], {
    name: 'Skipped -- nudged in last 24h (1)',
    value: 'Katorrí-Stormrage'
  });
});

Deno.test('/nudge-missing still nudges for a category the last DM did not cover', async () => {
  const { deps, recorded, settle } = setup(
    { rows: [row({ bis_link: null })], recent: [{ discordId: '500000000000000005', category: 'no-wishlist' }] },
    [dmChannel(), ok(), ok()]
  );
  await handle(await signed(sub('officer', 'nudge-missing')), deps);
  await settle();
  assertEquals(recorded, [{ discordId: '500000000000000005', categories: ['no-bis-link'] }]);
});

Deno.test('/nudge-missing: a DM that fails records no cooldown and is listed', async () => {
  const { deps, calls, recorded, settle } = setup({}, [
    dmChannel(),
    new Response('{"code":50007}', { status: 403 }),
    ok()
  ]);
  await handle(await signed(sub('officer', 'nudge-missing')), deps);
  await settle();
  assertEquals(recorded, []);
  const fields = JSON.parse(calls[2].body!).embeds[0].fields;
  assertEquals(fields[2], { name: "Couldn't DM -- DMs closed? (1)", value: 'Katorrí-Stormrage' });
});

for (const held of [[], ['view_loot'], ['manage_loot']]) {
  Deno.test(`/nudge-missing from someone holding only [${held}] reads and DMs nothing`, async () => {
    const { deps, log, calls, settle } = setup({ held }, [ok()]);
    await handle(await signed(sub('officer', 'nudge-missing')), deps);
    await settle();
    assert(!log.includes('db:setupStatus:1'));
    assertEquals(calls.length, 1);
    assertEquals(JSON.parse(calls[0].body!).content, NOT_ALLOWED('Phoenix'));
  });
}

Deno.test("/nudge-missing refused: the answer is an edit of the caller's own reply", async () => {
  const { deps, calls, settle } = setup({ held: [] }, [ok()]);
  await handle(await signed(sub('officer', 'nudge-missing')), deps);
  await settle();
  assert(calls[0].url.endsWith(`/webhooks/${APP}/interaction-token/messages/@original`));
});

Deno.test('/nudge-missing with no member on the interaction is refused the same way', async () => {
  const { deps, log, calls, settle } = setup({}, [ok()]);
  await handle(await signed(sub('officer', 'nudge-missing', { member: undefined })), deps);
  await settle();
  assert(!log.some((l) => l.startsWith('db:hasTeamPermission') || l.startsWith('db:setupStatus')));
  assertEquals(JSON.parse(calls[0].body!).content, NOT_ALLOWED('Phoenix'));
});

Deno.test('/nudge-missing: a failed read still answers the officer', async () => {
  const { deps, calls, settle } = setup({ statusFails: true }, [ok()]);
  await handle(await signed(sub('officer', 'nudge-missing')), deps);
  await settle();
  assertEquals(calls.length, 1);
  assert(calls[0].url.endsWith('/messages/@original'));
  assert(JSON.parse(calls[0].body!).content.startsWith("Couldn't finish the check"));
});

Deno.test('/nudge-missing waits out one 429 and tries again', async () => {
  const { deps, recorded, settle } = setup({}, [
    new Response('{"retry_after":0.5}', { status: 429 }),
    dmChannel(),
    ok(),
    ok()
  ]);
  await handle(await signed(sub('officer', 'nudge-missing')), deps);
  await settle();
  assertEquals(recorded.length, 1);
});

// -- The signup sheet's Refresh button (#960) ----------------------------------

const press = (customId: string) => ({
  type: 3,
  application_id: APP,
  token: 'interaction-token',
  guild_id: SERVER,
  member: { user: { id: OFFICER } },
  data: { custom_id: customId }
});

Deno.test('Refresh answers "the message will change" at once, then edits the sheet for that night', async () => {
  // The bot's emojis first (no application id, so no icons), then the edit.
  const { deps, log, calls, settle } = setup({}, [ok({}), ok({ id: 'm9' })], {
    nights: { '2026-11-05': RAID },
    rows: { '2026-11-05': { channelId: CHANNEL, messageId: 'm9' } }
  });
  const res = await handle(await signed(press('signup-sheet-refresh:1:2026-11-05')), deps);
  assertEquals(await res.json(), { type: 6 });
  assertEquals(log, ['waitUntil']);
  await settle();
  assertEquals(
    calls.map((c) => `${c.method} ${c.url.replace(API, '')}`),
    ['GET /applications/@me', `PATCH /channels/${CHANNEL}/messages/m9`]
  );
  assertEquals(JSON.parse(calls[1].body!).embeds[0].title, 'Phoenix — Signup Sheet');
});

Deno.test('Refresh on a night no sheet is posted for changes nothing', async () => {
  const { deps, calls, settle } = setup({}, [], { nights: { '2026-11-05': RAID } });
  const res = await handle(await signed(press('signup-sheet-refresh:1:2026-11-05')), deps);
  assertEquals(await res.json(), { type: 6 });
  await settle();
  assertEquals(calls.length, 0);
});

// -- The signup sheet's "Set your status" dropdown (#983) --------------------------

const pick = (value: string, date = '2026-11-05') => ({
  ...press(`signup-sheet-status:1:${date}`),
  data: { custom_id: `signup-sheet-status:1:${date}`, values: [value] }
});
const submitNote = (status: string, note: string, date = '2026-11-05') => ({
  ...press(''),
  type: 5,
  data: {
    custom_id: `signup-sheet-note:1:${date}:${status}`,
    components: [{ type: 1, components: [{ type: 4, custom_id: 'note', value: note }] }]
  }
});
const POSTED = { nights: { '2026-11-05': RAID }, rows: { '2026-11-05': { channelId: CHANNEL, messageId: 'm9' } } };
// The reply only the raider sees: the edit of their "thinking" answer.
const reply = (calls: { url: string; body?: string | null }[]) =>
  JSON.parse(calls.find((c) => c.url.endsWith('/messages/@original'))!.body!).content;

Deno.test('picking an answer that wants a reason opens the note pop-up at once, reading nothing', async () => {
  const { deps, log, calls } = setup();
  const res = await handle(await signed(pick('Late')), deps);
  const body = await res.json();
  assertEquals(body.type, 9);
  assertEquals(body.data.custom_id, 'signup-sheet-note:1:2026-11-05:Late');
  assertEquals(body.data.components[0].components[0].required, true);
  assertEquals(log, []);
  assertEquals(calls.length, 0);
});

Deno.test(
  'the note saves the answer for the account that pressed it, then the sheet is brought up to date',
  async () => {
    const { deps, saved, calls, settle } = setup({}, [ok(), ok({}), ok({ id: 'm9' })], POSTED);
    const res = await handle(await signed(submitNote('Late', '  traffic  ')), deps);
    assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
    await settle();
    assertEquals(saved, [[OFFICER, 1, '2026-11-05', 'Late', 'traffic']]);
    assertEquals(reply(calls), SAVED('Late', 'Thursday, November 5'));
    assertEquals(calls[calls.length - 1].method, 'PATCH');
    assert(calls[calls.length - 1].url.endsWith(`/channels/${CHANNEL}/messages/m9`));
  }
);

Deno.test('Clear saves no answer: back to Present on a normal night', async () => {
  const { deps, saved, calls, settle } = setup({}, [ok(), ok({}), ok({ id: 'm9' })], POSTED);
  const res = await handle(await signed(pick('clear')), deps);
  assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
  await settle();
  assertEquals(saved, [[OFFICER, 1, '2026-11-05', null, null]]);
  assertEquals(reply(calls), CLEARED('Thursday, November 5', false));
});

Deno.test('Attending saves at once, with no pop-up', async () => {
  const optional = { nights: { '2026-11-05': { ...RAID, isOptional: true } } };
  const { deps, saved, settle } = setup({}, [ok()], optional);
  const res = await handle(await signed(pick('Attending')), deps);
  assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
  await settle();
  assertEquals(saved, [[OFFICER, 1, '2026-11-05', 'Attending', null]]);
});

Deno.test("the database's refusal is told in plain words, and the sheet is left alone", async () => {
  const { deps, calls, settle } = setup({ rsvpRefusal: 'Bench players cannot set an RSVP status.' }, [ok()], POSTED);
  await handle(await signed(pick('clear')), deps);
  await settle();
  assertEquals(reply(calls), BENCH);
  assertEquals(calls.length, 1);
});

Deno.test('a sheet that fails to refresh still tells the raider their answer saved', async () => {
  const { deps, calls, settle } = setup({}, [ok()], POSTED);
  deps.sheets.teamSheets = () => Promise.reject(new Error('read failed'));
  await handle(await signed(pick('clear')), deps);
  await settle();
  assertEquals(reply(calls), CLEARED('Thursday, November 5', false));
  assertEquals(calls.length, 1);
});

Deno.test('a raid that has passed is refused before anything is saved', async () => {
  const { deps, saved, calls, settle } = setup({}, [ok()], { nights: { '2026-10-27': RAID } });
  await handle(await signed(submitNote('Absent', 'sick', '2026-10-27')), deps);
  await settle();
  assertEquals(saved, []);
  assertEquals(reply(calls), RAID_OVER);
});

Deno.test('a pick the dropdown never offers is refused', async () => {
  const { deps, saved } = setup();
  const res = await handle(await signed(pick('Present')), deps);
  assertEquals((await res.json()).data.content, UNKNOWN_COMMAND);
  assertEquals(saved, []);
});

// -- The team box on every command (#961) ---------------------------------------

Deno.test('the team box works the same under /raider', async () => {
  const { deps } = setup({ teams: [HELLFIRE, PHOENIX] });
  const res = await handle(
    await signed({ ...sub('raider', 'me', {}, [{ name: 'team', value: 'hell', focused: true }]), type: 4 }),
    deps
  );
  assertEquals(await res.json(), { type: 8, data: { choices: [{ name: 'Hellfire Rollers', value: '2' }] } });
});

// -- Refusals, for each new command ------------------------------------------------

// What one command answered, once its work has run: the last call is the
// edit of the caller's own "thinking" answer.
async function answer(interaction: unknown, state: State = {}, discord: Response[] = [ok()], sheetState?: SheetState) {
  const s = setup(state, discord, sheetState);
  const res = await handle(await signed(interaction), s.deps);
  assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
  assertEquals(s.log[0], 'waitUntil');
  await s.settle();
  const last = s.calls[s.calls.length - 1];
  assert(last.url.endsWith(`/webhooks/${APP}/interaction-token/messages/@original`));
  return { ...s, body: JSON.parse(last.body!) };
}

const NEW_COMMANDS: [string, string, string][] = [
  ['/raider me', 'raider', 'me'],
  ['/raider schedule', 'raider', 'schedule'],
  ['/officer invite', 'officer', 'invite']
];

for (const [name, group, subName] of NEW_COMMANDS) {
  Deno.test(`${name} with another server's team is refused before reading who's asking`, async () => {
    const { body, log } = await answer(sub(group, subName, {}, [{ name: 'team', value: '9' }]));
    assertEquals(body.content, UNKNOWN_TEAM);
    assert(!log.some((l) => l.startsWith('db:member') || l.startsWith('db:hasTeamPermission')));
  });

  Deno.test(`${name} with no team picked in a server with two is refused`, async () => {
    const { body } = await answer(sub(group, subName), { teams: [PHOENIX, HELLFIRE] });
    assertEquals(body.content, PICK_TEAM);
  });

  Deno.test(`${name} in a server no team has set is refused`, async () => {
    const { body } = await answer(sub(group, subName), { teams: [] });
    assertEquals(body.content, NO_TEAMS);
  });

  Deno.test(`${name} in a DM is refused at once and reads nothing`, async () => {
    const { deps, log } = setup();
    const res = await handle(await signed(sub(group, subName, { guild_id: undefined })), deps);
    assertEquals(await res.json(), { type: 4, data: { content: NOT_IN_SERVER, flags: 64 } });
    assertEquals(log, []);
  });
}

for (const [name, group, subName] of NEW_COMMANDS.slice(0, 2)) {
  Deno.test(`${name} from a Discord account on no profile points them to claim one`, async () => {
    const { body, log } = await answer(sub(group, subName), { member: null });
    assertEquals(body.content, NO_PROFILE('https://site.test'));
    assert(!log.some((l) => l.startsWith('db:setupStatus') || l.startsWith('db:awards')));
  });

  Deno.test(`${name} from someone not on the team is refused`, async () => {
    const { body, log } = await answer(sub(group, subName), { member: { ...KAT, onTeam: false } });
    assertEquals(body.content, NOT_ON_TEAM('Phoenix'));
    assert(!log.some((l) => l.startsWith('db:setupStatus') || l.startsWith('db:awards')));
  });

  Deno.test(`${name} with no member on the interaction is treated as no profile`, async () => {
    const { body, log } = await answer(sub(group, subName, { member: undefined }));
    assertEquals(body.content, NO_PROFILE('https://site.test'));
    assert(!log.some((l) => l.startsWith('db:member')));
  });
}

// -- /raider me ----------------------------------------------------------------------

Deno.test('/raider me shows only their own wishlist, their signup and what they received', async () => {
  const { body, log } = await answer(sub('raider', 'me'), {
    rows: [
      row({ missing_bis_rows: ['Neck', 'Back'], wishlist_count: 14 }),
      row({ player_id: 2, name_realm: 'Someone-Else', wishlist_count: 0 })
    ],
    signup: { seasonName: 'Midnight Season 2', status: 'pending' },
    awards: [
      { itemName: 'Old Ring', awardedAt: '2026-10-20T02:00:00Z', response: 'BiS' },
      { itemName: 'Pretty Hat', awardedAt: '2026-10-28T02:00:00Z', response: 'Xmog' },
      { itemName: 'Shiny Trinket', awardedAt: '2026-10-27T02:00:00Z', response: 'Upgrade' }
    ]
  });
  assert(log.includes(`db:member:${OFFICER}:1`));
  assert(log.includes('db:awards:1:1'));
  const [embed] = body.embeds;
  assertEquals(embed.title, 'Phoenix -- Your loot setup');
  assertEquals(embed.fields, [
    { name: 'Wishlist', value: '**Midnight Season 1**: missing a BiS pick for Neck, Back.' },
    { name: 'Season signup', value: 'Midnight Season 2: signed up, waiting for an officer.' },
    {
      name: 'Items received',
      value: `2 this season. Last: Shiny Trinket, <t:${Date.parse('2026-10-27T02:00:00Z') / 1000}:R>.`
    }
  ]);
  assertEquals(
    body.components[0].components.map((b: { label: string; url: string }) => [b.label, b.url]),
    [
      ['Fix my wishlist', 'https://site.test/#profile/Katorr%C3%AD/wishlist'],
      ['Open my profile', 'https://site.test/#profile/Katorr%C3%AD']
    ]
  );
  // No priority score anywhere.
  assert(!JSON.stringify(body).toLowerCase().includes('priority'));
  assertEquals(body.allowed_mentions, { parse: [] });
});

Deno.test('/raider me with nothing set up yet says so for each part', async () => {
  const { body } = await answer(sub('raider', 'me'), { rows: [], signup: null, awards: [] });
  assertEquals(
    body.embeds[0].fields.map((f: { value: string }) => f.value),
    ['No wishlist is open for you right now.', "Signups for the next season aren't open.", 'None yet this season.']
  );
});

Deno.test('/raider me: a season open but no signup, and a wishlist complete', async () => {
  const { body } = await answer(sub('raider', 'me'), {
    rows: [row({ wishlist_count: 16 })],
    signup: { seasonName: 'Midnight Season 2', status: null }
  });
  assertEquals(body.embeds[0].fields[0].value, '**Midnight Season 1**: every slot has a BiS pick.');
  assertEquals(body.embeds[0].fields[1].value, 'Not signed up for Midnight Season 2 yet.');
});

Deno.test("/raider me counts by the team's saved response list once there is one", async () => {
  const { body } = await answer(sub('raider', 'me'), {
    awards: [
      { itemName: 'A', awardedAt: '2026-10-20T02:00:00Z', response: 'BiS' },
      { itemName: 'B', awardedAt: '2026-10-21T02:00:00Z', response: 'OS' },
      { itemName: 'C', awardedAt: '2026-10-22T02:00:00Z', response: 'Something unlisted' }
    ],
    list: {
      buttons: [
        { text: 'bis', countsAs: 'main' },
        { text: 'OS', countsAs: 'off' }
      ],
      groups: []
    }
  });
  // Off spec counts only while no list is saved; an unlisted response is Hidden.
  assert(body.embeds[0].fields[2].value.startsWith('1 this season. Last: A,'));
});

Deno.test('/raider me: a failed read answers "try again", not silence', async () => {
  const { body } = await answer(sub('raider', 'me'), { statusFails: true });
  assertEquals(body.content, BROKE);
});

// -- /raider schedule --------------------------------------------------------------------

Deno.test('/raider schedule lists the coming nights with their own answer, dropping one that started', async () => {
  const optional = { ...RAID, isOptional: true };
  // Sunday's night (yesterday, 9 PM ET) has started; Tuesday's and
  // Thursday's are ahead.
  const { body } = await answer(sub('raider', 'schedule'), {}, [ok()], {
    nights: { '2026-11-01': RAID, '2026-11-03': RAID, '2026-11-05': optional }
  });
  const tue = Date.parse('2026-11-04T02:00:00Z') / 1000;
  const thu = Date.parse('2026-11-06T02:00:00Z') / 1000;
  assertEquals(body.embeds[0].title, 'Phoenix -- Your next raid nights');
  assertEquals(body.embeds[0].description, `<t:${tue}:F>: **Present**\n<t:${thu}:F> (optional): **No response**`);
});

Deno.test("/raider schedule shows their RSVP, not someone else's", async () => {
  const { body } = await answer(sub('raider', 'schedule'), {}, [ok()], {
    nights: { '2026-11-03': RAID },
    rsvps: [
      { playerId: 2, status: 'Absent' },
      { playerId: 1, status: 'Late' }
    ]
  });
  assert(body.embeds[0].description.endsWith('**Late**'));
});

Deno.test('/raider schedule with no nights ahead says so', async () => {
  const { body } = await answer(sub('raider', 'schedule'), {}, [ok()], { nights: {} });
  assertEquals(body.embeds[0].description, 'No raid nights in the next two weeks.');
});

// -- /officer invite ---------------------------------------------------------------------

Deno.test('/officer invite settles the "thinking" answer, then posts the link for the channel', async () => {
  const { deps, calls, log, settle } = setup({ held: ['edit_roster'] }, [ok(), ok()]);
  await handle(await signed(sub('officer', 'invite')), deps);
  await settle();
  assert(log.includes(`db:hasTeamPermission:${OFFICER}:1:edit_roster`));
  // Discord takes the first follow-up after "thinking" as an edit of it, still
  // only the caller's, so the edit has to come first.
  assertEquals(
    calls.map((c) => `${c.method} ${c.url.replace(API, '')}`),
    [`PATCH /webhooks/${APP}/interaction-token/messages/@original`, `POST /webhooks/${APP}/interaction-token`]
  );
  assertEquals(JSON.parse(calls[0].body!).content, INVITE_POSTED('Phoenix'));
  const post = JSON.parse(calls[1].body!);
  assertEquals(post.content, 'Join **Phoenix** on Raid Hub: https://site.test/join/phoenix-abc123');
  // Not "only you": the channel sees it.
  assertEquals(post.flags, undefined);
  assertEquals(post.allowed_mentions, { parse: [] });
});

Deno.test('/officer invite from someone who cannot edit the roster posts nothing', async () => {
  const { body, calls, log } = await answer(sub('officer', 'invite'), { held: ['manage_loot', 'view_loot'] });
  assertEquals(calls.length, 1);
  assertEquals(body.content, INVITE_NOT_ALLOWED('Phoenix'));
  assert(!log.includes('db:inviteCode:1'));
});

Deno.test('/officer invite with no member on the interaction posts nothing', async () => {
  const { body, calls } = await answer(sub('officer', 'invite', { member: undefined }), { held: ['edit_roster'] });
  assertEquals(calls.length, 1);
  assertEquals(body.content, INVITE_NOT_ALLOWED('Phoenix'));
});

Deno.test('/officer invite with no live link says where to make one', async () => {
  const { body, calls } = await answer(sub('officer', 'invite'), { held: ['edit_roster'], invite: null });
  assertEquals(calls.length, 1);
  assertEquals(body.content, NO_INVITE('Phoenix'));
});

Deno.test('/officer invite: a post Discord refuses is not reported as posted', async () => {
  const { body, calls } = await answer(sub('officer', 'invite'), { held: ['edit_roster'] }, [
    ok(),
    new Response('{}', { status: 403 }),
    ok()
  ]);
  assertEquals(calls.length, 3);
  assertEquals(body.content, BROKE);
});

// -- /officer post lineup (#1709) ------------------------------------------------------------

const postLineup = (options: unknown[] = []) =>
  command('officer', {}, [{ type: 2, name: 'post', options: [{ type: 1, name: 'lineup', options }] }]);
const lineupDb = (): LineupDb => ({
  allLineups: () => Promise.resolve([]),
  teamLineup: () =>
    Promise.resolve({
      team: { id: 1, name: 'Phoenix', slug: 'phoenix', serverId: SERVER, quietHours: null },
      setting: { channelId: CHANNEL, pingRoleId: null, weekday: 3, time: '18:00:00', timezone: 'America/New_York' }
    }),
  night: () => Promise.resolve(RAID),
  roster: () => Promise.resolve([]),
  bosses: () => Promise.resolve([{ name: "Nek'zali", position: 1, playerIds: [] }]),
  postedLineup: () => Promise.resolve(null),
  saveLineup: () => Promise.resolve(true),
  updateLineup: () => Promise.resolve(),
  markPosted: () => Promise.resolve()
});

Deno.test('/officer post lineup from someone who cannot edit the schedule posts nothing', async () => {
  const { body, calls, log } = await answer(postLineup(), { held: ['edit_roster'] });
  assert(log.includes(`db:hasTeamPermission:${OFFICER}:1:edit_schedule`));
  assertEquals(calls.length, 1);
  assertEquals(body.content, LINEUP_NOT_ALLOWED('Phoenix'));
});

Deno.test('/officer post lineup refuses a date it cannot read', async () => {
  const { body } = await answer(postLineup([{ name: 'date', value: '2026-02-31' }]), { held: ['edit_schedule'] });
  assertEquals(body.content, LINEUP_BAD_DATE);
});

Deno.test('/officer post lineup posts the night given to the lineup channel, then says so', async () => {
  const s = setup({ held: ['edit_schedule'] }, [ok({ id: CHANNEL, guild_id: SERVER }), ok({ id: 'm1' }), ok()]);
  s.deps.lineups = lineupDb();
  await handle(await signed(postLineup([{ name: 'date', value: '2026-11-05' }])), s.deps);
  await s.settle();
  assertEquals(
    s.calls.map((c) => `${c.method} ${c.url.replace(API, '')}`),
    [
      `GET /channels/${CHANNEL}`,
      `POST /channels/${CHANNEL}/messages`,
      `PATCH /webhooks/${APP}/interaction-token/messages/@original`
    ]
  );
  assertEquals(JSON.parse(s.calls[2].body!).content, LINEUP_POSTED('Phoenix', 'Thursday, November 5'));
});

// -- /help -------------------------------------------------------------------------------

Deno.test("/help lists the server's teams, where their posts go, and only the caller's commands", async () => {
  const { body } = await answer(command('help'), {
    held: ['edit_roster'],
    posts: [{ kind: 'officer_requests', channelId: '800000000000000008' }]
  });
  const [embed] = body.embeds;
  assertEquals(
    embed.fields[0].value,
    `**Phoenix**\n- Signup sheets: <#${CHANNEL}>\n- Officer requests: <#800000000000000008>`
  );
  assertEquals(
    embed.fields[1].value,
    [
      '`/help` -- this message',
      '`/raider me` -- your wishlist, season signup and items received',
      '`/raider schedule` -- your next raid nights and your RSVP for each',
      "`/officer invite` -- post the team's invite link"
    ].join('\n')
  );
  assertEquals(embed.footer.text, `The bot was last updated in Raid Hub release ${VERSION}.`);
});

Deno.test("/help shows a team's channels only to people on it, its name to anyone", async () => {
  const { body, log } = await answer(command('help'), {
    teams: [HELLFIRE, PHOENIX],
    member: { ...KAT, onTeam: false },
    posts: [{ kind: 'officer_requests', channelId: '800000000000000008' }]
  });
  assertEquals(body.embeds[0].fields[0].value, '**Hellfire Rollers**\n\n**Phoenix**');
  assert(!log.some((l) => l.startsWith('db:posts')));
});

Deno.test('/help shows /officer nudge-missing only with both loot permissions', async () => {
  const { body } = await answer(command('help'), { member: { ...KAT, onTeam: false } });
  assertEquals(
    body.embeds[0].fields[1].value,
    '`/help` -- this message\n`/officer nudge-missing` -- DM raiders whose loot setup is missing something'
  );
});

Deno.test('/help for a Discord account on no profile lists only /help', async () => {
  const { body, log } = await answer(command('help'), { member: null });
  assertEquals(body.embeds[0].fields[1].value, '`/help` -- this message');
  assert(!log.some((l) => l.startsWith('db:hasTeamPermission')));
});

Deno.test('/help in a server no team has set says so', async () => {
  const { body } = await answer(command('help'), { teams: [] });
  assertEquals(body.embeds[0].fields[0].value, 'No team has set this Discord server on Settings › Discord yet.');
});
