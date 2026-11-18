// The weekly boss lineup post (#1709). Once a week, on the day and time a team
// picks on Settings › Discord, the bot posts the boss lineup for the raid
// nights of the coming week, a drawn grid per night, and edits that message
// when an officer changes the lineup. /officer post lineup posts one night's
// now. Once the last raid night it covers has passed, the post is marked
// finished or deleted, as the team chose (#1825).
//
// The grid is the look Kat picked (2026-11-04, mockup C2): raiders down the
// side by role in class colour, the night's bosses across the top in pull
// order, a dot where a raider is in, a green up-arrow where one comes in for
// that boss, a red down-arrow where one goes out, a dash where they sit out,
// and under each boss who comes in over who goes out.
//
// No reads or Discord calls of its own, like signup-sheet.ts.
import {
  type AfterRaid,
  type DiscordCall,
  type DiscordFile,
  type Night,
  type QuietHours,
  type RosterRow,
  finishPost,
  hasPassed,
  inQuietHours,
  startsAt
} from './signup-sheet.ts';
import { CLASS_COLORS, pictureKey, specIconKey } from './sheet-picture.ts';
import { isoDate, zonedTimeToUtc } from './time.ts';

export type LineupSetting = {
  channelId: string;
  pingRoleId: string | null;
  weekday: number;
  time: string;
  timezone: string;
};
export type LineupTeam = {
  id: number;
  name: string;
  slug: string;
  serverId: string;
  quietHours: QuietHours | null;
  afterRaid: AfterRaid;
};
export type TeamLineup = { team: LineupTeam; setting: LineupSetting };
// Another character or spec a raider plays on one boss (#1873): the alt's
// name (null on their own character) and the class and spec played.
export type LineupPick = { character: string | null; className: string; spec: string };
// One boss on a night's list, in pull order, with who is in for it and the
// picks of those who play something other than their usual. A pick's class
// or spec left null is the raider's usual one.
export type LineupBoss = {
  name: string;
  position: number;
  playerIds: number[];
  picks?: Record<number, { character: string | null; className: string | null; spec: string | null }>;
};
// coversUntil: when the post's week ended as it was posted (#1825), so a
// later change to the posting time can't cut short a week already up.
export type WeekPost = { messageId: string | null; channelId: string | null; key: string; coversUntil?: string };
// The key of a week whose lineup was emptied after it posted.
export const EMPTY_KEY = 'empty';
export const WEEK_FINISHED = "This week's raids have finished.";

export interface LineupDb {
  // Every team with a weekly lineup post set, or one team's.
  allLineups(): Promise<TeamLineup[]>;
  teamLineup(teamId: number): Promise<TeamLineup | null>;
  night(teamId: number, raidDate: string): Promise<Night>;
  roster(teamId: number): Promise<RosterRow[]>;
  // The bosses being pulled that night (skipped ones left out), in order.
  bosses(teamId: number, raidDate: string): Promise<LineupBoss[]>;
  // The message posted for a week, or null.
  // The week's row: its message and channel (null once taken down), what it
  // shows, and whether it was finished (#1825). Null when the week hasn't posted.
  postedLineup(teamId: number, weekOf: string): Promise<(WeekPost & { finished: boolean }) | null>;
  // Records the week's first message; false when another run's is already there.
  saveLineup(teamId: number, weekOf: string, post: WeekPost & { messageId: string }): Promise<boolean>;
  // Changes the week's row after an edit, a take-down or a repost.
  updateLineup(teamId: number, weekOf: string, post: WeekPost): Promise<void>;
  // The latest week the team posted for before this one, or null.
  previousWeek(teamId: number, before: string): Promise<string | null>;
  markPosted(teamId: number): Promise<void>;
  // The team's posted weeks not yet finished (#1825).
  unfinishedWeeks(
    teamId: number
  ): Promise<Array<{ weekOf: string; channelId: string; messageId: string; coversUntil: string | null }>>;
  // Records that a week's post was finished or deleted, so it happens once.
  finishLineup(teamId: number, weekOf: string): Promise<void>;
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

// When a week's post stops covering nights: the next post's time.
// Seven days on at the same clock time, so a week the clocks change in
// neither drops nor repeats the hour before the next post (fresh review on #1761).
// The next post's own clock time, not this one's after a clock change
// moved it (CodeRabbit on #1761).
const weekEnd = (weekOf: string, setting: Pick<LineupSetting, 'time' | 'timezone'>) =>
  zonedTimeToUtc(addDays(weekOf, 7), setting.time, setting.timezone);

// The raid nights a week's post covers: every night starting in the seven
// days from the time it was due, or up to the end it was posted with.
export async function weekNights(
  db: LineupDb,
  teamId: number,
  week: { weekOf: string; due: Date; end?: Date },
  setting: Pick<LineupSetting, 'time' | 'timezone'>
): Promise<Array<{ raidDate: string; night: Night }>> {
  const dates = Array.from({ length: 9 }, (_, n) => addDays(week.weekOf, n - 1));
  const nights = await Promise.all(
    dates.map(async (raidDate) => ({ raidDate, night: await db.night(teamId, raidDate) }))
  );
  const end = (week.end ?? weekEnd(week.weekOf, setting)).getTime();
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
// picks: per boss, what the raider plays when it isn't their usual (#1873).
// Left off a raider with none, so their row and the post's key stay as before.
export type GridRow = {
  name: string;
  className: string;
  role: string;
  cells: Cell[];
  count: number;
  picks?: Array<LineupPick | null>;
};
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
        const picks = ordered.map((b, i): LineupPick | null => {
          const pick = sets[i].has(p.id) ? b.picks?.[p.id] : undefined;
          return pick
            ? {
                character: pick.character,
                className: pick.className ?? p.className ?? '',
                spec: pick.spec ?? p.spec ?? ''
              }
            : null;
        });
        return {
          name: nameOf(p),
          className: p.className ?? '',
          role,
          cells,
          count: cells.filter((c) => c === 'in' || c === 'came').length,
          ...(picks.some(Boolean) ? { picks } : {})
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

// A pick in words: "on Kattotem (Restoration Shaman)" or "as Destruction".
export const pickWords = (p: LineupPick) =>
  p.character ? `on ${p.character} (${p.spec} ${p.className})` : `as ${p.spec}`;
const pickKey = (p: LineupPick | null | undefined) => (p ? pickWords(p) : '');

// The swaps in words, for the alt text and the text fallback: "3. Vashnik:
// Bear, Luminouss in; Zuggz, Brooke out". A pick is named where it starts:
// with the raider coming in, or on its own for one already in ("Katorri on
// Kattotem (Restoration Shaman)"), and where it ends the same way (#1873).
export function swapLines(grid: Grid): string[] {
  const rows = grid.groups.flatMap((g) => g.rows);
  return grid.bosses.flatMap((boss, i) => {
    const now = (r: GridRow) => r.picks?.[i] ?? null;
    const before = (r: GridRow) => (i ? (r.picks?.[i - 1] ?? null) : null);
    const came = rows
      .filter((r) => r.cells[i] === 'came')
      .map((r) => (now(r) ? `${r.name} ${pickWords(now(r)!)}` : r.name));
    const went = rows.filter((r) => r.cells[i] === 'went').map((r) => r.name);
    const switched = rows
      .filter((r) => r.cells[i] === 'in' && pickKey(now(r)) !== pickKey(before(r)))
      .map((r) =>
        now(r)
          ? `${r.name} ${pickWords(now(r)!)}`
          : `${r.name} ${before(r)?.character ? 'back on their main' : 'back to their usual spec'}`
      );
    const parts = [
      came.length ? `${came.join(', ')} in` : '',
      went.length ? `${went.join(', ')} out` : '',
      switched.join(', ')
    ].filter(Boolean);
    return parts.length ? [`${i + 1}. ${boss}: ${parts.join('; ')}`] : [];
  });
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
        // Another character or spec: the spec's icon in a frame of the class
        // played, as on the site's grid (#1873). drawSvg fills in the icon; a
        // missing one leaves a dot in the class colour.
        const picked = row.picks?.[i];
        if (picked) {
          const color = CLASS_COLORS[picked.className] ?? '#e8eaf0';
          if (cell === 'came')
            parts.push(`<rect x="${x}" y="${y}" width="${CELL_W}" height="${ROW_H}" fill="#1a3a2c"/>`);
          parts.push(
            `<circle cx="${cx}" cy="${y + ROW_H / 2}" r="5" fill="${color}"/>`,
            `<image href="spec-icon:${specIconKey(picked.className, picked.spec)}" x="${cx - 12}" y="${y + 4}" width="24" height="24"/>`,
            `<rect x="${cx - 13}" y="${y + 3}" width="26" height="26" fill="none" stroke="${color}" stroke-width="2"/>`
          );
        } else if (cell === 'out') {
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
  // Finished once its last raid night passed (#1825): never edited or posted again.
  if (row?.finished) return 'passed';
  // The day or time moved since the last post, which went out less than a
  // week before this one: its nights are left out here, so none is posted
  // (and pinged) twice and none is missed (Kat, 2026-11-04; fresh review on
  // #1761). That post covered the seven days from its own date.
  const previous = await ctx.db.previousWeek(team.id, week.weekOf);
  const coveredUntil = previous && previous > addDays(week.weekOf, -7) ? addDays(previous, 7) : null;
  const inWeek = await weekNights(ctx.db, team.id, week, setting);
  const nights = await gridsFor(ctx, team.id, coveredUntil ? inWeek.filter((n) => n.raidDate >= coveredUntil) : inWeek);
  const key = nights.length ? await keyOf(nights) : EMPTY_KEY;
  const coversUntil = weekEnd(week.weekOf, setting).toISOString();
  if (!row && nights.length === 0) return 'no lineup';
  if (row?.key === key) return 'unchanged';

  if (row) {
    // Where it went, even if the channel was changed since (fresh review on #1761).
    const path = row.messageId ? `/channels/${row.channelId}/messages/${row.messageId}` : null;
    if (nights.length === 0) {
      if (path) {
        const removed = await ctx.discord('DELETE', path);
        // 403: out of the bot's reach now, so as good as gone (fresh review on #1761).
        if (![200, 204, 403, 404].includes(removed.status)) {
          throw new Error(`Discord answered ${removed.status} to the take-down`);
        }
      }
      await ctx.db.updateLineup(team.id, week.weekOf, { messageId: null, channelId: null, key, coversUntil });
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
        await ctx.db.updateLineup(team.id, week.weekOf, {
          messageId: row.messageId,
          channelId: row.channelId,
          key,
          coversUntil
        });
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
  const post = { messageId: sent.body.id as string, channelId: setting.channelId, key, coversUntil };
  const takeDown = () =>
    ctx.discord('DELETE', `/channels/${setting.channelId}/messages/${sent.body.id}`).catch(() => null);
  if (row) {
    // A repost that can't be recorded is taken back down, or the next run
    // would post a second (fresh review on #1761).
    try {
      await ctx.db.updateLineup(team.id, week.weekOf, post);
    } catch (err) {
      await takeDown();
      throw err;
    }
    return 'posted';
  }
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

// A team's weekly posts whose raid nights have all passed, finished or
// deleted as the team chose, once each (#1825). A week is over 4 hours after
// its last raid night starts; until then the post is left alone, so a week
// raiding Tuesday and Thursday keeps its post through Thursday's raid.
// One week failing (Discord down) is left for the next run and the rest go
// on (CodeRabbit on #1866).
export async function finishLineups(
  ctx: LineupContext,
  { team, setting }: TeamLineup
): Promise<{ finished: number; failed: number }> {
  const counts = { finished: 0, failed: 0 };
  for (const row of await ctx.db.unfinishedWeeks(team.id)) {
    try {
      // The end the post went up with, so a posting time changed since
      // can't end its week early (CodeRabbit on #1866).
      const end = row.coversUntil ? new Date(row.coversUntil) : weekEnd(row.weekOf, setting);
      const due = zonedTimeToUtc(row.weekOf, setting.time, setting.timezone);
      const nights = await weekNights(ctx.db, team.id, { weekOf: row.weekOf, due, end }, setting);
      // A week whose nights were all cancelled is over once its seven days are.
      const over = nights.length
        ? nights.every((n) => hasPassed(n.raidDate, n.night, ctx.now))
        : ctx.now.getTime() >= end.getTime();
      if (!over) continue;
      await finishPost(
        ctx.discord,
        `/channels/${row.channelId}/messages/${row.messageId}`,
        team.afterRaid,
        WEEK_FINISHED
      );
      await ctx.db.finishLineup(team.id, row.weekOf);
      counts.finished++;
    } catch (err) {
      counts.failed++;
      console.error(`lineup post: team ${team.id} finishing ${row.weekOf}:`, err instanceof Error ? err.message : err);
    }
  }
  return counts;
}

// The scheduled run: every team's weekly post brought up to date, then its
// passed weeks finished. One failing does not stop the rest.
export async function sweepLineups(
  ctx: LineupContext
): Promise<{ posted: number; edited: number; failed: number; finished: number }> {
  const counts = { posted: 0, edited: 0, failed: 0, finished: 0 };
  for (const lineup of await ctx.db.allLineups()) {
    try {
      const result = await syncLineup(ctx, lineup);
      if (result === 'posted') counts.posted++;
      if (result === 'edited') counts.edited++;
    } catch (err) {
      counts.failed++;
      console.error(`lineup post: team ${lineup.team.id}:`, err instanceof Error ? err.message : err);
    }
    // Apart, so this week's post failing still finishes older ones (CodeRabbit on #1866).
    try {
      const done = await finishLineups(ctx, lineup);
      counts.finished += done.finished;
      counts.failed += done.failed;
    } catch (err) {
      counts.failed++;
      console.error(`lineup post: team ${lineup.team.id} finishing:`, err instanceof Error ? err.message : err);
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
