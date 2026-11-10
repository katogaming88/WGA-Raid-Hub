// Find my ticket's channel (#1542), Discord and the database stubbed: only
// whoever may edit the team's recruiting sets it, only in the team's own
// server, only while a team there uses private tickets; posted once, edited in
// place, moved, removed.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  FIND_TICKET_ID,
  FIND_TICKET_MESSAGE,
  type FindTicket,
  type FindTicketDb,
  NO_SERVER,
  NO_TICKET_TEAM,
  NOT_IN_SERVER,
  NOT_TEXT,
  findTicket
} from '../../../supabase/functions/discord-settings/find-ticket.ts';
import { FIND_TICKET_ID as PRESSED_ID } from '../../../supabase/functions/discord-interactions/recruit.ts';

const SERVER = '100000000000000001';
const OTHER = '100000000000000002';
const CHANNEL = '300000000000000003';
const NEW_CHANNEL = '300000000000000004';
const MESSAGE = '600000000000000006';
const POSTED = '600000000000000007';
const VOICE = '300000000000000005';

type Call = { method: string; path: string; body: any };

function setup(
  opts: {
    may?: boolean;
    server?: string | null;
    tickets?: boolean;
    current?: FindTicket | null;
    editFails?: boolean;
  } = {}
) {
  const calls: Call[] = [];
  const saved: Array<FindTicket | null> = [];
  const db: FindTicketDb = {
    mayEditRecruiting: (auth, teamId) => Promise.resolve((opts.may ?? true) && auth === 'Bearer jwt' && teamId === 1),
    serverOf: () => Promise.resolve(opts.server === undefined ? SERVER : opts.server),
    ticketTeamIn: () => Promise.resolve(opts.tickets ?? true),
    current: () => Promise.resolve(opts.current ?? null),
    save: (_server, value) => {
      saved.push(value);
      return Promise.resolve();
    },
    clear: () => {
      saved.push(null);
      return Promise.resolve();
    }
  };
  const discord = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    if (method === 'GET') {
      const guild = path.endsWith(CHANNEL) || path.endsWith(NEW_CHANNEL) || path.endsWith(VOICE) ? SERVER : OTHER;
      // VOICE is a voice channel in the right server.
      return Promise.resolve({ ok: true, status: 200, body: { guild_id: guild, type: path.endsWith(VOICE) ? 2 : 0 } });
    }
    if (method === 'PATCH' && opts.editFails) return Promise.resolve({ ok: false, status: 404, body: null });
    if (method === 'POST') return Promise.resolve({ ok: true, status: 200, body: { id: POSTED } });
    return Promise.resolve({ ok: true, status: 204, body: null });
  };
  const run = (body: Record<string, unknown>, auth = 'Bearer jwt') => findTicket(db, discord, auth, 'u1', 1, body);
  return { run, calls, saved };
}

Deno.test('the button is the one discord-interactions answers', () => {
  assertEquals(FIND_TICKET_ID, PRESSED_ID);
  assertEquals(FIND_TICKET_MESSAGE.components[0].components[0].custom_id, FIND_TICKET_ID);
  assertEquals(FIND_TICKET_MESSAGE.allowed_mentions, { parse: [] });
});

Deno.test("someone who may not edit the team's recruiting is refused before anything else", async () => {
  const { run, calls, saved } = setup({ may: false });
  const answer = await run({ channelId: CHANNEL });
  assertEquals(answer.status, 403);
  assertEquals(calls, []);
  assertEquals(saved, []);
});

Deno.test('no server picked yet', async () => {
  const { run } = setup({ server: null });
  assertEquals((await run({})).body.error, NO_SERVER);
});

Deno.test('asking without a channel answers the one picked', async () => {
  const { run, calls } = setup({ current: { channelId: CHANNEL, messageId: MESSAGE } });
  assertEquals((await run({})).body, { success: true, channelId: CHANNEL });
  assertEquals(calls, []);
});

Deno.test('a channel is only taken while some team in the server uses private tickets', async () => {
  const { run, calls } = setup({ tickets: false });
  const answer = await run({ channelId: CHANNEL });
  assertEquals(answer.body.error, NO_TICKET_TEAM);
  assertEquals(calls, []);
});

Deno.test('a channel in another server is refused, and nothing posts', async () => {
  const { run, calls, saved } = setup();
  const answer = await run({ channelId: '300000000000000009' });
  assertEquals(answer.status, 404);
  assertEquals(answer.body.error, NOT_IN_SERVER);
  assert(!calls.some((c) => c.method === 'POST'));
  assertEquals(saved, []);
});

Deno.test('first pick: posts the message there and keeps its id', async () => {
  const { run, calls, saved } = setup();
  assertEquals((await run({ channelId: CHANNEL })).body, { success: true, channelId: CHANNEL });
  const post = calls.find((c) => c.method === 'POST');
  assertEquals(post!.path, `/channels/${CHANNEL}/messages`);
  assertEquals(post!.body, FIND_TICKET_MESSAGE);
  assertEquals(saved, [{ channelId: CHANNEL, messageId: POSTED }]);
});

Deno.test('the same channel again edits the message in place, no second post', async () => {
  const { run, calls, saved } = setup({ current: { channelId: CHANNEL, messageId: MESSAGE } });
  await run({ channelId: CHANNEL });
  assertEquals(
    calls.map((c) => c.method + ' ' + c.path),
    [`GET /channels/${CHANNEL}`, `PATCH /channels/${CHANNEL}/messages/${MESSAGE}`]
  );
  assertEquals(saved, []);
});

Deno.test('the same channel with its message deleted by hand posts it again', async () => {
  const { run, saved } = setup({ current: { channelId: CHANNEL, messageId: MESSAGE }, editFails: true });
  await run({ channelId: CHANNEL });
  assertEquals(saved, [{ channelId: CHANNEL, messageId: POSTED }]);
});

Deno.test('a new channel: posted there first, then the old message removed', async () => {
  const { run, calls, saved } = setup({ current: { channelId: CHANNEL, messageId: MESSAGE } });
  await run({ channelId: NEW_CHANNEL });
  const order = calls.map((c) => c.method + ' ' + c.path);
  assertEquals(order, [
    `GET /channels/${NEW_CHANNEL}`,
    `POST /channels/${NEW_CHANNEL}/messages`,
    `DELETE /channels/${CHANNEL}/messages/${MESSAGE}`
  ]);
  assertEquals(saved, [{ channelId: NEW_CHANNEL, messageId: POSTED }]);
});

Deno.test('removing it deletes the message and forgets the channel', async () => {
  const { run, calls, saved } = setup({ current: { channelId: CHANNEL, messageId: MESSAGE } });
  assertEquals((await run({ channelId: null })).body, { success: true, channelId: null });
  assertEquals(
    calls.map((c) => c.method + ' ' + c.path),
    [`DELETE /channels/${CHANNEL}/messages/${MESSAGE}`]
  );
  assertEquals(saved, [null]);
});

Deno.test('a channel id that is not one is refused', async () => {
  const { run } = setup();
  assertEquals((await run({ channelId: 'general' })).status, 400);
});

Deno.test('a voice, category or forum channel is refused with the reason', async () => {
  const { run, calls, saved } = setup();
  const answer = await run({ channelId: VOICE });
  assertEquals(answer.body.error, NOT_TEXT);
  assert(!calls.some((c) => c.method === 'POST'));
  assertEquals(saved, []);
});
