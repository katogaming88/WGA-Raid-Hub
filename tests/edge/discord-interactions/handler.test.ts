// discord-interactions' handler (#998): the signature check before anything
// else, PING, the team a command is for, and /nudge-missing answering
// "thinking" before it reads or posts anything, then DMing each raider and
// recording the cooldown only after a DM went out.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  COOLDOWN_MS,
  type Deps,
  type InteractionsDb,
  NO_TEAMS,
  NOT_IN_SERVER,
  PICK_TEAM,
  type Team,
  UNKNOWN_COMMAND,
  NOT_ALLOWED,
  UNKNOWN_TEAM,
  handle,
  verifySignature
} from '../../../supabase/functions/discord-interactions/handler.ts';
import type { NudgeCategory, WishlistSetupStatusRow } from '../../../supabase/functions/discord-interactions/nudge.ts';
import { VERSION } from '../../../supabase/functions/discord-interactions/version.ts';
import { recordingFetch } from '../_support/fetch.ts';

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
  // Whether the caller holds Manage loot on the team; true unless set.
  allowed?: boolean;
};

// One log for the database and Discord both, so the order between them is
// an assertion.
function setup(state: State = {}, discord: Response[] = []) {
  const log: string[] = [];
  const recorded: { discordId: string; categories: NudgeCategory[] }[] = [];
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
      return Promise.resolve(state.allowed ?? true);
    },
    recordNudge(discordId, categories) {
      log.push('db:recordNudge:' + discordId);
      recorded.push({ discordId, categories });
      return Promise.resolve();
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
    now: () => NOW,
    sleep: () => Promise.resolve(),
    waitUntil: (work) => {
      log.push('waitUntil');
      pending.push(work);
    }
  };
  return { deps, log, calls: rec.calls, recorded, settle: () => Promise.all(pending) };
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
    const body = JSON.stringify(command('nudge-missing'));
    const req = await signed(command('nudge-missing'), await headers(body));
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

Deno.test('/about answers the version, only to the caller', async () => {
  const { deps, log } = setup();
  const res = await handle(await signed(command('about')), deps);
  assertEquals(await res.json(), {
    type: 4,
    data: { content: `The bot was last updated in Raid Hub release ${VERSION}.`, flags: 64 }
  });
  assertEquals(log, []);
});

Deno.test('an unknown command is refused, only to the caller', async () => {
  const { deps } = setup();
  const res = await handle(await signed(command('fairness')), deps);
  assertEquals(await res.json(), { type: 4, data: { content: UNKNOWN_COMMAND, flags: 64 } });
});

Deno.test('a button this bot does not know yet is refused, only to the caller', async () => {
  const { deps } = setup();
  const res = await handle(
    await signed({ ...command('x'), type: 3, data: { custom_id: 'signup-sheet-refresh:1:2026-11-03' } }),
    deps
  );
  assertEquals(await res.json(), { type: 4, data: { content: UNKNOWN_COMMAND, flags: 64 } });
});

Deno.test("the team box lists this server's teams, filtered by what's typed", async () => {
  const { deps, log } = setup({ teams: [HELLFIRE, PHOENIX] });
  const res = await handle(
    await signed({
      ...command('nudge-missing'),
      type: 4,
      data: { name: 'nudge-missing', options: [{ name: 'team', value: 'pho', focused: true }] }
    }),
    deps
  );
  assertEquals(await res.json(), { type: 8, data: { choices: [{ name: 'Phoenix', value: '1' }] } });
  assertEquals(log, ['db:teamsInServer:' + SERVER]);
});

const refusals: [string, Record<string, unknown>, Team[], unknown[] | undefined, string][] = [
  ['in a DM', { guild_id: undefined }, [PHOENIX], undefined, NOT_IN_SERVER],
  ['in a server no team has set', {}, [], undefined, NO_TEAMS],
  ['with no team picked in a server with two', {}, [PHOENIX, HELLFIRE], undefined, PICK_TEAM],
  ["with another server's team", {}, [PHOENIX], [{ name: 'team', value: '9' }], UNKNOWN_TEAM]
];

for (const [what, over, teams, options, message] of refusals) {
  Deno.test(`/nudge-missing ${what} is refused and nudges nobody`, async () => {
    const { deps, log } = setup({ teams });
    const res = await handle(await signed(command('nudge-missing', over, options)), deps);
    assertEquals(await res.json(), { type: 4, data: { content: message, flags: 64 } });
    assert(!log.includes('waitUntil'));
    assert(!log.some((l) => l.startsWith('fetch:')));
  });
}

// ── /nudge-missing ────────────────────────────────────────────────────────

Deno.test('/nudge-missing answers "thinking" before any setup read or Discord call', async () => {
  const { deps, log, settle } = setup({}, [dmChannel(), ok(), ok()]);
  const res = await handle(await signed(command('nudge-missing')), deps);
  // Nothing but the server's teams was read before the answer came back.
  assertEquals([...log], ['db:teamsInServer:' + SERVER, 'waitUntil']);
  assertEquals(await res.json(), { type: 5, data: { flags: 64 } });
  await settle();
  assertEquals(log.slice(2, 5), [
    `db:hasTeamPermission:${OFFICER}:1:manage_loot`,
    'db:setupStatus:1',
    `db:nudgedSince:500000000000000005:${new Date(NOW.getTime() - COOLDOWN_MS).toISOString()}`
  ]);
});

Deno.test('/nudge-missing uses the team picked in a server with two', async () => {
  const { deps, log, settle } = setup({ teams: [PHOENIX, HELLFIRE] }, [dmChannel(), ok(), ok()]);
  await handle(await signed(command('nudge-missing', {}, [{ name: 'team', value: '2' }])), deps);
  await settle();
  assert(log.includes('db:setupStatus:2'));
});

Deno.test('/nudge-missing DMs the raider, then records the cooldown, then edits the answer', async () => {
  const { deps, log, calls, recorded, settle } = setup({}, [dmChannel(), ok(), ok()]);
  await handle(await signed(command('nudge-missing')), deps);
  await settle();
  assertEquals(log.slice(5), [
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
  await handle(await signed(command('nudge-missing')), deps);
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
  await handle(await signed(command('nudge-missing')), deps);
  await settle();
  assertEquals(recorded, [{ discordId: '500000000000000005', categories: ['no-bis-link'] }]);
});

Deno.test('/nudge-missing: a DM that fails records no cooldown and is listed', async () => {
  const { deps, calls, recorded, settle } = setup({}, [
    dmChannel(),
    new Response('{"code":50007}', { status: 403 }),
    ok()
  ]);
  await handle(await signed(command('nudge-missing')), deps);
  await settle();
  assertEquals(recorded, []);
  const fields = JSON.parse(calls[2].body!).embeds[0].fields;
  assertEquals(fields[2], { name: "Couldn't DM -- DMs closed? (1)", value: 'Katorrí-Stormrage' });
});

Deno.test("/nudge-missing from someone who doesn't manage the team's loot reads and DMs nothing", async () => {
  const { deps, log, calls, settle } = setup({ allowed: false }, [ok()]);
  await handle(await signed(command('nudge-missing')), deps);
  await settle();
  assert(!log.includes('db:setupStatus:1'));
  assertEquals(calls.length, 1);
  assert(calls[0].url.endsWith('/messages/@original'));
  assertEquals(JSON.parse(calls[0].body!).content, NOT_ALLOWED('Phoenix'));
});

Deno.test('/nudge-missing with no member on the interaction is refused the same way', async () => {
  const { deps, log, calls, settle } = setup({}, [ok()]);
  await handle(await signed(command('nudge-missing', { member: undefined })), deps);
  await settle();
  assert(!log.some((l) => l.startsWith('db:hasTeamPermission') || l.startsWith('db:setupStatus')));
  assertEquals(JSON.parse(calls[0].body!).content, NOT_ALLOWED('Phoenix'));
});

Deno.test('/nudge-missing: a failed read still answers the officer', async () => {
  const { deps, calls, settle } = setup({ statusFails: true }, [ok()]);
  await handle(await signed(command('nudge-missing')), deps);
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
  await handle(await signed(command('nudge-missing')), deps);
  await settle();
  assertEquals(recorded.length, 1);
});
