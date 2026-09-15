// battlenet-characters (#942 step 5, #1162): lists a raider's max-level
// characters from their Battle.net account, links the ones on a team's roster
// to them, and saves the ones they pick as alts.
//
// POST { token, save? }. `token` is the Battle.net access token the app holds
// right after a Battle.net sign-in or connect. `save`, when present, is the
// Blizzard ids of the characters to keep as alts; without it nothing is saved.
//
// The token is only ever sent to Blizzard, never stored or logged. Before it is
// used, Blizzard is asked whose token it is, and the answer must be the
// Battle.net login linked to the caller's account: a refused Connect still
// leaves a working token in the browser (tested 2026-09-14), so holding one
// proves nothing on its own.
//
// handle() takes its reads and its fetch as an argument (#1006); deps.ts
// supplies the real ones and index.ts serves it.
import {
  type AccountCharacter,
  type ShownCharacter,
  atMaxLevel,
  battlenetAccountIdOf,
  charactersOf,
  detailOf,
  pickedFrom,
  summaryPath
} from './characters.ts';
import { VERSION } from './version.ts';

export type RosterLink = {
  player_id: number;
  team_id: number;
  name_realm: string;
  outcome: 'linked' | 'already_yours' | 'claimed_by_someone_else' | 'needs_discord';
};

// One method per read or write the function performs.
export interface CharactersDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  // The Battle.net account id of the login linked to this account, or null.
  battlenetAccountId(userId: string): Promise<string | null>;
  personId(userId: string): Promise<number | null>;
  linkRosterCharacters(personId: number, characters: Array<{ name: string; realm: string }>): Promise<RosterLink[]>;
  saveCharacters(personId: number, characters: ShownCharacter[]): Promise<void>;
  savedBlizzardIds(personId: number): Promise<number[]>;
}

export type Deps = { fetch: typeof fetch; db: CharactersDb };

export const USERINFO_URL = 'https://oauth.battle.net/userinfo';
export const API_BASE = 'https://us.api.blizzard.com';
const PROFILE_QUERY = '?namespace=profile-us&locale=en_US';

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
export const BLIZZARD_DOWN = 'Battle.net did not answer. Try again in a minute.';

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return refuse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return refuse('Not signed in', 401);

  let body: { token?: unknown; save?: unknown };
  try {
    body = await req.json();
  } catch {
    return refuse('Missing token', 400);
  }
  if (typeof body?.token !== 'string' || body.token === '') return refuse('Missing token', 400);
  const token = body.token;

  const user = await deps.db.getUser(authHeader);
  if (!user) return refuse('Not signed in', 401);

  const linked = await deps.db.battlenetAccountId(user.id);
  if (!linked) return refuse(NOT_CONNECTED, 409);

  const bearer = { headers: { Authorization: 'Bearer ' + token } };

  const who = await deps.fetch(USERINFO_URL, bearer);
  if (who.status === 401) return refuse(EXPIRED, 401);
  if (!who.ok) return refuse(BLIZZARD_DOWN, 502);
  if (battlenetAccountIdOf(await who.json()) !== linked) return refuse(NOT_YOURS, 403);

  const personId = await deps.db.personId(user.id);
  if (personId === null) return refuse('Could not find your account', 500);

  const list = await deps.fetch(API_BASE + '/profile/user/wow' + PROFILE_QUERY, bearer);
  if (list.status === 401) return refuse(EXPIRED, 401);
  // 404 is Blizzard's answer for a login with no WoW characters at all.
  let everyone: AccountCharacter[] = [];
  if (list.ok) everyone = charactersOf(await list.json());
  else if (list.status !== 404) return refuse(BLIZZARD_DOWN, 502);

  const shown: ShownCharacter[] = await Promise.all(
    atMaxLevel(everyone).map(async (c) => {
      const res = await deps.fetch(API_BASE + summaryPath(c) + PROFILE_QUERY, bearer);
      const detail = res.ok ? detailOf(await res.json()) : { spec_name: null, item_level: null };
      return { ...c, ...detail };
    })
  );

  // Every character on the list, not only the max-level ones: a roster row is
  // whatever its team put on the roster.
  const roster = await deps.db.linkRosterCharacters(
    personId,
    everyone.map((c) => ({ name: c.name, realm: c.realm }))
  );

  const picked = pickedFrom(shown, body.save);
  if (picked) await deps.db.saveCharacters(personId, picked);
  const saved = new Set(await deps.db.savedBlizzardIds(personId));

  const key = (name: string, realm: string) => (name + '-' + realm).replace(/ /g, '').toLowerCase();
  const rosterByKey = new Map(roster.map((r) => [r.name_realm.replace(/ /g, '').toLowerCase(), r]));

  return jsonResponse({
    success: true,
    characters: shown
      .map((c) => ({ ...c, saved: saved.has(c.blizzard_id), roster: rosterByKey.get(key(c.name, c.realm)) ?? null }))
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
    roster
  });
}
