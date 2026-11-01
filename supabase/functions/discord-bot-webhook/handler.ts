// discord-bot-webhook (#224, #959): the site's Discord notices. It used to
// forward each one to a bot process on a VM; since #959 it posts them itself
// with the bot's token, to the channel and ping role the team picked on
// Settings › Discord (#994).
//
// POST { action, team, teamId?, payload }. `team` is the team's address key;
// `teamId` settles it where two guilds use the same key. What each action
// posts is in posts.ts; who may ask for it is its gate:
//   - optionalReminder: the optional-rsvp-reminders job's x-cron-secret.
//   - signup, addCharacter, rsvp, signupSheetSync, verifyChannel: a signed-in
//     caller. addCharacter posts the caller's own add as the database records
//     it, not their text (#1674). verifyChannel is for whoever may change the
//     team's Discord settings.
//   - selfreceived, bis, mplus: no sign-in; these forms work signed out on the
//     current site.
//   - signup, rsvp, selfreceived, bis, mplus also need that character's row on
//     that team from the last minute, so the post is about something real and
//     about that team (CodeRabbit on #1727).
//
// Before a post goes out, its channel and ping role must be in the team's own
// server (#1712): ids are global in Discord and the bot sits in many servers,
// so a channel picked from another guild's server is refused here. A kind of
// post with no channel is off and posts nothing. A 429 waits Discord's
// retry_after and tries once more.
//
// Quiet hours are not held yet: that needs the outbox (#962). The signup sheet
// is #960's; until then signupSheetSync answers OK and posts nothing.
//
// handle() takes its reads, its fetch and its environment as an argument
// (#1006), so tests/edge/ runs it against plain objects; deps.ts supplies the
// real ones and index.ts serves it.
import { resolveBot } from '../_shared/discord-destination.ts';
import {
  ACTIONS,
  type Kind,
  MissingFields,
  type Message,
  type Payload,
  type RecordTable,
  buildPost,
  buildReminder,
  mentions
} from './posts.ts';
import { VERSION } from './version.ts';

// What add_own_character() wrote, as my_recent_own_add() reads it back.
export type OwnAdd = {
  auditId: number;
  team: string;
  member: string;
  nameRealm: string;
  classSpec: string;
  addedAt: string;
};

export type PostSetting = { serverId: string; channelId: string | null; roleId: string | null };

export interface RelayDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  // The caller's own newest add on this team from the last five minutes.
  latestOwnAdd(authHeader: string, team: string): Promise<OwnAdd | null>;
  // The team with this address key (and id, when given); 'ambiguous' when
  // the key alone matches more than one.
  team(key: string, id: number | null): Promise<{ id: number } | 'ambiguous' | null>;
  // The team's server, and its channel and ping role for one kind of post;
  // null when the team has no Discord server set.
  postSetting(teamId: number, kind: Kind): Promise<PostSetting | null>;
  serverOf(teamId: number): Promise<string | null>;
  // A row in `table` for that character on that team since `since` (an RSVP
  // counts when it last changed).
  recentRecord(table: RecordTable, teamId: number, nameRealm: string, since: Date): Promise<boolean>;
  markPosted(teamId: number, kind: Kind): Promise<void>;
  // Whether the caller may change this team's Discord settings.
  canManageDiscord(authHeader: string, teamId: number): Promise<boolean>;
}

export type Env = { get(name: string): string | undefined };

export type Deps = {
  fetch: typeof fetch;
  env: Env;
  db: RelayDb;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export const API = 'https://discord.com/api/v10';
export const CRON_SECRET = 'OPTIONAL_RSVP_REMINDERS_SECRET';
export const BOT_TOKEN = 'DISCORD_BOT_TOKEN';
// How long a request row proves a signed-out post (#959): the form posts
// straight after the row is written.
export const RECORD_WINDOW_MS = 60_000;
// The longest a 429 is waited out before giving up on the post.
const MAX_RETRY_WAIT_MS = 5_000;

export const NOT_SIGNED_IN = 'Not signed in';
export const NO_RECORD = 'No matching request was just made';
export const NOT_IN_SERVER = "That channel is not in the team's Discord server";
export const CANT_SEE = "Channel not found, or the bot can't see it";

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

const refuse = (error: string, status: number) => jsonResponse({ success: false, error }, status);

type Answer = { status: number; body: any };

// One Discord REST call as the bot, waiting out one 429.
async function discord(deps: Deps, token: string, path: string, body?: unknown): Promise<Answer> {
  const call = () =>
    deps.fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  let res = await call();
  if (res.status === 429) {
    const wait = Number((await res.json().catch(() => ({})))?.retry_after ?? 1) * 1000;
    await (deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(Math.min(wait, MAX_RETRY_WAIT_MS));
    res = await call();
  }
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return refuse('Method not allowed', 405);

  let parsed: { action?: unknown; team?: unknown; teamId?: unknown; payload?: unknown };
  try {
    parsed = await req.json();
  } catch {
    return refuse('Bad request', 400);
  }
  const action = typeof parsed?.action === 'string' ? parsed.action : '';
  const def = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!def) return refuse('Unknown action: ' + action, 400);
  let payload: Payload = parsed.payload && typeof parsed.payload === 'object' ? (parsed.payload as Payload) : {};
  const now = (deps.now ?? (() => new Date()))();

  // The gate, before anything is read on the caller's behalf.
  const authHeader = req.headers.get('Authorization');
  if (def.gate === 'cron') {
    const secret = deps.env.get(CRON_SECRET);
    // An unset secret refuses everything rather than letting everything in.
    if (!secret || req.headers.get('x-cron-secret') !== secret) return refuse('Unauthorized', 401);
  } else if (def.gate === 'signedIn') {
    const user = authHeader ? await deps.db.getUser(authHeader) : null;
    if (!user) return refuse(NOT_SIGNED_IN, 401);
  }

  const dest = resolveBot(deps.env);
  const token = deps.env.get(BOT_TOKEN);
  if (dest.kind === 'bot' && !token) {
    console.error('discord-bot-webhook: ' + BOT_TOKEN + ' is not set');
    return refuse('The Discord bot is not set up', 500);
  }

  if (action === 'optionalReminder') {
    let message: Message;
    try {
      message = buildReminder(payload);
    } catch (e) {
      if (e instanceof MissingFields) return refuse('Missing required fields', 400);
      throw e;
    }
    if (dest.kind === 'skip') return jsonResponse({ success: true, posted: false });
    if (dest.kind === 'post') {
      await localPost(deps, dest.url, { ...message, content: `DM to ${String(payload.discordId)}` });
      return jsonResponse({ success: true });
    }
    // A DM that can't be delivered (closed DMs, left the server) still
    // answers OK, so the job marks it sent instead of retrying forever.
    const dm = await discord(deps, token!, '/users/@me/channels', { recipient_id: String(payload.discordId) });
    if (dm.status === 200 && dm.body?.id) await discord(deps, token!, `/channels/${dm.body.id}/messages`, message);
    return jsonResponse({ success: true });
  }

  const teamKey = typeof parsed.team === 'string' ? parsed.team : '';
  if (!teamKey) return refuse('Missing team', 400);
  const teamId = typeof parsed.teamId === 'number' ? parsed.teamId : null;
  const team = await deps.db.team(teamKey, teamId);
  if (team === 'ambiguous') return refuse('Two teams use that key; send teamId', 400);
  if (!team) return refuse('Unknown team: ' + teamKey, 400);

  if (def.officer && !(await deps.db.canManageDiscord(authHeader!, team.id))) return refuse('Not authorized', 403);

  if (def.record) {
    const nameRealm = def.record.nameRealm(payload);
    const since = new Date(now.getTime() - RECORD_WINDOW_MS);
    if (!nameRealm || !(await deps.db.recentRecord(def.record.table, team.id, nameRealm, since))) {
      return refuse(NO_RECORD, 403);
    }
  }

  if (action === 'signupSheetSync') return jsonResponse({ success: true, posted: false });

  if (action === 'verifyChannel') {
    const channelId = String(payload.channelId ?? '');
    if (dest.kind !== 'bot') {
      return jsonResponse({
        success: true,
        ok: false,
        error: 'Checking a channel needs the bot, which a local stack does not hold'
      });
    }
    const serverId = await deps.db.serverOf(team.id);
    const channel = /^[0-9]{17,20}$/.test(channelId) ? await discord(deps, token!, `/channels/${channelId}`) : null;
    if (!channel || channel.status !== 200) return jsonResponse({ success: true, ok: false, error: CANT_SEE });
    if (channel.body?.guild_id !== serverId) return jsonResponse({ success: true, ok: false, error: NOT_IN_SERVER });
    if (channel.body?.type !== 0 && channel.body?.type !== 5) {
      return jsonResponse({ success: true, ok: false, error: 'That is not a text channel' });
    }
    return jsonResponse({ success: true, ok: true, name: channel.body.name });
  }

  if (action === 'addCharacter') {
    const add = await deps.db.latestOwnAdd(authHeader!, teamKey);
    if (!add) return refuse('No character added', 404);
    payload = { member: add.member, nameRealm: add.nameRealm, classSpec: add.classSpec, submittedAt: add.addedAt };
  }

  const kind = def.kind!;
  const setting = await deps.db.postSetting(team.id, kind);
  if (!setting?.channelId) return jsonResponse({ success: true, posted: false });

  let message: Message;
  try {
    message = buildPost(action, payload, dest.kind === 'bot' ? setting.roleId : null, now.toISOString());
  } catch (e) {
    if (e instanceof MissingFields) return refuse('Missing required fields', 400);
    throw e;
  }

  if (dest.kind === 'skip') return jsonResponse({ success: true, posted: false });
  if (dest.kind === 'post') {
    await localPost(deps, dest.url, message);
    return jsonResponse({ success: true, posted: true });
  }

  // The channel and the role must be in the team's own server (#1712).
  const channel = await discord(deps, token!, `/channels/${setting.channelId}`);
  if (channel.status !== 200 || channel.body?.guild_id !== setting.serverId) {
    console.error(`discord-bot-webhook: ${action} for team ${team.id}: channel ${setting.channelId} refused`);
    return refuse(channel.status === 200 ? NOT_IN_SERVER : CANT_SEE, 409);
  }
  if (setting.roleId) {
    const roles = await discord(deps, token!, `/guilds/${setting.serverId}/roles`);
    const inServer = Array.isArray(roles.body) && roles.body.some((r: { id?: string }) => r.id === setting.roleId);
    if (!inServer) {
      // Post without the ping rather than drop the notice.
      console.error(`discord-bot-webhook: team ${team.id}'s ${kind} role ${setting.roleId} is not in its server`);
      message = buildPost(action, payload, null, now.toISOString());
    }
  }

  const sent = await discord(deps, token!, `/channels/${setting.channelId}/messages`, message);
  if (sent.status !== 200) {
    console.error(`discord-bot-webhook: ${action} for team ${team.id} answered ${sent.status}`);
    return refuse('Discord answered ' + sent.status, 502);
  }
  await deps.db.markPosted(team.id, kind);
  return jsonResponse({ success: true, posted: true });
}

// A local stack's post to the test webhook: marked, pinging nobody.
async function localPost(deps: Deps, url: string, message: Message) {
  const res = await deps.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '[local] ' + (message.content ?? '').replace(/<@&\d+>\s*/g, ''),
      embeds: message.embeds,
      allowed_mentions: mentions(null)
    })
  });
  if (!res.ok) console.error('discord-bot-webhook local post answered ' + res.status);
}
