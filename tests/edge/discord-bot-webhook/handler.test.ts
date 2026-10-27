// discord-bot-webhook's addCharacter gate (#1674): only a signed-in caller's
// own add reaches the bot, and the message is the caller's Audit Log row, not
// the text they sent. The bot posts each row once (bot/tests/postedOnce.test.ts).
import { assertEquals } from 'jsr:@std/assert@1';
import {
  type Deps,
  type OwnAdd,
  OWN_ADD_WINDOW_MS,
  handle
} from '../../../supabase/functions/discord-bot-webhook/handler.ts';
import { recordingFetch } from '../_support/fetch.ts';

const URL = 'http://edge.test/functions/v1/discord-bot-webhook';
const BOT_URL = 'https://bot.test';
const NOW = new Date('2026-10-27T20:00:00Z');

const ADD: OwnAdd = {
  auditId: 41,
  team: 'phoenix',
  member: 'Kat',
  nameRealm: 'Katorri-Stormrage',
  classSpec: 'Warlock Demonology DPS',
  addedAt: '2026-10-27T19:59:58Z'
};

function setup({ user = { id: 'u1' } as { id: string } | null, add = ADD as OwnAdd | null } = {}) {
  const { fetch, calls } = recordingFetch([new Response('{"ok":true}', { status: 200 })]);
  const sinces: Date[] = [];
  const deps: Deps = {
    fetch,
    env: { get: (name) => ({ BOT_WEBHOOK_URL: BOT_URL, BOT_WEBHOOK_SECRET: 's3cret' })[name] },
    now: () => NOW,
    db: {
      getUser: () => Promise.resolve(user),
      latestOwnAdd: (_userId, since) => {
        sinces.push(since);
        return Promise.resolve(add);
      }
    }
  };
  return { deps, calls, sinces };
}

const FAKE = {
  action: 'addCharacter',
  team: 'hellfire',
  payload: { member: 'Katorri', nameRealm: 'Fakechar-Illidan', classSpec: 'Fake' }
};

function post(body: unknown, headers: Record<string, string> = { Authorization: 'Bearer user-jwt' }) {
  return new Request(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

Deno.test('addCharacter with no Authorization header is refused and posts nothing', async () => {
  const { deps, calls } = setup();
  const res = await handle(post(FAKE, {}), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('addCharacter from a token with no user (the anon key) is refused and posts nothing', async () => {
  const { deps, calls } = setup({ user: null });
  const res = await handle(post(FAKE), deps);
  assertEquals(res.status, 401);
  assertEquals(calls.length, 0);
});

Deno.test('addCharacter with no recent own add posts nothing', async () => {
  const { deps, calls } = setup({ add: null });
  const res = await handle(post(FAKE), deps);
  assertEquals(res.status, 404);
  assertEquals(calls.length, 0);
});

Deno.test('addCharacter looks back only the window', async () => {
  const { deps, sinces } = setup();
  await handle(post(FAKE), deps);
  assertEquals(sinces, [new Date(NOW.getTime() - OWN_ADD_WINDOW_MS)]);
});

Deno.test("addCharacter posts the Audit Log row, not the caller's text or team", async () => {
  const { deps, calls } = setup();
  const res = await handle(post(FAKE), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, BOT_URL + '/add-character');
  assertEquals(JSON.parse(calls[0].body!), {
    team: 'phoenix',
    auditId: 41,
    member: 'Kat',
    nameRealm: 'Katorri-Stormrage',
    classSpec: 'Warlock Demonology DPS',
    submittedAt: '2026-10-27T19:59:58Z'
  });
});

Deno.test('the other notices still relay without a sign-in', async () => {
  const { deps, calls } = setup({ user: null });
  const res = await handle(post({ action: 'bis', team: 'phoenix', payload: { player: 'Kat' } }, {}), deps);
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assertEquals(JSON.parse(calls[0].body!).player, 'Kat');
});
