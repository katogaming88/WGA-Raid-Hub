// Closing a recruit's Discord ticket (#1544), the second half of each sweep.
// When a record closes (declined, no reply, joined, not joining, withdrawn),
// its ticket goes through three steps, each written onto the record once done
// so a failed step is simply tried again next sweep:
//
//   1. Locked (ticket_closed_at): the applicant can still read but can't post,
//      a closing message worded by the reason goes in, and an officer-only
//      thread is locked.
//   2. Saved (ticket_saved_at): every message in the ticket and the thread,
//      100 at a time, to recruit_messages, with author, text, time and the
//      attachments' names (Discord's links expire, so only the names are
//      kept). If saving fails it's tried again each sweep, and the officer
//      channel is told once, at the third failure.
//   3. Deleted (ticket_deleted_at): delete_closed_after_hours after it was
//      locked, and never before it's saved. Null means never.
//
// Reopened before it's deleted (the record is open again with
// ticket_closed_at set): the applicant can post again, the thread opens, a
// line says so, and the steps start over at the next close. A ticket deleted
// by hand is simply missing: nothing to lock or save there, and its officer
// thread still goes through every step. Reopened after it's deleted, the
// record gets a fresh ticket (freshTickets below). "Locked right
// away" means by the next sweep, within 15 minutes.
import { call, DiscordDown, type Fetcher, postTo } from './discord.ts';

const HOUR = 3_600_000;
const PAGE = 100;
const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const ATTACH = 1n << 15n;
const HISTORY = 1n << 16n;
const CREATE_PUBLIC_THREADS = 1n << 35n;
const CREATE_PRIVATE_THREADS = 1n << 36n;
const SEND_IN_THREADS = 1n << 38n;
// What recruit-ticket gives the applicant, and what a closed ticket leaves them.
const APPLICANT = VIEW | SEND | ATTACH | HISTORY;
const READ_ONLY = VIEW | HISTORY;
const NO_POSTING = SEND | ATTACH | CREATE_PUBLIC_THREADS | CREATE_PRIVATE_THREADS | SEND_IN_THREADS;
export const SAVE_FAILURES_TOLD = 3;

export type Closed = 'declined' | 'no_reply' | 'joined' | 'not_joining' | 'withdrawn';

export type TicketRec = {
  id: number;
  team_name: string;
  // Closed, or open again after a reopen.
  status: string;
  open: boolean;
  name_realm: string;
  applicant_discord_id: string | null;
  channel_id: string | null;
  thread_id: string | null;
  officer_channel_id: string | null;
  ticket_closed_at: string | null;
  ticket_saved_at: string | null;
  ticket_save_failures: number;
  delete_after_hours: number | null;
};

export type SavedMessage = {
  discord_message_id: string;
  author_discord_id: string | null;
  author_name: string;
  body: string;
  attachments: { name: string; content_type: string | null }[];
  sent_at: string;
  in_officer_thread: boolean;
};

export type Progress = Partial<{
  ticket_closed_at: string | null;
  ticket_saved_at: string | null;
  ticket_deleted_at: string | null;
  ticket_save_failures: number;
}>;

export interface TicketDb {
  // Closed records whose ticket or thread isn't deleted yet, and open ones
  // whose ticket is still locked from before a reopen.
  closingTickets(): Promise<TicketRec[]>;
  ticketProgress(id: number, progress: Progress): Promise<void>;
  saveMessages(id: number, messages: SavedMessage[]): Promise<void>;
  // Sets ticket_deleted_at while the record is still closed; false if it was
  // reopened.
  claimDelete(id: number, at: string): Promise<boolean>;
  // Open records whose ticket was deleted before a reopen: each gets a fresh
  // one from recruit-ticket.
  reopenedAfterDelete(): Promise<number[]>;
}

type Deps = Fetcher & { db: TicketDb; now: () => Date };

const plural = (n: number, word: string) => n + ' ' + word + (n === 1 ? '' : 's');
const after = (hours: number) => (hours % 24 === 0 ? plural(hours / 24, 'day') : plural(hours, 'hour'));

// The closing message, by reason.
export function closingMessage(status: string, team: string, deleteAfterHours: number | null): string {
  const lead: Record<string, string> = {
    joined: 'Welcome to ' + team + ' for real!',
    declined: 'Thanks for applying to ' + team + '.',
    not_joining: 'Thanks for trialing with ' + team + '.',
    no_reply:
      "We didn't hear back, so " + team + "'s officers have closed your application. You can apply again any time.",
    withdrawn: 'You withdrew your application to ' + team + '.'
  };
  return (
    (lead[status] ?? 'Thanks for applying to ' + team + '.') +
    ' This ticket is closed' +
    (deleteAfterHours === null ? '' : ' and will be deleted in ' + after(deleteAfterHours)) +
    '.' +
    (status === 'joined' ? ' Everything here is saved on Raid Hub.' : '')
  );
}

export const REOPENED = 'This ticket is open again.';
export const SAVE_FAILED = (name: string, where: string) =>
  "Raid Hub couldn't save " +
  name +
  "'s closed ticket after " +
  SAVE_FAILURES_TOLD +
  " tries, so it won't be deleted until it saves. " +
  where;

async function setApplicant(deps: Deps, token: string, t: TicketRec, allow: bigint, deny: bigint) {
  if (!t.channel_id || !t.applicant_discord_id) return;
  const res = await call(deps, token, 'PUT', '/channels/' + t.channel_id + '/permissions/' + t.applicant_discord_id, {
    type: 1,
    allow: String(allow),
    deny: String(deny)
  });
  await res.body?.cancel();
  // A ticket deleted by hand has nothing to lock; its thread carries on.
  if (res.status === 404) return;
  if (!res.ok) throw new Error('Discord refused the ticket permission change: ' + res.status);
}

async function setThreadLocked(deps: Deps, token: string, t: TicketRec, locked: boolean) {
  if (!t.thread_id) return;
  const res = await call(
    deps,
    token,
    'PATCH',
    '/channels/' + t.thread_id,
    // An archived thread (7 quiet days) refuses a change that leaves it
    // archived, so both ways bring it back (fresh-agent review).
    { locked, archived: false }
  );
  await res.body?.cancel();
  // A thread deleted by hand has nothing left to lock.
  if (!res.ok && res.status !== 404) throw new Error('Discord refused the thread change: ' + res.status);
}

type DiscordMessage = {
  id: string;
  author?: { id?: string; username?: string; global_name?: string | null };
  content?: string;
  embeds?: { title?: string; description?: string }[];
  timestamp: string;
  attachments?: { filename?: string; content_type?: string }[];
};

// The text worth keeping: what was written, and an embed's title and text
// (the bot's card), with a line of nothing but mentions dropped.
const NEWLINE = '\n';
export function bodyOf(m: { content?: string; embeds?: { title?: string; description?: string }[] }): string {
  const content = (m.content ?? '').trim();
  const parts = [
    /^(<@[!&]?\d+>\s*)+$/.test(content) ? '' : content,
    ...(m.embeds ?? []).map((e) => [e.title, e.description].filter(Boolean).join(NEWLINE))
  ];
  return parts
    .filter(Boolean)
    .join(NEWLINE + NEWLINE)
    .slice(0, 4000);
}

// Every message in a channel or thread, oldest first. A channel that's gone
// has nothing to save.
async function readAll(deps: Deps, token: string, channelId: string, inThread: boolean): Promise<SavedMessage[]> {
  const out: SavedMessage[] = [];
  let before: string | null = null;
  for (;;) {
    const res = await call(
      deps,
      token,
      'GET',
      '/channels/' + channelId + '/messages?limit=' + PAGE + (before ? '&before=' + before : '')
    );
    if (res.status === 404) {
      await res.body?.cancel();
      return out;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error('Discord refused the ticket read: ' + res.status);
    }
    const page = (await res.json()) as DiscordMessage[];
    for (const m of page) {
      out.push({
        discord_message_id: m.id,
        author_discord_id: m.author?.id ?? null,
        author_name: (m.author?.global_name || m.author?.username || 'Unknown').slice(0, 100),
        body: bodyOf(m),
        attachments: (m.attachments ?? []).map((a) => ({
          name: (a.filename ?? 'file').slice(0, 200),
          content_type: a.content_type ?? null
        })),
        sent_at: new Date(m.timestamp).toISOString(),
        in_officer_thread: inThread
      });
    }
    if (page.length < PAGE) return out.reverse();
    before = page[page.length - 1].id;
  }
}

async function remove(deps: Deps, token: string, channelId: string | null) {
  if (!channelId) return;
  const res = await call(deps, token, 'DELETE', '/channels/' + channelId);
  await res.body?.cancel();
  if (!res.ok && res.status !== 404) throw new Error('Discord refused the delete: ' + res.status);
}

// One record's next steps. Returns what it did, for the sweep's answer.
async function step(deps: Deps, token: string, t: TicketRec): Promise<string | null> {
  const now = deps.now();

  if (t.open) {
    await setApplicant(deps, token, t, APPLICANT, 0n);
    await setThreadLocked(deps, token, t, false);
    await deps.db.ticketProgress(t.id, { ticket_closed_at: null, ticket_saved_at: null, ticket_save_failures: 0 });
    // Last and best effort, so a failure can't post it twice.
    if (t.channel_id) await postTo(deps, token, t.channel_id, { content: REOPENED }).catch(() => null);
    return 'reopened';
  }

  let closedAt = t.ticket_closed_at;
  if (!closedAt) {
    await setApplicant(deps, token, t, READ_ONLY, NO_POSTING);
    await setThreadLocked(deps, token, t, true);
    closedAt = now.toISOString();
    await deps.db.ticketProgress(t.id, { ticket_closed_at: closedAt });
    // Posted once the close is on the record, so a step that fails and is
    // tried again can never post it twice (fresh-agent review). Best effort:
    // a lost message doesn't stop the save.
    if (t.channel_id) {
      await postTo(deps, token, t.channel_id, {
        content: closingMessage(t.status, t.team_name, t.delete_after_hours)
      }).catch(() => null);
    }
  }

  const deleteDue =
    t.delete_after_hours !== null && now.getTime() >= Date.parse(closedAt) + t.delete_after_hours * HOUR;
  // Saved once closed, and again just before deletion, so anything an officer
  // wrote during the wait is kept too (the save skips messages it has).
  if (!t.ticket_saved_at || deleteDue) {
    try {
      const messages = [
        ...(t.channel_id ? await readAll(deps, token, t.channel_id, false) : []),
        ...(t.thread_id ? await readAll(deps, token, t.thread_id, true) : [])
      ];
      await deps.db.saveMessages(t.id, messages);
    } catch (e) {
      const failures = t.ticket_save_failures + 1;
      await deps.db.ticketProgress(t.id, { ticket_save_failures: failures });
      if (failures === SAVE_FAILURES_TOLD && t.officer_channel_id) {
        const where = t.channel_id ? '<#' + t.channel_id + '>' : t.thread_id ? '<#' + t.thread_id + '>' : '';
        await postTo(deps, token, t.officer_channel_id, {
          content: SAVE_FAILED(t.name_realm.split('-')[0], where)
        }).catch((err) =>
          console.error('recruit-reminders: the save-failed notice for ticket ' + t.id + ' did not post:', err)
        );
      }
      throw e;
    }
    await deps.db.ticketProgress(t.id, { ticket_saved_at: now.toISOString(), ticket_save_failures: 0 });
  }

  if (!deleteDue) return t.ticket_closed_at ? null : 'closed';
  // Claimed on the record first, only while it's still closed, so a reopen
  // since this sweep read it keeps its ticket (CodeRabbit).
  if (!(await deps.db.claimDelete(t.id, now.toISOString()))) return null;
  try {
    await remove(deps, token, t.channel_id);
    await remove(deps, token, t.thread_id);
  } catch (e) {
    await deps.db.ticketProgress(t.id, { ticket_deleted_at: null });
    throw e;
  }
  return 'deleted';
}

// A record reopened after its ticket was deleted gets a fresh one: the same
// recruit-ticket an applicant's Send calls, with the cron secret in place of a
// sign-in. recruit-ticket claims it first (a row in recruit_reminders_sent),
// so only one fresh ticket is ever made. "off" (the team stopped making
// tickets) stops the asking; "not_in_server" asks again each sweep until they
// rejoin, with the officers told once; "busy" means another call is making it.
export type Fresh = { url: string; secret: string };

async function freshTickets(deps: Deps, fresh: Fresh) {
  let made = 0;
  for (const id of await deps.db.reopenedAfterDelete()) {
    try {
      const res = await deps.fetch(fresh.url + '/functions/v1/recruit-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': fresh.secret },
        body: JSON.stringify({ application: id }),
        // A ticket is up to about nine Discord calls at five seconds each.
        signal: AbortSignal.timeout(90_000)
      });
      const answer = await res.json().catch(() => null);
      if (res.ok && answer?.status === 'made') made++;
      // off, not_in_server and busy are answers, not failures.
      else if (!res.ok) console.error('recruit-reminders: fresh ticket for ' + id + ':', res.status, answer?.error);
    } catch (e) {
      console.error('recruit-reminders: fresh ticket for ' + id + ' failed:', e instanceof Error ? e.message : e);
    }
  }
  return made;
}

export async function closeTickets(deps: Deps, token: string, fresh?: Fresh) {
  const done = { closed: 0, deleted: 0, reopened: 0, failed: 0, fresh: 0 };
  for (const t of await deps.db.closingTickets()) {
    try {
      const did = await step(deps, token, t);
      if (did) done[did as 'closed' | 'deleted' | 'reopened']++;
    } catch (e) {
      done.failed++;
      console.error(
        'recruit-reminders: ticket ' + t.id + ' failed:',
        e instanceof DiscordDown ? e.message : e instanceof Error ? e.message : e
      );
    }
  }
  if (fresh) done.fresh = await freshTickets(deps, fresh);
  return done;
}
