// The weekly boss lineup post (#1709): which week it covers, the grid (who
// comes in and goes out at each boss), its drawing, and posting, editing and
// leaving alone the week's message.
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  type LineupBoss,
  type LineupContext,
  type LineupDb,
  type TeamLineup,
  type WeekPost,
  currentWeek,
  lineupGrid,
  lineupSvg,
  postLineupNow,
  weekNights,
  swapLines,
  syncLineup
} from '../../../supabase/functions/_shared/lineup-post.ts';
import type { Night, RosterRow } from '../../../supabase/functions/_shared/signup-sheet.ts';
import { CHANNEL, ROLE, SERVER, fakeDiscord } from '../_support/sheets.ts';

const player = (id: number, name: string, role: string, className = 'Mage', over = {}): RosterRow => ({
  id,
  nameRealm: `${name}-Stormrage`,
  nickname: null,
  isBench: false,
  role,
  className,
  spec: 'Frost',
  ...over
});
const ROSTER = [
  player(1, 'Fluffy', 'Tank', 'Warrior'),
  player(2, 'Kat', 'Ranged', 'Warlock'),
  player(3, 'Noc', 'Ranged', 'Shaman'),
  player(4, 'Brooke', 'Heal', 'Priest'),
  player(5, 'Benchy', 'Melee', 'Rogue', { isBench: true }),
  player(6, 'Sub', 'Melee', 'Rogue', { isBench: true })
];
// Kat out for the second boss, Noc in for her; Sub (bench) in for the third.
const BOSSES: LineupBoss[] = [
  { name: "Nek'zali", position: 1, playerIds: [1, 2, 4] },
  { name: 'Sentinels', position: 2, playerIds: [1, 3, 4] },
  { name: 'Vashnik', position: 3, playerIds: [1, 3, 4, 6] }
];
const SETTING = { channelId: CHANNEL, pingRoleId: ROLE, weekday: 3, time: '18:00:00', timezone: 'America/New_York' };
const LINEUP: TeamLineup = {
  team: { id: 1, name: 'Phoenix', slug: 'phoenix', serverId: SERVER, quietHours: null },
  setting: SETTING
};
const RAID: Night = { exists: true, startTime: '21:00:00', timezone: 'America/New_York', isOptional: false };

Deno.test('the week is the latest time the post was due: Wednesday 6 PM Eastern', () => {
  // Thursday 2026-11-05, noon Eastern.
  assertEquals(currentWeek(SETTING, new Date('2026-11-05T17:00:00Z')).weekOf, '2026-11-04');
  // Wednesday 5 PM Eastern, an hour before: still last week's.
  assertEquals(currentWeek(SETTING, new Date('2026-11-04T22:00:00Z')).weekOf, '2026-10-28');
  // Wednesday 6 PM Eastern exactly: this week's.
  const at = currentWeek(SETTING, new Date('2026-11-04T23:00:00Z'));
  assertEquals([at.weekOf, at.due.toISOString()], ['2026-11-04', '2026-11-04T23:00:00.000Z']);
});

Deno.test('the grid marks who comes in and who goes out at each boss, and counts each raider’s bosses', () => {
  const grid = lineupGrid(ROSTER, BOSSES);
  assertEquals(grid.bosses, ["Nek'zali", 'Sentinels', 'Vashnik']);
  assertEquals(
    grid.groups.map((g) => [g.label, g.rows.map((r) => `${r.name} ${r.cells.join(',')} ${r.count}`)]),
    [
      ['Tanks', ['Fluffy in,in,in 3']],
      ['Healers', ['Brooke in,in,in 3']],
      // The bench is left off unless in for a boss.
      ['Melee', ['Sub out,out,came 1']],
      ['Ranged', ['Kat in,went,out 1', 'Noc out,came,in 2']]
    ]
  );
  assertEquals(grid.swaps, [
    { came: [], went: [] },
    { came: ['Noc'], went: ['Kat'] },
    { came: ['Sub'], went: [] }
  ]);
  assertEquals(swapLines(grid), ['2. Sentinels: Noc in; Kat out', '3. Vashnik: Sub in']);
});

Deno.test(
  'the drawing names each raider in class colour, marks swaps by direction, and lists them under each boss',
  () => {
    const svg = lineupSvg(lineupGrid(ROSTER, BOSSES));
    assert(svg.includes('fill="#8788ee">Kat</text>'));
    // A green up-arrow for Noc coming in, a red down-arrow for Kat going out.
    assert(svg.includes('fill="#3fd68a"/>'));
    assert(svg.includes('fill="#ff6b6b"/>'));
    assert(svg.includes('>SWAPS</text>'));
    assert(svg.includes('>Sentinels</tspan>'));
  }
);

// -- Posting -------------------------------------------------------------------

function fakeLineups(over: Partial<{ bosses: Record<string, LineupBoss[]>; nights: Record<string, Night> }> = {}) {
  const rows = new Map<string, WeekPost>();
  const log: string[] = [];
  const db: LineupDb = {
    allLineups: () => Promise.resolve([LINEUP]),
    teamLineup: () => Promise.resolve(LINEUP),
    night: (_t, date) => Promise.resolve((over.nights ?? { '2026-11-05': RAID })[date] ?? { ...RAID, exists: false }),
    roster: () => Promise.resolve(ROSTER),
    bosses: (_t, date) => Promise.resolve((over.bosses ?? { '2026-11-05': BOSSES })[date] ?? []),
    postedLineup: (_t, week) => Promise.resolve(rows.get(week) ?? null),
    saveLineup(_t, week, post) {
      log.push(`save ${week} ${post.messageId}`);
      if (rows.has(week)) return Promise.resolve(false);
      rows.set(week, post);
      return Promise.resolve(true);
    },
    updateLineup(_t, week, post) {
      log.push(`update ${week} ${post.messageId}`);
      rows.set(week, post);
      return Promise.resolve();
    },
    markPosted() {
      log.push('markPosted');
      return Promise.resolve();
    }
  };
  return { db, rows, log };
}

const PNG = new Uint8Array([137, 80, 78, 71]);
// Thursday 2026-11-05 noon Eastern; that night's raid is at 9 PM.
const NOW = new Date('2026-11-05T17:00:00Z');
const MSG = `/channels/${CHANNEL}/messages`;
const WEEK = '2026-11-04';

function context(over: Parameters<typeof fakeLineups>[0] = {}, routes = {}) {
  const lineups = fakeLineups(over);
  const discord = fakeDiscord(routes);
  const ctx: LineupContext = { db: lineups.db, discord: discord.call, now: NOW, draw: () => Promise.resolve(PNG) };
  return { ctx, calls: discord.calls, ...lineups };
}

// The key a first post records, for the runs after it.
async function postedKey(draw = true): Promise<string> {
  const first = context();
  if (!draw) first.ctx.draw = undefined;
  await syncLineup(first.ctx, LINEUP);
  return first.rows.get(WEEK)!.key;
}

Deno.test('the week’s post goes up with a grid per night, pinging the role, and is recorded', async () => {
  const { ctx, calls, rows, log } = context();
  assertEquals(await syncLineup(ctx, LINEUP), 'posted');
  const post = calls.find((c) => c.key === `POST ${MSG}`)!;
  assertEquals(post.body.content, `<@&${ROLE}>`);
  assertEquals(post.body.allowed_mentions, { parse: [], roles: [ROLE] });
  assertEquals(post.files!.length, 1);
  assertEquals(post.body.embeds[0].image.url, `attachment://${post.files![0].name}`);
  assert(post.body.attachments[0].description.includes('Sentinels: Noc in; Kat out'));
  assertEquals(rows.get(WEEK)?.messageId, 'm1');
  assert(log.includes('markPosted'));
});

Deno.test('a week with no lineup saved posts nothing', async () => {
  const { ctx, calls } = context({ bosses: {} });
  assertEquals(await syncLineup(ctx, LINEUP), 'no lineup');
  assertEquals(calls.length, 0);
});

Deno.test('a week whose nights have all started is not posted late', async () => {
  const { ctx, calls } = context({
    nights: { '2026-11-04': { ...RAID, startTime: '09:00:00' } },
    bosses: { '2026-11-04': BOSSES }
  });
  // The 11-04 raid at 9 AM is before the post was due; nothing else this week.
  assertEquals(await syncLineup(ctx, LINEUP), 'no lineup');
  assertEquals(calls.length, 0);
});

Deno.test('a posted week showing this lineup is left alone without asking Discord, picture or text', async () => {
  for (const draw of [true, false]) {
    const key = await postedKey(draw);
    const same = context();
    if (!draw) same.ctx.draw = undefined;
    same.rows.set(WEEK, { messageId: 'm1', channelId: CHANNEL, key });
    assertEquals(await syncLineup(same.ctx, LINEUP), 'unchanged');
    assertEquals(same.calls.length, 0);
  }
});

Deno.test('a changed lineup edits the post, pinging nobody, even one sent as text (CodeRabbit on #1761)', async () => {
  // Who's in for a boss changes; the boss list doesn't.
  const key = await postedKey(false);
  const moved = [BOSSES[0], { ...BOSSES[1], playerIds: [1, 2, 4] }, BOSSES[2]];
  const changed = context({ bosses: { '2026-11-05': moved } });
  changed.ctx.draw = undefined;
  changed.rows.set(WEEK, { messageId: 'm1', channelId: CHANNEL, key });
  assertEquals(await syncLineup(changed.ctx, LINEUP), 'edited');
  const edit = changed.calls.find((c) => c.key === `PATCH ${MSG}/m1`)!;
  assertEquals(edit.body.allowed_mentions, { parse: [] });
  assertEquals(edit.body.content, undefined);
  assert(changed.rows.get(WEEK)!.key !== key);
});

Deno.test('the week’s message is edited in the channel it went to, after the channel changes', async () => {
  const OLD = '200000000000000009';
  const { ctx, calls, rows } = context();
  rows.set(WEEK, { messageId: 'm1', channelId: OLD, key: 'older' });
  assertEquals(await syncLineup(ctx, LINEUP), 'edited');
  assert(calls.some((c) => c.key === `PATCH /channels/${OLD}/messages/m1`));
});

Deno.test(
  'a lineup emptied after it posted takes the post down and keeps the week; back, it posts unpinged',
  async () => {
    const key = await postedKey();
    const emptied = context({ bosses: {} }, { [`DELETE ${MSG}/m1`]: { status: 204 } });
    emptied.rows.set(WEEK, { messageId: 'm1', channelId: CHANNEL, key });
    assertEquals(await syncLineup(emptied.ctx, LINEUP), 'edited');
    assertEquals(
      emptied.calls.map((c) => c.key),
      [`DELETE ${MSG}/m1`]
    );
    assertEquals(emptied.rows.get(WEEK), { messageId: null, channelId: null, key: 'empty' });

    const back = context();
    back.rows.set(WEEK, { messageId: null, channelId: null, key: 'empty' });
    assertEquals(await syncLineup(back.ctx, LINEUP), 'posted');
    const post = back.calls.find((c) => c.key === `POST ${MSG}`)!;
    assertEquals(post.body.content, undefined);
    assertEquals(post.body.allowed_mentions, { parse: [], roles: [] });
    assertEquals(back.rows.get(WEEK)?.messageId, 'm1');
  }
);

Deno.test('a take-down Discord doesn’t confirm is tried again on the next run', async () => {
  const emptied = context({ bosses: {} }, { [`DELETE ${MSG}/m1`]: { status: 500 } });
  emptied.rows.set(WEEK, { messageId: 'm1', channelId: CHANNEL, key: 'older' });
  let failed = false;
  await syncLineup(emptied.ctx, LINEUP).catch(() => (failed = true));
  assert(failed);
  assertEquals(emptied.rows.get(WEEK)?.messageId, 'm1');
});

Deno.test('the week ends at the same clock time seven days on, across a clock change', async () => {
  // Saturdays at 6 PM Eastern; the clocks went back overnight (2026-11-01).
  const setting = { ...SETTING, weekday: 6 };
  const week = currentWeek(setting, new Date('2026-11-01T12:00:00Z'));
  assertEquals(week.weekOf, '2026-10-31');
  // A raid at 5:30 PM Eastern on the next Saturday, half an hour before the
  // next post: in this week's.
  const nights = { '2026-11-07': { ...RAID, startTime: '17:30:00' } };
  const db = fakeLineups({ nights }).db;
  assertEquals(
    (await weekNights(db, 1, week, setting)).map((n) => n.raidDate),
    ['2026-11-07']
  );
});

Deno.test(
  'a post time the clocks skip still ends the week at the next post’s own time (CodeRabbit on #1761)',
  async () => {
    // Sundays at 2:30 AM Eastern; 2027-03-14 has no 2:30 (the clocks jump to 3:00).
    const setting = { ...SETTING, weekday: 0, time: '02:30:00' };
    const week = currentWeek(setting, new Date('2027-03-15T12:00:00Z'));
    assertEquals(week.weekOf, '2027-03-14');
    // A raid at 3 AM the next Sunday starts after the next post (2:30): not this week's.
    const db = fakeLineups({ nights: { '2027-03-21': { ...RAID, startTime: '03:00:00' } } }).db;
    assertEquals(await weekNights(db, 1, week, setting), []);
  }
);

Deno.test('a picture that can’t be drawn sends the night as text: its bosses and swaps', async () => {
  const { ctx, calls } = context();
  ctx.draw = () => Promise.reject(new Error('no fonts'));
  await syncLineup(ctx, LINEUP);
  const post = calls.find((c) => c.key === `POST ${MSG}`)!;
  assertEquals(post.files, undefined);
  assert(post.body.embeds[0].description.includes('2. Sentinels: Noc in; Kat out'));
});

Deno.test('/officer post lineup posts one night now, pinging nobody, and is not recorded as the week’s', async () => {
  const { ctx, calls, rows } = context();
  assertEquals(await postLineupNow(ctx, 1, '2026-11-05'), 'posted');
  const post = calls.find((c) => c.key === `POST ${MSG}`)!;
  assertEquals(post.body.allowed_mentions, { parse: [] });
  assertEquals(rows.size, 0);
  assertEquals(await postLineupNow(context({ bosses: {} }).ctx, 1, '2026-11-05'), 'no lineup');
});
