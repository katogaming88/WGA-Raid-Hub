// The Discord signup sheet (#900, moved off the VM by #960): one message per
// raid night with every raider's RSVP, edited in place as answers change,
// with a Refresh button. It was the bot process's; discord-bot-webhook now
// posts and keeps it current, and discord-interactions answers the button,
// since Discord sends a button press to the application that posted it.
//
// A team sets its sheets on Settings › Discord (#1712): each has a channel,
// the raid days it covers, and either keeps the next 1 to 4 raids posted or
// posts each raid a number of hours before it starts. A sheet that is posted
// stays up after its raid and stops being updated (Kat, 2026-11-03).
//
// No reads or Discord calls of its own: the caller hands over a SheetDb and a
// Discord call, so tests/edge runs all of it against plain objects.
import { EMBED_FIELD_VALUE_MAX, truncate } from './discord-text.ts';
import { clockTime, isoDate, weekdayOf, zonedTimeToUtc } from './time.ts';

export type Night = { exists: boolean; startTime: string | null; timezone: string | null; isOptional: boolean };
export type RosterRow = {
  id: number;
  nameRealm: string;
  nickname: string | null;
  isBench: boolean;
  role: string | null;
  // classes_specs' class and spec, for the spec icon.
  className: string | null;
  spec: string | null;
};
export type Rsvp = { playerId: number; status: string };
export type QuietHours = { start: string; end: string; timezone: string };
export type Team = { id: number; name: string; slug: string; serverId: string; quietHours: QuietHours | null };
export type SheetSetting = {
  id: number;
  channelId: string;
  raidDays: number[];
  keepRaidsPosted: number | null;
  hoursBefore: number | null;
  pingRoleId: string | null;
};
export type TeamSheets = { team: Team; sheets: SheetSetting[] };

export interface SheetDb {
  // Every team with a signup sheet, or one team's (null when it has none set).
  allSheets(): Promise<TeamSheets[]>;
  teamSheets(teamId: number): Promise<TeamSheets | null>;
  // raid_night_info(): whether the team raids that date, and when.
  night(teamId: number, raidDate: string): Promise<Night>;
  roster(teamId: number): Promise<RosterRow[]>;
  rsvps(teamId: number, raidDate: string): Promise<Rsvp[]>;
  // The posted sheet's message id, read only; null when none is posted.
  postedMessage(teamId: number, raidDate: string): Promise<string | null>;
  // claim_raid_signup_sheet(): the message to edit, or null to post one. A
  // first call leaves a row with no message, which two racing calls share.
  claim(teamId: number, raidDate: string, channelId: string): Promise<string | null>;
  // Records a posted message, only where the row still has none.
  saveMessage(teamId: number, raidDate: string, messageId: string): Promise<void>;
  // Forgets this message id, only where the row still holds it.
  forgetMessage(teamId: number, raidDate: string, messageId: string): Promise<void>;
  markPosted(sheetId: number): Promise<void>;
}

export type DiscordCall = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;

export type SheetContext = {
  db: SheetDb;
  discord: DiscordCall;
  siteUrl?: string;
  now: Date;
  // The bot's own emojis by name; loaded once per run when left out.
  emojis?: Map<string, string>;
};

export const REFRESH_PREFIX = 'signup-sheet-refresh:';
// The new site's brand blue (the old bot used the old site's gold).
const COLOR = 0x5b9cf5;
const DEFAULT_TIMEZONE = 'America/New_York';
// A raid counts as passed this long after it starts: its sheet stops being
// updated and, on a sheet that keeps raids posted, the next one goes up.
export const PASSED_AFTER_MS = 4 * 60 * 60 * 1000;
// How far ahead the sweep looks: four weekly raids, the most a sheet keeps.
export const LOOKAHEAD_DAYS = 28;

// The banner is what makes Discord draw the embed wide; any image ~600px wide
// does it. A team without its own gets the Raid Hub one (Kat, 2026-11-03).
const BANNER_BASE = 'https://raw.githubusercontent.com/katogaming88/WGA-Raid-Hub/main/assets/banners/';
const TEAM_BANNERS: Record<number, string> = { 1: 'phoenix-header.png', 2: 'hellfire-header.png' };
export const bannerUrl = (teamId: number) => BANNER_BASE + (TEAM_BANNERS[teamId] ?? 'raid-hub-header.png');

const ROLES = ['Tank', 'Melee', 'Ranged', 'Heal'];
// The answers listed under the role columns, a line each, in this order.
// Unassigned is anyone in without a role, or with an answer this doesn't know.
const STATUSES = ['Unassigned', 'Late', 'Leaving Early', 'Tentative', 'Absent', 'No Response', 'Bench'];

type Field = { name: string; value: string; inline?: boolean };

// The nickname, else the character's name without its realm.
const displayName = (p: RosterRow) => p.nickname || p.nameRealm.split('-')[0].trim();

// The bot's emoji for a spec (Kat, 2026-11-03): uploaded by
// scripts/discord/upload-emojis.ts from app/public/spec-icons and named after
// the icon file, e.g. Demonology Warlock -> warlock_demonology.
export const specEmojiName = (className: string | null, spec: string | null) =>
  className && spec
    ? `${className}_${spec}`
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
    : null;

// The name with its spec icon in front, or the name alone without one.
function label(p: RosterRow, emojis: Map<string, string>): string {
  const key = specEmojiName(p.className, p.spec);
  const id = key ? emojis.get(key) : undefined;
  return id ? `<:${key}:${id}> ${displayName(p)}` : displayName(p);
}

// The bot's emojis by name, from Discord. A failed read only means names
// without icons.
export async function loadEmojis(discord: DiscordCall): Promise<Map<string, string>> {
  const app = await discord('GET', '/applications/@me');
  if (app.status !== 200 || !app.body?.id) return new Map();
  const list = await discord('GET', `/applications/${app.body.id}/emojis`);
  const items: { name: string; id: string }[] = list.status === 200 ? (list.body?.items ?? []) : [];
  return new Map(items.map((e) => [e.name, e.id]));
}

// Several sections in one field, so Heal sits under Tank whatever height the
// other columns are: Discord lays fields out three to a row, and only one
// field's own text keeps its sections stacked. The first non-empty section is
// the field's header, the rest bold lines inside it.
function column(sections: Array<{ label: string; names: string[] }>): Field | null {
  const [first, ...rest] = sections.filter((s) => s.names.length);
  if (!first) return null;
  const value = [
    first.names.join('\n'),
    ...rest.map((s) => `\n**${s.label} (${s.names.length})**\n${s.names.join('\n')}`)
  ];
  return {
    name: `${first.label} (${first.names.length})`,
    value: truncate(value.join('\n'), EMBED_FIELD_VALUE_MAX),
    inline: true
  };
}

export function startsAt(raidDate: string, night: Night): Date | null {
  return night.startTime ? zonedTimeToUtc(raidDate, night.startTime, night.timezone || DEFAULT_TIMEZONE) : null;
}

// The sheet for one raid night, as the bot posted it.
export function buildSheet(input: {
  team: Pick<Team, 'id' | 'name' | 'slug'>;
  raidDate: string;
  night: Night;
  roster: RosterRow[];
  rsvps: Rsvp[];
  siteUrl?: string;
  emojis?: Map<string, string>;
}) {
  const { team, raidDate, night } = input;
  const emojis = input.emojis ?? new Map<string, string>();
  const answers = new Map(input.rsvps.map((r) => [r.playerId, r.status]));
  const byRole: Record<string, string[]> = { Tank: [], Melee: [], Ranged: [], Heal: [] };
  const byStatus: Record<string, string[]> = Object.fromEntries(STATUSES.map((s) => [s, []]));
  let inCount = 0;

  for (const player of input.roster) {
    const name = label(player, emojis);
    // Present unless answered, except on an optional night, which has no default.
    const status = answers.get(player.id) ?? (night.isOptional ? 'No Response' : 'Present');
    if (player.isBench) {
      byStatus.Bench.push(name);
    } else if (status === 'Present' || status === 'Attending') {
      (player.role && ROLES.includes(player.role) ? byRole[player.role] : byStatus.Unassigned).push(name);
      inCount++;
    } else {
      (byStatus[status] ?? byStatus.Unassigned).push(name);
    }
  }

  // <t:unix:F> shows the weekday, date and time in each reader's own zone.
  const at = startsAt(raidDate, night);
  const optional = night.isOptional ? 'Optional Night' : '';
  const description = at ? `<t:${Math.round(at.getTime() / 1000)}:F>${optional ? ' — ' + optional : ''}` : optional;

  const fields: Field[] = [];
  const columns = [
    column([
      { label: 'Tank', names: byRole.Tank },
      { label: 'Heal', names: byRole.Heal }
    ]),
    column([{ label: 'Melee', names: byRole.Melee }]),
    column([{ label: 'Ranged', names: byRole.Ranged }])
  ].filter((c): c is Field => c !== null);
  fields.push(...columns);
  // Every other answer in one field, a line each: "**Late:** Name, Name".
  const others = STATUSES.filter((s) => byStatus[s].length && (s !== 'No Response' || night.isOptional)).map(
    (s) => `**${s}:** ${byStatus[s].join(', ')}`
  );
  if (others.length) fields.push({ name: 'Other answers', value: truncate(others.join('\n'), EMBED_FIELD_VALUE_MAX) });

  const buttons: Record<string, unknown>[] = [];
  if (input.siteUrl) {
    // calendar.html opens on the default team when ?team= is left off.
    const teamParam = team.slug && team.slug !== 'phoenix' ? `&team=${team.slug}` : '';
    buttons.push({
      type: 2,
      style: 5,
      label: 'View on Site',
      url: `${input.siteUrl.replace(/\/$/, '')}/calendar.html?date=${raidDate}${teamParam}`
    });
  }
  // The team id rides on the button: one server can hold several teams.
  buttons.push({ type: 2, style: 2, label: 'Refresh', custom_id: `${REFRESH_PREFIX}${team.id}:${raidDate}` });

  return {
    embeds: [
      {
        color: COLOR,
        title: `${team.name} — Signup Sheet`,
        description,
        fields,
        footer: { text: `${inCount} of ${input.roster.length} available · Refresh to update` },
        image: { url: bannerUrl(team.id) }
      }
    ],
    components: [{ type: 1, components: buttons }]
  };
}

export function inQuietHours(quiet: QuietHours | null, now: Date): boolean {
  if (!quiet) return false;
  const t = clockTime(now, quiet.timezone);
  return quiet.start < quiet.end ? t >= quiet.start && t < quiet.end : t >= quiet.start || t < quiet.end;
}

// The sheet that covers a raid date: the one whose raid days hold its weekday.
export const sheetFor = (sheets: SheetSetting[], raidDate: string) =>
  sheets.find((s) => s.raidDays.includes(weekdayOf(raidDate))) ?? null;

export type Planned = { raidDate: string; night: Night; post: boolean };

// The raid nights a sheet looks after now, soonest first: every one on its
// days not yet passed, each marked whether it should be posted by now.
export function plan(sheet: SheetSetting, nights: Array<{ raidDate: string; night: Night }>, now: Date): Planned[] {
  const upcoming = nights
    .filter(({ raidDate, night }) => {
      const at = night.exists ? startsAt(raidDate, night) : null;
      return (
        at !== null && sheet.raidDays.includes(weekdayOf(raidDate)) && now.getTime() < at.getTime() + PASSED_AFTER_MS
      );
    })
    .sort((a, b) => a.raidDate.localeCompare(b.raidDate));
  return upcoming.map((n, i) => ({
    ...n,
    post:
      sheet.hoursBefore !== null
        ? now.getTime() >= startsAt(n.raidDate, n.night)!.getTime() - sheet.hoursBefore * 3_600_000
        : i < (sheet.keepRaidsPosted ?? 0)
  }));
}

// Yesterday through LOOKAHEAD_DAYS ahead, by UTC date: an evening raid in the
// Americas is already the next day in UTC.
export function lookaheadDates(now: Date): string[] {
  const dates: string[] = [];
  for (let offset = -1; offset <= LOOKAHEAD_DAYS; offset++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + offset);
    dates.push(isoDate(d));
  }
  return dates;
}

export type SyncResult = 'posted' | 'edited' | 'not posted' | 'no raid' | 'quiet hours' | 'not in server';

// Brings one raid night's sheet up to date: edits the posted message, or,
// when `create` allows, posts one. A message Discord will not let this bot
// edit (posted by the old bots, 403) or that is gone (404) is forgotten and
// a fresh one posted in its place.
export async function syncSheet(
  ctx: SheetContext,
  team: Team,
  sheet: SheetSetting,
  raidDate: string,
  opts: { create: boolean; night?: Night }
): Promise<SyncResult> {
  const { db, discord } = ctx;
  const night = opts.night ?? (await db.night(team.id, raidDate));
  if (!night.exists) return 'no raid';
  // Nothing is posted and this call may not post: leave no row behind, so
  // the sweep still posts it on time.
  if (!opts.create && !(await db.postedMessage(team.id, raidDate))) return 'not posted';

  // Read once and kept on the context for the rest of the run.
  ctx.emojis ??= await loadEmojis(discord);
  const [roster, rsvps] = await Promise.all([db.roster(team.id), db.rsvps(team.id, raidDate)]);
  const message = buildSheet({ team, raidDate, night, roster, rsvps, siteUrl: ctx.siteUrl, emojis: ctx.emojis });
  const existing = await db.claim(team.id, raidDate, sheet.channelId);

  if (existing) {
    const path = `/channels/${sheet.channelId}/messages/${existing}`;
    const edited = await discord('PATCH', path, { ...message, allowed_mentions: { parse: [] } });
    if (edited.status === 200) return 'edited';
    if (edited.status !== 403 && edited.status !== 404)
      throw new Error(`Discord answered ${edited.status} to the edit`);
    // An old bot's sheet: take it down too where the bot may (Manage
    // Messages), so no button is left pointing at a stopped application.
    if (edited.status === 403) await discord('DELETE', path);
    await db.forgetMessage(team.id, raidDate, existing);
  }

  if (inQuietHours(team.quietHours, ctx.now)) return 'quiet hours';
  // The channel must be in the team's own server (#1712).
  const channel = await discord('GET', `/channels/${sheet.channelId}`);
  if (channel.status !== 200 || channel.body?.guild_id !== team.serverId) return 'not in server';

  const role = sheet.pingRoleId;
  const sent = await discord('POST', `/channels/${sheet.channelId}/messages`, {
    ...message,
    ...(role ? { content: `<@&${role}>` } : {}),
    allowed_mentions: { parse: [], roles: role ? [role] : [] }
  });
  if (sent.status !== 200 || !sent.body?.id) throw new Error(`Discord answered ${sent.status} to the post`);
  await db.saveMessage(team.id, raidDate, sent.body.id);
  await db.markPosted(sheet.id);
  return 'posted';
}

// One raid night's sheet for a team, from an RSVP change or the Refresh
// button: edits only, unless the posted message has to be replaced.
export async function refreshSheet(ctx: SheetContext, teamId: number, raidDate: string): Promise<SyncResult> {
  const found = await ctx.db.teamSheets(teamId);
  const sheet = found && sheetFor(found.sheets, raidDate);
  if (!found || !sheet) return 'not posted';
  return syncSheet(ctx, found.team, sheet, raidDate, { create: false });
}

// The scheduled run: every team's sheets, each raid night posted when due and
// every posted one not yet passed brought up to date. One night failing does
// not stop the rest.
export async function sweepSheets(ctx: SheetContext): Promise<{ posted: number; edited: number; failed: number }> {
  const counts = { posted: 0, edited: 0, failed: 0 };
  const dates = lookaheadDates(ctx.now);
  for (const { team, sheets } of await ctx.db.allSheets()) {
    for (const sheet of sheets) {
      const days = dates.filter((d) => sheet.raidDays.includes(weekdayOf(d)));
      const nights = await Promise.all(
        days.map(async (raidDate) => ({ raidDate, night: await ctx.db.night(team.id, raidDate) }))
      );
      for (const n of plan(sheet, nights, ctx.now)) {
        try {
          const result = await syncSheet(ctx, team, sheet, n.raidDate, { create: n.post, night: n.night });
          if (result === 'posted') counts.posted++;
          if (result === 'edited') counts.edited++;
        } catch (err) {
          counts.failed++;
          console.error(`signup sheet: team ${team.id} ${n.raidDate}:`, err instanceof Error ? err.message : err);
        }
      }
    }
  }
  return counts;
}
