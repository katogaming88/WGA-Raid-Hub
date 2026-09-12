// boe-sold-webhook's handler against injected dependencies (#1006): the
// gate, the reads, the response codes and the one post. Refusals are
// asserted as the exact body, decided before the split, so a stub that
// throws cannot satisfy any of them by naming its subject.
import { assertEquals } from 'jsr:@std/assert@1';
import { handle } from '../../../supabase/functions/boe-sold-webhook/handler.ts';
import { soldPost } from '../../../supabase/functions/boe-sold-webhook/format.ts';
import {
  FINDER_ID,
  FOUND_WEBHOOK_URL,
  LEGACY_WEBHOOK_URL,
  MANAGER_AUTH,
  MANAGER_ID,
  SOLD_ROW,
  SOLD_WEBHOOK_URL
} from '../_support/corpus.ts';
import { fakeDb, testDeps } from '../_support/deps.ts';
import { discordError, discordNoContent } from '../_support/fetch.ts';

const URL = 'http://edge.test/functions/v1/boe-sold-webhook';

function post(body: unknown, headers: Record<string, string> = { Authorization: MANAGER_AUTH }) {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

// A sold row, a manager at the keyboard, the finder resolved, one manager
// with an id, and Discord answering 204: the path that posts.
function happyPath() {
  const db = fakeDb({ rows: [SOLD_ROW], finderId: FINDER_ID, managerIds: [MANAGER_ID] });
  return testDeps({ db, responses: [discordNoContent()] });
}

Deno.test('OPTIONS answers the CORS preflight without touching anything', async () => {
  const { deps, calls, db } = happyPath();
  const res = await handle(new Request(URL, { method: 'OPTIONS' }), deps);
  assertEquals(res.status, 200);
  assertEquals(await res.text(), 'ok');
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(res.headers.get('Access-Control-Allow-Headers'), 'authorization, x-client-info, apikey, content-type');
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assertEquals(db.calls, []);
  assertEquals(calls, []);
});

Deno.test('a body with no id, or one that is not a number, is a 400', async () => {
  const { deps } = happyPath();
  assertEquals(await json(await handle(post({}), deps)), {
    status: 400,
    body: { success: false, error: 'Missing id' }
  });
  assertEquals(await json(await handle(post({ id: 'abc' }), deps)), {
    status: 400,
    body: { success: false, error: 'Missing id' }
  });
});

Deno.test('no Authorization header is a 401 before any read', async () => {
  const { deps, calls, db } = happyPath();
  const res = await handle(post({ id: 41 }, {}), deps);
  assertEquals(await json(res), { status: 401, body: { success: false, error: 'Not authorized' } });
  assertEquals(db.calls, []);
  assertEquals(calls, []);
});

Deno.test('a header with no session behind it is a 401', async () => {
  const db = fakeDb({ user: null, rows: [SOLD_ROW] });
  const { deps, calls } = testDeps({ db, responses: [discordNoContent()] });
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 401, body: { success: false, error: 'Not authorized' } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['getUser']
  );
  assertEquals(calls, []);
});

Deno.test('a signed-in caller who is neither a BoE manager nor a site admin is a 403, with no row read', async () => {
  const db = fakeDb({ boeManager: false, siteAdmin: false, rows: [SOLD_ROW] });
  const { deps, calls } = testDeps({ db, responses: [discordNoContent()] });
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 403, body: { success: false, error: 'Not authorized' } });
  assertEquals(
    db.calls.some((c) => c.method === 'readSale'),
    false
  );
  assertEquals(calls, []);
});

Deno.test('a site admin without the manager grant passes the gate', async () => {
  const db = fakeDb({ boeManager: false, siteAdmin: true, rows: [SOLD_ROW], finderId: FINDER_ID });
  const { deps, calls } = testDeps({ db, responses: [discordNoContent()] });
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 200, body: { success: true } });
  assertEquals(calls.length, 1);
});

Deno.test('with no webhook URL configured the call is skipped after the gate and before the row read', async () => {
  const db = fakeDb({ rows: [SOLD_ROW] });
  const { deps, calls } = testDeps({ db, env: {}, responses: [discordNoContent()] });
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 200, body: { success: true, skipped: true } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['getUser', 'isBoeManager', 'isSiteAdmin']
  );
  assertEquals(calls, []);
});

Deno.test('a failed row read is a 500 that names the read, not the cause', async () => {
  const db = fakeDb({ readFails: 'connection reset' });
  const { deps, calls } = testDeps({ db, responses: [discordNoContent()] });
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 500, body: { success: false, error: 'Could not read the find' } });
  assertEquals(calls, []);
});

Deno.test('an id with no row is a 404', async () => {
  const db = fakeDb({ rows: [SOLD_ROW] });
  const { deps, calls } = testDeps({ db, responses: [discordNoContent()] });
  const res = await handle(post({ id: 42 }), deps);
  assertEquals(await json(res), { status: 404, body: { success: false, error: 'No such find' } });
  assertEquals(calls, []);
});

Deno.test('a row that is no longer sold posts nothing and says why', async () => {
  const db = fakeDb({ rows: [{ ...SOLD_ROW, status: 'paid' }] });
  const { deps, calls } = testDeps({ db, responses: [discordNoContent()] });
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 200, body: { success: true, skipped: true, reason: 'not sold' } });
  assertEquals(calls, []);
});

Deno.test('a sold row posts the pinned body once, to the sold webhook, as JSON', async () => {
  const { deps, calls, db } = happyPath();
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 200, body: { success: true } });
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, SOLD_WEBHOOK_URL);
  assertEquals(calls[0].method, 'POST');
  assertEquals(calls[0].headers['content-type'], 'application/json');
  assertEquals(JSON.parse(calls[0].body ?? ''), soldPost(SOLD_ROW, FINDER_ID, [MANAGER_ID]));
  // The later steps ran, on the right client: the finder resolves on the
  // caller's own session and the manager list is read after it.
  assertEquals(
    db.calls.map((c) => c.method),
    ['getUser', 'isBoeManager', 'isSiteAdmin', 'readSale', 'resolveFinderDiscordId', 'managerDiscordIds']
  );
  assertEquals(db.calls[4].args, [MANAGER_AUTH, 41]);
});

Deno.test('an unresolved finder is posted by name with nobody allowed to ping', async () => {
  const db = fakeDb({ rows: [SOLD_ROW], finderId: null, managerIds: [MANAGER_ID] });
  const { deps, calls } = testDeps({ db, responses: [discordNoContent()] });
  await handle(post({ id: 41 }), deps);
  assertEquals(JSON.parse(calls[0].body ?? ''), soldPost(SOLD_ROW, null, [MANAGER_ID]));
});

Deno.test('a Discord error is reported with its status and is not a thrown failure', async () => {
  const db = fakeDb({ rows: [SOLD_ROW], finderId: FINDER_ID, managerIds: [MANAGER_ID] });
  const { deps } = testDeps({ db, responses: [discordError(429, 'rate limited')] });
  const res = await handle(post({ id: 41 }), deps);
  assertEquals(await json(res), { status: 200, body: { success: false, error: 'Discord responded with 429' } });
});

Deno.test('the sold webhook URL wins over the found one, which wins over the legacy name', async () => {
  const all = {
    BOE_SOLD_WEBHOOK_URL: SOLD_WEBHOOK_URL,
    BOE_WEBHOOK_URL: FOUND_WEBHOOK_URL,
    'BOE-Found-Webhook': LEGACY_WEBHOOK_URL
  };
  const noSold = { BOE_WEBHOOK_URL: FOUND_WEBHOOK_URL, 'BOE-Found-Webhook': LEGACY_WEBHOOK_URL };
  const legacyOnly = { 'BOE-Found-Webhook': LEGACY_WEBHOOK_URL };
  for (const [env, expected] of [
    [all, SOLD_WEBHOOK_URL],
    [noSold, FOUND_WEBHOOK_URL],
    [legacyOnly, LEGACY_WEBHOOK_URL]
  ] as const) {
    const db = fakeDb({ rows: [SOLD_ROW], finderId: FINDER_ID });
    const { deps, calls } = testDeps({ db, env, responses: [discordNoContent()] });
    await handle(post({ id: 41 }), deps);
    assertEquals(
      calls.map((c) => c.url),
      [expected]
    );
  }
});

Deno.test('a body that is not JSON is the catch-all: a 200 that says it failed', async () => {
  const { deps, calls } = happyPath();
  const res = await handle(post('not json'), deps);
  const { status, body } = await json(res);
  assertEquals(status, 200);
  assertEquals(body.success, false);
  assertEquals(typeof body.error, 'string');
  assertEquals(calls, []);
});
