// discord-join (#1540): adds an applicant to their team's Discord server when
// they send an application, so nobody needs an invite link or a channel hunt.
//
// Discord lets the bot add someone who gave its app the guilds.join scope.
// Supabase's Discord sign-in can't be relied on for that (it may be another
// app, and refuses to re-link an account already linked), so this runs its own
// short OAuth step with the bot's app (Kat's pick, 2026-11-09):
//
// POST { action: 'start', application }
//   The caller's own open application, on a team with "Add them to the Discord
//   server" on. Already in the server: recorded, answers already_member.
//   Otherwise answers authorize with Discord's consent URL, which sends the
//   applicant back to SITE_URL + RETURN_PATH with ?code&state.
// POST { action: 'finish', state, code } or { action: 'finish', state, error }
//   That page hands the code over, signed in as the applicant. The code is
//   swapped for a token, the token's Discord account must be the applicant's,
//   the bot adds them with it, and the token is dropped: never stored, never
//   logged. Answers joined or already_member. Anything else (banned, Discord
//   down, they said no, another Discord account) answers failed with a
//   single-use invite: the failure goes in the record's history and the
//   officers are told in their channel.
//
// The application is already saved by then (send_application), so a failed
// join never loses one. Calling again is safe: a recorded join is answered
// from the record, someone the bot sees in the server is never a failure, and
// a failure is recorded and told once per REPEAT_FAILURE_MS.
//
// handle() takes its reads and its fetch as an argument (#1006); deps.ts
// supplies the real ones and index.ts serves it.
import { type Env, resolveBot } from '../_shared/discord-destination.ts';
import { VERSION } from './version.ts';

export type Application = {
  id: number;
  team_id: number;
  person_id: number;
  name_realm: string;
  discord_id: string | null;
  add_to_server: boolean;
  server_id: string | null;
  officer_channel_id: string | null;
};

export interface JoinDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  // The caller's own open application with this id, or null.
  application(authUserId: string, applicationId: number): Promise<Application | null>;
  addEvent(
    applicationId: number,
    kind: 'joined_discord' | 'discord_join_failed',
    actor: number,
    detail: string | null
  ): Promise<void>;
  // The application's latest joined_discord or discord_join_failed row.
  lastDiscordEvent(
    applicationId: number
  ): Promise<{ kind: 'joined_discord' | 'discord_join_failed'; at: number; detail: string | null } | null>;
}

export type Deps = {
  fetch: typeof fetch;
  db: JoinDb;
  env: Env;
  now: () => number;
};

// A failure is recorded and told to the officers once in this long, so a
// reloaded after-send page or a repeated call can't flood the history, the
// officer channel or the server's invites (CodeRabbit on #1797). Past it, a
// failure is recorded again but the officers hear about each reason once.
export const REPEAT_FAILURE_MS = 10 * 60_000;

export const API = 'https://discord.com/api/v10';
export const AUTHORIZE_URL = 'https://discord.com/oauth2/authorize';
// The after-send page (#1547) reads ?code&state off this path and calls finish.
export const RETURN_PATH = '/apply/discord';
const INVITE_SECONDS = 7 * 24 * 60 * 60;
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

export const NOT_SET_UP = 'Adding applicants to Discord is not set up on this site yet.';
export const NOT_YOURS = 'That application is not yours, or it is closed.';
export const BAD_STATE = "That Discord link doesn't fit this application. Open your application and try again.";
export const SOMETHING_WRONG = 'Something went wrong. Your application is saved.';

// Why a join failed, as the history and the officers' notice say it.
export const WHY = {
  declined: 'They said no on Discord',
  other_account: 'They signed in to Discord with a different account',
  banned: 'They are banned from the server',
  no_permission: 'The bot lacks Create Invite in the server',
  refused: 'Discord refused to add them',
  discord_down: 'Discord did not answer'
} as const;
type Why = keyof typeof WHY;

type Config = { botToken: string; clientId: string; clientSecret: string; siteUrl: string };

function config(env: Env): Config | null {
  const botToken = env.get('DISCORD_BOT_TOKEN');
  const clientId = env.get('DISCORD_CLIENT_ID');
  const clientSecret = env.get('DISCORD_CLIENT_SECRET');
  const siteUrl = env.get('SITE_URL');
  if (!botToken || !clientId || !clientSecret || !siteUrl) return null;
  return { botToken, clientId, clientSecret, siteUrl: siteUrl.replace(/\/+$/, '') };
}

const redirectUri = (c: Config) => c.siteUrl + RETURN_PATH;

// The state ties Discord's answer to this application and this person, so a
// code can't be handed to someone else's application. HMAC with the client
// secret, which only this function holds.
async function sign(c: Config, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(c.clientSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function stateFor(c: Config, app: { id: number; person_id: number }): Promise<string> {
  return app.id + '.' + (await sign(c, 'discord-join:' + app.id + ':' + app.person_id));
}

// The application id a state names, before it is checked against the caller.
function applicationIdOf(state: unknown): number | null {
  const m = typeof state === 'string' ? /^([1-9][0-9]{0,9})\.[0-9a-f]{64}$/.exec(state) : null;
  return m ? Number(m[1]) : null;
}

const timed = () => AbortSignal.timeout(DEADLINE_MS);

const bot = (c: Config, path: string, init: RequestInit = {}) => ({
  url: API + path,
  init: {
    ...init,
    headers: { Authorization: 'Bot ' + c.botToken, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    signal: timed()
  }
});

async function botCall(deps: Deps, c: Config, path: string, init: RequestInit = {}) {
  const r = bot(c, path, init);
  return await deps.fetch(r.url, r.init);
}

// Whether the bot sees them in the server; null when Discord doesn't say.
async function isMember(deps: Deps, c: Config, app: Application): Promise<boolean | null> {
  try {
    const res = await botCall(deps, c, '/guilds/' + app.server_id + '/members/' + app.discord_id);
    return res.ok ? true : res.status === 404 ? false : null;
  } catch {
    return null;
  }
}

// Joined already recorded: answer it again and write nothing.
async function alreadyRecorded(deps: Deps, app: Application) {
  const last = await deps.db.lastDiscordEvent(app.id);
  return last?.kind === 'joined_discord' ? jsonResponse({ success: true, status: 'already_member' }) : null;
}

async function start(deps: Deps, c: Config, app: Application): Promise<Response> {
  const recorded = await alreadyRecorded(deps, app);
  if (recorded) return recorded;
  // Already in the server: nothing to ask. A failed check just asks.
  if ((await isMember(deps, c, app)) === true) {
    await deps.db.addEvent(app.id, 'joined_discord', app.person_id, 'Already a member');
    return jsonResponse({ success: true, status: 'already_member' });
  }
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', c.clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri(c));
  url.searchParams.set('scope', 'identify guilds.join');
  url.searchParams.set('state', await stateFor(c, app));
  return jsonResponse({ success: true, status: 'authorize', url: url.toString() });
}

// The code for the applicant's own token, their Discord id, and the add.
async function join(deps: Deps, c: Config, app: Application, code: string): Promise<'joined' | 'already_member' | Why> {
  let accessToken: string | undefined;
  try {
    const res = await deps.fetch(API + '/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(c)
      }),
      signal: timed()
    });
    const body = await res.json().catch(() => null);
    // A bad or reused code is a 400: the applicant has to start again, which
    // reads to them as Discord not answering.
    if (!res.ok || typeof body?.access_token !== 'string') return 'discord_down';
    accessToken = body.access_token;

    const me = await deps.fetch(API + '/users/@me', {
      headers: { Authorization: 'Bearer ' + accessToken },
      signal: timed()
    });
    if (!me.ok) return 'discord_down';
    if ((await me.json())?.id !== app.discord_id) return 'other_account';

    const put = await botCall(deps, c, '/guilds/' + app.server_id + '/members/' + app.discord_id, {
      method: 'PUT',
      body: JSON.stringify({ access_token: accessToken })
    });
    if (put.status === 201) return 'joined';
    if (put.status === 204) return 'already_member';
    // Discord's error code says which refusal it is (40007 banned, 50013
    // missing permission), so the officers know what to fix.
    if (put.status === 403) {
      const code = (await put.json().catch(() => null))?.code;
      return code === 40007 ? 'banned' : code === 50013 ? 'no_permission' : 'refused';
    }
    return 'discord_down';
  } catch {
    return 'discord_down';
  } finally {
    // The token did its one job: hand it back so Discord stops honoring it
    // (it would stay good for about a week). Best effort.
    if (accessToken) await revoke(deps, c, accessToken);
  }
}

async function revoke(deps: Deps, c: Config, token: string) {
  try {
    await deps.fetch(API + '/oauth2/token/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: c.clientSecret,
        token,
        token_type_hint: 'access_token'
      }),
      signal: timed()
    });
  } catch {
    // it expires on its own
  }
}

// A single-use, week-long invite to the server's welcome channel (or its rules
// channel), or null when there is neither or Discord says no.
// A local stack makes none: restored from the production backup, its server
// ids are the real servers, and an invite is the one thing here that would
// change one without anybody's OK (the add needs the applicant's own).
async function inviteFor(deps: Deps, c: Config, serverId: string): Promise<string | null> {
  if (resolveBot(deps.env).kind !== 'bot') return null;
  try {
    const g = await botCall(deps, c, '/guilds/' + serverId);
    if (!g.ok) return null;
    const guild = await g.json();
    const channel = guild?.system_channel_id ?? guild?.rules_channel_id;
    if (typeof channel !== 'string') return null;
    const res = await botCall(deps, c, '/channels/' + channel + '/invites', {
      method: 'POST',
      body: JSON.stringify({ max_age: INVITE_SECONDS, max_uses: 1, unique: true })
    });
    const invite = res.ok ? await res.json() : null;
    return typeof invite?.code === 'string' ? 'https://discord.gg/' + invite.code : null;
  } catch {
    return null;
  }
}

// The officers' notice. Best effort: the history row is the record.
async function tellOfficers(deps: Deps, c: Config, app: Application, why: Why, invite: string | null) {
  const content =
    "Couldn't add **" +
    app.name_realm.replace(/([*_`~|>\\])/g, '\\$1') +
    '** to the Discord server when they applied. ' +
    WHY[why] +
    '. ' +
    (invite ? 'They were shown an invite link.' : 'There was no invite link to show them, so reach out to them.');
  const dest = resolveBot(deps.env);
  try {
    if (dest.kind === 'bot' && app.officer_channel_id) {
      await botCall(deps, c, '/channels/' + app.officer_channel_id + '/messages', {
        method: 'POST',
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
      });
    } else if (dest.kind === 'post') {
      await deps.fetch(dest.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '[local] ' + content, allowed_mentions: { parse: [] } }),
        signal: timed()
      });
    }
  } catch {
    // the history has it
  }
}

async function finish(deps: Deps, c: Config, app: Application, body: Record<string, unknown>): Promise<Response> {
  // A reload after a join reuses a spent code: the record already says so.
  const recorded = await alreadyRecorded(deps, app);
  if (recorded) return recorded;

  let outcome: 'joined' | 'already_member' | Why =
    typeof body.code === 'string' && body.code !== ''
      ? await join(deps, c, app, body.code)
      : body.error === 'access_denied'
        ? 'declined'
        : 'discord_down';
  // In the server after all (a second send of the code, or they joined by
  // hand): not a failure. A different Discord account never counts.
  if (outcome !== 'joined' && outcome !== 'already_member' && outcome !== 'other_account') {
    if ((await isMember(deps, c, app)) === true) outcome = 'already_member';
  }

  if (outcome === 'joined' || outcome === 'already_member') {
    await deps.db.addEvent(
      app.id,
      'joined_discord',
      app.person_id,
      outcome === 'already_member' ? 'Already a member' : null
    );
    return jsonResponse({ success: true, status: outcome });
  }
  // A failure already recorded a moment ago: same answer, nothing new made.
  // The page keeps the first answer's invite on screen (#1547).
  const last = await deps.db.lastDiscordEvent(app.id);
  if (last?.kind === 'discord_join_failed' && deps.now() - last.at < REPEAT_FAILURE_MS) {
    return jsonResponse({ success: true, status: 'failed', reason: outcome, invite: null, repeat: true });
  }
  const invite = await inviteFor(deps, c, app.server_id!);
  await deps.db.addEvent(app.id, 'discord_join_failed', app.person_id, WHY[outcome]);
  // The officers hear about a reason once: the same failure again (someone
  // opening the page over and over) only goes in the history.
  if (!(last?.kind === 'discord_join_failed' && last.detail === WHY[outcome])) {
    await tellOfficers(deps, c, app, outcome, invite);
  }
  return jsonResponse({ success: true, status: 'failed', reason: outcome, invite });
}

async function route(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return refuse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return refuse('Not signed in', 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return refuse('Unknown action', 400);
  }
  const action = body?.action;
  if (action !== 'start' && action !== 'finish') return refuse('Unknown action', 400);

  const applicationId =
    action === 'start'
      ? typeof body.application === 'number' && Number.isInteger(body.application) && body.application > 0
        ? body.application
        : null
      : applicationIdOf(body.state);
  if (applicationId === null) return refuse(action === 'start' ? 'Missing application' : BAD_STATE, 400);

  const c = config(deps.env);
  if (!c) return refuse(NOT_SET_UP, 503);

  const user = await deps.db.getUser(authHeader);
  if (!user) return refuse('Not signed in', 401);

  const app = await deps.db.application(user.id, applicationId);
  if (!app) return refuse(NOT_YOURS, 403);
  if (action === 'finish' && body.state !== (await stateFor(c, app))) return refuse(BAD_STATE, 400);
  // The team's setting, a server and the applicant's Discord id
  // (send_application needs one) are all it takes; without them there is
  // nothing to do, which is not a failure.
  if (!app.add_to_server || !app.server_id || !app.discord_id) {
    return jsonResponse({ success: true, status: 'off' });
  }

  return action === 'start' ? await start(deps, c, app) : await finish(deps, c, app, body);
}

// A throw anywhere still answers with the CORS headers (as character-stats).
export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    return await route(req, deps);
  } catch {
    return refuse(SOMETHING_WRONG, 500);
  }
}
