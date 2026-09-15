// battlenet-characters' handler against injected dependencies: the gate that
// the token belongs to the caller, the Blizzard reads, and that the roster
// link and the save run with what Blizzard said rather than what the body said.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  API_BASE,
  BLIZZARD_DOWN,
  type CharactersDb,
  EXPIRED,
  NOT_CONNECTED,
  NOT_YOURS,
  type RosterLink,
  USERINFO_URL,
  handle
} from '../../../supabase/functions/battlenet-characters/handler.ts';
import { VERSION } from '../../../supabase/functions/battlenet-characters/version.ts';
import { recordingFetch } from '../_support/fetch.ts';
import { PROFILE } from './characters.test.ts';

const URL = 'http://edge.test/functions/v1/battlenet-characters';
const AUTH = 'Bearer caller-jwt';
const TOKEN = 'battlenet-access-token';
const USER_ID = '00000000-0000-0000-0000-00000000c0de';
const BNET_ID = '777';
const PERSON_ID = 42;

type State = {
  user?: { id: string } | null;
  linked?: string | null;
  personId?: number | null;
  roster?: RosterLink[];
  saved?: number[];
};

type Call = { method: string; args: unknown[] };

function fakeDb(state: State = {}): CharactersDb & { calls: Call[] } {
  const calls: Call[] = [];
  let saved = state.saved ?? [];
  const record = (method: string, ...args: unknown[]) => calls.push({ method, args });
  return {
    calls,
    getUser(authHeader) {
      record('getUser', authHeader);
      return Promise.resolve(state.user === undefined ? { id: USER_ID } : state.user);
    },
    battlenetAccountId(userId) {
      record('battlenetAccountId', userId);
      return Promise.resolve(state.linked === undefined ? BNET_ID : state.linked);
    },
    personId(userId) {
      record('personId', userId);
      return Promise.resolve(state.personId === undefined ? PERSON_ID : state.personId);
    },
    linkRosterCharacters(personId, characters) {
      record('linkRosterCharacters', personId, characters);
      return Promise.resolve(state.roster ?? []);
    },
    saveCharacters(personId, characters) {
      record('saveCharacters', personId, characters);
      saved = characters.map((c) => c.blizzard_id);
      return Promise.resolve();
    },
    savedBlizzardIds(personId) {
      record('savedBlizzardIds', personId);
      return Promise.resolve(saved);
    }
  };
}

const jsonOk = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response('', { status: code });

// userinfo, the account list, then one summary per max-level character (two).
const happyQueue = () => [
  jsonOk({ sub: BNET_ID, battletag: 'Grihz#1234' }),
  jsonOk(PROFILE),
  jsonOk({ active_spec: { name: 'Restoration' }, equipped_item_level: 704 }),
  status(404)
];

function post(body: unknown, headers: Record<string, string> = { Authorization: AUTH }) {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function run(
  body: unknown,
  state: State = {},
  queue: Response[] = happyQueue(),
  headers?: Record<string, string>
) {
  const db = fakeDb(state);
  const rec = recordingFetch(queue);
  const res = await handle(post(body, headers), { fetch: rec.fetch, db });
  return { status: res.status, body: await res.json(), res, db, fetches: rec.calls };
}

Deno.test('refuses without a signed-in caller, before touching Blizzard', async () => {
  const noHeader = await run({ token: TOKEN }, {}, [], {});
  assertEquals([noHeader.status, noHeader.body], [401, { success: false, error: 'Not signed in' }]);

  const noUser = await run({ token: TOKEN }, { user: null }, []);
  assertEquals([noUser.status, noUser.body], [401, { success: false, error: 'Not signed in' }]);
  assertEquals(noUser.fetches.length, 0);
});

Deno.test('refuses a missing token', async () => {
  for (const body of [{}, { token: '' }, 'not json']) {
    const r = await run(body, {}, []);
    assertEquals([r.status, r.body], [400, { success: false, error: 'Missing token' }]);
  }
});

Deno.test('refuses an account with no Battle.net login connected', async () => {
  const r = await run({ token: TOKEN }, { linked: null }, []);
  assertEquals([r.status, r.body], [409, { success: false, error: NOT_CONNECTED }]);
  assertEquals(r.fetches.length, 0);
});

Deno.test("refuses a token for a different Battle.net login, and never reads that login's characters", async () => {
  const r = await run({ token: TOKEN, save: [101] }, {}, [jsonOk({ sub: '999' })]);
  assertEquals([r.status, r.body], [403, { success: false, error: NOT_YOURS }]);
  assertEquals(
    r.fetches.map((f) => f.url),
    [USERINFO_URL]
  );
  assertEquals(
    r.db.calls.map((c) => c.method),
    ['getUser', 'battlenetAccountId']
  );
});

Deno.test('an expired token says to sign in again; Blizzard failing says to try again', async () => {
  const expired = await run({ token: TOKEN }, {}, [status(401)]);
  assertEquals([expired.status, expired.body.error], [401, EXPIRED]);

  const down = await run({ token: TOKEN }, {}, [status(503)]);
  assertEquals([down.status, down.body.error], [502, BLIZZARD_DOWN]);

  const listDown = await run({ token: TOKEN }, {}, [jsonOk({ sub: BNET_ID }), status(500)]);
  assertEquals([listDown.status, listDown.body.error], [502, BLIZZARD_DOWN]);
});

Deno.test('sends the token only to Blizzard, as a bearer header', async () => {
  const r = await run({ token: TOKEN });
  assertEquals(r.status, 200);
  for (const f of r.fetches) {
    assertEquals(f.headers.authorization, 'Bearer ' + TOKEN);
    assertEquals(f.url.startsWith(USERINFO_URL) || f.url.startsWith(API_BASE), true);
  }
  assertEquals(r.res.headers.get('X-WGA-Version'), VERSION);
});

// Listed alphabetically at one level, so the accented Ëlune sorts before Grihz.
Deno.test(
  'lists max-level characters with spec and item level, and links roster matches from the whole list',
  async () => {
    const roster: RosterLink[] = [{ player_id: 5, team_id: 1, name_realm: 'Grihz-Illidan', outcome: 'linked' }];
    const r = await run({ token: TOKEN }, { roster });

    assertEquals(r.status, 200);
    assertEquals(r.body.success, true);
    assertEquals(
      r.body.characters.map((c: { blizzard_id: number; spec_name: string | null; roster: unknown; saved: boolean }) => [
        c.blizzard_id,
        c.spec_name,
        c.roster,
        c.saved
      ]),
      [
        [201, null, null, false],
        [101, 'Restoration', roster[0], false]
      ]
    );
    assertEquals(r.body.roster, roster);

    const linkCall = r.db.calls.find((c) => c.method === 'linkRosterCharacters')!;
    assertEquals(linkCall.args, [
      PERSON_ID,
      [
        { name: 'Grihz', realm: 'Illidan' },
        { name: 'Lowbie', realm: 'Area 52' },
        { name: 'Ëlune', realm: "Kel'Thuzad" }
      ]
    ]);
    // No save field: nothing saved, and the saved ids are still read for the answer.
    assertEquals(
      r.db.calls.some((c) => c.method === 'saveCharacters'),
      false
    );
    assertEquals(r.db.calls.at(-1)!.method, 'savedBlizzardIds');
  }
);

Deno.test("saves only picked ids that are on the raider's own max-level list", async () => {
  const r = await run({ token: TOKEN, save: [201, 102, 31337] });
  assertEquals(r.status, 200);

  const saveCall = r.db.calls.find((c) => c.method === 'saveCharacters')!;
  assertEquals(saveCall.args[0], PERSON_ID);
  assertEquals(
    (saveCall.args[1] as Array<{ blizzard_id: number }>).map((c) => c.blizzard_id),
    [201]
  );
  assertEquals(
    r.body.characters.map((c: { blizzard_id: number; saved: boolean }) => [c.blizzard_id, c.saved]),
    [
      [201, true],
      [101, false]
    ]
  );
});

Deno.test('a login with no WoW characters answers an empty list, not an error', async () => {
  const r = await run({ token: TOKEN, save: [] }, {}, [jsonOk({ sub: BNET_ID }), status(404)]);
  assertEquals([r.status, r.body.characters, r.body.roster], [200, [], []]);
});

Deno.test('answers the preflight and refuses other methods', async () => {
  const db = fakeDb();
  const options = await handle(new Request(URL, { method: 'OPTIONS' }), { fetch: recordingFetch().fetch, db });
  assertEquals(options.status, 200);
  const get = await handle(new Request(URL, { method: 'GET' }), { fetch: recordingFetch().fetch, db });
  assertEquals(get.status, 405);
});
