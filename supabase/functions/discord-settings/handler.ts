// discord-settings (#994): what Settings › Discord reads from Discord, through
// the bot, so no officer ever copies an id out of Discord.
//
// POST { teamId, action: 'load' } answers
//   - servers: the Discord servers the caller and the bot are both in, each
//     recorded in discord_server_access, which set_team_discord_server()
//     needs within the hour before it takes one;
//   - server: the team's saved server, with whether the bot is still in it,
//     its text channels (each with what the bot is missing there), its
//     categories (for the ticket category, #1541, each with what the bot lacks
//     there to make ticket channels, #1814) and its roles; null when the team has none yet.
// POST { teamId, action: 'find_ticket', ... } is Find my ticket's channel (#1542),
//   find-ticket.ts's, asked for on Recruiting settings with its own gate.
// POST { teamId, action: 'test', channelId, kind } posts a short test message
//   in a channel of the team's saved server, pinging nobody.
//
// Both are for whoever team_discord_settings() lets read the team's settings
// (Change Discord settings on the team's grid, or a site admin): it is called
// with the caller's own token, so the database decides. The bot token never
// leaves this function.
//
// handle() takes its reads and its fetch as an argument (#1006); deps.ts
// supplies the real ones and index.ts serves it.
import {
  type DiscordChannel,
  type DiscordGuild,
  type DiscordMember,
  type ShownCategory,
  type ShownChannel,
  type ShownRole,
  shownCategories,
  shownChannels,
  shownRoles
} from './discord.ts';
import { type FindTicketDb, findTicket } from './find-ticket.ts';
import { VERSION } from './version.ts';

export interface SettingsDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  // The team's saved server id (null for none), read as the caller, or
  // 'forbidden' when the database refuses them the team's settings.
  teamServer(authHeader: string, teamId: number): Promise<{ serverId: string | null } | 'forbidden'>;
  person(userId: string): Promise<{ id: number; discordId: string | null } | null>;
  recordAccess(personId: number, serverIds: string[]): Promise<void>;
  teamName(teamId: number): Promise<string>;
}

export type Deps = {
  fetch: typeof fetch;
  db: SettingsDb;
  botToken: string | undefined;
  // Find my ticket's channel (#1542), asked for on Recruiting settings.
  findTicket?: FindTicketDb;
};

export const API = 'https://discord.com/api/v10';

export const NOT_SET_UP = 'The Discord bot is not set up on this site yet.';
export const DISCORD_DOWN = 'Discord did not answer. Try again in a minute.';
export const NO_SERVER = "Pick the team's Discord server first.";
export const NOT_IN_SERVER = "That channel is not in the team's Discord server.";
export const CANT_POST = "The bot can't post there. Check its permissions in that channel.";

// What a test message says it is for, by the kind of post it was sent from.
export const TEST_FOR: Record<string, string> = {
  officer_requests: 'officer requests',
  mplus_requests: 'M+ requests',
  rsvp_changes: 'RSVP changes',
  weekly_lineup: 'weekly boss lineup',
  signup_sheet: 'a signup sheet'
};

const SNOWFLAKE = /^[0-9]{17,20}$/;

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

class DiscordDown extends Error {}

// One Discord REST call as the bot. 404 reads as null (a server the person
// isn't in, a channel that is gone); 403 as 'forbidden'; anything else that
// isn't a success, rate limits included, as Discord being down.
function discord(fetchFn: typeof fetch, token: string) {
  return async <T>(path: string, body?: unknown): Promise<T | null | 'forbidden'> => {
    let res: Response;
    try {
      res = await fetchFn(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new DiscordDown();
    }
    if (res.status === 404) return null;
    if (res.status === 403) return 'forbidden';
    if (!res.ok) throw new DiscordDown();
    return (await res.json()) as T;
  };
}

// Any Discord REST call as the bot, with its status, for Find my ticket's
// edit and delete. A network failure or Discord being down (5xx, 429) is
// DiscordDown.
function call(fetchFn: typeof fetch, token: string) {
  return async (method: string, path: string, body?: unknown) => {
    let res: Response;
    try {
      res = await fetchFn(API + path, {
        method,
        headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw new DiscordDown();
    }
    if (res.status >= 500 || res.status === 429) throw new DiscordDown();
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  };
}

export type ServerAnswer = {
  id: string;
  name: string | null;
  botIn: boolean;
  channels: ShownChannel[];
  categories: ShownCategory[];
  roles: ShownRole[];
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return refuse('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return refuse('Not signed in', 401);

  let body: { teamId?: unknown; action?: unknown; channelId?: unknown; kind?: unknown };
  try {
    body = await req.json();
  } catch {
    return refuse('Bad request', 400);
  }
  const teamId = body?.teamId;
  if (typeof teamId !== 'number' || !Number.isInteger(teamId)) return refuse('Missing team', 400);
  if (body.action !== 'load' && body.action !== 'test' && body.action !== 'find_ticket') {
    return refuse('Bad request', 400);
  }

  const user = await deps.db.getUser(authHeader);
  if (!user) return refuse('Not signed in', 401);
  // Find my ticket is a recruiting setting (#1542): its own gate, below.
  if (body.action === 'find_ticket') {
    if (!deps.botToken || !deps.findTicket) return refuse(NOT_SET_UP, 500);
    try {
      const answer = await findTicket(
        deps.findTicket,
        call(deps.fetch, deps.botToken),
        authHeader,
        user.id,
        teamId,
        body as Record<string, unknown>
      );
      return jsonResponse(answer.body, answer.status);
    } catch (e) {
      if (e instanceof DiscordDown) return refuse(DISCORD_DOWN, 502);
      throw e;
    }
  }
  const team = await deps.db.teamServer(authHeader, teamId);
  if (team === 'forbidden') return refuse('Not authorized', 403);
  if (!deps.botToken) return refuse(NOT_SET_UP, 500);
  const api = discord(deps.fetch, deps.botToken);

  try {
    if (body.action === 'test') {
      const channelId = body.channelId;
      const kind = body.kind;
      if (typeof channelId !== 'string' || !SNOWFLAKE.test(channelId)) return refuse('Missing channel', 400);
      if (typeof kind !== 'string' || !(kind in TEST_FOR)) return refuse('Bad request', 400);
      if (!team.serverId) return refuse(NO_SERVER, 409);
      // The channel must be in the team's own server, so this never posts
      // anywhere a team's officer hasn't picked for that team.
      const channel = await api<{ guild_id?: string }>(`/channels/${channelId}`);
      if (channel === 'forbidden') return refuse(CANT_POST, 409);
      if (!channel || channel.guild_id !== team.serverId) return refuse(NOT_IN_SERVER, 404);
      const name = await deps.db.teamName(teamId);
      const sent = await api(`/channels/${channelId}/messages`, {
        content: `Test message from WGA Raid Hub: ${name}'s ${TEST_FOR[kind]} will post here.`,
        allowed_mentions: { parse: [] }
      });
      if (sent === 'forbidden') return refuse(CANT_POST, 409);
      // Gone between the lookup and the post (CodeRabbit on #1726).
      if (!sent) return refuse(NOT_IN_SERVER, 404);
      return jsonResponse({ success: true });
    }

    const person = await deps.db.person(user.id);
    const botGuilds = (await api<Array<{ id: string; name: string }>>('/users/@me/guilds')) || [];
    if (botGuilds === 'forbidden') throw new DiscordDown();

    let servers: Array<{ id: string; name: string }> = [];
    if (person?.discordId) {
      // ponytail: one member read per server the bot is in, all at once.
      // Fine while the bot is in a handful of servers; near Discord's global
      // 50 requests a second, batch these and honor 429's retry_after.
      const found = await Promise.all(
        botGuilds.map(async (g) => {
          const member = await api<DiscordMember>(`/guilds/${g.id}/members/${person.discordId}`);
          return member && member !== 'forbidden' ? g : null;
        })
      );
      servers = found.filter((g) => g !== null).map((g) => ({ id: g.id, name: g.name }));
      if (servers.length > 0) {
        await deps.db.recordAccess(
          person.id,
          servers.map((s) => s.id)
        );
      }
    }

    let server: ServerAnswer | null = null;
    if (team.serverId) {
      const serverId = team.serverId;
      server = { id: serverId, name: null, botIn: false, channels: [], categories: [], roles: [] };
      if (botGuilds.some((g) => g.id === serverId)) {
        const [guild, channels, me] = await Promise.all([
          api<DiscordGuild>(`/guilds/${serverId}`),
          api<DiscordChannel[]>(`/guilds/${serverId}/channels`),
          api<{ id: string }>('/users/@me')
        ]);
        if (!guild || guild === 'forbidden' || !channels || channels === 'forbidden' || !me || me === 'forbidden') {
          throw new DiscordDown();
        }
        const bot = await api<DiscordMember>(`/guilds/${serverId}/members/${me.id}`);
        if (!bot || bot === 'forbidden') throw new DiscordDown();
        server = {
          id: serverId,
          name: guild.name,
          botIn: true,
          channels: shownChannels(guild, channels, me.id, bot),
          categories: shownCategories(guild, channels, me.id, bot),
          roles: shownRoles(guild)
        };
      }
    }

    return jsonResponse({ success: true, hasDiscord: Boolean(person?.discordId), servers, server });
  } catch (e) {
    if (e instanceof DiscordDown) return refuse(DISCORD_DOWN, 502);
    throw e;
  }
}
