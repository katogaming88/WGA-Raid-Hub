// recruit-reminders (#1543): every 15 minutes, work out whose turn it is in
// each open recruit record and nudge only that side, plus a heads-up before a
// trial ends. All timings are the team's (team_recruiting, #1535); null means
// never.
//
//   Applicant's turn (an officer wrote last in their ticket):
//     reply_dm        dm_reply_after_minutes after the officers' last message,
//                     one DM: "Phoenix's officers replied to your application"
//     reply_reminder  remind_after_hours after it: an @mention in the ticket
//                     and a DM saying when it closes
//     no_reply        close_no_reply_after_hours after it: closed as No reply
//                     (bot_close_no_reply), with a last DM (#1544)
//   Officers' turn (the applicant wrote last, or just applied):
//     officers_ping   ping_officers_after_hours: "Katorri has been waiting
//                     1 day" in the officer channel
//     owner_ping      ping_owner_after_hours: again, @mentioning the Team Owner
//   On trial: no turn reminders.
//     trial_end       trial_end_notice_hours before the end date, to the
//                     ticket and the officer channel, with Joined / Extend
//                     trial / Not joining (#1542 answers them)
//
// Whose turn: there's no gateway process (#997), so the bot can't hear
// messages as they're posted. The sweep reads each open ticket's newest 50
// messages, ignoring bots (its own posts included), and writes the
// last-message times onto the record; the record's trigger moves the status.
// Only the ticket channel is read, so an officer-only thread never counts.
// Turn reminders need a ticket; a team without one gets the officer-side
// pings, counted from the record's last status change or note.
//
// Once each: a reminder is claimed in recruit_reminders_sent before it goes,
// keyed on the turn (the applicant's last message, or when they applied) or
// the trial's end, so a new turn starts a new round and a repeat sweep sends
// nothing twice. If Discord fails before anything went out, the claim is
// dropped and the next sweep tries again.
//
// No DMs between 1 and 9 AM in the applicant's time zone: a reminder due
// overnight waits for the first sweep after 9.
//
// Discord's limits: one read per open ticket per sweep, plus the reminders,
// is nothing at WGA's size. Discord allows about 50 requests a second overall
// and less per route; with many guilds and hundreds of open tickets this needs
// pacing, or the gateway (#997) to hear messages instead of reading them.
//
// Then each closed record's ticket is locked, saved and deleted (tickets.ts,
// #1544).
//
// Called by pg_cron with the x-cron-secret header. It reuses the
// OPTIONAL_RSVP_REMINDERS_SECRET value, as the signup-sheets cron does, so no
// new secret is owed. Deploy with --no-verify-jwt.
import { type Env, resolveBot } from '../_shared/discord-destination.ts';
import { zonedTimeToUtc } from '../_shared/time.ts';
import { VERSION } from './version.ts';
import { API, call, dm, postTo, type Sent } from './discord.ts';
import { closeTickets, type TicketDb } from './tickets.ts';

export type Timings = {
  dm_reply_after_minutes: number | null;
  remind_after_hours: number | null;
  close_no_reply_after_hours: number | null;
  ping_officers_after_hours: number | null;
  ping_owner_after_hours: number | null;
  trial_end_notice_hours: number | null;
};

export type Rec = {
  id: number;
  team_name: string;
  status: 'waiting_on_officers' | 'waiting_on_applicant' | 'on_trial';
  name_realm: string;
  applicant_discord_id: string | null;
  time_zone: string | null;
  applicant_last_message_at: string | null;
  officers_last_message_at: string | null;
  applied_at: string;
  // The newest history row that isn't a reminder (status changes, notes).
  last_activity_at: string | null;
  // The newest reopened history row: a reopen starts the clocks again.
  reopened_at: string | null;
  trial_ends_on: string | null;
  uses_ticket: boolean;
  ticket_channel_id: string | null;
  thread_id: string | null;
  server_id: string | null;
  officer_channel_id: string | null;
  owner_discord_id: string | null;
  timings: Timings;
};

// no_reply isn't a reminder but the close itself (#1544): the record is
// closed and the applicant told, once, since only one call can close it.
export type Reminder = 'reply_dm' | 'reply_reminder' | 'officers_ping' | 'owner_ping' | 'trial_end' | 'no_reply';

export interface ReminderDb extends TicketDb {
  // Closes the record as No reply while it's still the applicant's turn; false
  // when it was already closed or they answered.
  closeNoReply(id: number): Promise<boolean>;
  // Every open record waiting on someone or on trial.
  openRecords(): Promise<Rec[]>;
  saveTimes(
    id: number,
    times: { applicant_last_message_at?: string; officers_last_message_at?: string }
  ): Promise<void>;
  // True when this call claimed it; false when it was already sent.
  claim(id: number, reminder: Reminder, dueFor: string): Promise<boolean>;
  unclaim(id: number, reminder: Reminder, dueFor: string): Promise<void>;
  // The record's reminder_sent history row.
  sent(id: number, detail: string): Promise<void>;
}

export type Deps = { fetch: typeof fetch; db: ReminderDb; env: Env; now: () => Date };

export { API };
export const HOUR = 3_600_000;
const DEFAULT_TIMEZONE = 'America/New_York';
const QUIET_FROM = 1;
const QUIET_UNTIL = 9;

const iso = (ms: number) => new Date(ms).toISOString();
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

// When a trial "ends" for the heads-up: noon Eastern on its end date.
// ponytail: one zone for every team, as the RSVP reminders; a team zone if a
// guild outside the US needs it.
export const trialEnd = (endsOn: string) => zonedTimeToUtc(endsOn, '12:00:00', DEFAULT_TIMEZONE);

// What's due for this record now: at most one reminder per turn, the latest
// one when a sweep was missed. dueFor names the turn or the trial's end.
export function due(r: Rec, now: Date): { reminder: Reminder; dueFor: string } | null {
  const t = now.getTime();
  const passed = (from: string, ms: number | null) => ms !== null && t >= Date.parse(from) + ms;
  const hours = (h: number | null) => (h === null ? null : h * HOUR);

  if (r.status === 'on_trial') {
    if (!r.trial_ends_on || r.timings.trial_end_notice_hours === null) return null;
    const end = trialEnd(r.trial_ends_on).getTime();
    if (t < end - r.timings.trial_end_notice_hours * HOUR || t >= end) return null;
    return { reminder: 'trial_end', dueFor: iso(end) };
  }

  const ticket = r.uses_ticket && r.ticket_channel_id !== null;
  if (r.status === 'waiting_on_applicant') {
    if (!ticket || !r.officers_last_message_at) return null;
    // The turn is the applicant's last word: more officer messages don't start
    // a new one, so they get one DM per turn.
    const turn = r.applicant_last_message_at ?? r.applied_at;
    const from = later(r.officers_last_message_at, r.reopened_at) as string;
    if (passed(from, hours(r.timings.close_no_reply_after_hours))) return { reminder: 'no_reply', dueFor: turn };
    if (passed(from, hours(r.timings.remind_after_hours))) return { reminder: 'reply_reminder', dueFor: turn };
    const dm = r.timings.dm_reply_after_minutes;
    if (passed(from, dm === null ? null : dm * 60_000)) return { reminder: 'reply_dm', dueFor: turn };
    return null;
  }

  const start = ticket
    ? (later(later(r.applicant_last_message_at, r.reopened_at), r.applied_at) as string)
    : (later(r.last_activity_at, r.applied_at) as string);
  if (passed(start, hours(r.timings.ping_owner_after_hours))) return { reminder: 'owner_ping', dueFor: start };
  if (passed(start, hours(r.timings.ping_officers_after_hours))) return { reminder: 'officers_ping', dueFor: start };
  return null;
}

// 1 AM up to 9 AM where the applicant is. An unknown zone counts as Eastern.
export function overnight(timeZone: string | null, now: Date): boolean {
  const hourIn = (zone: string) =>
    Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(now));
  let hour: number;
  try {
    hour = hourIn(timeZone ?? DEFAULT_TIMEZONE);
  } catch {
    hour = hourIn(DEFAULT_TIMEZONE);
  }
  return hour >= QUIET_FROM && hour < QUIET_UNTIL;
}

const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
// "3 days", or hours under a day.
export const span = (ms: number) => {
  const h = Math.floor(ms / HOUR);
  return h >= 24 ? plural(Math.floor(h / 24), 'day') : plural(Math.max(h, 1), 'hour');
};

export const firstName = (nameRealm: string) => nameRealm.split('-')[0];
const jump = (serverId: string, channelId: string) => 'https://discord.com/channels/' + serverId + '/' + channelId;
export const recordUrl = (siteUrl: string, id: number) => siteUrl + '/recruits/' + id;
const mention = (id: string) => '<@' + id + '>';
const link = (label: string, url: string) => ({ type: 2, style: 5, label, url });
const row = (...components: unknown[]) => [{ type: 1, components }];

// The trial message's buttons, whose ids #1542's handler reads.
export const TRIAL_BUTTONS = (id: number) => [
  { type: 2, style: 3, label: 'Joined', custom_id: 'recruit:joined:' + id },
  { type: 2, style: 1, label: 'Extend trial', custom_id: 'recruit:extend:' + id },
  { type: 2, style: 4, label: 'Not joining', custom_id: 'recruit:notjoining:' + id }
];

export const REPLY_DM = (team: string) => team + "'s officers replied to your application.";
export const REMIND_TICKET = (applicant: string, team: string) =>
  mention(applicant) + ' ' + team + "'s officers are waiting on your reply.";
export const REMIND_DM = (team: string, closesIn: string | null) =>
  team +
  "'s officers are waiting on your reply" +
  (closesIn ? '. Your application closes in ' + closesIn + " if you don't answer." : '.');
export const WAITING = (name: string, waited: string) => name + ' has been waiting ' + waited + '.';
export const NO_REPLY_DM = (team: string) =>
  'Your application to ' + team + ' was closed because there was no reply. You can apply again any time.';
export const TRIAL_ENDS = (name: string, team: string, endsIn: string) =>
  name + "'s trial with " + team + ' ends in ' + endsIn + '. Officers, how did it go?';

// Reads the ticket's newest messages and saves who wrote last on each side.
// Only people's own messages and replies count (Discord's types 0 and 19), not
// pins or other system lines. A ticket that's gone (deleted by hand) is
// treated as no ticket, so nothing links to it. Any other refusal
// (the bot lost access) could hide a newer message, so the record is skipped
// (null) until a read works.
async function readTicket(deps: Deps, token: string, r: Rec): Promise<Rec | null> {
  const res = await call(deps, token, 'GET', '/channels/' + r.ticket_channel_id + '/messages?limit=50');
  if (!res.ok) {
    await res.body?.cancel();
    return res.status === 404 ? { ...r, ticket_channel_id: null } : null;
  }
  const messages = (await res.json()) as Array<{
    type?: number;
    author?: { id?: string; bot?: boolean };
    timestamp?: string;
  }>;
  let applicant: string | null = null;
  let officers: string | null = null;
  for (const m of messages) {
    if (!m.author?.id || m.author.bot || !m.timestamp || (m.type !== 0 && m.type !== 19)) continue;
    const at = new Date(m.timestamp).toISOString();
    if (m.author.id === r.applicant_discord_id) applicant = later(applicant, at);
    else officers = later(officers, at);
  }
  const times: { applicant_last_message_at?: string; officers_last_message_at?: string } = {};
  // By instant, not by text: the database writes +00:00 and Discord Z.
  const newer = (a: string | null, b: string | null) => !!a && (!b || Date.parse(a) > Date.parse(b));
  if (newer(applicant, r.applicant_last_message_at)) {
    times.applicant_last_message_at = applicant!;
  }
  if (newer(officers, r.officers_last_message_at)) {
    times.officers_last_message_at = officers;
  }
  if (!times.applicant_last_message_at && !times.officers_last_message_at) return r;
  await deps.db.saveTimes(r.id, times);
  const next = { ...r, ...times };
  // The record's trigger does the same.
  next.status =
    next.officers_last_message_at &&
    Date.parse(next.officers_last_message_at) > Date.parse(next.applicant_last_message_at ?? '1970-01-01T00:00:00Z')
      ? 'waiting_on_applicant'
      : 'waiting_on_officers';
  return next;
}

const DETAIL: Record<Reminder, string> = {
  reply_dm: 'Told them the officers replied',
  reply_reminder: 'Reminded them to reply',
  officers_ping: 'Reminded the officers',
  owner_ping: 'Reminded the Team Owner',
  trial_end: 'Trial ends soon: asked the officers how it went',
  no_reply: 'Closed: no reply'
};

// Sends one reminder, each message's outcome pushed onto out as it goes, so
// a failure partway still shows what already went.
async function send(
  deps: Deps,
  token: string,
  siteUrl: string,
  r: Rec,
  { reminder, dueFor }: { reminder: Reminder; dueFor: string },
  out: Sent[]
): Promise<void> {
  const name = firstName(r.name_realm);
  const ticketUrl = r.server_id && r.ticket_channel_id ? jump(r.server_id, r.ticket_channel_id) : null;
  const open = link('Open in Raid Hub', recordUrl(siteUrl, r.id));
  const where = r.ticket_channel_id ? '<#' + r.ticket_channel_id + '>' : r.thread_id ? '<#' + r.thread_id + '>' : null;

  switch (reminder) {
    case 'reply_dm':
      out.push(
        await dm(deps, token, r.applicant_discord_id!, {
          content: REPLY_DM(r.team_name),
          components: row(link('Open your ticket', ticketUrl!))
        })
      );
      return;
    case 'reply_reminder': {
      const t = r.timings;
      // From now, so a DM held overnight doesn't overstate it. #1544 closes it.
      const closesAt =
        t.close_no_reply_after_hours === null
          ? null
          : Date.parse(r.officers_last_message_at!) + t.close_no_reply_after_hours * HOUR;
      const closesIn =
        closesAt !== null && closesAt > deps.now().getTime() ? span(closesAt - deps.now().getTime() + HOUR / 2) : null;
      out.push(
        await postTo(deps, token, r.ticket_channel_id!, {
          content: REMIND_TICKET(r.applicant_discord_id!, r.team_name),
          allowed_mentions: { parse: [], users: [r.applicant_discord_id!] }
        })
      );
      out.push(
        await dm(deps, token, r.applicant_discord_id!, {
          content: REMIND_DM(r.team_name, closesIn),
          components: row(link('Open your ticket', ticketUrl!))
        })
      );
      return;
    }
    case 'officers_ping':
    case 'owner_ping': {
      const owner = reminder === 'owner_ping' ? r.owner_discord_id : null;
      out.push(
        await postTo(deps, token, r.officer_channel_id!, {
          content:
            (owner ? mention(owner) + ' ' : '') +
            WAITING(name, span(deps.now().getTime() - Date.parse(dueFor))) +
            (where ? ' ' + where : ''),
          allowed_mentions: { parse: [], users: owner ? [owner] : [] },
          components: row(open)
        })
      );
      return;
    }
    case 'trial_end': {
      const endsIn = span(trialEnd(r.trial_ends_on!).getTime() - deps.now().getTime() + HOUR / 2);
      const body = {
        content: TRIAL_ENDS(name, r.team_name, endsIn),
        components: [{ type: 1, components: [...TRIAL_BUTTONS(r.id), open] }]
      };
      for (const channel of [r.officer_channel_id, r.ticket_channel_id]) {
        if (channel) out.push(await postTo(deps, token, channel, body));
      }
      return;
    }
  }
}

// Whether the reminder has anywhere to go. One that can't is never claimed.
function deliverable(r: Rec, reminder: Reminder): boolean {
  if (reminder === 'reply_dm' || reminder === 'reply_reminder') {
    return !!r.applicant_discord_id && !!r.server_id && !!r.ticket_channel_id;
  }
  if (reminder === 'trial_end') return !!(r.officer_channel_id || r.ticket_channel_id);
  if (reminder === 'no_reply') return true;
  return !!r.officer_channel_id;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
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

export async function sweep(deps: Deps, token: string, siteUrl: string) {
  let sent = 0;
  let noReply = 0;
  let failed = 0;
  for (const found of await deps.db.openRecords()) {
    try {
      // Without the applicant's Discord id every message would read as an
      // officer's, so the ticket isn't read and the saved times stand.
      const r =
        found.status !== 'on_trial' && found.uses_ticket && found.ticket_channel_id && found.applicant_discord_id
          ? await readTicket(deps, token, found)
          : found;
      if (!r) continue;
      const next = due(r, deps.now());
      if (!next || !deliverable(r, next.reminder)) continue;
      const dms = next.reminder === 'reply_dm' || next.reminder === 'reply_reminder' || next.reminder === 'no_reply';
      if (dms && overnight(r.time_zone, deps.now())) continue;
      if (next.reminder === 'no_reply') {
        if (!(await deps.db.closeNoReply(r.id))) continue;
        noReply++;
        // Best effort: the record is closed whatever Discord says.
        if (r.applicant_discord_id) {
          await dm(deps, token, r.applicant_discord_id, { content: NO_REPLY_DM(r.team_name) }).catch(() => null);
        }
        continue;
      }
      if (!(await deps.db.claim(r.id, next.reminder, next.dueFor))) continue;
      const out: Sent[] = [];
      let down: unknown = null;
      try {
        await send(deps, token, siteUrl, r, next, out);
      } catch (e) {
        down = e;
      }
      // Discord failed before anything went out: try again next sweep. Once
      // something went, the claim stays, so nobody is pinged twice.
      if (down && !out.some((s) => s.ok)) {
        await deps.db.unclaim(r.id, next.reminder, next.dueFor);
        throw down;
      }
      const closed = out.some((s) => !s.ok && s.dmsClosed);
      const refused = !closed && (down !== null || out.some((s) => !s.ok));
      await deps.db.sent(
        r.id,
        (next.reminder === 'owner_ping' && !r.owner_discord_id
          ? 'Reminded the officers again (no Team Owner with a linked Discord to mention)'
          : DETAIL[next.reminder]) +
          (closed ? "; their DMs are closed, so the DM didn't arrive" : refused ? '; Discord refused part of it' : '')
      );
      sent++;
    } catch (e) {
      failed++;
      console.error('recruit-reminders: record ' + found.id + ' failed:', e instanceof Error ? e.message : e);
    }
  }
  // Then the closed records' tickets, including any closed just now.
  const url = deps.env.get('SUPABASE_URL');
  const secret = deps.env.get('OPTIONAL_RSVP_REMINDERS_SECRET');
  const tickets = await closeTickets(deps, token, url && secret ? { url, secret } : undefined);
  return { sent, failed, noReply, tickets };
}

async function route(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  const secret = deps.env.get('OPTIONAL_RSVP_REMINDERS_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return jsonResponse({ success: false, error: 'Not authorized' }, 401);
  }
  // A local stack's server ids are the real servers (from the production
  // backup), so it reads and sends nothing.
  if (resolveBot(deps.env).kind !== 'bot') return jsonResponse({ success: true, status: 'local' });
  const token = deps.env.get('DISCORD_BOT_TOKEN');
  const siteUrl = deps.env.get('SITE_URL')?.replace(/\/+$/, '');
  if (!token || !siteUrl) return jsonResponse({ success: false, error: 'The Discord bot is not set up.' }, 503);
  return jsonResponse({ success: true, ...(await sweep(deps, token, siteUrl)) });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    return await route(req, deps);
  } catch (e) {
    console.error('recruit-reminders error:', e instanceof Error ? e.message : e);
    return jsonResponse({ success: false, error: 'Something went wrong' }, 500);
  }
}
