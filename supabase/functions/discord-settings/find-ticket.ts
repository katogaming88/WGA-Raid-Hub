// Find my ticket (#1542): one message per Discord server with a button that
// shows the presser, and only them, links to their own open recruiting
// tickets (discord-interactions answers the press). Teams share a server, so
// the message is the server's, not a team's; the officer picks its channel on
// Recruiting settings (#1548).
//
// POST { teamId, action: 'find_ticket' } answers the channel picked for the
//   team's server (channelId, null for none).
// POST { teamId, action: 'find_ticket', channelId } posts the message there,
//   or edits it when it is already there; moving it removes the old one.
// POST { teamId, action: 'find_ticket', channelId: null } removes it.
//
// For whoever may edit the team's recruiting (team_recruiting_settings(),
// asked with the caller's own token, so the database decides). A channel is
// only taken while some team in the server uses private tickets, since the
// button has nothing to find otherwise.

export const FIND_TICKET_ID = 'find-ticket';

export const FIND_TICKET_MESSAGE = {
  content:
    "**Can't find your recruiting ticket?** Press the button and the bot shows you a link to each of your open tickets in this server. Only you see the answer.",
  components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Find my ticket', custom_id: FIND_TICKET_ID }] }],
  allowed_mentions: { parse: [] }
};

export const NO_TICKET_TEAM =
  'No team in this Discord server uses private tickets, so there is nothing for the button to find.';
export const NOT_IN_SERVER = "That channel is not in the team's Discord server.";
export const CANT_POST = "The bot can't post there. Check its permissions in that channel.";
export const NO_SERVER = "Pick the team's Discord server first.";

export type FindTicket = { channelId: string; messageId: string | null };

export interface FindTicketDb {
  // Whether the caller may edit the team's recruiting.
  mayEditRecruiting(authHeader: string, teamId: number): Promise<boolean>;
  // The team's Discord server, null for none.
  serverOf(teamId: number): Promise<string | null>;
  // Whether some team in this server makes private tickets.
  ticketTeamIn(serverId: string): Promise<boolean>;
  current(serverId: string): Promise<FindTicket | null>;
  save(serverId: string, value: FindTicket, userId: string): Promise<void>;
  clear(serverId: string): Promise<void>;
}

type Call = (method: string, path: string, body?: unknown) => Promise<{ ok: boolean; status: number; body: any }>;

const SNOWFLAKE = /^[0-9]{17,20}$/;

type Answer = { status: number; body: Record<string, unknown> };
const ok = (body: Record<string, unknown>): Answer => ({ status: 200, body: { success: true, ...body } });
const no = (error: string, status: number): Answer => ({ status, body: { success: false, error } });

export async function findTicket(
  db: FindTicketDb,
  discord: Call,
  authHeader: string,
  userId: string,
  teamId: number,
  body: Record<string, unknown>
): Promise<Answer> {
  if (!(await db.mayEditRecruiting(authHeader, teamId))) return no('Not authorized', 403);
  const serverId = await db.serverOf(teamId);
  if (!serverId) return no(NO_SERVER, 409);
  const current = await db.current(serverId);
  if (!('channelId' in body)) return ok({ channelId: current?.channelId ?? null });

  const channelId = body.channelId;
  if (channelId === null) {
    if (current?.messageId) {
      await discord('DELETE', `/channels/${current.channelId}/messages/${current.messageId}`).catch(() => null);
    }
    await db.clear(serverId);
    return ok({ channelId: null });
  }
  if (typeof channelId !== 'string' || !SNOWFLAKE.test(channelId)) return no('Missing channel', 400);
  if (!(await db.ticketTeamIn(serverId))) return no(NO_TICKET_TEAM, 409);

  // The channel must be in the team's own server.
  const channel = await discord('GET', `/channels/${channelId}`);
  if (channel.status === 403) return no(CANT_POST, 409);
  if (!channel.ok || channel.body?.guild_id !== serverId) return no(NOT_IN_SERVER, 404);

  // Same channel: edit the message there; it may have been deleted by hand.
  if (current?.channelId === channelId && current.messageId) {
    const edited = await discord('PATCH', `/channels/${channelId}/messages/${current.messageId}`, FIND_TICKET_MESSAGE);
    if (edited.ok) return ok({ channelId });
  }
  const posted = await discord('POST', `/channels/${channelId}/messages`, FIND_TICKET_MESSAGE);
  if (posted.status === 403) return no(CANT_POST, 409);
  if (!posted.ok || typeof posted.body?.id !== 'string') return no(NOT_IN_SERVER, 404);
  await db.save(serverId, { channelId, messageId: posted.body.id }, userId);
  // The old one goes once the new one is up. Best effort: a message left
  // behind still finds tickets.
  if (current?.messageId && current.messageId !== posted.body.id) {
    await discord('DELETE', `/channels/${current.channelId}/messages/${current.messageId}`).catch(() => null);
  }
  return ok({ channelId });
}
