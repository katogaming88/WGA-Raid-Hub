// recruit-ticket (#1541): what the bot makes in Discord when someone applies,
// by the team's choice in Recruiting settings (team_recruiting.discord_mode),
// seen only by that team's people.
//
// POST { application }, signed in as the applicant, after send (and after
// discord-join, for a team that adds them to the server):
//   ticket          a private channel in the team's ticket category with the
//                   applicant and the team's people, plus an officer-only
//                   thread beside it when the team ticked that
//   officer_thread  a private thread in the officer channel, no applicant
//   officer_post    one message in the officer channel
//   none            nothing (answers off)
// Each gets the application card: the applicant's line about themselves, their
// numbers, links, and the buttons (#1542 answers them). The applicant is then
// sent a welcome DM pointing at their ticket; closed DMs (Discord 50007) are
// noted on the ticket_opened history row, and the answer still carries the
// ticket's link for the after-send page (#1547).
//
// Who sees it: the team's Owner and officers, its assistants and the guild's
// Owner and Admins when the team ticked those, each by their linked Discord
// account, plus the extra roles the team picked. @everyone is denied. Someone
// without a linked Discord can't be added (the settings page warns).
//
// The recruiting sweep (recruit-reminders) calls it too, with the cron secret
// and no signed-in user, for a record reopened after its ticket was deleted:
// that record gets a fresh ticket, its card links the saved conversation, and
// the DM says the application is open again (#1544). Supabase's JWT gate is
// off for this function so that call gets through; a signed-in call is still
// checked against the caller's own token below.
//
// What was made goes on the record (discord_channel_id, discord_thread_id,
// discord_officer_message_id), so calling again answers it and makes nothing.
// A local stack makes nothing either: its server ids are the real servers
// (restored from the production backup), so it posts the card's text to the
// test webhook and stops.
//
// handle() takes its reads and its fetch as an argument (#1006); deps.ts
// supplies the real ones and index.ts serves it.
import { type Env, resolveBot } from '../_shared/discord-destination.ts';
import { truncate } from '../_shared/discord-text.ts';
import { VERSION } from './version.ts';

export type Mode = 'ticket' | 'officer_thread' | 'officer_post' | 'none';

export type Ticket = {
  id: number;
  team_id: number;
  team_name: string;
  guild_name: string;
  team_slug: string;
  person_id: number;
  discord_id: string | null;
  name_realm: string;
  character: { name: string; realm_slug: string } | null;
  class_name: string | null;
  spec_name: string | null;
  other_specs: string[];
  item_level: number | null;
  mplus_score: number | null;
  logs_best_average: number | null;
  mythic_bosses_killed: number | null;
  answers: Array<{ key?: string; answer?: unknown }>;
  sent_by: 'recruiter' | 'friend' | 'nobody';
  sent_by_name: string | null;
  // Their latest earlier record with this team, whose saved conversation the
  // card links to (#1544).
  applied_before: number | null;
  // Reopened after its ticket was deleted: this call makes a fresh one, and
  // the card links to the record's own saved conversation (#1544).
  reopened: boolean;
  // When the old ticket was deleted: the key of this reopen's claims.
  ticket_deleted_at: string | null;
  // Already made, from the record.
  discord_channel_id: string | null;
  discord_thread_id: string | null;
  discord_officer_message_id: string | null;
  // The latest ticket_opened row's detail: null when the welcome DM went out.
  opened_detail: string | null;
  // The team's settings.
  mode: Mode;
  thread_with_ticket: boolean;
  server_id: string | null;
  officer_channel_id: string | null;
  ticket_category_id: string | null;
  role_ids: string[];
  // Linked Discord ids of the people who see it (officers, and assistants or
  // guild admins when ticked), the applicant left out.
  viewer_ids: string[];
};

export type Visibility = {
  visible_to_team_officers: boolean;
  visible_to_team_assistants: boolean;
  visible_to_guild_admins: boolean;
};

// The linked Discord ids that see a team's ticket: its current Owner and
// officers, its assistants and the guild's Owner and Admins when ticked. Only
// rows of this team and this guild count, whatever else is passed in.
export function viewerIds(
  team: { id: number; guild_id: number },
  v: Visibility,
  members: Array<{ team_id: number; person_id: number; rank: string; archived_at: string | null }>,
  guildRanks: Array<{ guild_id: number; person_id: number; rank: string }>,
  discordOf: Map<number, string | null>,
  applicantDiscordId: string | null
): string[] {
  const ranks = new Set([
    ...(v.visible_to_team_officers ? ['owner', 'officer'] : []),
    ...(v.visible_to_team_assistants ? ['assistant'] : [])
  ]);
  const people = [
    ...members.filter((m) => m.team_id === team.id && m.archived_at === null && ranks.has(m.rank)),
    ...(v.visible_to_guild_admins
      ? guildRanks.filter((g) => g.guild_id === team.guild_id && (g.rank === 'owner' || g.rank === 'admin'))
      : [])
  ].map((p) => p.person_id);
  const ids = people.map((p) => discordOf.get(p)).filter((d): d is string => !!d && d !== applicantDiscordId);
  return [...new Set(ids)];
}

export type FreshClaim = 'fresh_ticket' | 'fresh_not_in_server';

export type Made = {
  discord_channel_id: string | null;
  discord_thread_id: string | null;
  discord_officer_message_id: string | null;
};

export interface TicketDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  // The caller's own open application with this id, or null. With no caller
  // (the sweep), the open application itself.
  ticket(authUserId: string | null, applicationId: number): Promise<Ticket | null>;
  // Writes what was made and the ticket_opened history row.
  saveMade(applicationId: number, actor: number | null, made: Made, detail: string | null): Promise<void>;
  // Once-only claims for a reopen, a row each in recruit_reminders_sent keyed
  // on when the old ticket was deleted: 'fresh_ticket' while one call makes
  // the fresh ticket, 'fresh_not_in_server' for the officers' notice. False
  // when the claim was already taken.
  claim(applicationId: number, key: FreshClaim, deletedAt: string): Promise<boolean>;
  unclaim(applicationId: number, key: FreshClaim, deletedAt: string): Promise<void>;
  // The team stopped making tickets: clears ticket_deleted_at so the sweep
  // stops asking.
  stopFresh(applicationId: number): Promise<void>;
}

export type Deps = { fetch: typeof fetch; db: TicketDb; env: Env };

export const API = 'https://discord.com/api/v10';
export const DEADLINE_MS = 5_000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

const refuse = (error: string, status: number) => jsonResponse({ success: false, error }, status);

export const NOT_SET_UP = 'The Discord bot is not set up on this site yet.';
export const NOT_YOURS = 'That application is not yours, or it is closed.';
export const DISCORD_DOWN = 'Discord did not answer. Your application is saved; an officer will reach out.';
export const SOMETHING_WRONG = 'Something went wrong. Your application is saved.';
export const DMS_CLOSED = "Their Discord DMs are closed, so the welcome message didn't arrive.";
// Without a ticket they may never have been added to the server, and Discord
// gives the same answer (50007) for that as for closed DMs.
export const DMS_BLOCKED =
  "Discord wouldn't deliver the welcome message: their DMs are closed, or they aren't in the server.";
export const NOT_REOPENED = 'That application has no deleted ticket to replace.';
export const DM_NOT_SENT = "The welcome message wasn't sent.";
export const DM_FAILED = "The welcome message couldn't be sent.";

// Discord's permission bits this needs.
const VIEW = 1n << 10n;
const SEND = 1n << 11n;
const EMBED = 1n << 14n;
const ATTACH = 1n << 15n;
const HISTORY = 1n << 16n;
const MANAGE_CHANNELS = 1n << 4n;
const PEOPLE = VIEW | SEND | EMBED | ATTACH | HISTORY;
const APPLICANT = VIEW | SEND | ATTACH | HISTORY;
const BOT = VIEW | SEND | EMBED | HISTORY | MANAGE_CHANNELS;

const TEXT = 0;
const UNKNOWN_MEMBER = 10007;
const PRIVATE_THREAD = 12;
// Discord allows 100 overwrites on a channel. @everyone, the bot, the
// applicant and up to 25 roles leave 71 for people; a team's officers,
// assistants and the guild's admins fit easily, and past that the rest still
// see it through a role.
export const MAX_OVERWRITES = 100;
// Private-thread members are added one call each; a team is far under this.
const MAX_THREAD_MEMBERS = 50;

class DiscordDown extends Error {}

const timed = () => AbortSignal.timeout(DEADLINE_MS);

async function call(deps: Deps, token: string, method: string, path: string, body?: unknown): Promise<Response> {
  try {
    return await deps.fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timed()
    });
  } catch {
    throw new DiscordDown();
  }
}

async function must<T>(res: Response): Promise<T> {
  if (!res.ok) throw new DiscordDown();
  return (await res.json()) as T;
}

// The channel's name: the team's key and the character's name, lowercased,
// accents stripped (Katorrí -> katorri), anything else Discord would refuse
// dropped, and -2, -3 on the end while the server has one by that name.
export function channelName(slug: string, nameRealm: string, taken: Set<string>): string {
  const character =
    nameRealm
      .split('-')[0]
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '') || 'applicant';
  const base = (slug + '-' + character).slice(0, 90);
  let name = base;
  for (let n = 2; taken.has(name); n++) name = base + '-' + n;
  return name;
}

const escape = (s: string) => s.replace(/([*_`~|>\\[\]])/g, '\\$1');

export function linksOf(t: Ticket) {
  // ponytail: US region only, as character-stats; a guild elsewhere needs the
  // region on the team.
  const name = t.character?.name ?? t.name_realm.split('-')[0];
  const realm =
    t.character?.realm_slug ??
    t.name_realm
      .slice(t.name_realm.indexOf('-') + 1)
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/\s+/g, '-');
  const path = 'us/' + encodeURIComponent(realm) + '/' + encodeURIComponent(name.toLowerCase());
  return {
    warcraftlogs: 'https://www.warcraftlogs.com/character/' + path,
    raiderio: 'https://raider.io/characters/' + path,
    armory: 'https://worldofwarcraft.blizzard.com/en-us/character/' + path
  };
}

// The Recruits page's record (#1549).
export const recordUrl = (siteUrl: string, id: number) => siteUrl + '/recruits/' + id;

// The buttons' ids, which #1542's handler in discord-interactions reads.
export const BUTTON_PREFIX = 'recruit:';

const answerOf = (t: Ticket, key: string) => {
  const a = t.answers.find((x) => x?.key === key)?.answer;
  return typeof a === 'string' && a.trim() !== '' ? a.trim() : null;
};

// The application card: its message body, without mentions or content.
export function card(t: Ticket, siteUrl: string) {
  const about = answerOf(t, 'about');
  const links = linksOf(t);
  const spec = [t.spec_name, t.class_name].filter(Boolean).join(' ') || null;
  const sentBy =
    t.sent_by === 'recruiter'
      ? (t.sent_by_name ?? 'A recruiter')
      : t.sent_by === 'friend'
        ? 'A friend: ' + (t.sent_by_name ?? '')
        : null;
  const fields: Array<[string, string | null]> = [
    ['Spec', spec],
    ['Other specs', t.other_specs.length ? t.other_specs.join(', ') : null],
    ['Item level', t.item_level === null ? null : String(t.item_level)],
    ['M+ score', t.mplus_score === null ? null : String(t.mplus_score)],
    ['Best logs average', t.logs_best_average === null ? null : String(t.logs_best_average)],
    ['Mythic bosses killed', t.mythic_bosses_killed === null ? null : String(t.mythic_bosses_killed)],
    ['Raid nights', answerOf(t, 'nights')],
    ['Sent by', sentBy]
  ];
  // Links, written as Discord markdown, so not escaped like the rest.
  const linked: Array<[string, string | null]> = [
    [
      'Applied before',
      t.applied_before ? '[Yes: their earlier ticket](' + recordUrl(siteUrl, t.applied_before) + ')' : null
    ],
    ['Reopened', t.reopened ? '[Their earlier ticket is saved](' + recordUrl(siteUrl, t.id) + ')' : null]
  ];
  return {
    embeds: [
      {
        title: truncate(t.name_realm, 256),
        description:
          (about ? '> ' + escape(truncate(about, 100)) + '\n\n' : '') +
          '[Warcraft Logs](' +
          links.warcraftlogs +
          ') · [Raider.IO](' +
          links.raiderio +
          ') · [Armory](' +
          links.armory +
          ')',
        fields: [
          ...fields
            .filter(([, v]) => v !== null)
            .map(([name, value]) => ({ name, value: escape(truncate(value!, 1024)), inline: true })),
          ...linked.filter(([, v]) => v !== null).map(([name, value]) => ({ name, value: value!, inline: true }))
        ]
      }
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Start a trial', custom_id: BUTTON_PREFIX + 'trial:' + t.id },
          { type: 2, style: 4, label: 'Decline', custom_id: BUTTON_PREFIX + 'decline:' + t.id },
          { type: 2, style: 2, label: 'Add note', custom_id: BUTTON_PREFIX + 'note:' + t.id },
          { type: 2, style: 5, label: 'Open in Raid Hub', url: recordUrl(siteUrl, t.id) }
        ]
      }
    ]
  };
}

const mention = (id: string) => '<@' + id + '>';

// The ticket's overwrites: @everyone out, the bot, the applicant, the team's
// people and roles in.
export function overwrites(t: Ticket, botId: string) {
  const people = t.viewer_ids.slice(0, MAX_OVERWRITES - 3 - t.role_ids.length);
  return [
    { id: t.server_id!, type: 0, allow: '0', deny: String(VIEW) },
    { id: botId, type: 1, allow: String(BOT), deny: '0' },
    { id: t.discord_id!, type: 1, allow: String(APPLICANT), deny: '0' },
    ...t.role_ids.map((id) => ({ id, type: 0, allow: String(PEOPLE), deny: '0' })),
    ...people.map((id) => ({ id, type: 1, allow: String(PEOPLE), deny: '0' }))
  ];
}

// A private thread in the officer channel with the team's people in it. The
// roles join by being mentioned in its first message, which is how Discord
// adds a role to a private thread.
//
// Discord decides the rest from the officer channel's own permissions: anyone
// with Manage Threads there sees every private thread in it, and someone who
// can't see the channel is never added. So each team needs its own officer
// channel, which the Recruiting settings page (#1548) says.
async function officerThread(
  deps: Deps,
  token: string,
  t: Ticket,
  siteUrl: string,
  ticketId: string | null,
  made: Made
) {
  const thread = await must<{ id: string }>(
    await call(deps, token, 'POST', '/channels/' + t.officer_channel_id + '/threads', {
      name: truncate('Applicant: ' + t.name_realm, 100),
      type: PRIVATE_THREAD,
      invitable: false,
      auto_archive_duration: 10080
    })
  );
  // On the record at once, so a failure below still saves it (CodeRabbit).
  made.discord_thread_id = thread.id;
  for (const id of t.viewer_ids.slice(0, MAX_THREAD_MEMBERS)) {
    // One person who left the server shouldn't stop the rest.
    await call(deps, token, 'PUT', '/channels/' + thread.id + '/thread-members/' + id).catch(() => null);
  }
  await must(
    await call(deps, token, 'POST', '/channels/' + thread.id + '/messages', {
      content:
        [...t.viewer_ids.map(mention), ...t.role_ids.map((r) => '<@&' + r + '>')].join(' ') +
        (ticketId ? '\nTheir ticket: <#' + ticketId + '>' : ''),
      allowed_mentions: { parse: [], users: t.viewer_ids, roles: t.role_ids },
      ...card(t, siteUrl)
    })
  );
  return thread.id;
}

async function welcome(deps: Deps, token: string, t: Ticket, ticketUrl: string | null): Promise<string | null> {
  try {
    const dm = await must<{ id: string }>(
      await call(deps, token, 'POST', '/users/@me/channels', { recipient_id: t.discord_id })
    );
    const res = await call(deps, token, 'POST', '/channels/' + dm.id + '/messages', {
      content: t.reopened
        ? 'Your application to ' +
          t.team_name +
          ' is open again.' +
          (ticketUrl ? ' Your new ticket with the officers: ' + ticketUrl : ' An officer will message you.')
        : ticketUrl
          ? 'Welcome to ' +
            t.guild_name +
            '! Your private ticket with ' +
            t.team_name +
            "'s officers is ready: " +
            ticketUrl
          : 'Your application to ' + t.team_name + ' is in. An officer will message you.',
      components: ticketUrl
        ? [{ type: 1, components: [{ type: 2, style: 5, label: 'Open your ticket', url: ticketUrl }] }]
        : []
    });
    if (res.ok) return null;
    if ((await res.json().catch(() => null))?.code !== 50007) return DM_FAILED;
    return t.mode === 'ticket' ? DMS_CLOSED : DMS_BLOCKED;
  } catch {
    return DM_FAILED;
  }
}

const jump = (serverId: string, channelId: string) => 'https://discord.com/channels/' + serverId + '/' + channelId;

function answerMade(t: Ticket, made: Made, dm: string | null) {
  const where = made.discord_channel_id ?? made.discord_thread_id;
  return {
    success: true,
    status: 'made',
    mode: t.mode,
    // The applicant's way in: only a ticket is theirs to open (#1547).
    ticket_url: t.mode === 'ticket' && where ? jump(t.server_id!, where) : null,
    welcome_dm: dm ?? 'sent'
  };
}

class SaveFailed extends Error {}

// Made in Discord but not on the record: the next call would make it again,
// so the ids go in the function's log for an officer to clean up by hand.
async function save(deps: Deps, t: Ticket, actor: number | null, made: Made, detail: string | null) {
  try {
    await deps.db.saveMade(t.id, actor, made, detail);
  } catch {
    console.error('recruit-ticket: made in Discord but not recorded', JSON.stringify({ application: t.id, ...made }));
    throw new SaveFailed();
  }
}

export const PARTLY_MADE = 'Discord stopped answering partway; the card may be missing.';

async function make(deps: Deps, token: string, siteUrl: string, t: Ticket, actor: number | null): Promise<Response> {
  const made: Made = { discord_channel_id: null, discord_thread_id: null, discord_officer_message_id: null };
  try {
    return await makeInto(deps, token, siteUrl, t, actor, made);
  } catch (e) {
    const any = made.discord_channel_id || made.discord_thread_id || made.discord_officer_message_id;
    // Whatever exists is recorded, so a retry doesn't make a second one.
    if (!(e instanceof SaveFailed) && any) await save(deps, t, actor, made, PARTLY_MADE);
    // Nothing made for a reopened record: hand the claim back so the next
    // sweep tries again. Made but not saved keeps it, so nothing is made
    // twice; the ids are in the log for an officer.
    if (!any && t.reopened) await deps.db.unclaim(t.id, 'fresh_ticket', t.ticket_deleted_at!).catch(() => null);
    throw e;
  }
}

export const NOT_IN_SERVER_NOTICE = (name: string) =>
  name +
  "'s application was reopened, but they've left the Discord server, so there's no new ticket yet. Raid Hub makes it once they rejoin.";

async function makeInto(
  deps: Deps,
  token: string,
  siteUrl: string,
  t: Ticket,
  actor: number | null,
  made: Made
): Promise<Response> {
  const me = await must<{ id: string }>(await call(deps, token, 'GET', '/users/@me'));

  if (t.mode === 'ticket') {
    // The applicant has to be in the server to be let into a channel there;
    // the page calls again once discord-join has added them.
    const member = await call(deps, token, 'GET', '/guilds/' + t.server_id + '/members/' + t.discord_id);
    // Only Discord's Unknown Member means not in yet: a 404 for an unknown
    // server (the bot was removed) is a failure, or they'd wait forever.
    if (!member.ok) {
      const code = (await member.json().catch(() => null))?.code;
      if (member.status === 404 && code === UNKNOWN_MEMBER) {
        // A reopened record hands its claim back, so the sweep makes the
        // ticket once they rejoin; the officers are told once why there's
        // none yet, and again only if that notice didn't post.
        if (t.reopened) {
          await deps.db.unclaim(t.id, 'fresh_ticket', t.ticket_deleted_at!);
          if (t.officer_channel_id && (await deps.db.claim(t.id, 'fresh_not_in_server', t.ticket_deleted_at!))) {
            const posted = await call(deps, token, 'POST', '/channels/' + t.officer_channel_id + '/messages', {
              content: NOT_IN_SERVER_NOTICE(t.name_realm.split('-')[0]),
              allowed_mentions: { parse: [] }
            })
              .then((r) => r.ok)
              .catch(() => false);
            if (!posted) await deps.db.unclaim(t.id, 'fresh_not_in_server', t.ticket_deleted_at!);
          }
        }
        return jsonResponse({ success: true, status: 'not_in_server' });
      }
      throw new DiscordDown();
    }
    const channels = await must<Array<{ name: string }>>(
      await call(deps, token, 'GET', '/guilds/' + t.server_id + '/channels')
    );
    const channel = await must<{ id: string }>(
      await call(deps, token, 'POST', '/guilds/' + t.server_id + '/channels', {
        name: channelName(t.team_slug, t.name_realm, new Set(channels.map((c) => c.name))),
        type: TEXT,
        parent_id: t.ticket_category_id,
        permission_overwrites: overwrites(t, me.id)
      })
    );
    made.discord_channel_id = channel.id;
    const users = [t.discord_id!, ...t.viewer_ids];
    await must(
      await call(deps, token, 'POST', '/channels/' + channel.id + '/messages', {
        content: users.map(mention).join(' '),
        allowed_mentions: { parse: [], users },
        ...card(t, siteUrl)
      })
    );
    if (t.thread_with_ticket && t.officer_channel_id) {
      await officerThread(deps, token, t, siteUrl, channel.id, made);
    }
  } else if (t.mode === 'officer_thread') {
    await officerThread(deps, token, t, siteUrl, null, made);
  } else {
    const msg = await must<{ id: string }>(
      await call(deps, token, 'POST', '/channels/' + t.officer_channel_id + '/messages', {
        content: t.viewer_ids.map(mention).join(' '),
        allowed_mentions: { parse: [], users: t.viewer_ids },
        ...card(t, siteUrl)
      })
    );
    made.discord_officer_message_id = msg.id;
  }

  const ticketUrl = made.discord_channel_id ? jump(t.server_id!, made.discord_channel_id) : null;
  const dm = await welcome(deps, token, t, ticketUrl);
  await save(deps, t, actor, made, dm);
  return jsonResponse(answerMade(t, made, dm));
}

async function route(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return refuse('Method not allowed', 405);

  // The recruiting sweep, for a record reopened after its ticket was deleted
  // (#1544), sends the cron secret instead of a signed-in applicant.
  const secret = deps.env.get('OPTIONAL_RSVP_REMINDERS_SECRET');
  const sweep = !!secret && req.headers.get('x-cron-secret') === secret;
  const authHeader = req.headers.get('Authorization');
  if (!sweep && !authHeader) return refuse('Not signed in', 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return refuse('Missing application', 400);
  }
  const id = body?.application;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return refuse('Missing application', 400);

  const token = deps.env.get('DISCORD_BOT_TOKEN');
  const siteUrl = deps.env.get('SITE_URL')?.replace(/\/+$/, '');
  const dest = resolveBot(deps.env);
  if (dest.kind === 'bot' && (!token || !siteUrl)) return refuse(NOT_SET_UP, 503);

  const user = sweep ? null : await deps.db.getUser(authHeader!);
  if (!sweep && !user) return refuse('Not signed in', 401);
  const t = await deps.db.ticket(user?.id ?? null, id);
  if (!t) return refuse(NOT_YOURS, 403);
  // The secret makes only a reopened record's fresh ticket.
  if (sweep && !t.reopened) return refuse(NOT_REOPENED, 409);

  // Nothing to make: the team chose nothing, or hasn't picked what it needs.
  const ready =
    t.mode !== 'none' &&
    t.server_id &&
    t.discord_id &&
    (t.mode === 'ticket' ? t.ticket_category_id : t.officer_channel_id);
  if (!ready) {
    // The team stopped making tickets: nothing to make, so the sweep stops
    // asking.
    if (t.reopened) await deps.db.stopFresh(t.id);
    return jsonResponse({ success: true, status: 'off' });
  }

  // Made already: answer it again.
  // ponytail: two calls at the same instant could both make a first ticket;
  // the page calls once per send. A reopened record's fresh one is claimed
  // below, so it can't be made twice.
  if (!t.reopened && (t.discord_channel_id || t.discord_thread_id || t.discord_officer_message_id)) {
    // The DM's outcome is the one the record kept; a partly made one never sent it.
    const dm = t.opened_detail === PARTLY_MADE ? DM_NOT_SENT : t.opened_detail;
    return jsonResponse(answerMade(t, t, dm));
  }

  if (dest.kind !== 'bot') {
    if (dest.kind === 'post') {
      await deps
        .fetch(dest.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: '[local] ' + t.mode + ' for ' + t.name_realm + ' (nothing made on a local stack)',
            allowed_mentions: { parse: [] },
            embeds: card(t, siteUrl ?? 'http://localhost').embeds
          }),
          signal: timed()
        })
        .catch(() => null);
    }
    return jsonResponse({ success: true, status: 'local' });
  }

  // A reopened record's old ones are deleted. Whoever takes the claim makes
  // the fresh one (the sweep or the applicant, two sweeps at once); anyone
  // else is told it's already being made. ticket_deleted_at stays set until
  // the new ids are saved, so every caller sees it's a reopen.
  let fresh = t;
  if (t.reopened) {
    if (!(await deps.db.claim(t.id, 'fresh_ticket', t.ticket_deleted_at!))) {
      return jsonResponse({ success: true, status: 'busy' });
    }
    fresh = { ...t, discord_channel_id: null, discord_thread_id: null, discord_officer_message_id: null };
  }

  try {
    // The sweep's call has no person behind it.
    return await make(deps, token!, siteUrl!, fresh, sweep ? null : t.person_id);
  } catch (e) {
    if (e instanceof DiscordDown) return refuse(DISCORD_DOWN, 502);
    throw e;
  }
}

// A throw anywhere still answers with the CORS headers (as discord-join).
export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    return await route(req, deps);
  } catch {
    return refuse(SOMETHING_WRONG, 500);
  }
}
