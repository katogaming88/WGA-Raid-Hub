// wcl-sync's handler up to its gate (#1013): the body is validated before
// anything is built or read, and a refusal is the exact 200 { success,
// error } body the frontend shows. The runner grants no permission, so if a
// refusal were ever to reach the WCL fetch or Deno.env the attempt would
// throw into the catch-all and fail the body assertion; "no WarcraftLogs
// call" is proven by the sandbox, not by a mock. The actions themselves
// still run on the platform fetch and are not exercised here.
import { assertEquals } from 'jsr:@std/assert@1';
import { type Deps, handle } from '../../../supabase/functions/wcl-sync/handler.ts';

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
