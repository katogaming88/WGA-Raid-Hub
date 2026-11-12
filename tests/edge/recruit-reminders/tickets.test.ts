// The ticket half of the sweep (#1544) against an in-memory record, the clock
// and Discord stubbed: a closed ticket is locked, gets its closing message, is
// saved 100 messages at a time with the officer thread kept apart, and is
// deleted after the team's delay and never before it saves; a reopen unlocks
// it; a ticket deleted by hand is left alone.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { API } from '../../../supabase/functions/recruit-reminders/discord.ts';
import {
  REOPENED,
  SAVE_FAILED,
  type Progress,
  type SavedMessage,
  type TicketRec,
  closeTickets,
  closingMessage
} from '../../../supabase/functions/recruit-reminders/tickets.ts';

const APPLICANT = '444444444444444444';
const TICKET = '800000000000000001';
const THREAD = '800000000000000002';
const OFFICERS = '222222222222222222';
const T0 = Date.parse('2026-11-12T15:00:00Z');
const H = 3_600_000;

const CLOSED: TicketRec = {
  id: 7,
  team_name: 'Phoenix',
  status: 'joined',
  open: false,
  name_realm: 'Katorrí-Stormrage',
  applicant_discord_id: APPLICANT,
  channel_id: TICKET,
  thread_id: THREAD,
  officer_channel_id: OFFICERS,
  ticket_closed_at: null,
  ticket_saved_at: null,
  ticket_save_failures: 0,
  delete_after_hours: 24
};

type Call = { method: string; path: string; body: any };

const message = (n: number, author = APPLICANT) => ({
  id: String(900000000000000000n + BigInt(n)),
  author: { id: author, username: 'katorri', global_name: 'Katorrí' },
  content: 'message ' + n,
  timestamp: new Date(T0 - (1000 - n) * 60_000).toISOString(),
  attachments: n === 1 ? [{ filename: 'ui.png', content_type: 'image/png' }] : []
});

function setup(rec: Partial<TicketRec> = {}, ticketMessages = 103) {
  const record: TicketRec = { ...CLOSED, ...rec };
  const calls: Call[] = [];
  const saved: SavedMessage[] = [];
  const progress: Progress[] = [];
  const answers: Record<string, number> = {};
  let clock = T0;
  let reopenBeforeDelete = false;
  // Newest first, as Discord answers.
  const inTicket = Array.from({ length: ticketMessages }, (_, i) => message(i + 1)).reverse();
  const inThread = [message(500, '600000000000000001')];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = await req.text();
    const path = req.url.slice(API.length);
    calls.push({ method: req.method, path, body: text ? JSON.parse(text) : null });
    const key = req.method + ' ' + path.split('?')[0];
    if (answers[key]) return json({ code: 0 }, answers[key]);
    if (req.method === 'GET') {
      const list = path.startsWith('/channels/' + THREAD) ? inThread : inTicket;
      const before = new URL(req.url).searchParams.get('before');
      const from = before ? list.findIndex((m) => m.id === before) + 1 : 0;
      return json(list.slice(from, from + 100));
    }
    if (req.method === 'DELETE') return new Response(null, { status: 200 });
    return json({ id: '1' });
  }) as typeof globalThis.fetch;

  const deps = {
    fetch,
    now: () => new Date(clock),
    db: {
      closingTickets: () => Promise.resolve([{ ...record }]),
      ticketProgress: (_id: number, p: Progress) => {
        progress.push(p);
        Object.assign(record, p);
        return Promise.resolve();
      },
      saveMessages: (_id: number, m: SavedMessage[]) => {
        // The real upsert skips messages it already has.
        for (const x of m) if (!saved.some((y) => y.discord_message_id === x.discord_message_id)) saved.push(x);
        return Promise.resolve();
      },
      claimDelete: (_id: number, at: string) => {
        if (reopenBeforeDelete) return Promise.resolve(false);
        progress.push({ ticket_deleted_at: at });
        return Promise.resolve(true);
      }
    }
  };
  const run = async (ms: number) => {
    clock = ms;
    calls.length = 0;
    return await closeTickets(deps, 'bot-token');
  };
  return {
    record,
    calls,
    saved,
    progress,
    run,
    answer: (key: string, status: number) => (answers[key] = status),
    clear: (key: string) => delete answers[key],
    reopenMidway: () => (reopenBeforeDelete = true),
    officerWrites: () => inTicket.unshift(message(900, '600000000000000001'))
  };
}

Deno.test('a closed ticket is locked, gets its message, is saved, then deleted after the delay', async () => {
  const s = setup();
  let done = await s.run(T0);
  assertEquals(done, { closed: 1, deleted: 0, reopened: 0, failed: 0 });

  // Locked: the applicant can read, not post.
  const lock = s.calls.find((c) => c.method === 'PUT')!;
  assertEquals(lock.path, '/channels/' + TICKET + '/permissions/' + APPLICANT);
  assertEquals(lock.body.allow, String((1n << 10n) | (1n << 16n)));
  assert((BigInt(lock.body.deny) & (1n << 11n)) !== 0n);
  // The closing message, then the thread locked.
  const post = s.calls.find((c) => c.method === 'POST' && c.path === '/channels/' + TICKET + '/messages')!;
  assertEquals(
    post.body.content,
    'Welcome to Phoenix for real! This ticket is closed and will be deleted in 1 day. Everything here is saved on Raid Hub.'
  );
  assertEquals(post.body.allowed_mentions, { parse: [] });
  assertEquals(s.calls.find((c) => c.method === 'PATCH')!.body, { locked: true });

  // Saved 100 at a time, oldest first, the thread's apart.
  const reads = s.calls.filter((c) => c.method === 'GET').map((c) => c.path);
  assertEquals(reads.length, 3);
  assert(reads[1].includes('&before='));
  assertEquals(s.saved.length, 104);
  assertEquals(s.saved[0].body, 'message 1');
  assertEquals(s.saved[0].attachments, [{ name: 'ui.png', content_type: 'image/png' }]);
  assertEquals(s.saved[0].author_name, 'Katorrí');
  assertEquals(s.saved[102].body, 'message 103');
  assertEquals(s.saved.filter((m) => m.in_officer_thread).length, 1);
  assert(s.record.ticket_closed_at && s.record.ticket_saved_at);

  // Not yet deleted; then 24 hours after it closed, both go.
  done = await s.run(T0 + 23 * H);
  assertEquals(done.deleted, 0);
  assertEquals(s.calls.length, 0);
  done = await s.run(T0 + 24 * H);
  assertEquals(done.deleted, 1);
  assertEquals(
    s.calls.filter((c) => c.method === 'DELETE').map((c) => c.method + ' ' + c.path),
    ['DELETE /channels/' + TICKET, 'DELETE /channels/' + THREAD]
  );
  assert(s.progress.at(-1)?.ticket_deleted_at);
});

Deno.test('a save that fails is never deleted, is retried, and the officers are told once at the third', async () => {
  const s = setup({ ticket_closed_at: new Date(T0 - 48 * H).toISOString() });
  s.answer('GET /channels/' + TICKET + '/messages', 403);
  for (let i = 1; i <= 4; i++) {
    const done = await s.run(T0 + i * H);
    assertEquals(done.failed, 1);
    assert(!s.calls.some((c) => c.method === 'DELETE'));
    const told = s.calls.filter((c) => c.path === '/channels/' + OFFICERS + '/messages');
    assertEquals(told.length, i === 3 ? 1 : 0);
    if (i === 3) assertEquals(told[0].body.content, SAVE_FAILED('Katorrí', '<#' + TICKET + '>'));
  }
  assertEquals(s.record.ticket_save_failures, 4);
  assertEquals(s.saved.length, 0);

  // It reads again: saved, the count back to 0, and deleted in the same sweep.
  s.clear('GET /channels/' + TICKET + '/messages');
  const done = await s.run(T0 + 5 * H);
  assertEquals(done.deleted, 1);
  assertEquals(s.record.ticket_save_failures, 0);
  assertEquals(s.saved.length, 104);
});

Deno.test('every close reason has its own wording, and a team that never deletes says so', () => {
  assertEquals(
    closingMessage('declined', 'Phoenix', 24),
    'Thanks for applying to Phoenix. This ticket is closed and will be deleted in 1 day.'
  );
  assertEquals(
    closingMessage('no_reply', 'Phoenix', 48),
    "We didn't hear back, so Phoenix's officers have closed your application. You can apply again any time. This ticket is closed and will be deleted in 2 days."
  );
  assertEquals(
    closingMessage('not_joining', 'Phoenix', 6),
    'Thanks for trialing with Phoenix. This ticket is closed and will be deleted in 6 hours.'
  );
  assertEquals(
    closingMessage('withdrawn', 'Phoenix', null),
    'You withdrew your application to Phoenix. This ticket is closed.'
  );
});

Deno.test('a team that never deletes keeps the ticket, saved', async () => {
  const s = setup({ delete_after_hours: null });
  await s.run(T0);
  const done = await s.run(T0 + 1000 * H);
  assertEquals(done.deleted, 0);
  assert(s.record.ticket_saved_at);
  assert(!s.calls.some((c) => c.method === 'DELETE'));
});

Deno.test(
  'reopened before deletion: the applicant can post again, the thread opens, the steps start over',
  async () => {
    const s = setup({
      open: true,
      status: 'waiting_on_officers',
      ticket_closed_at: new Date(T0 - H).toISOString(),
      ticket_saved_at: new Date(T0 - H).toISOString()
    });
    const done = await s.run(T0);
    assertEquals(done.reopened, 1);
    const unlock = s.calls.find((c) => c.method === 'PUT')!;
    assertEquals(unlock.body.allow, String((1n << 10n) | (1n << 11n) | (1n << 15n) | (1n << 16n)));
    assertEquals(unlock.body.deny, '0');
    assertEquals(s.calls.find((c) => c.method === 'PATCH')!.body, { locked: false, archived: false });
    assertEquals(s.calls.find((c) => c.method === 'POST')!.body.content, REOPENED);
    assertEquals(s.progress.at(-1), { ticket_closed_at: null, ticket_saved_at: null, ticket_save_failures: 0 });
  }
);

Deno.test('a ticket deleted by hand is skipped; its officer thread is still saved and deleted', async () => {
  const s = setup();
  s.answer('PUT /channels/' + TICKET + '/permissions/' + APPLICANT, 404);
  s.answer('POST /channels/' + TICKET + '/messages', 404);
  s.answer('GET /channels/' + TICKET + '/messages', 404);
  s.answer('DELETE /channels/' + TICKET, 404);
  await s.run(T0);
  assertEquals(s.calls.find((c) => c.method === 'PATCH')!.body, { locked: true });
  assertEquals(
    s.saved.map((m) => m.in_officer_thread),
    [true]
  );
  const done = await s.run(T0 + 24 * H);
  assertEquals(done.deleted, 1);
  assert(s.calls.some((c) => c.method === 'DELETE' && c.path === '/channels/' + THREAD));
});

Deno.test('anything written during the wait is saved before the delete', async () => {
  const s = setup();
  await s.run(T0);
  s.officerWrites();
  await s.run(T0 + 24 * H);
  assert(s.saved.some((m) => m.body === 'message 900'));
  assertEquals(s.saved.length, 105);
});

Deno.test('a record reopened while the sweep runs keeps its ticket', async () => {
  const s = setup({
    ticket_closed_at: new Date(T0 - 48 * H).toISOString(),
    ticket_saved_at: new Date(T0 - 48 * H).toISOString()
  });
  s.reopenMidway();
  const done = await s.run(T0);
  assertEquals(done.deleted, 0);
  assert(!s.calls.some((c) => c.method === 'DELETE'));
});

Deno.test('Discord down changes nothing', async () => {
  const down = setup();
  down.answer('PUT /channels/' + TICKET + '/permissions/' + APPLICANT, 503);
  const done = await down.run(T0);
  assertEquals(done.failed, 1);
  assertEquals(down.progress, []);

  // A delete Discord refuses is un-claimed, so the next sweep tries again.
  const refused = setup({ ticket_closed_at: new Date(T0 - 48 * H).toISOString() });
  refused.answer('DELETE /channels/' + THREAD, 503);
  assertEquals((await refused.run(T0)).failed, 1);
  assertEquals(refused.progress.at(-1), { ticket_deleted_at: null });
});
