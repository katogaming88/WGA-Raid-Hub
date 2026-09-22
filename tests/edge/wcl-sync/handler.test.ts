// wcl-sync's handler up to its gate (#1013): the body is validated before
// anything is built or read, and a refusal is the exact 200 { success,
// error } body the frontend shows. The runner grants no permission, so if a
// refusal were ever to reach the WCL fetch or Deno.env the attempt would
// throw into the catch-all and fail the body assertion; "no WarcraftLogs
// call" is proven by the sandbox, not by a mock. The actions themselves
// still run on the platform fetch and are not exercised here, except the
// attendance refresh's report window (#1269): the tier's start as an
// instant, and the two reads that find it.
import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  currentTierStartMs,
  type Deps,
  handle,
  tierStartTimeMs
} from '../../../supabase/functions/wcl-sync/handler.ts';
import { VERSION } from '../../../supabase/functions/wcl-sync/version.ts';

const URL = 'http://edge.test/functions/v1/wcl-sync';
const OFFICER_AUTH = 'Bearer officer-session';

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

// The one injected dependency: a factory for the caller's client. The client
// it hands back fakes rpc() alone, which handle() awaits directly; no fluent
// chain is faked.
function clientFactory(rpcAnswers: Record<string, unknown> = {}) {
  const built: string[] = [];
  const rpcCalls: Array<{ name: string; args: unknown }> = [];
  const client = {
    rpc(name: string, args?: unknown) {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: rpcAnswers[name] ?? null, error: null });
    }
  };
  const deps: Deps = {
    supabase(authHeader) {
      built.push(authHeader);
      return client as any;
    }
  };
  return { deps, built, rpcCalls };
}

function refusal(error: string) {
  return { status: 200, body: { success: false, error } };
}

Deno.test('OPTIONS answers the CORS preflight without building a client', async () => {
  const { deps, built } = clientFactory();
  const res = await handle(new Request(URL, { method: 'OPTIONS' }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  // #971: the version travels on every response, the preflight included.
  assertEquals(res.headers.get('X-WGA-Version'), VERSION);
  assertEquals(res.headers.get('Access-Control-Expose-Headers'), 'X-WGA-Version');
  assertEquals(built, []);
});

Deno.test('an empty body is missing its action and team', async () => {
  const { deps, built } = clientFactory();
  assertEquals(await json(await handle(post({}), deps)), refusal('Missing action or teamId'));
  assertEquals(built, []);
});

Deno.test('a teamId that is not a positive integer is refused before the gate', async () => {
  const { deps, built } = clientFactory();
  const res = await handle(post({ action: 'getZoneEncounters', teamId: '7a' }), deps);
  assertEquals(await json(res), refusal('Invalid teamId'));
  assertEquals(built, []);
});

Deno.test('a zoneId carrying query text is refused, and no client is built', async () => {
  const { deps, built } = clientFactory();
  const res = await handle(post({ action: 'getZoneEncounters', teamId: 1, zoneId: '1) { name }' }), deps);
  assertEquals(await json(res), refusal('Invalid zoneId'));
  assertEquals(built, []);
});

Deno.test('an action that needs a zone and gets none is refused before the gate', async () => {
  const { deps, built } = clientFactory();
  const res = await handle(post({ action: 'fetchProgression', teamId: 1 }), deps);
  assertEquals(await json(res), refusal('Missing zoneId'));
  assertEquals(built, []);
});

Deno.test('fetchSeasonPerf with no season is refused before the gate', async () => {
  const { deps, built } = clientFactory();
  const res = await handle(post({ action: 'fetchSeasonPerf', teamId: 1, zoneId: 44 }), deps);
  assertEquals(await json(res), refusal('Missing season'));
  assertEquals(built, []);
});

Deno.test('an unknown action is refused before the gate', async () => {
  const { deps, built } = clientFactory();
  const res = await handle(post({ action: 'nope', teamId: 1 }), deps);
  assertEquals(await json(res), refusal('Unknown action: nope'));
  assertEquals(built, []);
});

Deno.test('a valid body with no Authorization header is not signed in, and no client is built', async () => {
  const { deps, built } = clientFactory();
  const res = await handle(post({ action: 'refreshPerformance', teamId: 1 }), deps);
  assertEquals(await json(res), refusal('Not signed in'));
  assertEquals(built, []);
});

Deno.test('a signed-in caller with no role on the team is not authorized, after both gate reads ran', async () => {
  const { deps, built, rpcCalls } = clientFactory();
  const res = await handle(post({ action: 'refreshPerformance', teamId: 1 }, { Authorization: OFFICER_AUTH }), deps);
  assertEquals(await json(res), refusal('Not authorized'));
  assertEquals(built, [OFFICER_AUTH]);
  assertEquals(rpcCalls[0], { name: 'my_team_role', args: { p_team_id: 1 } });
  assertEquals(rpcCalls[1].name, 'is_site_admin');
});

// The report window (#1269): the current tier's start date as Eastern
// midnight, the instant the reports query filters on. The fake answers
// rpc('current_season') and one seasons row by code, recording the row read;
// nothing else on the client is faked, so any other read throws.
function tierClient(
  opts: { code?: string | null; row?: { starts_at: string } | null; rpcError?: string; rowError?: string } = {}
) {
  const reads: Array<{ table: string; column: string; value: unknown }> = [];
  const client = {
    rpc(name: string) {
      if (name !== 'current_season') throw new Error(`unexpected rpc ${name}`);
      if (opts.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      return Promise.resolve({ data: opts.code ?? null, error: null });
    },
    from(table: string) {
      return {
        select: () => ({
          eq: (column: string, value: unknown) => {
            reads.push({ table, column, value });
            return {
              maybeSingle: () =>
                Promise.resolve(
                  opts.rowError
                    ? { data: null, error: { message: opts.rowError } }
                    : { data: opts.row ?? null, error: null }
                )
            };
          }
        })
      };
    }
  };
  return { client: client as any, reads };
}

// Hours behind UTC that day, so the expected instants are computed here and
// never read back from the function.
const EDT = 4;
const EST = 5;

Deno.test('tierStartTimeMs: a summer date is Eastern midnight, four hours after UTC midnight', () => {
  assertEquals(tierStartTimeMs('2026-08-11'), Date.UTC(2026, 7, 11, EDT));
});

Deno.test('tierStartTimeMs: a winter date is five hours after', () => {
  assertEquals(tierStartTimeMs('2026-01-15'), Date.UTC(2026, 0, 15, EST));
});

Deno.test('tierStartTimeMs: the day the clocks go forward is still on winter time at midnight', () => {
  assertEquals(tierStartTimeMs('2026-03-08'), Date.UTC(2026, 2, 8, EST));
});

Deno.test('tierStartTimeMs: the day the clocks go back is still on summer time at midnight', () => {
  assertEquals(tierStartTimeMs('2026-11-01'), Date.UTC(2026, 10, 1, EDT));
});

Deno.test('tierStartTimeMs: no date, a malformed date and an unpadded date are null', () => {
  assertEquals(tierStartTimeMs(null), null);
  assertEquals(tierStartTimeMs('not a date'), null);
  assertEquals(tierStartTimeMs('2026-8-11'), null);
});

Deno.test('currentTierStartMs: the current tier is read by its code and its start becomes the window', async () => {
  const { client, reads } = tierClient({ code: 'MID2', row: { starts_at: '2026-08-11' } });
  assertEquals(await currentTierStartMs(client), Date.UTC(2026, 7, 11, EDT));
  assertEquals(reads, [{ table: 'seasons', column: 'code', value: 'MID2' }]);
});

Deno.test('currentTierStartMs: no tier started means no window, and no seasons read', async () => {
  const { client, reads } = tierClient({ code: null });
  assertEquals(await currentTierStartMs(client), null);
  assertEquals(reads, []);
});

Deno.test('currentTierStartMs: a code the table does not hold means no window', async () => {
  const { client } = tierClient({ code: 'MID9', row: null });
  assertEquals(await currentTierStartMs(client), null);
});

Deno.test('currentTierStartMs: a failed tier read throws its message rather than widening the window', async () => {
  const { client } = tierClient({ rpcError: 'permission denied for function current_season' });
  await assertRejects(() => currentTierStartMs(client), Error, 'permission denied for function current_season');
  const { client: rowClient } = tierClient({ code: 'MID2', rowError: 'permission denied for table seasons' });
  await assertRejects(() => currentTierStartMs(rowClient), Error, 'permission denied for table seasons');
});
