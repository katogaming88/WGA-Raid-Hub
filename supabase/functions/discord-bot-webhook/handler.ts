// discord-bot-webhook (#224, #959): the site's Discord notices. It used to
// forward each one to a bot process on a VM; since #959 it posts them itself
// with the bot's token, to the channel and ping role the team picked on
// Settings › Discord (#994).
//
// Every channel notice is queued by the write behind it (#962): RSVP changes,
// signups, adds, BiS, Mark Received and M+ requests each add a
// discord_post_queue row built from what they saved. The drain, called every
// minute by pg_cron, takes the due rows of teams not in quiet hours and posts
// each once. A post that fails waits and tries again, five tries in all, then
// stays as failed. A team can batch its RSVP changes (#1710, rsvp-batch.ts): a
// change waits for its batched post, and waiting uses up no try.
//
// POST { action, team?, teamId?, payload? }:
//   - drain, signupSheets and optionalReminder: a scheduled job's x-cron-secret.
//   - signupSheetSync, verifyChannel: a signed-in caller; signupSheetSync for
//     someone on the team, verifyChannel for whoever may change the team's
//     Discord settings. `team` is the team's
//     address key; `teamId` settles it where two guilds use the same key.
//
// Before a post goes out, its channel and ping role must be in the team's own
// server (#1712): ids are global in Discord and the bot sits in many servers,
// so a channel picked from another guild's server is refused here. A kind of
// post with no channel is off, and its queued notices are skipped. A 429
// waits Discord's retry_after and tries once more.
//
// The signup sheets (#960, _shared/signup-sheet.ts): signupSheets, every 15
// minutes from pg_cron, posts each raid night's sheet when it is due and keeps
// every posted one current; signupSheetSync, after an RSVP on the site, edits
// that night's sheet if one is posted. Only the bot can post a sheet, since
// its Refresh button is answered by discord-interactions: a local stack posts
// none. The same run posts each team's weekly boss lineup when it's due and
// keeps the week's post current (#1709, _shared/lineup-post.ts).
//
// handle() takes its reads, its fetch and its environment as an argument
// (#1006), so tests/edge/ runs it against plain objects; deps.ts supplies the
// real ones and index.ts serves it.
import { resolveBot } from '../_shared/discord-destination.ts';
import { discordRequestBody } from '../_shared/discord-text.ts';
import type { Picture } from '../_shared/sheet-picture.ts';
import { type LineupDb, sweepLineups } from '../_shared/lineup-post.ts';
import { type DiscordFile, type SheetDb, refreshSheet, startsAt, sweepSheets } from '../_shared/signup-sheet.ts';
import {
  ACTIONS,
  type Kind,
  MissingFields,
  type Message,
  type Payload,
  buildPost,
  buildReminder,
  mentions
} from './posts.ts';
import { type RsvpTiming, buildRsvpDigest, dueAt } from './rsvp-batch.ts';
import { VERSION } from './version.ts';

// A row claim_discord_posts() took: counted as a try already.
export type QueuedPost = {
  id: number;
  teamId: number;
  kind: Kind;
  action: string;
  payload: Payload;
  createdAt: string;
  attempts: number;
};

// What a try leaves on its row.
export type Finish = {
  status: 'queued' | 'posted' | 'skipped' | 'failed';
  lastError: string | null;
  // When a row left queued may try again.
  nextTryAt?: string;
  // Not a failed try: the change waits for its batched post (#1710), and
  // `attempts` gives back the try its claim counted.
  hold?: boolean;
  attempts?: number;
};

export type PostSetting = {
  serverId: string;
  channelId: string | null;
  roleId: string | null;
  // RSVP changes only: null posts each change as it happens.
  rsvpTiming?: RsvpTiming | null;
};

export interface RelayDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  // The team with this address key (and id, when given); 'ambiguous' when
  // the key alone matches more than one.
  team(key: string, id: number | null): Promise<{ id: number } | 'ambiguous' | null>;
  // The team's server, and its channel and ping role for one kind of post;
  // null when the team has no Discord server set.
  postSetting(teamId: number, kind: Kind): Promise<PostSetting | null>;
  serverOf(teamId: number): Promise<string | null>;
  claimPosts(): Promise<QueuedPost[]>;
  finishPost(id: number, finish: Finish): Promise<void>;
  markPosted(teamId: number, kind: Kind): Promise<void>;
  // Whether the caller may change this team's Discord settings.
  canManageDiscord(authHeader: string, teamId: number): Promise<boolean>;
  // Whether the caller is on this team (my_team_role(), read as them).
  onTeam(authHeader: string, teamId: number): Promise<boolean>;
}

export type Env = { get(name: string): string | undefined };

export type Deps = {
  fetch: typeof fetch;
  env: Env;
  db: RelayDb;
  sheets: SheetDb;
  // The signup sheet's picture (#983); left out, sheets are text.
  drawPicture?: (picture: Picture) => Promise<Uint8Array>;
  // The weekly lineup post (#1709): its reads, and how its grid is drawn.
  lineups?: LineupDb;
  drawSvg?: (svg: string) => Promise<Uint8Array>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export const API = 'https://discord.com/api/v10';
export const CRON_SECRET = 'OPTIONAL_RSVP_REMINDERS_SECRET';
export const BOT_TOKEN = 'DISCORD_BOT_TOKEN';
// Tries before a queued post stays failed, and the wait after a failed try
// (1, 2, 4 then 8 minutes).
export const MAX_TRIES = 5;
const retryWaitMs = (attempts: number) => 60_000 * 2 ** (attempts - 1);
// The longest one Discord call may take.
const CALL_TIMEOUT_MS = 10_000;
// The longest a 429 is waited out before giving up on the post.
const MAX_RETRY_WAIT_MS = 5_000;

export const NOT_SIGNED_IN = 'Not signed in';
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

// One Discord REST call as the bot, waiting out one 429. GET without a body,
// POST with one, unless a method is named.
async function discord(
  deps: Deps,
  token: string,
  path: string,
  body?: unknown,
  method?: string,
  files?: DiscordFile[]
): Promise<Answer> {
  const call = () => {
    const request = discordRequestBody(body, files);
    return deps.fetch(API + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { Authorization: 'Bot ' + token, ...request.headers },
      body: request.body,
      // A hung call fails its try instead of running the drain out of time,
      // which would leave its row claimed and never counted as failed.
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
  };
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
  const payload: Payload = parsed.payload && typeof parsed.payload === 'object' ? (parsed.payload as Payload) : {};
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

  if (action === 'signupSheets') {
    if (dest.kind !== 'bot') return jsonResponse({ success: true, posted: 0, edited: 0, failed: 0 });
    const counts = await sweepSheets(sheetContext(deps, token!, now));
    const lineups = deps.lineups
      ? await sweepLineups({ ...sheetContext(deps, token!, now), db: deps.lineups, draw: deps.drawSvg })
      : null;
    return jsonResponse({ success: true, ...counts, ...(lineups ? { lineups } : {}) });
  }

  if (action === 'drain') {
    const rows = await deps.db.claimPosts();
    const settings = new Map<string, PostSetting | null>();
    const batches = new Map<number, QueuedPost[]>();
    const singles: QueuedPost[] = [];
    const settle = async (row: QueuedPost, finish: Finish) => {
      if (finish.status === 'queued' && !finish.hold) {
        console.error(`discord-bot-webhook: queued post ${row.id} (try ${row.attempts}): ${finish.lastError}`);
        finish =
          row.attempts >= MAX_TRIES
            ? { ...finish, status: 'failed' }
            : { ...finish, nextTryAt: new Date(now.getTime() + retryWaitMs(row.attempts)).toISOString() };
      }
      await deps.db.finishPost(row.id, finish);
    };
    const errorFinish = (e: unknown): Finish => ({
      status: 'queued',
      lastError: e instanceof Error ? e.message : String(e)
    });
    const settingOf = async (teamId: number, kind: Kind) => {
      const key = `${teamId}:${kind}`;
      if (!settings.has(key)) settings.set(key, await deps.db.postSetting(teamId, kind));
      return settings.get(key) ?? null;
    };

    for (const row of rows) {
      try {
        // A team that batches its RSVP changes (#1710): the change waits for
        // the batched post, joins it once it is due, or, due the moment it
        // was made, posts now on its own.
        const timing = row.action === 'rsvp' ? ((await settingOf(row.teamId, row.kind))?.rsvpTiming ?? null) : null;
        if (timing) {
          const madeAt = new Date(row.createdAt);
          const due = dueAt(timing, madeAt, await raidStart(deps, row), String(row.payload.raidDate ?? ''));
          if (due.getTime() > now.getTime()) {
            await settle(row, {
              status: 'queued',
              lastError: null,
              nextTryAt: due.toISOString(),
              hold: true,
              attempts: row.attempts - 1
            });
            continue;
          }
          if (due.getTime() > madeAt.getTime()) {
            batches.set(row.teamId, [...(batches.get(row.teamId) ?? []), row]);
            continue;
          }
        }
        singles.push(row);
      } catch (e) {
        await settle(row, errorFinish(e));
      }
    }

    // Batches first: for one raid night, a change posted on its own was made
    // after any change waiting for the batch, so the newest answer posts last.
    for (const [teamId, batch] of batches) {
      // The claim names no order, and a raider's last answer is the one shown.
      batch.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id);
      let finish: Finish;
      try {
        const setting = await settingOf(teamId, 'rsvp_changes');
        finish = await sendPost(deps, dest, token, teamId, 'rsvp_changes', setting, (roleId) =>
          buildRsvpDigest(
            batch.map((r) => r.payload),
            roleId
          )
        );
      } catch (e) {
        finish = errorFinish(e);
      }
      for (const row of batch) await settle(row, finish);
    }

    for (const row of singles) {
      let finish: Finish;
      try {
        finish = await postQueued(deps, dest, token, row);
      } catch (e) {
        finish = errorFinish(e);
      }
      await settle(row, finish);
    }
    return jsonResponse({ success: true, claimed: rows.length });
  }

  const teamKey = typeof parsed.team === 'string' ? parsed.team : '';
  if (!teamKey) return refuse('Missing team', 400);
  const teamId = typeof parsed.teamId === 'number' ? parsed.teamId : null;
  const team = await deps.db.team(teamKey, teamId);
  if (team === 'ambiguous') return refuse('Two teams use that key; send teamId', 400);
  if (!team) return refuse('Unknown team: ' + teamKey, 400);

  if (def.officer && !(await deps.db.canManageDiscord(authHeader!, team.id))) return refuse('Not authorized', 403);

  if (action === 'signupSheetSync') {
    const raidDate = String(payload.raidDate ?? '');
    // A real calendar date: 2026-02-31 has the shape but is refused here, not
    // by the database (CodeRabbit on #1750).
    const ms = /^\d{4}-\d{2}-\d{2}$/.test(raidDate) ? Date.parse(raidDate + 'T00:00:00Z') : NaN;
    if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== raidDate) {
      return refuse('Missing required fields', 400);
    }
    // Only the team's own people: a refresh can post a deleted sheet again,
    // with its ping (CodeRabbit on #1750). A site admin off the team, whom
    // officer_set_rsvp() also lets through, is refused here; the 15-minute
    // run brings that sheet up to date anyway.
    if (!(await deps.db.onTeam(authHeader!, team.id))) return refuse('Not authorized', 403);
    if (dest.kind !== 'bot') return jsonResponse({ success: true, result: 'not posted' });
    const result = await refreshSheet(sheetContext(deps, token!, now), team.id, raidDate);
    return jsonResponse({ success: true, result });
  }

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

  return refuse('Unknown action: ' + action, 400);
}

// The raid night's start for a queued RSVP change, or null when it has none.
async function raidStart(deps: Deps, row: QueuedPost): Promise<Date | null> {
  const raidDate = String(row.payload.raidDate ?? '');
  const night = await deps.sheets.night(row.teamId, raidDate);
  return night.exists ? startsAt(raidDate, night) : null;
}

// One queued notice: built from its row, to the team's channel for its kind
// as they are now. Answers what the try leaves on the row; 'queued' means it
// failed and may try again.
async function postQueued(
  deps: Deps,
  dest: ReturnType<typeof resolveBot>,
  token: string | undefined,
  row: QueuedPost
): Promise<Finish> {
  const setting = await deps.db.postSetting(row.teamId, row.kind);
  return sendPost(deps, dest, token, row.teamId, row.kind, setting, (roleId) =>
    buildPost(row.action, row.payload, roleId, row.createdAt)
  );
}

// One message to the team's channel for a kind of post, pinging the role it
// picked. `build` throws MissingFields for a row too short to post.
async function sendPost(
  deps: Deps,
  dest: ReturnType<typeof resolveBot>,
  token: string | undefined,
  teamId: number,
  kind: Kind,
  setting: PostSetting | null,
  build: (roleId: string | null) => Message
): Promise<Finish> {
  if (!setting?.channelId) return { status: 'skipped', lastError: 'That kind of post is off' };

  let message: Message;
  try {
    message = build(dest.kind === 'bot' ? setting.roleId : null);
  } catch (e) {
    // The row's own fields are short: no later try can fix that.
    if (e instanceof MissingFields) return { status: 'failed', lastError: 'Missing required fields' };
    throw e;
  }

  if (dest.kind === 'skip') return { status: 'skipped', lastError: 'Nowhere to post on this stack' };
  if (dest.kind === 'post') {
    await localPost(deps, dest.url, message);
    return { status: 'posted', lastError: null };
  }

  // The channel and the role must be in the team's own server (#1712).
  const channel = await discord(deps, token!, `/channels/${setting.channelId}`);
  if (channel.status !== 200 || channel.body?.guild_id !== setting.serverId) {
    return { status: 'queued', lastError: channel.status === 200 ? NOT_IN_SERVER : CANT_SEE };
  }
  if (setting.roleId) {
    const roles = await discord(deps, token!, `/guilds/${setting.serverId}/roles`);
    const inServer = Array.isArray(roles.body) && roles.body.some((r: { id?: string }) => r.id === setting.roleId);
    if (!inServer) {
      // Post without the ping rather than drop the notice.
      console.error(`discord-bot-webhook: team ${teamId}'s ${kind} role ${setting.roleId} is not in its server`);
      message = build(null);
    }
  }

  const sent = await discord(deps, token!, `/channels/${setting.channelId}/messages`, message);
  if (sent.status !== 200) return { status: 'queued', lastError: 'Discord answered ' + sent.status };
  await deps.db.markPosted(teamId, kind);
  return { status: 'posted', lastError: null };
}

function sheetContext(deps: Deps, token: string, now: Date) {
  return {
    db: deps.sheets,
    discord: (method: string, path: string, body?: unknown, files?: DiscordFile[]) =>
      discord(deps, token, path, body, method, files),
    siteUrl: deps.env.get('SITE_URL'),
    now,
    draw: deps.drawPicture
  };
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
