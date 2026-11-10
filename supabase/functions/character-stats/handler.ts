// character-stats (#1538): an applicant's numbers for one of their own
// characters, so the application form fills them in and nobody types them.
//
// POST { token, character }. `token` is the Battle.net access token the app
// holds after a Battle.net sign-in, as battlenet-characters takes it;
// `character` is a Blizzard character id from that function's list. The gate
// is the same one: Blizzard says whose token it is, it must be the login
// linked to the caller's account, and the character must be on that login's
// own list. Anyone else's character is refused.
//
// Each number is read on its own, and one that fails or has nothing comes back
// null rather than failing the rest:
//   item level, spec       Blizzard profile summary
//   class, name, realm     the account list the gate already read
//   M+ score               Blizzard Mythic Keystone profile, current season
//   logs, Heroic + Mythic  Warcraft Logs zoneRankings on the season's raid
//   Mythic bosses killed   the same Mythic zoneRankings: bosses with a kill
//
// "The season's raid" is current_season()'s first raid zone that is not a mini
// raid, the zone the Season tab's performance fetch reads. Bosses killed come
// from logs, so a kill nobody logged does not count (Blizzard's encounter list
// names raids by text, not by Warcraft Logs zone, so it cannot be matched
// without guessing). The rankings use Warcraft Logs' default metric, which is
// healing for a healer, rather than the Season tab's dps-only one: an
// applicant can be any role.
//
// A full answer is kept for CACHE_MS per character, so the form re-asking on
// every click costs no Warcraft Logs points. The gate runs every time.
import {
  type AccountCharacter,
  battlenetAccountIdOf,
  charactersOf,
  detailOf,
  summaryPath
} from '../_shared/battlenet.ts';
import { gqlInt, gqlString } from '../_shared/gql.ts';
import { VERSION } from './version.ts';

export interface StatsDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  battlenetAccountId(userId: string): Promise<string | null>;
  // The season's raid zone, or null when no season has a raid yet.
  seasonZone(): Promise<{ wcl_zone_id: number; name: string } | null>;
}

export type Cached = { at: number; stats: Stats };

export type Deps = {
  fetch: typeof fetch;
  db: StatsDb;
  wcl: { clientId: string; clientSecret: string } | null;
  cache: Map<string, Cached>;
  now: () => number;
};

export type Logs = { best: number | null; median: number | null };

export type Stats = {
  blizzard_id: number;
  name: string;
  realm: string;
  realm_slug: string;
  class_name: string | null;
  spec_name: string | null;
  item_level: number | null;
  mplus_score: number | null;
  raid: string | null;
  heroic_logs: Logs | null;
  mythic_logs: Logs | null;
  mythic_bosses_killed: { killed: number; total: number } | null;
  links: { warcraftlogs: string; raiderio: string; armory: string };
};

export const USERINFO_URL = 'https://oauth.battle.net/userinfo';
export const API_BASE = 'https://us.api.blizzard.com';
export const WCL_TOKEN_URL = 'https://www.warcraftlogs.com/oauth/token';
export const WCL_API = 'https://www.warcraftlogs.com/api/v2/client';
const PROFILE_QUERY = '?namespace=profile-us&locale=en_US';
export const CACHE_MS = 10 * 60_000;
// Each number's read gets this long, so one slow source cannot hold the rest.
export const SOURCE_DEADLINE_MS = 5_000;
const HEROIC = 4;
const MYTHIC = 5;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-WGA-Version',
  'X-WGA-Version': VERSION
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

const refuse = (error: string, status: number) => jsonResponse({ success: false, error }, status);

export const EXPIRED = 'Your Battle.net sign-in has expired. Sign in with Battle.net again.';
export const NOT_CONNECTED = 'Connect Battle.net to your account first.';
export const NOT_YOURS = 'That Battle.net login is not the one connected to your account.';
export const NOT_YOUR_CHARACTER = 'That character is not on your Battle.net account.';
export const BLIZZARD_DOWN = 'Battle.net did not answer. Try again in a minute.';

export function linksOf(c: AccountCharacter) {
  const path = 'us/' + encodeURIComponent(c.realm_slug) + '/' + encodeURIComponent(c.name.toLowerCase());
  return {
    warcraftlogs: 'https://www.warcraftlogs.com/character/' + path,
    raiderio: 'https://raider.io/characters/' + path,
    armory: 'https://worldofwarcraft.blizzard.com/en-us/character/' + path
  };
}

// One zoneRankings answer as the two averages, or null when the character has
// no ranked kill at that difficulty (Warcraft Logs answers null averages then).
export function logsOf(rankings: any): Logs | null {
  const best = typeof rankings?.bestPerformanceAverage === 'number' ? rankings.bestPerformanceAverage : null;
  const median = typeof rankings?.medianPerformanceAverage === 'number' ? rankings.medianPerformanceAverage : null;
  return best === null && median === null ? null : { best, median };
}

// Bosses in the zone with at least one logged kill, out of the zone's bosses.
export function bossesKilledOf(rankings: any): { killed: number; total: number } | null {
  const list = rankings?.rankings;
  if (!Array.isArray(list) || list.length === 0) return null;
  return { killed: list.filter((r: any) => (r?.totalKills ?? 0) > 0).length, total: list.length };
}

// A read that throws, times out or answers non-2xx is "couldn't load".
type Read<T> = { ok: true; value: T } | { ok: false };

async function read<T>(work: (signal: AbortSignal) => Promise<T>): Promise<Read<T>> {
  try {
    return { ok: true, value: await work(AbortSignal.timeout(SOURCE_DEADLINE_MS)) };
  } catch {
    return { ok: false };
  }
}

async function blizzardJson(deps: Deps, path: string, token: string, signal: AbortSignal): Promise<any | null> {
  const res = await deps.fetch(API_BASE + path + PROFILE_QUERY, {
    headers: { Authorization: 'Bearer ' + token },
    signal
  });
  // 404 is Blizzard's "nothing here": a character with no keys, a locked profile.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Blizzard ' + res.status);
  return await res.json();
}

async function wclRankings(deps: Deps, c: AccountCharacter, zoneId: number, signal: AbortSignal) {
  if (!deps.wcl) throw new Error('No Warcraft Logs credentials');
  const tokenRes = await deps.fetch(WCL_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(deps.wcl.clientId + ':' + deps.wcl.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials',
    signal
  });
  const accessToken = (await tokenRes.json())?.access_token;
  if (!tokenRes.ok || typeof accessToken !== 'string') throw new Error('Warcraft Logs token');

  const who =
    'name: ' + gqlString(c.name) + ', serverSlug: ' + gqlString(c.realm_slug) + ', serverRegion: ' + gqlString('US');
  const zone = 'zoneID: ' + gqlInt(zoneId);
  const query =
    'query { characterData { character(' +
    who +
    ') { heroic: zoneRankings(' +
    zone +
    ', difficulty: ' +
    gqlInt(HEROIC) +
    ') mythic: zoneRankings(' +
    zone +
    ', difficulty: ' +
    gqlInt(MYTHIC) +
    ') } } }';
  const res = await deps.fetch(WCL_API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal
  });
  const body = await res.json();
  if (!res.ok || body?.errors) throw new Error('Warcraft Logs query');
  // A character Warcraft Logs has never seen is null: nothing, not down.
  return (body?.data?.characterData?.character ?? null) as { heroic: any; mythic: any } | null;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return refuse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return refuse('Not signed in', 401);

  let body: { token?: unknown; character?: unknown };
  try {
    body = await req.json();
  } catch {
    return refuse('Missing token', 400);
  }
  if (typeof body?.token !== 'string' || body.token === '') return refuse('Missing token', 400);
  if (typeof body.character !== 'number' || !Number.isInteger(body.character)) {
    return refuse('Missing character', 400);
  }
  const token = body.token;
  const characterId = body.character;

  const user = await deps.db.getUser(authHeader);
  if (!user) return refuse('Not signed in', 401);
  const linked = await deps.db.battlenetAccountId(user.id);
  if (!linked) return refuse(NOT_CONNECTED, 409);

  const bearer = { headers: { Authorization: 'Bearer ' + token } };
  const who = await deps.fetch(USERINFO_URL, bearer);
  if (who.status === 401) return refuse(EXPIRED, 401);
  if (!who.ok) return refuse(BLIZZARD_DOWN, 502);
  if (battlenetAccountIdOf(await who.json()) !== linked) return refuse(NOT_YOURS, 403);

  const list = await deps.fetch(API_BASE + '/profile/user/wow' + PROFILE_QUERY, bearer);
  if (list.status === 401) return refuse(EXPIRED, 401);
  if (!list.ok && list.status !== 404) return refuse(BLIZZARD_DOWN, 502);
  const own = list.ok ? charactersOf(await list.json()) : [];
  const c = own.find((x) => x.blizzard_id === characterId);
  if (!c) return refuse(NOT_YOUR_CHARACTER, 403);

  const key = String(c.blizzard_id);
  const hit = deps.cache.get(key);
  if (hit && deps.now() - hit.at < CACHE_MS) return jsonResponse({ success: true, character: hit.stats });

  const [summary, keystone, zone] = await Promise.all([
    read((signal) => blizzardJson(deps, summaryPath(c), token, signal)),
    read((signal) => blizzardJson(deps, summaryPath(c) + '/mythic-keystone-profile', token, signal)),
    read(() => deps.db.seasonZone())
  ]);
  const logs =
    zone.ok && zone.value
      ? await read((signal) => wclRankings(deps, c, zone.value!.wcl_zone_id, signal))
      : ({ ok: false } as const);

  const detail = summary.ok ? detailOf(summary.value) : { spec_name: null, item_level: null };
  const rating = keystone.ok ? keystone.value?.current_mythic_rating?.rating : null;
  const ranked = logs.ok ? logs.value : null;
  const stats: Stats = {
    blizzard_id: c.blizzard_id,
    name: c.name,
    realm: c.realm,
    realm_slug: c.realm_slug,
    class_name: c.class_name,
    spec_name: detail.spec_name,
    item_level: detail.item_level,
    mplus_score: typeof rating === 'number' ? Math.round(rating) : null,
    raid: zone.ok ? (zone.value?.name ?? null) : null,
    heroic_logs: logsOf(ranked?.heroic),
    mythic_logs: logsOf(ranked?.mythic),
    mythic_bosses_killed: bossesKilledOf(ranked?.mythic),
    links: linksOf(c)
  };

  // ponytail: per-isolate memory, so a cold start or a second isolate reads
  // again; a table would share it, worth it only if points run short.
  if (summary.ok && keystone.ok && logs.ok) deps.cache.set(key, { at: deps.now(), stats });
  return jsonResponse({ success: true, character: stats });
}
