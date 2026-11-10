// character-stats' handler against injected dependencies: the gate that the
// token and the character are the caller's own, each number failing on its
// own, and the cache sparing Warcraft Logs a second read.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  API_BASE,
  BLIZZARD_DOWN,
  CACHE_MS,
  type Cached,
  type Deps,
  EXPIRED,
  NOT_CONNECTED,
  NOT_YOUR_CHARACTER,
  NOT_YOURS,
  USERINFO_URL,
  WCL_API,
  WCL_TOKEN_URL,
  handle
} from '../../../supabase/functions/character-stats/handler.ts';
import { PROFILE } from '../battlenet-characters/characters.test.ts';

const AUTH = 'Bearer caller-jwt';
const BNET_ID = '777';
// Grihz on Illidan in the captured PROFILE.
const GRIHZ = 101;

type Route = (init: RequestInit | undefined) => Response | Promise<Response>;
const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response('', { status: code });

const GRIHZ_PATH = '/profile/wow/character/illidan/grihz';
const RANKINGS = {
  heroic: { bestPerformanceAverage: 91.4, medianPerformanceAverage: 80.2, rankings: [] },
  mythic: {
    bestPerformanceAverage: 62.5,
    medianPerformanceAverage: null,
    rankings: [{ totalKills: 3 }, { totalKills: 1 }, { totalKills: 0 }]
  }
};

function routes(): Record<string, Route> {
  return {
    [USERINFO_URL]: () => jsonOk({ sub: BNET_ID }),
    [API_BASE + '/profile/user/wow']: () => jsonOk(PROFILE),
    [API_BASE + GRIHZ_PATH]: () => jsonOk({ active_spec: { name: 'Restoration' }, equipped_item_level: 704 }),
    [API_BASE + GRIHZ_PATH + '/mythic-keystone-profile']: () => jsonOk({ current_mythic_rating: { rating: 2534.6 } }),
    [WCL_TOKEN_URL]: () => jsonOk({ access_token: 'wcl' }),
    [WCL_API]: () => jsonOk({ data: { characterData: { character: RANKINGS } } })
  };
}

function setup(over: Partial<Record<string, Route>> = {}, linked: string | null = BNET_ID) {
  const table = { ...routes(), ...over };
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input).split('?')[0];
    calls.push(url);
    const route = table[url];
    if (!route) throw new Error('unrouted ' + url);
    return await route(init);
  }) as typeof globalThis.fetch;
  let clock = 1_000;
  const deps: Deps & { tick(ms: number): void } = {
    fetch,
    db: {
      getUser: () => Promise.resolve({ id: 'u1' }),
      battlenetAccountId: () => Promise.resolve(linked),
      seasonZone: () => Promise.resolve({ wcl_zone_id: 53, name: 'The Venomous Abyss' })
    },
    wcl: { clientId: 'id', clientSecret: 'secret' },
    cache: new Map<string, Cached>(),
    now: () => clock,
    tick: (ms) => (clock += ms)
  };
  return { deps, calls };
}

const post = (body: unknown) =>
  new Request('http://edge.test/functions/v1/character-stats', {
    method: 'POST',
    headers: { Authorization: AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

async function call(deps: Deps, body: unknown = { token: 'tok', character: GRIHZ }) {
  const res = await handle(post(body), deps);
  return { status: res.status, body: await res.json() };
}

Deno.test('returns every number for a character on the caller account', async () => {
  const { deps } = setup();
  const { status: code, body } = await call(deps);
  assertEquals(code, 200);
  assertEquals(body.character, {
    blizzard_id: GRIHZ,
    name: 'Grihz',
    realm: 'Illidan',
    realm_slug: 'illidan',
    class_name: 'Shaman',
    spec_name: 'Restoration',
    item_level: 704,
    mplus_score: 2535,
    raid: 'The Venomous Abyss',
    heroic_logs: { best: 91.4, median: 80.2 },
    mythic_logs: { best: 62.5, median: null },
    mythic_bosses_killed: { killed: 2, total: 3 },
    links: {
      warcraftlogs: 'https://www.warcraftlogs.com/character/us/illidan/grihz',
      raiderio: 'https://raider.io/characters/us/illidan/grihz',
      armory: 'https://worldofwarcraft.blizzard.com/en-us/character/us/illidan/grihz'
    }
  });
});

Deno.test('refuses a character that is not on the caller account, before any stats read', async () => {
  const { deps, calls } = setup();
  const { status: code, body } = await call(deps, { token: 'tok', character: 999999 });
  assertEquals([code, body.error], [403, NOT_YOUR_CHARACTER]);
  assertEquals(calls, [USERINFO_URL, API_BASE + '/profile/user/wow']);
});

Deno.test('refuses a token from someone else’s Battle.net login', async () => {
  const { deps, calls } = setup({ [USERINFO_URL]: () => jsonOk({ sub: '888' }) });
  const { status: code, body } = await call(deps);
  assertEquals([code, body.error], [403, NOT_YOURS]);
  assertEquals(calls, [USERINFO_URL]);
});

Deno.test('refuses without Battle.net connected, a sign-in, a token or a character', async () => {
  assertEquals((await call(setup({}, null).deps)).body.error, NOT_CONNECTED);
  const noAuth = await handle(new Request('http://edge.test/x', { method: 'POST', body: '{}' }), setup().deps);
  assertEquals(noAuth.status, 401);
  assertEquals((await call(setup().deps, { character: GRIHZ })).body.error, 'Missing token');
  assertEquals((await call(setup().deps, { token: 'tok', character: '101' })).body.error, 'Missing character');
});

Deno.test('an expired token and a Blizzard outage at the gate are refused', async () => {
  assertEquals((await call(setup({ [USERINFO_URL]: () => status(401) }).deps)).body.error, EXPIRED);
  assertEquals(
    (await call(setup({ [API_BASE + '/profile/user/wow']: () => status(503) }).deps)).body.error,
    BLIZZARD_DOWN
  );
});

Deno.test('each source fails on its own without failing the rest', async () => {
  const down = () => status(503);
  const summary = (await call(setup({ [API_BASE + GRIHZ_PATH]: down }).deps)).body.character;
  assertEquals([summary.item_level, summary.spec_name, summary.mplus_score], [null, null, 2535]);
  const summaryFailed = (await call(setup({ [API_BASE + GRIHZ_PATH]: down }).deps)).body.failed;
  assertEquals(summaryFailed, ['blizzard_profile']);

  const keys = (await call(setup({ [API_BASE + GRIHZ_PATH + '/mythic-keystone-profile']: down }).deps)).body.character;
  assertEquals([keys.mplus_score, keys.item_level, keys.heroic_logs.best], [null, 704, 91.4]);

  const wcl = (
    await call(
      setup({
        [WCL_API]: () => {
          throw new Error('timeout');
        }
      }).deps
    )
  ).body.character;
  assertEquals([wcl.heroic_logs, wcl.mythic_logs, wcl.mythic_bosses_killed, wcl.item_level], [null, null, null, 704]);

  const keysFailed = (await call(setup({ [API_BASE + GRIHZ_PATH + '/mythic-keystone-profile']: down }).deps)).body;
  assertEquals(keysFailed.failed, ['mythic_keystone']);
  const wclFailed = (await call(setup({ [WCL_API]: down }).deps)).body;
  assertEquals(wclFailed.failed, ['warcraft_logs']);
});

Deno.test('a full answer names no failed source', async () => {
  assertEquals((await call(setup().deps)).body.failed, []);
});

Deno.test('the season raid read failing marks the logs failed, and the rest arrive', async () => {
  const { deps, calls } = setup();
  deps.db.seasonZone = () => Promise.reject(new Error('db down'));
  const { body } = await call(deps);
  assertEquals([body.failed, body.character.heroic_logs, body.character.item_level], [['warcraft_logs'], null, 704]);
  assertEquals(calls.includes(WCL_API), false);
});

Deno.test('no season raid yet is nothing to show, not a failure', async () => {
  const { deps, calls } = setup();
  deps.db.seasonZone = () => Promise.resolve(null);
  const { body } = await call(deps);
  assertEquals([body.failed, body.character.raid, body.character.heroic_logs], [[], null, null]);
  assertEquals(calls.includes(WCL_API), false);
});

Deno.test('a throw at the gate answers 502 with the CORS headers, not a bare runtime 500', async () => {
  for (const breakIt of [
    (d: Deps) => (d.db.getUser = () => Promise.reject(new Error('db down'))),
    (d: Deps) => (d.db.battlenetAccountId = () => Promise.reject(new Error('rpc'))),
    (d: Deps) => (d.fetch = (() => Promise.reject(new TypeError('network'))) as typeof globalThis.fetch)
  ]) {
    const { deps } = setup();
    breakIt(deps);
    const res = await handle(post({ token: 'tok', character: GRIHZ }), deps);
    assertEquals(
      [res.status, res.headers.get('Access-Control-Allow-Origin'), (await res.json()).error],
      [502, '*', BLIZZARD_DOWN]
    );
  }
});

Deno.test('nothing to show is null too: no keys, logs Warcraft Logs never saw', async () => {
  const { deps } = setup({
    [API_BASE + GRIHZ_PATH + '/mythic-keystone-profile']: () => status(404),
    [WCL_API]: () => jsonOk({ data: { characterData: { character: null } } })
  });
  const c = (await call(deps)).body.character;
  assertEquals([c.mplus_score, c.heroic_logs, c.mythic_bosses_killed, c.item_level], [null, null, null, 704]);
});

Deno.test('a full answer is cached for ten minutes; the gate still runs each time', async () => {
  const { deps, calls } = setup();
  await call(deps);
  const first = calls.length;
  await call(deps);
  assertEquals(calls.slice(first), [USERINFO_URL, API_BASE + '/profile/user/wow']);
  deps.tick(CACHE_MS);
  await call(deps);
  assertEquals(calls.filter((u) => u === WCL_API).length, 2);
});

Deno.test('an answer with a failed source is not cached', async () => {
  const { deps, calls } = setup({ [WCL_API]: () => status(500) });
  await call(deps);
  await call(deps);
  assertEquals(calls.filter((u) => u === WCL_API).length, 2);
});
