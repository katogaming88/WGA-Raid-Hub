// An in-memory SheetDb for the signup sheet (#960). raid_signup_sheets is a
// Map that claim() treats the way claim_raid_signup_sheet() does: a first call
// adds a row with no message, and a changed channel clears the message.
import type {
  Night,
  RosterRow,
  Rsvp,
  SheetDb,
  SheetSetting,
  Team,
  TeamSheets
} from '../../../supabase/functions/_shared/signup-sheet.ts';

export const SERVER = '100000000000000001';
export const CHANNEL = '200000000000000002';
export const ROLE = '300000000000000003';

export const TEAM: Team = { id: 1, name: 'Phoenix', slug: 'phoenix', serverId: SERVER, quietHours: null };

// Tuesdays and Thursdays, two raids kept posted.
export const SHEET: SheetSetting = {
  id: 9,
  channelId: CHANNEL,
  raidDays: [2, 4],
  keepRaidsPosted: 2,
  hoursBefore: null,
  pingRoleId: ROLE
};

// 9 PM Eastern.
export const RAID: Night = { exists: true, startTime: '21:00:00', timezone: 'America/New_York', isOptional: false };
export const NO_RAID: Night = { exists: false, startTime: null, timezone: null, isOptional: false };

export type SheetState = {
  teams?: TeamSheets[];
  // Raid nights by date; any other date has no raid.
  nights?: Record<string, Night>;
  roster?: RosterRow[];
  rsvps?: Rsvp[];
  rows?: Record<string, { channelId: string; messageId: string | null }>;
};

export function fakeSheets(state: SheetState = {}) {
  const log: string[] = [];
  const rows = new Map(Object.entries(state.rows ?? {}));
  const teams = state.teams ?? [{ team: TEAM, sheets: [SHEET] }];
  const db: SheetDb = {
    allSheets: () => Promise.resolve(teams),
    teamSheets: (teamId) => Promise.resolve(teams.find((t) => t.team.id === teamId) ?? null),
    night: (_team, date) => Promise.resolve(state.nights?.[date] ?? NO_RAID),
    roster: () => Promise.resolve(state.roster ?? []),
    rsvps: () => Promise.resolve(state.rsvps ?? []),
    postedMessage: (_team, date) => Promise.resolve(rows.get(date)?.messageId ?? null),
    claim(_team, date, channelId) {
      log.push('claim ' + date);
      const row = rows.get(date);
      if (!row) {
        rows.set(date, { channelId, messageId: null });
        return Promise.resolve(null);
      }
      if (row.channelId !== channelId) {
        rows.set(date, { channelId, messageId: null });
        return Promise.resolve(null);
      }
      return Promise.resolve(row.messageId);
    },
    saveMessage(_team, date, messageId) {
      log.push(`save ${date} ${messageId}`);
      const row = rows.get(date);
      if (row && row.messageId === null) row.messageId = messageId;
      return Promise.resolve();
    },
    forgetMessage(_team, date, messageId) {
      log.push(`forget ${date} ${messageId}`);
      const row = rows.get(date);
      if (row?.messageId === messageId) row.messageId = null;
      return Promise.resolve();
    },
    markPosted(sheetId) {
      log.push('markPosted ' + sheetId);
      return Promise.resolve();
    }
  };
  return { db, log, rows };
}

// Discord, answered by "METHOD path"; anything unscripted is a 404. Posts
// get ids m1, m2, ... in order.
export function fakeDiscord(routes: Record<string, { status: number; body?: unknown }> = {}) {
  const calls: Array<{ key: string; body: any }> = [];
  let n = 0;
  const call = (method: string, path: string, body?: unknown) => {
    const key = `${method} ${path}`;
    calls.push({ key, body: body ?? null });
    if (routes[key]) return Promise.resolve({ status: routes[key].status, body: routes[key].body ?? null });
    if (key === `GET /channels/${CHANNEL}`)
      return Promise.resolve({ status: 200, body: { id: CHANNEL, guild_id: SERVER } });
    if (key === `POST /channels/${CHANNEL}/messages`) return Promise.resolve({ status: 200, body: { id: 'm' + ++n } });
    if (method === 'PATCH' || method === 'DELETE') return Promise.resolve({ status: 200, body: {} });
    return Promise.resolve({ status: 404, body: null });
  };
  return { call, calls };
}
