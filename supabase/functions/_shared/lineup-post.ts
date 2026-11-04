// The weekly boss lineup post (#1709). Once a week, on the day and time a team
// picks on Settings › Discord, the bot posts the boss lineup for the raid
// nights of the coming week, a drawn grid per night, and edits that message
// when an officer changes the lineup. /officer post lineup posts one night's
// now.
//
// The grid is the look Kat picked (2026-11-04, mockup C2): raiders down the
// side by role in class colour, the night's bosses across the top in pull
// order, a dot where a raider is in, a green up-arrow where one comes in for
// that boss, a red down-arrow where one goes out, a dash where they sit out,
// and under each boss who comes in over who goes out.
//
// No reads or Discord calls of its own, like signup-sheet.ts.
import {
  type DiscordCall,
  type DiscordFile,
  type Night,
  type QuietHours,
  type RosterRow,
  inQuietHours,
  startsAt
} from './signup-sheet.ts';
import { CLASS_COLORS, pictureKey } from './sheet-picture.ts';
import { isoDate, zonedTimeToUtc } from './time.ts';

export type LineupSetting = {
  channelId: string;
  pingRoleId: string | null;
  weekday: number;
  time: string;
  timezone: string;
};
export type LineupTeam = { id: number; name: string; slug: string; serverId: string; quietHours: QuietHours | null };
export type TeamLineup = { team: LineupTeam; setting: LineupSetting };
// One boss on a night's list, in pull order, with who is in for it.
export type LineupBoss = { name: string; position: number; playerIds: number[] };
export type WeekPost = { messageId: string | null; channelId: string | null; key: string };
// The key of a week whose lineup was emptied after it posted.
export const EMPTY_KEY = 'empty';

export interface LineupDb {
  // Every team with a weekly lineup post set, or one team's.
  allLineups(): Promise<TeamLineup[]>;
  teamLineup(teamId: number): Promise<TeamLineup | null>;
  night(teamId: number, raidDate: string): Promise<Night>;
  roster(teamId: number): Promise<RosterRow[]>;
  // The bosses being pulled that night (skipped ones left out), in order.
  bosses(teamId: number, raidDate: string): Promise<LineupBoss[]>;
  // The message posted for a week, or null.
  // The week's row: its message and channel (null once taken down) and what
  // it shows. Null when the week hasn't posted.
  postedLineup(teamId: number, weekOf: string): Promise<WeekPost | null>;
  // Records the week's first message; false when another run's is already there.
  saveLineup(teamId: number, weekOf: string, post: WeekPost & { messageId: string }): Promise<boolean>;
  // Changes the week's row after an edit, a take-down or a repost.
  updateLineup(teamId: number, weekOf: string, post: WeekPost): Promise<void>;
  markPosted(teamId: number): Promise<void>;
}

export type LineupContext = {
  db: LineupDb;
  discord: DiscordCall;
  siteUrl?: string;
  now: Date;
  // Turns the grid's SVG into a PNG. Left out, or failing, a night is sent as
  // text: its bosses and swaps.
  draw?: (svg: string) => Promise<Uint8Array>;
};

const COLOR = 0x5b9cf5;
const DAY_MS = 86_400_000;

// The day in `timeZone` that `at` falls on, as YYYY-MM-DD.
function zonedDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

const addDays = (date: string, n: number) => isoDate(new Date(Date.parse(date + 'T00:00:00Z') + n * DAY_MS));

// The week the post covers now: the latest time it was due, at or before now,
// and the date of that day in the team's zone (the week's key).
export function currentWeek(setting: LineupSetting, now: Date): { weekOf: string; due: Date } {
  const today = zonedDate(now, setting.timezone);
  const back = (new Date(today + 'T00:00:00Z').getUTCDay() - setting.weekday + 7) % 7;
  let weekOf = addDays(today, -back);
  let due = zonedTimeToUtc(weekOf, setting.time, setting.timezone);
  if (due.getTime() > now.getTime()) {
    weekOf = addDays(weekOf, -7);
    due = zonedTimeToUtc(weekOf, setting.time, setting.timezone);
  }
  return { weekOf, due };
}

// The raid nights a week's post covers: every night starting in the seven
// days from the time it was due.
export async function weekNights(
  db: LineupDb,
  teamId: number,
  week: { weekOf: string; due: Date },
  setting: Pick<LineupSetting, 'time' | 'timezone'>
): Promise<Array<{ raidDate: string; night: Night }>> {
  const dates = Array.from({ length: 9 }, (_, n) => addDays(week.weekOf, n - 1));
  const nights = await Promise.all(
    dates.map(async (raidDate) => ({ raidDate, night: await db.night(teamId, raidDate) }))
  );
  // Seven days on at the same clock time, so a week the clocks change in
  // neither drops nor repeats the hour before the next post (fresh review on #1761).
  // The next post's own clock time, not this one's after a clock change
  // moved it (CodeRabbit on #1761).
  const end = zonedTimeToUtc(addDays(week.weekOf, 7), setting.time, setting.timezone).getTime();
  return nights.filter(({ raidDate, night }) => {
    if (!night.exists) return false;
    const at = startsAt(raidDate, night);
    return at
      ? at.getTime() >= week.due.getTime() && at.getTime() < end
      : raidDate >= week.weekOf && raidDate < addDays(week.weekOf, 7);
  });
}

// -- The grid -----------------------------------------------------------------

export type Cell = 'in' | 'out' | 'came' | 'went';
export type GridRow = { name: string; className: string; role: string; cells: Cell[]; count: number };
export type Grid = {
  bosses: string[];
  groups: Array<{ label: string; rows: GridRow[] }>;
  // For each boss, who comes in and who goes out compared with the boss before.
  swaps: Array<{ came: string[]; went: string[] }>;
};

const ROLES: Array<[string, string]> = [
  ['Tank', 'Tanks'],
  ['Heal', 'Healers'],
  ['Melee', 'Melee'],
  ['Ranged', 'Ranged']
];
const nameOf = (p: RosterRow) => p.nickname || p.nameRealm.split('-')[0].trim();

// One night's grid. Rows are everyone on the roster with a role and off the
// bench, and anyone in for a boss whatever their status.
export function lineupGrid(roster: RosterRow[], bosses: LineupBoss[]): Grid {
  const ordered = [...bosses].sort((a, b) => a.position - b.position);
  const sets = ordered.map((b) => new Set(b.playerIds));
  const shown = roster.filter((p) => p.role && (!p.isBench || sets.some((s) => s.has(p.id))));
  const cellsOf = (id: number): Cell[] =>
    sets.map((s, i) => {
      const inNow = s.has(id);
      if (i === 0) return inNow ? 'in' : 'out';
      const inBefore = sets[i - 1].has(id);
      return inNow && !inBefore ? 'came' : !inNow && inBefore ? 'went' : inNow ? 'in' : 'out';
    });
  const groups = ROLES.map(([role, label]) => ({
    label,
    rows: shown
      .filter((p) => p.role === role)
      .map((p) => {
        const cells = cellsOf(p.id);
        return {
          name: nameOf(p),
          className: p.className ?? '',
          role,
          cells,
          count: cells.filter((c) => c === 'in' || c === 'came').length
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  })).filter((g) => g.rows.length);
  const rows = groups.flatMap((g) => g.rows);
  const swaps = ordered.map((_, i) => ({
    came: rows.filter((r) => r.cells[i] === 'came').map((r) => r.name),
    went: rows.filter((r) => r.cells[i] === 'went').map((r) => r.name)
  }));
  return { bosses: ordered.map((b) => b.name), groups, swaps };
}

// The swaps in words, for the alt text and the text fallback: "3. Vashnik:
// Bear, Luminouss in; Zuggz, Brooke out".
export function swapLines(grid: Grid): string[] {
  return grid.swaps.flatMap((s, i) =>
    s.came.length || s.went.length
      ? [
          `${i + 1}. ${grid.bosses[i]}: ` +
            [s.came.length ? `${s.came.join(', ')} in` : '', s.went.length ? `${s.went.join(', ')} out` : '']
              .filter(Boolean)
              .join('; ')
        ]
      : []
  );
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fit = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

const PAD = 28;
const NAME_W = 190;
const CELL_W = 64;
const ROW_H = 32;
const LEGEND_W = 300;

export function lineupSvg(grid: Grid): string {
  const n = grid.bosses.length;
  const tableW = NAME_W + n * CELL_W + 56;
  const width = PAD * 2 + tableW + 24 + LEGEND_W;
  const parts: string[] = [];
  let y = PAD;
  // Boss numbers across the top.
  grid.bosses.forEach((_, i) => {
    parts.push(
      `<text x="${PAD + NAME_W + i * CELL_W + CELL_W / 2}" y="${y + 18}" font-size="17" font-weight="700" fill="#9aa3b5" text-anchor="middle">${i + 1}</text>`
    );
  });
  y += 28;
  for (const group of grid.groups) {
    parts.push(
      `<text x="${PAD}" y="${y + 22}" font-size="15" fill="#9aa3b5" letter-spacing="1">${group.label.toUpperCase()}</text>`
    );
    y += 30;
    for (const row of group.rows) {
      parts.push(
        `<text x="${PAD}" y="${y + 22}" font-size="19" font-weight="700" fill="${CLASS_COLORS[row.className] ?? '#e8eaf0'}">${escape(fit(row.name, 15))}</text>`
      );
      row.cells.forEach((cell, i) => {
        const x = PAD + NAME_W + i * CELL_W;
        const cx = x + CELL_W / 2;
        if (cell === 'out') {
          parts.push(`<rect x="${x}" y="${y}" width="${CELL_W}" height="${ROW_H}" fill="#161a22"/>`);
          parts.push(`<text x="${cx}" y="${y + 21}" font-size="16" fill="#3a4152" text-anchor="middle">–</text>`);
        } else if (cell === 'in') {
          parts.push(`<circle cx="${cx}" cy="${y + ROW_H / 2}" r="4" fill="#5b9cf5"/>`);
        } else {
          const came = cell === 'came';
          parts.push(
            `<rect x="${x}" y="${y}" width="${CELL_W}" height="${ROW_H}" fill="${came ? '#1a3a2c' : '#3a1f24'}"/>`,
            came
              ? `<path d="M${cx - 7} ${y + 21} L${cx + 7} ${y + 21} L${cx} ${y + 10} Z" fill="#3fd68a"/>`
              : `<path d="M${cx - 7} ${y + 11} L${cx + 7} ${y + 11} L${cx} ${y + 22} Z" fill="#ff6b6b"/>`
          );
        }
      });
      parts.push(
        `<text x="${PAD + NAME_W + n * CELL_W + 12}" y="${y + 21}" font-size="15" fill="#9aa3b5">${row.count}/${n}</text>`
      );
      y += ROW_H;
    }
  }
  // Under each boss, who comes in over who goes out.
  y += 18;
  parts.push(`<text x="${PAD}" y="${y + 14}" font-size="15" fill="#9aa3b5" letter-spacing="1">SWAPS</text>`);
  let tallest = 0;
  grid.swaps.forEach((s, i) => {
    const cx = PAD + NAME_W + i * CELL_W + CELL_W / 2;
    let line = 0;
    const pairs = Math.max(s.came.length, s.went.length);
    for (let k = 0; k < pairs; k++) {
      if (s.came[k])
        parts.push(
          `<text x="${cx}" y="${y + 14 + line * 16}" font-size="13" font-weight="700" fill="#3fd68a" text-anchor="middle">${escape(fit(s.came[k], 9))}</text>`
        );
      line++;
      if (s.went[k])
        parts.push(
          `<text x="${cx}" y="${y + 14 + line * 16}" font-size="13" fill="#ff6b6b" text-anchor="middle">${escape(fit(s.went[k], 9))}</text>`
        );
      line += 1.6;
    }
    tallest = Math.max(tallest, line);
  });
  const tableBottom = y + Math.max(tallest, 1) * 16 + 6;
  // The legend: each boss by number, then what the marks mean.
  const lx = PAD + tableW + 24;
  let ly = PAD + 18;
  grid.bosses.forEach((b, i) => {
    parts.push(
      `<text x="${lx}" y="${ly}" font-size="16" fill="#c8ccd6"><tspan fill="#9aa3b5" font-weight="700">${i + 1}</tspan><tspan dx="10">${escape(fit(b, 28))}</tspan></text>`
    );
    ly += 28;
  });
  ly += 10;
  parts.push(
    `<path d="M${lx} ${ly + 1} L${lx + 12} ${ly + 1} L${lx + 6} ${ly - 9} Z" fill="#3fd68a"/><text x="${lx + 20}" y="${ly}" font-size="14" fill="#9aa3b5">comes in for this boss</text>`,
    `<path d="M${lx} ${ly + 17} L${lx + 12} ${ly + 17} L${lx + 6} ${ly + 27} Z" fill="#ff6b6b"/><text x="${lx + 20}" y="${ly + 26}" font-size="14" fill="#9aa3b5">goes out for this boss</text>`,
    `<text x="${lx + 1}" y="${ly + 52}" font-size="14" fill="#9aa3b5">–<tspan dx="12">sitting out</tspan></text>`
  );
  const height = Math.max(tableBottom, ly + 60) + PAD;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Onest">` +
    `<rect width="${width}" height="${height}" fill="#11141b"/>` +
    parts.join('') +
    `</svg>`
  );
}

// -- The message ----------------------------------------------------------------

export type NightGrid = { raidDate: string; night: Night; grid: Grid };

function nightLabel(raidDate: string, night: Night): string {
  const at = startsAt(raidDate, night);
  return at ? `<t:${Math.round(at.getTime() / 1000)}:F>` : raidDate;
}

// The post for some raid nights, a grid each. `files` names each night's
// picture, or is null for a night sent as text.
export function lineupMessage(
  team: Pick<LineupTeam, 'name' | 'slug'>,
  nights: NightGrid[],
  files: Array<string | null>,
  siteUrl?: string
) {
  const embeds = nights.map((n, i) => {
    const swaps = swapLines(n.grid);
    const base = {
      color: COLOR,
      ...(i === 0 ? { title: `${team.name} — Boss lineup` } : {}),
      description:
        `**${nightLabel(n.raidDate, n.night)}** · ${n.grid.bosses.length} ${n.grid.bosses.length === 1 ? 'boss' : 'bosses'}` +
        (files[i]
          ? ''
          : '\n' +
            (n.grid.bosses.map((b, k) => `${k + 1}. ${b}`).join('\n') +
              (swaps.length ? `\n\n**Swaps**\n${swaps.join('\n')}` : '')))
    };
    return files[i] ? { ...base, image: { url: `attachment://${files[i]}` } } : base;
  });
  embeds[embeds.length - 1] = {
    ...embeds[embeds.length - 1],
    footer: { text: 'Updates when an officer changes the lineup' }
  } as never;
  const components = siteUrl
    ? [
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 5,
              label: 'Open the lineup',
              url: `${siteUrl.replace(/\/$/, '')}/calendar.html?date=${nights[0].raidDate}${team.slug && team.slug !== 'phoenix' ? `&team=${team.slug}` : ''}`
            }
          ]
        }
      ]
    : [];
  return { embeds, components };
}

// The grids for some nights, drawn where they can be; the message, its files
// and its key (what it shows, so an unchanged post is told apart).
// What a post for these nights shows: each night's date and start, every
// boss and who is in for it. The start counts, so a night moved to another
// time edits the post too (CodeRabbit on #1761).
const keyOf = (nights: NightGrid[]) =>
  pictureKey(
    { groups: [] },
    nights.map((n) => ({ d: n.raidDate, t: n.night.startTime, z: n.night.timezone, g: n.grid }))
  );

async function render(ctx: LineupContext, team: LineupTeam, nights: NightGrid[]) {
  const key = await keyOf(nights);
  const names = nights.map((_, i) => `lineup-${key}-${i}.png`);
  const files: DiscordFile[] = [];
  const shown: Array<string | null> = [];
  for (const [i, n] of nights.entries()) {
    if (!ctx.draw) {
      shown.push(null);
      continue;
    }
    try {
      files.push({ name: names[i], data: await ctx.draw(lineupSvg(n.grid)) });
      shown.push(names[i]);
    } catch (err) {
      console.error('lineup post: picture not drawn:', err instanceof Error ? err.message : err);
      shown.push(null);
    }
  }
  const message = lineupMessage(team, nights, shown, ctx.siteUrl);
  const attachments = files.map((f) => {
    const n = nights[names.indexOf(f.name)];
    const swaps = swapLines(n.grid);
    const description = `Boss lineup for ${n.raidDate}: ${n.grid.bosses.length} bosses. ${swaps.length ? 'Swaps: ' + swaps.join('. ') : 'No swaps.'}`;
    return {
      id: files.indexOf(f),
      filename: f.name,
      description: description.length > 1024 ? description.slice(0, 1023) + '…' : description
    };
  });
  // No file at all when nothing was drawn, so the post is plain JSON.
  return { message, files: files.length ? files : undefined, attachments, key };
}

async function gridsFor(ctx: LineupContext, teamId: number, nights: Array<{ raidDate: string; night: Night }>) {
  const roster = await ctx.db.roster(teamId);
  const out: NightGrid[] = [];
  for (const n of nights) {
    const bosses = await ctx.db.bosses(teamId, n.raidDate);
    if (bosses.length) out.push({ ...n, grid: lineupGrid(roster, bosses) });
  }
  return out;
}

export type LineupResult = 'posted' | 'edited' | 'unchanged' | 'no lineup' | 'passed' | 'quiet hours' | 'not in server';

// Brings one team's weekly post up to date: posts it once it is due and has a
// lineup, pinging the role; afterwards edits it when the lineup changes,
// pinging nobody. A lineup emptied after it posted takes the post down and
// keeps the week's row, so the lineup coming back posts it again unpinged.
// The stored key says whether anything changed, so most runs ask Discord
// nothing (CodeRabbit on #1761).
export async function syncLineup(ctx: LineupContext, { team, setting }: TeamLineup): Promise<LineupResult> {
  const week = currentWeek(setting, ctx.now);
  const row = await ctx.db.postedLineup(team.id, week.weekOf);
  const nights = await gridsFor(ctx, team.id, await weekNights(ctx.db, team.id, week, setting));
  const key = nights.length ? await keyOf(nights) : EMPTY_KEY;
  if (!row && nights.length === 0) return 'no lineup';
  if (row?.key === key) return 'unchanged';

  if (row) {
    // Where it went, even if the channel was changed since (fresh review on #1761).
    const path = row.messageId ? `/channels/${row.channelId}/messages/${row.messageId}` : null;
    if (nights.length === 0) {
      if (path) {
        const removed = await ctx.discord('DELETE', path);
        if (removed.status !== 204 && removed.status !== 200 && removed.status !== 404) {
          throw new Error(`Discord answered ${removed.status} to the take-down`);
        }
      }
      await ctx.db.updateLineup(team.id, week.weekOf, { messageId: null, channelId: null, key });
      return 'edited';
    }
    if (path) {
      const { message, files, attachments } = await render(ctx, team, nights);
      const edited = await ctx.discord(
        'PATCH',
        path,
        { ...message, attachments, allowed_mentions: { parse: [] } },
        files
      );
      if (edited.status === 200) {
        await ctx.db.updateLineup(team.id, week.weekOf, { messageId: row.messageId, channelId: row.channelId, key });
        return 'edited';
      }
      if (edited.status !== 403 && edited.status !== 404)
        throw new Error(`Discord answered ${edited.status} to the edit`);
    }
    // Taken down, deleted, or out of the bot's reach: posted again below.
  }

  // A week whose nights have all started is not posted late, say when the
  // post was first turned on after them.
  if (!nights.some((n) => (startsAt(n.raidDate, n.night)?.getTime() ?? Infinity) > ctx.now.getTime())) return 'passed';
  if (inQuietHours(team.quietHours, ctx.now)) return 'quiet hours';
  const channel = await ctx.discord('GET', `/channels/${setting.channelId}`);
  if (channel.status !== 200 || channel.body?.guild_id !== team.serverId) return 'not in server';
  const { message, files, attachments } = await render(ctx, team, nights);
  // Only the week's first post pings.
  const role = row ? null : setting.pingRoleId;
  const sent = await ctx.discord(
    'POST',
    `/channels/${setting.channelId}/messages`,
    {
      ...message,
      attachments,
      ...(role ? { content: `<@&${role}>` } : {}),
      allowed_mentions: { parse: [], roles: role ? [role] : [] }
    },
    files
  );
  if (sent.status !== 200 || !sent.body?.id) throw new Error(`Discord answered ${sent.status} to the post`);
  const post = { messageId: sent.body.id as string, channelId: setting.channelId, key };
  if (row) {
    await ctx.db.updateLineup(team.id, week.weekOf, post);
    return 'posted';
  }
  const takeDown = () =>
    ctx.discord('DELETE', `/channels/${setting.channelId}/messages/${sent.body.id}`).catch(() => null);
  let saved: boolean;
  try {
    saved = await ctx.db.saveLineup(team.id, week.weekOf, post);
  } catch (err) {
    await takeDown();
    throw err;
  }
  if (!saved) {
    await takeDown();
    return 'edited';
  }
  await ctx.db.markPosted(team.id);
  return 'posted';
}

// The scheduled run: every team's weekly post. One failing does not stop the rest.
export async function sweepLineups(ctx: LineupContext): Promise<{ posted: number; edited: number; failed: number }> {
  const counts = { posted: 0, edited: 0, failed: 0 };
  for (const lineup of await ctx.db.allLineups()) {
    try {
      const result = await syncLineup(ctx, lineup);
      if (result === 'posted') counts.posted++;
      if (result === 'edited') counts.edited++;
    } catch (err) {
      counts.failed++;
      console.error(`lineup post: team ${lineup.team.id}:`, err instanceof Error ? err.message : err);
    }
  }
  return counts;
}

export type PostNowResult = 'posted' | 'no lineup' | 'not set' | 'not in server';

// /officer post lineup: one night's lineup now, to the lineup channel, pinging
// nobody. Not recorded as the week's post, so the weekly one still goes up.
export async function postLineupNow(ctx: LineupContext, teamId: number, raidDate: string): Promise<PostNowResult> {
  const lineup = await ctx.db.teamLineup(teamId);
  if (!lineup) return 'not set';
  const night = await ctx.db.night(teamId, raidDate);
  const nights = night.exists ? await gridsFor(ctx, teamId, [{ raidDate, night }]) : [];
  if (nights.length === 0) return 'no lineup';
  const channel = await ctx.discord('GET', `/channels/${lineup.setting.channelId}`);
  if (channel.status !== 200 || channel.body?.guild_id !== lineup.team.serverId) return 'not in server';
  const { message, files, attachments } = await render(ctx, lineup.team, nights);
  const sent = await ctx.discord(
    'POST',
    `/channels/${lineup.setting.channelId}/messages`,
    { ...message, attachments, allowed_mentions: { parse: [] } },
    files
  );
  if (sent.status !== 200) throw new Error(`Discord answered ${sent.status} to the post`);
  return 'posted';
}
