// The signup sheet (#960): the embed field by field as the bot posted it,
// which raid nights a sheet posts and when, and posting, editing and
// replacing a sheet, the old bots' among them.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import {
  type Night,
  PASSED_AFTER_MS,
  type RosterRow,
  type SheetContext,
  bannerUrl,
  buildSheet,
  inQuietHours,
  plan,
  refreshSheet,
  sweepSheets,
  syncSheet
} from '../../../supabase/functions/_shared/signup-sheet.ts';
import { CHANNEL, RAID, ROLE, SERVER, SHEET, TEAM, fakeDiscord, fakeSheets } from '../_support/sheets.ts';

// Tuesday 2026-11-03, 9 AM Eastern. Raids: Tuesday 11-03 and Thursday 11-05
// at 9 PM Eastern (02:00Z the next day), and Tuesday 11-10.
const NOW = new Date('2026-11-03T14:00:00.000Z');
const NIGHTS = { '2026-11-03': RAID, '2026-11-05': RAID, '2026-11-10': RAID };

const player = (id: number, name: string, role: string | null, over: Partial<RosterRow> = {}): RosterRow => ({
  id,
  nameRealm: `${name}-Stormrage`,
  nickname: null,
  isBench: false,
  role,
  className: null,
  spec: null,
  ...over
});

const sheet = (roster: RosterRow[], rsvps: { playerId: number; status: string }[] = [], night: Night = RAID) =>
  buildSheet({ team: TEAM, raidDate: '2026-11-03', night, roster, rsvps, siteUrl: 'https://site.test/' });

const fieldsOf = (msg: ReturnType<typeof buildSheet>) => msg.embeds[0].fields.map((f) => [f.name, f.value]);

// -- The embed --------------------------------------------------------------

Deno.test('everyone is in by default on a normal night, grouped by role, Heal under Tank in one column', () => {
  const msg = sheet([
    player(1, 'Tanky', 'Tank'),
    player(2, 'Stabby', 'Melee'),
    player(3, 'Katorrí', 'Ranged', { nickname: 'Kat' }),
    player(4, 'Healy', 'Heal')
  ]);
  assertEquals(fieldsOf(msg), [
    ['Tank (1)', 'Tanky\n\n**Heal (1)**\nHealy'],
    ['Melee (1)', 'Stabby'],
    ['Ranged (1)', 'Kat']
  ]);
  assert(msg.embeds[0].fields.every((f) => f.inline));
  assertEquals(msg.embeds[0].footer.text, '4 of 4 available · Refresh to update');
});

Deno.test('Bench comes first: a benched raider is on Bench whatever they answered', () => {
  const msg = sheet([player(1, 'Benchy', 'Tank', { isBench: true })], [{ playerId: 1, status: 'Present' }]);
  assertEquals(fieldsOf(msg), [['Other answers', '**Bench:** Benchy']]);
  assertEquals(msg.embeds[0].footer.text, '0 of 1 available · Refresh to update');
});

Deno.test('answers sort into their lists; Attending counts as in; unknown roles and answers are Unassigned', () => {
  const msg = sheet(
    [
      player(1, 'Late', 'Melee'),
      player(2, 'Gone', 'Melee'),
      player(3, 'Maybe', 'Melee'),
      player(4, 'Early', 'Melee'),
      player(5, 'Yes', 'Melee'),
      player(6, 'Nospec', null),
      player(7, 'Odd', 'Melee')
    ],
    [
      { playerId: 1, status: 'Late' },
      { playerId: 2, status: 'Absent' },
      { playerId: 3, status: 'Tentative' },
      { playerId: 4, status: 'Leaving Early' },
      { playerId: 5, status: 'Attending' },
      { playerId: 7, status: 'Something new' }
    ]
  );
  assertEquals(fieldsOf(msg), [
    ['Melee (1)', 'Yes'],
    [
      'Other answers',
      '**Unassigned:** Nospec, Odd\n**Late:** Late\n**Leaving Early:** Early\n**Tentative:** Maybe\n**Absent:** Gone'
    ]
  ]);
  assertEquals(msg.embeds[0].footer.text, '2 of 7 available · Refresh to update');
});

Deno.test('an optional night has no default: the unanswered are No Response, which a normal night never shows', () => {
  const optional = { ...RAID, isOptional: true };
  assertEquals(fieldsOf(sheet([player(1, 'Quiet', 'Tank')], [], optional)), [
    ['Other answers', '**No Response:** Quiet']
  ]);
  // As the bot did: a No Response answer on a normal night lists nobody.
  assertEquals(fieldsOf(sheet([player(1, 'Quiet', 'Tank')], [{ playerId: 1, status: 'No Response' }])), []);
});

Deno.test("the header is the start in each reader's own time, with Optional Night, or only that without a time", () => {
  const unix = Date.parse('2026-11-04T02:00:00Z') / 1000;
  assertEquals(sheet([]).embeds[0].description, `<t:${unix}:F>`);
  assertEquals(sheet([], [], { ...RAID, isOptional: true }).embeds[0].description, `<t:${unix}:F> — Optional Night`);
  assertEquals(sheet([], [], { ...RAID, startTime: null, isOptional: true }).embeds[0].description, 'Optional Night');
  assertEquals(sheet([], [], { ...RAID, startTime: null }).embeds[0].description, '');
  assertEquals(sheet([]).embeds[0].title, 'Phoenix — Signup Sheet');
});

Deno.test('View on Site leaves ?team= off for the default team; Refresh carries the team id and date', () => {
  const [link, refresh] = sheet([]).components[0].components;
  assertEquals(link.url, 'https://site.test/calendar.html?date=2026-11-03');
  assertEquals(refresh.custom_id, 'signup-sheet-refresh:1:2026-11-03');
  const other = buildSheet({
    team: { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', serverId: SERVER, quietHours: null },
    raidDate: '2026-11-03',
    night: RAID,
    roster: [],
    rsvps: [],
    siteUrl: 'https://site.test'
  } as never);
  assertEquals(other.components[0].components[0].url, 'https://site.test/calendar.html?date=2026-11-03&team=hellfire');
  // No site, no link: Refresh alone.
  const bare = buildSheet({ team: TEAM, raidDate: '2026-11-03', night: RAID, roster: [], rsvps: [] });
  assertEquals(
    bare.components[0].components.map((b) => b.label),
    ['Refresh']
  );
});

Deno.test('every team gets a wide banner: its own, or the Raid Hub one', () => {
  assert(bannerUrl(1).endsWith('/phoenix-header.png'));
  assert(bannerUrl(2).endsWith('/hellfire-header.png'));
  assert(bannerUrl(3).endsWith('/raid-hub-header.png'));
});

Deno.test('a list too long for one field is cut to what Discord takes', () => {
  const roster = Array.from({ length: 120 }, (_, i) => player(i, 'Raider' + String(i).padStart(3, '0'), null));
  assert(sheet(roster).embeds[0].fields.every((f) => f.value.length <= 1024));
});

// -- When a raid is posted ------------------------------------------------

const nights = (dates: string[]) => dates.map((raidDate) => ({ raidDate, night: RAID }));
const planned = (over: Partial<typeof SHEET>, now = NOW, dates = ['2026-11-03', '2026-11-05', '2026-11-10']) =>
  plan({ ...SHEET, ...over }, nights(dates), now).map((p) => [p.raidDate, p.post]);

Deno.test("keep raids posted: the next ones on the sheet's days, soonest first", () => {
  assertEquals(planned({ keepRaidsPosted: 2 }), [
    ['2026-11-03', true],
    ['2026-11-05', true],
    ['2026-11-10', false]
  ]);
  assertEquals(planned({ keepRaidsPosted: 1, raidDays: [4] }), [['2026-11-05', true]]);
});

Deno.test('a raid passes four hours after it starts, and the next one goes up', () => {
  const start = Date.parse('2026-11-04T02:00:00Z');
  const before = new Date(start + PASSED_AFTER_MS - 1);
  const after = new Date(start + PASSED_AFTER_MS);
  assertEquals(planned({ keepRaidsPosted: 1 }, before), [
    ['2026-11-03', true],
    ['2026-11-05', false],
    ['2026-11-10', false]
  ]);
  assertEquals(planned({ keepRaidsPosted: 1 }, after), [
    ['2026-11-05', true],
    ['2026-11-10', false]
  ]);
});

Deno.test('hours before: a raid is due from that many hours before its start, not a moment sooner', () => {
  const threshold = Date.parse('2026-11-06T02:00:00Z') - 48 * 3_600_000;
  const at = (ms: number) => planned({ keepRaidsPosted: null, hoursBefore: 48 }, new Date(ms));
  assertEquals(at(threshold - 1)[1], ['2026-11-05', false]);
  assertEquals(at(threshold)[1], ['2026-11-05', true]);
  assertEquals(at(threshold)[0], ['2026-11-03', true]);
});

Deno.test('a date with no raid, or with no start time, is skipped', () => {
  const p = plan(
    SHEET,
    [
      { raidDate: '2026-11-03', night: { exists: false, startTime: null, timezone: null, isOptional: false } },
      { raidDate: '2026-11-05', night: { ...RAID, startTime: null } },
      { raidDate: '2026-11-10', night: RAID }
    ],
    NOW
  );
  assertEquals(
    p.map((n) => n.raidDate),
    ['2026-11-10']
  );
});

Deno.test('quiet hours, inside and out, and across midnight', () => {
  const quiet = { start: '23:00:00', end: '08:00:00', timezone: 'America/New_York' };
  assert(inQuietHours(quiet, new Date('2026-11-04T05:00:00Z'))); // midnight
  assert(inQuietHours(quiet, new Date('2026-11-04T04:00:00Z'))); // 11 PM
  assert(!inQuietHours(quiet, new Date('2026-11-04T13:00:00Z'))); // 8 AM
  assert(!inQuietHours({ ...quiet, start: '01:00:00', end: '06:00:00' }, new Date('2026-11-04T05:00:00Z')));
  assert(!inQuietHours(null, NOW));
});

// -- Posting and editing ----------------------------------------------------

function context(state: Parameters<typeof fakeSheets>[0] = {}, routes: Parameters<typeof fakeDiscord>[0] = {}) {
  const sheets = fakeSheets({ nights: NIGHTS, ...state });
  const discord = fakeDiscord(routes);
  // The bot's emojis are given, so the call lists below are the sheet's own.
  const ctx: SheetContext = {
    db: sheets.db,
    discord: discord.call,
    siteUrl: 'https://site.test',
    now: NOW,
    emojis: new Map()
  };
  return { ctx, ...sheets, calls: discord.calls };
}
const keys = (calls: Array<{ key: string }>) => calls.map((c) => c.key);
const MSG = `/channels/${CHANNEL}/messages`;

Deno.test('may not post and nothing is posted: claims nothing and leaves no row', async () => {
  const { ctx, log, rows, calls } = context();
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'not posted');
  assertEquals([log, rows.size, calls.length], [[], 0, 0]);
});

Deno.test("a first post pings the sheet's role, and only it, then records the message", async () => {
  const { ctx, log, rows, calls } = context();
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: true }), 'posted');
  assertEquals(keys(calls), [`GET /channels/${CHANNEL}`, `POST ${MSG}`]);
  assertEquals(calls[1].body.content, `<@&${ROLE}>`);
  assertEquals(calls[1].body.allowed_mentions, { parse: [], roles: [ROLE] });
  assertEquals(log, ['claim 2026-11-03', 'save 2026-11-03 m1', 'markPosted 9']);
  assertEquals(rows.get('2026-11-03')?.messageId, 'm1');
});

Deno.test('a post whose id cannot be saved is taken back down, so the next run does not post a second', async () => {
  const { ctx, calls, log } = context({ saveFails: true });
  await assertRejects(() => syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: true }));
  assertEquals(keys(calls).slice(-2), [`POST ${MSG}`, `DELETE ${MSG}/m1`]);
  assert(!log.includes('markPosted 9'));
});

Deno.test("a post that lost to another run's is taken back down, leaving the one on record", async () => {
  const { ctx, calls, rows, log } = context();
  // Another run records its message between this run's claim and its save.
  const claim = ctx.db.claim;
  ctx.db.claim = async (...args) => {
    const id = await claim(...args);
    rows.set('2026-11-03', { channelId: CHANNEL, messageId: 'theirs' });
    return id;
  };
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: true }), 'edited');
  assertEquals(keys(calls).slice(-2), [`POST ${MSG}`, `DELETE ${MSG}/m1`]);
  assertEquals(rows.get('2026-11-03')?.messageId, 'theirs');
  assert(!log.includes('markPosted 9'));
});

Deno.test('a sheet with no ping role posts with no content and no mentions', async () => {
  const { ctx, calls } = context();
  await syncSheet(ctx, TEAM, { ...SHEET, pingRoleId: null }, '2026-11-03', { create: true });
  assertEquals([calls[1].body.content, calls[1].body.allowed_mentions], [undefined, { parse: [], roles: [] }]);
});

Deno.test('a posted sheet is edited in place, pinging nobody', async () => {
  const { ctx, calls } = context({ rows: { '2026-11-03': { channelId: CHANNEL, messageId: 'old' } } });
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'edited');
  assertEquals(keys(calls), [`PATCH ${MSG}/old`]);
  assertEquals(calls[0].body.allowed_mentions, { parse: [] });
  assertEquals(calls[0].body.content, undefined);
});

Deno.test("an old bot's sheet (403) is taken down where allowed, forgotten, and posted fresh", async () => {
  const { ctx, log, rows, calls } = context(
    { rows: { '2026-11-03': { channelId: CHANNEL, messageId: 'oldbot' } } },
    { [`PATCH ${MSG}/oldbot`]: { status: 403 }, [`DELETE ${MSG}/oldbot`]: { status: 403 } }
  );
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'posted');
  assertEquals(keys(calls), [`PATCH ${MSG}/oldbot`, `DELETE ${MSG}/oldbot`, `GET /channels/${CHANNEL}`, `POST ${MSG}`]);
  assert(log.includes('forget 2026-11-03 oldbot'));
  assertEquals(rows.get('2026-11-03')?.messageId, 'm1');
});

Deno.test('a deleted sheet (404) is forgotten and posted fresh, with nothing to take down', async () => {
  const { ctx, rows, calls } = context(
    { rows: { '2026-11-03': { channelId: CHANNEL, messageId: 'gone' } } },
    { [`PATCH ${MSG}/gone`]: { status: 404 } }
  );
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'posted');
  assert(!keys(calls).some((k) => k.startsWith('DELETE')));
  assertEquals(rows.get('2026-11-03')?.messageId, 'm1');
});

Deno.test('any other refusal of the edit is an error, and the message is kept', async () => {
  const { ctx, rows } = context(
    { rows: { '2026-11-03': { channelId: CHANNEL, messageId: 'old' } } },
    { [`PATCH ${MSG}/old`]: { status: 500 } }
  );
  await assertRejects(() => syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: false }));
  assertEquals(rows.get('2026-11-03')?.messageId, 'old');
});

Deno.test('quiet hours hold a new sheet, but not an edit', async () => {
  const quietTeam = { ...TEAM, quietHours: { start: '08:00:00', end: '10:00:00', timezone: 'America/New_York' } };
  const fresh = context();
  assertEquals(await syncSheet(fresh.ctx, quietTeam, SHEET, '2026-11-03', { create: true }), 'quiet hours');
  assertEquals(fresh.calls.length, 0);
  const posted = context({ rows: { '2026-11-03': { channelId: CHANNEL, messageId: 'old' } } });
  assertEquals(await syncSheet(posted.ctx, quietTeam, SHEET, '2026-11-03', { create: true }), 'edited');
});

Deno.test("a channel outside the team's server is never posted to", async () => {
  const { ctx, calls } = context({}, { [`GET /channels/${CHANNEL}`]: { status: 200, body: { guild_id: '999' } } });
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-03', { create: true }), 'not in server');
  assert(!keys(calls).includes(`POST ${MSG}`));
});

Deno.test('a date the team does not raid is left alone', async () => {
  const { ctx, log, calls } = context();
  assertEquals(await syncSheet(ctx, TEAM, SHEET, '2026-11-04', { create: true }), 'no raid');
  assertEquals([log, calls], [[], []]);
});

// -- The run and the refresh ------------------------------------------------

Deno.test('the run posts the next two raids, soonest first, and not the third', async () => {
  const { ctx, calls, rows } = context();
  assertEquals(await sweepSheets(ctx), { posted: 2, edited: 0, failed: 0 });
  assertEquals(calls.filter((c) => c.key.startsWith('POST')).length, 2);
  assertEquals([...rows.keys()].sort(), ['2026-11-03', '2026-11-05']);
});

Deno.test('a second run edits what the first posted and posts nothing new', async () => {
  const { ctx, calls } = context();
  await sweepSheets(ctx);
  calls.length = 0;
  assertEquals(await sweepSheets(ctx), { posted: 0, edited: 2, failed: 0 });
  assertEquals(keys(calls), [`PATCH ${MSG}/m1`, `PATCH ${MSG}/m2`]);
});

Deno.test('one night failing does not stop the rest', async () => {
  const { ctx } = context(
    { rows: { '2026-11-03': { channelId: CHANNEL, messageId: 'old' } } },
    { [`PATCH ${MSG}/old`]: { status: 500 } }
  );
  assertEquals(await sweepSheets(ctx), { posted: 1, edited: 0, failed: 1 });
});

Deno.test('a refresh leaves a passed raid alone: no edit, and no new sheet for a deleted one', async () => {
  // Thursday 11-05's raid started 02:00Z on 11-06; four hours later it has passed.
  const later = new Date(Date.parse('2026-11-06T02:00:00Z') + PASSED_AFTER_MS);
  for (const messageId of ['old', 'gone']) {
    const { ctx, calls, log } = context(
      { rows: { '2026-11-05': { channelId: CHANNEL, messageId } } },
      { [`PATCH ${MSG}/gone`]: { status: 404 } }
    );
    ctx.now = later;
    assertEquals(await refreshSheet(ctx, 1, '2026-11-05'), 'not posted');
    assertEquals([calls, log], [[], []], messageId);
  }
  // A moment before, it is still edited.
  const { ctx } = context({ rows: { '2026-11-05': { channelId: CHANNEL, messageId: 'old' } } });
  ctx.now = new Date(later.getTime() - 1);
  assertEquals(await refreshSheet(ctx, 1, '2026-11-05'), 'edited');
});

Deno.test('a refresh edits the posted sheet of the sheet whose days hold that date', async () => {
  const { ctx, calls } = context({ rows: { '2026-11-05': { channelId: CHANNEL, messageId: 'old' } } });
  assertEquals(await refreshSheet(ctx, 1, '2026-11-05'), 'edited');
  assertEquals(keys(calls), [`PATCH ${MSG}/old`]);
});

Deno.test(
  'a refresh posts nothing for a night not yet posted, a day no sheet covers, or a team with none',
  async () => {
    const { ctx, calls, log } = context({ teams: [{ team: TEAM, sheets: [{ ...SHEET, raidDays: [4] }] }] });
    assertEquals(await refreshSheet(ctx, 1, '2026-11-05'), 'not posted');
    assertEquals(await refreshSheet(ctx, 1, '2026-11-03'), 'not posted');
    assertEquals(await refreshSheet(ctx, 7, '2026-11-05'), 'not posted');
    assertEquals([calls, log], [[], []]);
  }
);

// -- Spec icons -------------------------------------------------------------

Deno.test("each name carries its spec icon from the bot's emojis, and goes without one it lacks", () => {
  const msg = buildSheet({
    team: TEAM,
    raidDate: '2026-11-03',
    night: RAID,
    roster: [
      player(1, 'Katorrí', 'Ranged', { nickname: 'Kat', className: 'Warlock', spec: 'Demonology' }),
      player(2, 'Beasty', 'Ranged', { className: 'Hunter', spec: 'Beast Mastery' }),
      player(3, 'Newspec', 'Ranged', { className: 'Shaman', spec: 'Something New' }),
      player(4, 'Late', 'Melee', { className: 'Death Knight', spec: 'Frost' })
    ],
    rsvps: [{ playerId: 4, status: 'Late' }],
    emojis: new Map([
      ['warlock_demonology', '11'],
      ['hunter_beast_mastery', '22'],
      ['death_knight_frost', '33']
    ])
  });
  assertEquals(fieldsOf(msg), [
    ['Ranged (3)', '<:warlock_demonology:11> Kat\n<:hunter_beast_mastery:22> Beasty\nNewspec'],
    ['Other answers', '**Late:** <:death_knight_frost:33> Late']
  ]);
});

Deno.test("the run reads the bot's emojis once, and a failed read just means no icons", async () => {
  const roster = [player(1, 'Icy', 'Ranged', { className: 'Mage', spec: 'Frost' })];
  const rows = {
    '2026-11-03': { channelId: CHANNEL, messageId: 'a' },
    '2026-11-05': { channelId: CHANNEL, messageId: 'b' }
  };
  const read = context(
    { rows, roster },
    {
      'GET /applications/@me': { status: 200, body: { id: 'app' } },
      'GET /applications/app/emojis': { status: 200, body: { items: [{ name: 'mage_frost', id: '9' }] } }
    }
  );
  delete read.ctx.emojis;
  assertEquals(await sweepSheets(read.ctx), { posted: 0, edited: 2, failed: 0 });
  assertEquals(keys(read.calls).filter((k) => k.startsWith('GET /applications')).length, 2);
  assertEquals(
    read.calls.find((c) => c.key === `PATCH ${MSG}/a`)!.body.embeds[0].fields[0].value,
    '<:mage_frost:9> Icy'
  );

  const thrown = context({ rows, roster });
  delete thrown.ctx.emojis;
  const call = thrown.ctx.discord;
  thrown.ctx.discord = (method, path, body) =>
    path.startsWith('/applications') ? Promise.reject(new Error('timed out')) : call(method, path, body);
  assertEquals(await syncSheet(thrown.ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'edited');
  assertEquals(thrown.calls.at(-1)!.body.embeds[0].fields[0].value, 'Icy');

  const failed = context({ rows, roster });
  delete failed.ctx.emojis;
  assertEquals(await syncSheet(failed.ctx, TEAM, SHEET, '2026-11-03', { create: false }), 'edited');
  assertEquals(failed.calls.at(-1)!.body.embeds[0].fields[0].value, 'Icy');
});
