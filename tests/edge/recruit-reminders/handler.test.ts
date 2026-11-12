// recruit-reminders' sweep against an in-memory database, the clock and
// Discord stubbed: a full applicant-side run (officer replies, one DM per
// turn, the reminder), an officer-side run (24 hours, then 3 days with the
// Team Owner), the overnight hold, the trial heads-up, and a retry after
// Discord fails.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  API,
  type Deps,
  type Rec,
  NO_REPLY_DM,
  REMIND_DM,
  REMIND_TICKET,
  REPLY_DM,
  TRIAL_ENDS,
  WAITING,
  due,
  handle,
  overnight,
  span
} from '../../../supabase/functions/recruit-reminders/handler.ts';

const SERVER = '111111111111111111';
const OFFICERS = '222222222222222222';
const APPLICANT = '444444444444444444';
const BOT = '555555555555555555';
const OFFICER = '600000000000000001';
const OWNER = '600000000000000009';
const TICKET = '800000000000000001';
const DM = '800000000000000004';
const SECRET = 'cron-secret';
const ENV: Record<string, string> = {
  SUPABASE_URL: 'https://kxgjqnpwfklbgrxdgmmv.supabase.co',
  DISCORD_BOT_TOKEN: 'bot-token',
  SITE_URL: 'https://raidhub.example/',
  OPTIONAL_RSVP_REMINDERS_SECRET: SECRET
};
// 10 AM Eastern.
const T0 = Date.parse('2026-11-10T15:00:00Z');
const H = 3_600_000;
const at = (ms: number) => new Date(ms).toISOString();

const TICKET_REC: Rec = {
  id: 7,
  team_name: 'Phoenix',
  status: 'waiting_on_officers',
  name_realm: 'Katorrí-Stormrage',
  applicant_discord_id: APPLICANT,
  time_zone: 'America/New_York',
  applicant_last_message_at: null,
  officers_last_message_at: null,
  applied_at: at(T0),
  last_activity_at: at(T0),
  reopened_at: null,
  trial_ends_on: null,
  uses_ticket: true,
  ticket_channel_id: TICKET,
  thread_id: null,
  server_id: SERVER,
  officer_channel_id: OFFICERS,
  owner_discord_id: OWNER,
  timings: {
    dm_reply_after_minutes: 120,
    remind_after_hours: 48,
    close_no_reply_after_hours: 120,
    ping_officers_after_hours: 24,
    ping_owner_after_hours: 72,
    trial_end_notice_hours: 48
  }
};

type Post = { channel: string; body: any };
type Msg = { type?: number; author: { id: string; bot?: boolean }; timestamp: string };

function setup(rec: Partial<Rec> = {}, env = ENV) {
  const record: Rec = { ...TICKET_REC, ...rec };
  const claims = new Set<string>();
  const events: string[] = [];
  const posts: Post[] = [];
  const ticket: Msg[] = [];
  let clock = T0;
  let down = false;
  let readStatus = 200;
  let saveCount = 0;
  let closes = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = new Request(input, init);
    const text = await req.text();
    if (down) return new Response('', { status: 503 });
    const path = req.url.slice(API.length);
    if (req.method === 'GET' && path === '/channels/' + TICKET + '/messages?limit=50') {
      if (readStatus !== 200) return json({ code: 50001 }, readStatus);
      return json([...ticket].reverse());
    }
    if (req.method === 'POST' && path === '/users/@me/channels') return json({ id: DM });
    const post = path.match(/^\/channels\/(\d+)\/messages$/);
    if (req.method === 'POST' && post) {
      posts.push({ channel: post[1], body: JSON.parse(text) });
      return json({ id: '1' });
    }
    throw new Error('unrouted ' + req.method + ' ' + path);
  }) as typeof globalThis.fetch;

  const deps: Deps = {
    fetch,
    now: () => new Date(clock),
    env: { get: (n) => env[n] },
    db: {
      openRecords: () => Promise.resolve([{ ...record }]),
      saveTimes: (_id, times) => {
        saveCount++;
        Object.assign(record, times);
        // The record's trigger.
        if (record.status !== 'on_trial') {
          record.status =
            Date.parse(record.officers_last_message_at ?? '1970-01-01') >
            Date.parse(record.applicant_last_message_at ?? '1970-01-01')
              ? 'waiting_on_applicant'
              : 'waiting_on_officers';
        }
        return Promise.resolve();
      },
      claim: (id, r, d) => {
        const key = id + r + d;
        if (claims.has(key)) return Promise.resolve(false);
        claims.add(key);
        return Promise.resolve(true);
      },
      unclaim: (id, r, d) => {
        claims.delete(id + r + d);
        return Promise.resolve();
      },
      sent: (_id, detail) => {
        events.push(detail);
        return Promise.resolve();
      },
      closeNoReply: () => {
        const was = record.status === 'waiting_on_applicant';
        if (was) closes++;
        // Closed records leave the open list.
        if (was) (record as any).status = 'no_reply';
        return Promise.resolve(was);
      },
      closingTickets: () => Promise.resolve([]),
      ticketProgress: () => Promise.resolve(),
      saveMessages: () => Promise.resolve()
    }
  };

  const sweep = async (ms: number) => {
    clock = ms;
    posts.length = 0;
    const res = await handle(
      new Request('http://edge.test/functions/v1/recruit-reminders', {
        method: 'POST',
        headers: { 'x-cron-secret': SECRET }
      }),
      deps
    );
    return { status: res.status, body: await res.json() };
  };
  const say = (id: string, ms: number, type = 0) => ticket.push({ type, author: { id }, timestamp: at(ms) });
  return {
    deps,
    record,
    events,
    posts,
    sweep,
    say,
    bot: (ms: number) => ticket.push({ type: 0, author: { id: BOT, bot: true }, timestamp: at(ms) }),
    saves: () => saveCount,
    closes: () => closes,
    setDown: (v: boolean) => (down = v),
    setRead: (v: number) => (readStatus = v)
  };
}

const dms = (posts: Post[]) => posts.filter((p) => p.channel === DM);

Deno.test('applicant side: one DM per turn, then the reminder, then nothing more', async () => {
  const s = setup();
  s.say(OFFICER, T0 + H);

  // The officer's message is read and it's the applicant's turn; the DM isn't due yet.
  let r = await s.sweep(T0 + 1.5 * H);
  assertEquals([r.body.success, r.body.sent, r.body.failed], [true, 0, 0]);
  assertEquals(s.record.officers_last_message_at, at(T0 + H));
  assertEquals(s.record.status, 'waiting_on_applicant');

  // 2 hours after it: one DM.
  r = await s.sweep(T0 + 3 * H + 5 * 60_000);
  assertEquals(r.body.sent, 1);
  assertEquals(dms(s.posts).length, 1);
  assertEquals(dms(s.posts)[0].body.content, REPLY_DM('Phoenix'));
  assertEquals(
    dms(s.posts)[0].body.components[0].components[0].url,
    'https://discord.com/channels/' + SERVER + '/' + TICKET
  );

  // Another officer message, and the bot's own post, don't start a new turn.
  s.say(OFFICER, T0 + 3.2 * H);
  s.bot(T0 + 3.3 * H);
  r = await s.sweep(T0 + 6 * H);
  assertEquals(r.body.sent, 0);
  assertEquals(s.record.officers_last_message_at, at(T0 + 3.2 * H));

  // 48 hours after the officers' last message: the @mention and the DM.
  r = await s.sweep(T0 + 3.2 * H + 48 * H + 60_000);
  assertEquals(r.body.sent, 1);
  const ticketPost = s.posts.find((p) => p.channel === TICKET)!;
  assertEquals(ticketPost.body.content, REMIND_TICKET(APPLICANT, 'Phoenix'));
  assertEquals(ticketPost.body.allowed_mentions, { parse: [], users: [APPLICANT] });
  assertEquals(dms(s.posts)[0].body.content, REMIND_DM('Phoenix', '3 days'));

  // Nothing again in the same turn, short of the close at 5 days.
  r = await s.sweep(T0 + 3.2 * H + 100 * H);
  assertEquals(r.body.sent, 0);
  assertEquals(s.events, ['Told them the officers replied', 'Reminded them to reply']);

  // They answer, the officers reply again: a new turn, a new DM.
  s.say(APPLICANT, T0 + 101 * H);
  s.say(OFFICER, T0 + 102 * H);
  r = await s.sweep(T0 + 104.5 * H);
  assertEquals(r.body.sent, 1);
  assertEquals(dms(s.posts)[0].body.content, REPLY_DM('Phoenix'));
});

Deno.test('officer side: 24 hours in the officer channel, then 3 days with the Team Owner', async () => {
  // A team without a ticket counts from the last status change or note.
  const s = setup({ uses_ticket: false, ticket_channel_id: null, last_activity_at: at(T0 + H) });

  let r = await s.sweep(T0 + 24 * H);
  assertEquals(r.body.sent, 0);

  r = await s.sweep(T0 + 25 * H + 60_000);
  assertEquals(r.body.sent, 1);
  assertEquals(s.posts.length, 1);
  assertEquals(s.posts[0].channel, OFFICERS);
  assertEquals(s.posts[0].body.content, WAITING('Katorrí', '1 day'));
  assertEquals(s.posts[0].body.allowed_mentions, { parse: [], users: [] });
  assertEquals(s.posts[0].body.components[0].components[0].url, 'https://raidhub.example/recruits/7');

  r = await s.sweep(T0 + 30 * H);
  assertEquals(r.body.sent, 0);

  r = await s.sweep(T0 + 73 * H + 60_000);
  assertEquals(r.body.sent, 1);
  assertEquals(s.posts[0].body.content, '<@' + OWNER + '> ' + WAITING('Katorrí', '3 days'));
  assertEquals(s.posts[0].body.allowed_mentions, { parse: [], users: [OWNER] });
  // No turn reminders without a ticket.
  assertEquals(dms(s.posts).length, 0);
  assertEquals(s.events, ['Reminded the officers', 'Reminded the Team Owner']);
});

Deno.test("officer side with a ticket counts from the applicant's last message and links the ticket", async () => {
  const s = setup();
  s.say(APPLICANT, T0 + 2 * H);
  await s.sweep(T0 + 3 * H);
  const r = await s.sweep(T0 + 26 * H + 60_000);
  assertEquals(r.body.sent, 1);
  assertEquals(s.posts[0].body.content, WAITING('Katorrí', '1 day') + ' <#' + TICKET + '>');
});

Deno.test('no DMs overnight: due at 2 AM, sent after 9 AM in their time zone', async () => {
  // Midnight Eastern.
  const night = Date.parse('2026-11-11T05:00:00Z');
  const s = setup({ status: 'waiting_on_applicant', officers_last_message_at: at(night) });
  let r = await s.sweep(night + 2 * H + 60_000);
  assertEquals(r.body.sent, 0);
  r = await s.sweep(night + 8.9 * H);
  assertEquals(r.body.sent, 0);
  r = await s.sweep(night + 9 * H + 60_000);
  assertEquals(r.body.sent, 1);
  assertEquals(dms(s.posts).length, 1);
  // Officer pings aren't held.
  assert(!overnight('America/New_York', new Date('2026-11-11T19:00:00Z')));
  assert(overnight('Europe/London', new Date('2026-11-11T03:00:00Z')));
  assert(overnight('Not/AZone', new Date('2026-11-11T08:00:00Z')));
});

Deno.test(
  'trial: a heads-up 2 days before the end, to the officer channel and the ticket, with the buttons',
  async () => {
    const s = setup({ status: 'on_trial', trial_ends_on: '2026-11-20' });
    // Ends noon Eastern on the 20th (17:00Z); the notice opens 48 hours before.
    let r = await s.sweep(Date.parse('2026-11-18T16:50:00Z'));
    assertEquals(r.body.sent, 0);
    r = await s.sweep(Date.parse('2026-11-18T17:05:00Z'));
    assertEquals(r.body.sent, 1);
    assertEquals(
      s.posts.map((p) => p.channel),
      [OFFICERS, TICKET]
    );
    const body = s.posts[0].body;
    assertEquals(body.content, TRIAL_ENDS('Katorrí', 'Phoenix', '2 days'));
    assertEquals(
      body.components[0].components.map((c: any) => c.custom_id ?? c.url),
      ['recruit:joined:7', 'recruit:extend:7', 'recruit:notjoining:7', 'https://raidhub.example/recruits/7']
    );
    r = await s.sweep(Date.parse('2026-11-19T12:00:00Z'));
    assertEquals(r.body.sent, 0);

    // An extension moves the end, and a new heads-up goes out before it.
    s.record.trial_ends_on = '2026-12-04';
    r = await s.sweep(Date.parse('2026-12-02T17:05:00Z'));
    assertEquals(r.body.sent, 1);
  }
);

Deno.test('Discord down before anything went: nothing recorded, the next sweep sends it', async () => {
  // No ticket to read, so the claim is made and the post is what fails.
  const s = setup({ uses_ticket: false, ticket_channel_id: null });
  s.setDown(true);
  let r = await s.sweep(T0 + 25 * H);
  assertEquals([r.body.success, r.body.sent, r.body.failed], [true, 0, 1]);
  assertEquals(s.events, []);
  s.setDown(false);
  r = await s.sweep(T0 + 25.25 * H);
  assertEquals(r.body.sent, 1);
  assertEquals(s.events, ['Reminded the officers']);
});

Deno.test('a turn with no timing set sends nothing, and the spans read as words', () => {
  const r: Rec = {
    ...TICKET_REC,
    status: 'waiting_on_applicant',
    officers_last_message_at: at(T0),
    timings: {
      ...TICKET_REC.timings,
      dm_reply_after_minutes: null,
      remind_after_hours: null,
      close_no_reply_after_hours: null
    }
  };
  assertEquals(due(r, new Date(T0 + 200 * H)), null);
  assertEquals(span(26 * H), '1 day');
  assertEquals(span(5 * H), '5 hours');
});

Deno.test('the cron secret is required, and a local stack sends nothing', async () => {
  const s = setup();
  const res = await handle(new Request('http://edge.test/x', { method: 'POST' }), s.deps);
  assertEquals(res.status, 401);
  await res.body?.cancel();
  const local = setup({}, { ...ENV, SUPABASE_URL: 'http://127.0.0.1:54321', DISCORD_TEST_WEBHOOK_URL: 'https://hook' });
  const r = await local.sweep(T0 + 100 * H);
  assertEquals(r.body, { success: true, status: 'local' });
});

Deno.test('a ticket the bot lost access to is skipped until a read works', async () => {
  const s = setup({ status: 'waiting_on_applicant', officers_last_message_at: at(T0) });
  s.setRead(403);
  let r = await s.sweep(T0 + 2.5 * H);
  assertEquals(r.body.sent, 0);
  s.setRead(200);
  r = await s.sweep(T0 + 2.75 * H);
  assertEquals(r.body.sent, 1);
});

Deno.test('a reminder held overnight says how long is really left', async () => {
  // The officers wrote at 1 AM Eastern; the 48-hour reminder falls at 1 AM and waits until 9.
  const night = Date.parse('2026-11-11T06:00:00Z');
  const s = setup({ status: 'waiting_on_applicant', officers_last_message_at: at(night) });
  let r = await s.sweep(night + 48 * H + 60_000);
  assertEquals(r.body.sent, 0);
  r = await s.sweep(night + 56 * H + 60_000);
  assertEquals(r.body.sent, 1);
  assertEquals(dms(s.posts)[0].body.content, REMIND_DM('Phoenix', '2 days'));
});

Deno.test(
  'with no Team Owner linked, the 3-day ping still goes and the history says no owner was mentioned',
  async () => {
    const s = setup({ uses_ticket: false, ticket_channel_id: null, owner_discord_id: null });
    const r = await s.sweep(T0 + 72 * H + 60_000);
    assertEquals(r.body.sent, 1);
    assertEquals(s.posts[0].body.content, WAITING('Katorrí', '3 days'));
    assertEquals(s.events, ['Reminded the officers again (no Team Owner with a linked Discord to mention)']);
  }
);

Deno.test('times are saved only when a message is really newer, whatever the format', async () => {
  // The database answers +00:00; Discord answers Z.
  const s = setup({ officers_last_message_at: '2026-11-10T16:00:00+00:00', status: 'waiting_on_applicant' });
  s.say(OFFICER, T0 + H);
  await s.sweep(T0 + 1.5 * H);
  assertEquals(s.saves(), 0);
});

Deno.test('a pin or other system line in the ticket is not a turn', async () => {
  const s = setup();
  // 6 = a pinned message.
  s.say(OFFICER, T0 + H, 6);
  await s.sweep(T0 + 3.5 * H);
  assertEquals(s.record.officers_last_message_at, null);
  assertEquals(s.record.status, 'waiting_on_officers');
  // 19 = a reply, which counts.
  s.say(OFFICER, T0 + 4 * H, 19);
  await s.sweep(T0 + 4.5 * H);
  assertEquals(s.record.officers_last_message_at, at(T0 + 4 * H));
});

Deno.test("without the applicant's Discord id the ticket is not read", async () => {
  const s = setup({ applicant_discord_id: null });
  s.say(APPLICANT, T0 + H);
  await s.sweep(T0 + 2 * H);
  assertEquals(s.saves(), 0);
});

Deno.test("a reopen starts the officers' clock again", async () => {
  const s = setup({ applicant_last_message_at: at(T0), reopened_at: at(T0 + 200 * H) });
  s.say(APPLICANT, T0);
  let r = await s.sweep(T0 + 201 * H);
  assertEquals(r.body.sent, 0);
  r = await s.sweep(T0 + 224 * H + 60_000);
  assertEquals(r.body.sent, 1);
  assertEquals(s.posts[0].body.content, WAITING('Katorrí', '1 day') + ' <#' + TICKET + '>');
});

Deno.test('a deleted ticket counts as none: officer pings, no link to it, no turn reminders', async () => {
  const s = setup({ status: 'waiting_on_applicant', officers_last_message_at: at(T0) });
  s.setRead(404);
  let r = await s.sweep(T0 + 50 * H);
  assertEquals(r.body.sent, 0);
  s.record.status = 'waiting_on_officers';
  r = await s.sweep(T0 + 25 * H);
  assertEquals(r.body.sent, 1);
  assertEquals(s.posts[0].body.content, WAITING('Katorrí', '1 day'));
});

Deno.test(
  "no reply: closed once the team's time has passed, with a last DM, held overnight like the rest",
  async () => {
    const s = setup({ status: 'waiting_on_applicant', officers_last_message_at: at(T0) });
    // 120 hours on is 10 AM Eastern.
    let r = await s.sweep(T0 + 119 * H);
    assertEquals(s.closes(), 0);
    r = await s.sweep(T0 + 120 * H + 60_000);
    assertEquals(r.body.noReply, 1);
    assertEquals(s.closes(), 1);
    assertEquals(dms(s.posts)[0].body.content, NO_REPLY_DM('Phoenix'));
    // Already closed: no second DM.
    r = await s.sweep(T0 + 121 * H);
    assertEquals(s.closes(), 1);
    assertEquals(dms(s.posts).length, 0);

    // Due at 2 AM Eastern: waits until 9.
    const night = Date.parse('2026-11-11T07:00:00Z') - 120 * H;
    const n = setup({ status: 'waiting_on_applicant', officers_last_message_at: at(night) });
    await n.sweep(night + 120 * H + 60_000);
    assertEquals(n.closes(), 0);
    await n.sweep(Date.parse('2026-11-11T14:05:00Z'));
    assertEquals(n.closes(), 1);
  }
);
