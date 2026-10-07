// wcl-progression-sync's handler (#932, #933): the cron gate, the raid_zones
// stamp taken from the current tier (current_season(), read once per run and
// the same for every team since the season went app-wide on #1189) for a zone
// the table does not hold yet, a zone filed under an earlier tier left as it
// stands, and a day with no tier row writing nothing, which the foreign key
// would refuse. Each team's reports are fetched once per run from the tier's
// start, and every one is kept in team_raid_reports with the title rule's
// verdict (#1469). The progress rows are the ones the pre-split aggregation
// produced over this corpus, recorded before the split, so the move is
// measured against what was deployed. The runner grants no permission: a path
// that reached the platform fetch or Deno.env would throw into the catch-all
// and fail the body assertion.
import { assertEquals, assertMatch, assertNotMatch } from 'jsr:@std/assert@1';
import { type Deps, handle, type ReportRow } from '../../../supabase/functions/wcl-progression-sync/handler.ts';
import { VERSION } from '../../../supabase/functions/wcl-progression-sync/version.ts';
import { envOf } from '../_support/corpus.ts';
import { recordingFetch } from '../_support/fetch.ts';
import { type FakeDb, type FakeDbState, fakeDb } from './fake-db.ts';

const URL = 'http://edge.test/functions/v1/wcl-progression-sync';
const CRON_SECRET = 'cron-secret-value';

function post(headers: Record<string, string> = {}) {
  return new Request(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } });
}

async function json(res: Response) {
  return { status: res.status, body: await res.json() };
}

function fullEnv(values: Record<string, string> = {}) {
  return envOf({
    WCL_PROGRESS_SYNC_SECRET: CRON_SECRET,
    WCL_CLIENT_ID: 'wcl-client-id',
    WCL_CLIENT_SECRET: 'wcl-client-secret',
    ...values
  });
}

function testDeps(opts: { state?: FakeDbState; env?: Deps['env']; responses?: Response[] } = {}) {
  const { fetch, calls } = recordingFetch(opts.responses ?? []);
  const db: FakeDb = fakeDb(opts.state);
  const deps: Deps = { fetch, env: opts.env ?? fullEnv(), db };
  return { deps, calls, db };
}

const wclJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const tokenResponse = () => wclJson({ access_token: 'wcl-token' });
const zoneResponse = (name: string, encounters: Array<{ id: number; name: string }>) =>
  wclJson({ data: { worldData: { zone: { name, encounters } } } });
const unknownZoneResponse = () => wclJson({ data: { worldData: { zone: null } } });
const reportsPage = (data: unknown[], more: boolean) =>
  wclJson({ data: { reportData: { reports: { data, has_more_pages: more } } } });
const reportsResponse = (data: unknown[]) => reportsPage(data, false);
const graphqlError = (message: string) => wclJson({ errors: [{ message }] });

// The tier's start as the reports query takes it: 2026-08-11, Eastern midnight.
const TIER_START_MS = Date.UTC(2026, 7, 11, 4);

function reportsWritten(db: FakeDb) {
  return db.calls.filter((c) => c.method === 'upsertReports').map((c) => c.args[0] as ReportRow[]);
}

function reportsCalls(calls: Array<{ body?: string | null }>) {
  return calls.filter((c) => /reportData/.test(c.body ?? ''));
}

// The corpus the pre-split aggregation ran over (scratch pin, 2026-09-14).
// Report A is an earlier night: a mythic wipe then a mythic kill on boss one,
// a heroic wipe on boss two. Report B is later: a second mythic kill on boss
// one (the earliest kill must win), a better heroic wipe on boss two, a fight
// on an encounter the zone does not own and a Normal fight, both ignored.
const REPORT_A_START = 1789430400000; // 2026-09-15T00:00:00Z, 20:00 ET on the 14th
const REPORT_B_START = 1789689600000; // 2026-09-18T00:00:00Z, 20:00 ET on the 17th
const REPORTS = [
  {
    code: 'reportA',
    title: 'Phoenix Mythic 9/14',
    startTime: REPORT_A_START,
    zone: { id: 44 },
    fights: [
      { id: 1, encounterID: 3001, difficulty: 5, kill: false, bossPercentage: 42.5 },
      { id: 2, encounterID: 3001, difficulty: 5, kill: true, bossPercentage: 0 },
      { id: 3, encounterID: 3002, difficulty: 4, kill: false, bossPercentage: 12 }
    ]
  },
  {
    code: 'reportB',
    title: 'Phoenix Heroic 9/17',
    startTime: REPORT_B_START,
    zone: { id: 44 },
    fights: [
      { id: 1, encounterID: 3001, difficulty: 5, kill: true, bossPercentage: 0 },
      { id: 2, encounterID: 3002, difficulty: 4, kill: false, bossPercentage: 8.25 },
      { id: 3, encounterID: 9999, difficulty: 5, kill: true, bossPercentage: 0 },
      { id: 4, encounterID: 3002, difficulty: 3, kill: true, bossPercentage: 0 }
    ]
  }
];
const ENCOUNTERS = [
  { id: 3001, name: 'Boss One' },
  { id: 3002, name: 'Boss Two' }
];

const TEAM = { id: 1, wcl_guild_id: 777 };
const SEASON_NAME = 'Midnight Season 2';
const SEASON_CODE = 'MID2';
const TWO_RAIDS = {
  raidProgression: [
    { wclZoneId: 44, name: 'Test Raid' },
    { wclZoneId: '45', name: 'Mini Raid', isMiniRaid: true }
  ],
  seasonName: SEASON_NAME
};

Deno.test('OPTIONS answers the preflight with the version header', async () => {
  const { deps } = testDeps();
  const res = await handle(new Request(URL, { method: 'OPTIONS' }), deps);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('X-WGA-Version'), VERSION);
  assertEquals(res.headers.get('Access-Control-Expose-Headers'), 'X-WGA-Version');
  await res.text();
});

Deno.test('no cron secret header is refused before anything is read', async () => {
  const { deps, calls, db } = testDeps();
  const res = await json(await handle(post(), deps));
  assertEquals(res, { status: 401, body: { success: false, error: 'Not authorized' } });
  assertEquals(db.calls, []);
  assertEquals(calls, []);
});

Deno.test('a wrong cron secret is refused', async () => {
  const { deps, db } = testDeps();
  const res = await json(await handle(post({ 'x-cron-secret': 'not-it' }), deps));
  assertEquals(res.status, 401);
  assertEquals(db.calls, []);
});

Deno.test('an unset cron secret refuses every caller', async () => {
  const { deps, db } = testDeps({ env: fullEnv({ WCL_PROGRESS_SYNC_SECRET: '' }) });
  const res = await json(await handle(post({ 'x-cron-secret': '' }), deps));
  assertEquals(res.status, 401);
  assertEquals(db.calls, []);
});

Deno.test('missing WarcraftLogs credentials answer 500 before any read', async () => {
  const { deps, db } = testDeps({ env: envOf({ WCL_PROGRESS_SYNC_SECRET: CRON_SECRET }) });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 500, body: { success: false, error: 'WCL credentials not configured' } });
  assertEquals(db.calls, []);
});

Deno.test('no team with a guild id answers teams: 0 without calling WarcraftLogs', async () => {
  const { deps, calls, db } = testDeps({ state: { teams: [] } });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 0, synced: 0 } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams']
  );
  assertEquals(calls, []);
});

Deno.test('a team with no raid list makes no WarcraftLogs zone call and writes nothing', async () => {
  const { deps, calls, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: { seasonName: SEASON_NAME } } },
    responses: [tokenResponse()]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 0, errors: [], reports: 0 } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason', 'teamConfig']
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://www.warcraftlogs.com/oauth/token');
  assertEquals(calls[0].body, 'grant_type=client_credentials');
});

Deno.test('a team whose raids have no usable zone id fetches no reports and writes nothing', async () => {
  const { deps, calls, db } = testDeps({
    state: {
      teams: [TEAM],
      configs: { 1: { raidProgression: [{ wclZoneId: 'not a zone', name: 'Test Raid' }, { name: 'Mini Raid' }] } }
    },
    responses: [tokenResponse()]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 0, errors: [], reports: 0 } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason', 'teamConfig']
  );
  assertEquals(calls.length, 1);
});

Deno.test('a team with raids and no seasonName syncs, stamped with the current tier', async () => {
  const { deps, db } = testDeps({
    state: {
      teams: [TEAM],
      configs: { 1: { raidProgression: [{ wclZoneId: 44, name: 'Test Raid' }], seasonName: '' } }
    },
    responses: [tokenResponse(), reportsResponse(REPORTS), zoneResponse('Test Raid Zone', ENCOUNTERS)]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 1, errors: [], reports: 2 } });
  assertEquals(
    db.calls.map((c) => c.method),
    [
      'teams',
      'currentSeason',
      'teamConfig',
      'raidZoneSeason',
      'upsertRaidZone',
      'upsertEncounters',
      'upsertReports',
      'upsertProgress',
      'insertKills'
    ]
  );
  assertEquals(db.calls[4].args, [
    { wcl_zone_id: 44, name: 'Test Raid', season: SEASON_CODE, is_mini_raid: false, sort_index: 0 }
  ]);
});

// The tier boundary: the next tier has started and no officer has yet
// replaced the outgoing raid in the team's list. The reports come from the new
// tier's start, so a night of the outgoing raid after it would rebuild that
// raid's progress from one report: its pulls cut to that night's and its
// first kill dated to it. Its rows are left as the tier left them instead,
// and it is neither duplicated under the new tier nor pulled into the new
// tier's scope. The new raid takes the new tier when it is added (#1469).
Deno.test('a raid filed under an earlier tier is left as it stands; a new raid takes the current tier', async () => {
  const { deps, calls, db } = testDeps({
    state: {
      teams: [TEAM],
      configs: { 1: { raidProgression: TWO_RAIDS.raidProgression } },
      currentSeason: 'MID3',
      seasonStart: '2026-11-10',
      zones: { 44: 'MID2' }
    },
    responses: [
      tokenResponse(),
      reportsResponse(REPORTS),
      zoneResponse('Mini Raid Zone', [{ id: 3003, name: 'Mini Boss' }])
    ]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 1, errors: [], reports: 2 } });
  assertEquals(calls.length, 3);
  for (const call of calls) assertNotMatch(call.body ?? '', /zone\(id: 44\)/);
  const stamps = db.calls
    .filter((c) => c.method === 'upsertRaidZone')
    .map((c) => (c.args[0] as { season: string }).season);
  assertEquals(stamps, ['MID3']);
  assertEquals(
    db.calls.filter((c) => c.method === 'upsertProgress' || c.method === 'insertKills'),
    []
  );
  // The reports are still kept; none holds a pull of the new raid's boss.
  assertEquals(
    reportsWritten(db).map((rows) => rows.map((r) => [r.report_code, r.boss_pulls, r.boss_kills])),
    [
      [
        ['reportA', 0, 0],
        ['reportB', 0, 0]
      ]
    ]
  );
});

Deno.test('a day with no current tier makes no zone call and writes nothing', async () => {
  const { deps, calls, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: TWO_RAIDS }, currentSeason: null },
    responses: [tokenResponse()]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 0, errors: [], note: 'no current tier' } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason']
  );
  assertEquals(calls.length, 1);
});

Deno.test('a failed token answers 500 after the teams read', async () => {
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: TWO_RAIDS } },
    responses: [wclJson({ error: 'invalid_client' })]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 500, body: { success: false, error: 'Failed to get WCL access token' } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams']
  );
});

Deno.test("stamps raid_zones with the current tier's code and writes the pinned progress rows", async () => {
  const { deps, calls, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: TWO_RAIDS } },
    responses: [
      tokenResponse(),
      reportsResponse(REPORTS),
      zoneResponse('Test Raid Zone', ENCOUNTERS),
      zoneResponse('Mini Raid Zone', [])
    ]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 2, errors: [], reports: 2 } });

  // Token, the team's reports from the tier start, zone 44, zone 45 (no encounters).
  assertEquals(calls.length, 4);
  assertMatch(
    calls[1].body ?? '',
    new RegExp(`reports\\(guildID: 777, limit: 50, page: 1, startTime: ${TIER_START_MS}\\)`)
  );
  assertMatch(calls[2].body ?? '', /zone\(id: 44\)/);
  assertMatch(calls[3].body ?? '', /zone\(id: 45\)/);

  assertEquals(
    db.calls.map((c) => c.method),
    [
      'teams',
      'currentSeason',
      'teamConfig',
      'raidZoneSeason',
      'upsertRaidZone',
      'upsertEncounters',
      'raidZoneSeason',
      'upsertReports',
      'upsertProgress',
      'insertKills'
    ]
  );
  assertEquals(db.calls[4].args, [
    { wcl_zone_id: 44, name: 'Test Raid', season: SEASON_CODE, is_mini_raid: false, sort_index: 0 }
  ]);
  assertEquals(db.calls[5].args, [
    [
      { zone_id: 900, wcl_encounter_id: 3001, name: 'Boss One', sort_index: 0 },
      { zone_id: 900, wcl_encounter_id: 3002, name: 'Boss Two', sort_index: 1 }
    ]
  ]);

  const rows = (db.calls[8].args[0] as Array<Record<string, unknown>>).map((row) => {
    const { updated_at, ...rest } = row;
    assertMatch(String(updated_at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    return rest;
  });
  assertEquals(rows, [
    {
      team_id: 1,
      encounter_id: 500,
      mythic_date: '2026-09-14',
      mythic_pulls: 3,
      mythic_best_pct: null,
      mythic_report_code: 'reportA',
      mythic_fight_id: 2,
      heroic_date: null,
      heroic_pulls: 0,
      heroic_best_pct: null,
      heroic_report_code: null,
      heroic_fight_id: null
    },
    {
      team_id: 1,
      encounter_id: 501,
      mythic_date: null,
      mythic_pulls: 0,
      mythic_best_pct: null,
      mythic_report_code: null,
      mythic_fight_id: null,
      heroic_date: null,
      heroic_pulls: 2,
      heroic_best_pct: 8.25,
      heroic_report_code: 'reportB',
      heroic_fight_id: 2
    }
  ]);
});

// #1246: team_raid_progress keeps only the first kill, so a boss on farm
// looks the same every week. Every kill is kept as well, one row per fight.
const ONE_RAID = { raidProgression: [{ wclZoneId: 44, name: 'Test Raid' }] };

function killsWritten(db: FakeDb) {
  return db.calls.filter((c) => c.method === 'insertKills').map((c) => c.args[0]);
}

Deno.test("every Heroic and Mythic kill of the zone's bosses is stored, one row per fight", async () => {
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: ONE_RAID } },
    responses: [tokenResponse(), reportsResponse(REPORTS), zoneResponse('Test Raid Zone', ENCOUNTERS)]
  });
  await handle(post({ 'x-cron-secret': CRON_SECRET }), deps);
  // Boss one twice, on two nights; the other zone's kill and the Normal kill are not kept.
  assertEquals(killsWritten(db), [
    [
      {
        team_id: 1,
        encounter_id: 500,
        difficulty: 'mythic',
        report_code: 'reportA',
        fight_id: 2,
        raid_date: '2026-09-14',
        report_started_at: '2026-09-15T00:00:00.000Z'
      },
      {
        team_id: 1,
        encounter_id: 500,
        difficulty: 'mythic',
        report_code: 'reportB',
        fight_id: 1,
        raid_date: '2026-09-17',
        report_started_at: '2026-09-18T00:00:00.000Z'
      }
    ]
  ]);
});

Deno.test('a Heroic and a Mythic kill after midnight are both stored, on the night before', async () => {
  const REPORT_C_START = 1789536600000; // 2026-09-16T05:30:00Z, 01:30 ET on the 16th
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: ONE_RAID } },
    responses: [
      tokenResponse(),
      reportsResponse([
        {
          code: 'reportC',
          startTime: REPORT_C_START,
          fights: [
            { id: 4, encounterID: 3001, difficulty: 5, kill: true, bossPercentage: 0 },
            { id: 9, encounterID: 3002, difficulty: 4, kill: true, bossPercentage: 0 }
          ]
        }
      ]),
      zoneResponse('Test Raid Zone', ENCOUNTERS)
    ]
  });
  await handle(post({ 'x-cron-secret': CRON_SECRET }), deps);
  assertEquals(killsWritten(db), [
    [
      {
        team_id: 1,
        encounter_id: 500,
        difficulty: 'mythic',
        report_code: 'reportC',
        fight_id: 4,
        raid_date: '2026-09-15',
        report_started_at: '2026-09-16T05:30:00.000Z'
      },
      {
        team_id: 1,
        encounter_id: 501,
        difficulty: 'heroic',
        report_code: 'reportC',
        fight_id: 9,
        raid_date: '2026-09-15',
        report_started_at: '2026-09-16T05:30:00.000Z'
      }
    ]
  ]);
});

Deno.test('a night of wipes writes its progress and no kills', async () => {
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: ONE_RAID } },
    responses: [
      tokenResponse(),
      reportsResponse([
        {
          code: 'reportD',
          startTime: REPORT_A_START,
          fights: [
            { id: 1, encounterID: 3001, difficulty: 5, kill: false, bossPercentage: 30 },
            { id: 2, encounterID: 3002, difficulty: 4, kill: false, bossPercentage: 5 }
          ]
        }
      ]),
      zoneResponse('Test Raid Zone', ENCOUNTERS)
    ]
  });
  await handle(post({ 'x-cron-secret': CRON_SECRET }), deps);
  assertEquals(db.calls.at(-1)?.method, 'upsertProgress');
  assertEquals(killsWritten(db), []);
});

// The kills are the newer write: when they fail, the progress the landing page
// reads still syncs for every raid on the team's list, and the run says so.
Deno.test("a failed kills write is reported and the team's other raids still sync", async () => {
  const db = fakeDb({ teams: [TEAM], configs: { 1: TWO_RAIDS } });
  db.insertKills = () => Promise.reject(new Error('team_raid_kills is read-only tonight'));
  const { fetch } = recordingFetch([
    tokenResponse(),
    reportsResponse([
      ...REPORTS,
      {
        code: 'reportE',
        title: 'Phoenix Mythic 9/17',
        startTime: REPORT_B_START,
        zone: { id: 45 },
        fights: [{ id: 1, encounterID: 3003, difficulty: 5, kill: false, bossPercentage: 50 }]
      }
    ]),
    zoneResponse('Test Raid Zone', ENCOUNTERS),
    zoneResponse('Mini Raid Zone', [{ id: 3003, name: 'Mini Boss' }])
  ]);
  const deps: Deps = { fetch, env: fullEnv(), db };
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, {
    status: 200,
    body: {
      success: true,
      teams: 1,
      synced: 2,
      errors: [{ teamId: 1, error: 'Kills not saved: team_raid_kills is read-only tonight' }],
      reports: 3
    }
  });
  assertEquals(db.calls.filter((c) => c.method === 'upsertProgress').length, 2);
});

Deno.test('a zone WarcraftLogs does not know is skipped and counted as not synced', async () => {
  const { deps, db } = testDeps({
    state: {
      teams: [TEAM],
      configs: { 1: { raidProgression: [{ wclZoneId: 44, name: 'Test Raid' }], seasonName: SEASON_NAME } }
    },
    responses: [tokenResponse(), reportsResponse([]), unknownZoneResponse()]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 0, errors: [], reports: 0 } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason', 'teamConfig', 'raidZoneSeason']
  );
});

Deno.test('a write that fails is reported per team and the run goes on', async () => {
  const failing = fakeDb({ teams: [TEAM, { id: 2, wcl_guild_id: 778 }], configs: { 1: TWO_RAIDS, 2: {} } });
  failing.upsertRaidZone = () => Promise.reject(new Error('raid_zones is read-only tonight'));
  const { fetch } = recordingFetch([
    tokenResponse(),
    reportsResponse(REPORTS),
    zoneResponse('Test Raid Zone', ENCOUNTERS)
  ]);
  const deps: Deps = { fetch, env: fullEnv(), db: failing };
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, {
    status: 200,
    body: {
      success: true,
      teams: 2,
      synced: 0,
      errors: [{ teamId: 1, error: 'raid_zones is read-only tonight' }],
      reports: 0
    }
  });
});

// #1469: every report the sync reads is kept in team_raid_reports, one row per
// team and report, with the title rule's verdict. The guild's reports are read
// once per team, from the tier's start, whatever the length of the raid list.
Deno.test("fetches a team's reports once per run, from the tier start, with each report's title and zone", async () => {
  const { deps, calls } = testDeps({
    state: { teams: [TEAM], configs: { 1: TWO_RAIDS } },
    responses: [
      tokenResponse(),
      reportsResponse(REPORTS),
      zoneResponse('Test Raid Zone', ENCOUNTERS),
      zoneResponse('Mini Raid Zone', [{ id: 3003, name: 'Mini Boss' }])
    ]
  });
  await handle(post({ 'x-cron-secret': CRON_SECRET }), deps);
  const fetched = reportsCalls(calls);
  assertEquals(fetched.length, 1);
  assertMatch(fetched[0].body ?? '', new RegExp(`page: 1, startTime: ${TIER_START_MS}\\)`));
  assertMatch(fetched[0].body ?? '', /\btitle\b/);
  assertMatch(fetched[0].body ?? '', /zone \{ id \}/);
});

Deno.test('a tier with no start date fetches every report, as before the window', async () => {
  const { deps, calls } = testDeps({
    state: { teams: [TEAM], configs: { 1: ONE_RAID }, seasonStart: null },
    responses: [tokenResponse(), reportsResponse(REPORTS), zoneResponse('Test Raid Zone', ENCOUNTERS)]
  });
  await handle(post({ 'x-cron-secret': CRON_SECRET }), deps);
  assertMatch(reportsCalls(calls)[0].body ?? '', /reports\(guildID: 777, limit: 50, page: 1\)/);
});

Deno.test('writes a row for every report it read, before any progress or kill', async () => {
  // A third night, a Heroic wipe and a Heroic kill on boss two.
  const REPORT_H = {
    code: 'reportH',
    title: 'Phoenix Heroic 9/21',
    startTime: REPORT_B_START + 4 * 86400000,
    zone: { id: 44 },
    fights: [
      { id: 1, encounterID: 3002, difficulty: 4, kill: false, bossPercentage: 3 },
      { id: 2, encounterID: 3002, difficulty: 4, kill: true, bossPercentage: 0 }
    ]
  };
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: ONE_RAID } },
    responses: [tokenResponse(), reportsResponse([...REPORTS, REPORT_H]), zoneResponse('Test Raid Zone', ENCOUNTERS)]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res.body.reports, 3);
  const methods = db.calls.map((c) => c.method);
  assertEquals(methods.slice(-3), ['upsertReports', 'upsertProgress', 'insertKills']);
  // Pulls and kills count Heroic and Mythic fights on the raid's own bosses:
  // report B's fight on another zone's boss and its Normal kill are not counted.
  assertEquals(reportsWritten(db), [
    [
      {
        team_id: 1,
        report_code: 'reportA',
        title: 'Phoenix Mythic 9/14',
        started_at: '2026-09-15T00:00:00.000Z',
        raid_date: '2026-09-14',
        wcl_zone_id: 44,
        boss_pulls: 3,
        boss_kills: 1,
        kind: 'main'
      },
      {
        team_id: 1,
        report_code: 'reportB',
        title: 'Phoenix Heroic 9/17',
        started_at: '2026-09-18T00:00:00.000Z',
        raid_date: '2026-09-17',
        wcl_zone_id: 44,
        boss_pulls: 2,
        boss_kills: 1,
        kind: 'main'
      },
      {
        team_id: 1,
        report_code: 'reportH',
        title: 'Phoenix Heroic 9/21',
        started_at: '2026-09-22T00:00:00.000Z',
        raid_date: '2026-09-21',
        wcl_zone_id: 44,
        boss_pulls: 2,
        boss_kills: 1,
        kind: 'main'
      }
    ]
  ]);
});

Deno.test(
  'the verdict is the title rule: Alt as its own word is an alt run, and a report with no title is not',
  async () => {
    const { deps, db } = testDeps({
      state: { teams: [TEAM], configs: { 1: ONE_RAID } },
      responses: [
        tokenResponse(),
        reportsResponse([
          { code: 'alt', title: 'Phoenix Alt run', startTime: REPORT_A_START, zone: { id: 44 }, fights: [] },
          {
            code: 'altar',
            title: 'Phoenix Heroic 8/27 - The Coiled Altar (Best 9.63% P3, 17 Pulls)',
            startTime: REPORT_A_START,
            zone: { id: 44 },
            fights: []
          },
          { code: 'untitled', title: null, startTime: REPORT_B_START, zone: null, fights: [] }
        ]),
        zoneResponse('Test Raid Zone', ENCOUNTERS)
      ]
    });
    await handle(post({ 'x-cron-secret': CRON_SECRET }), deps);
    assertEquals(
      reportsWritten(db)[0].map((r) => [r.report_code, r.kind, r.title, r.wcl_zone_id]),
      [
        ['alt', 'alt', 'Phoenix Alt run', 44],
        ['altar', 'main', 'Phoenix Heroic 8/27 - The Coiled Altar (Best 9.63% P3, 17 Pulls)', 44],
        ['untitled', 'main', null, null]
      ]
    );
  }
);

Deno.test('a report renamed on Warcraft Logs carries its new title and verdict on the next run', async () => {
  const db = fakeDb({ teams: [TEAM], configs: { 1: ONE_RAID } });
  const run = async (reports: unknown[]) => {
    const { fetch } = recordingFetch([
      tokenResponse(),
      reportsResponse(reports),
      zoneResponse('Test Raid Zone', ENCOUNTERS)
    ]);
    await handle(post({ 'x-cron-secret': CRON_SECRET }), { fetch, env: fullEnv(), db });
  };
  await run(REPORTS);
  await run([{ ...REPORTS[0], title: 'Phoenix Alt run 9/14' }]);
  assertEquals(
    reportsWritten(db).map((rows) => rows.map((r) => [r.report_code, r.title, r.kind])),
    [
      [
        ['reportA', 'Phoenix Mythic 9/14', 'main'],
        ['reportB', 'Phoenix Heroic 9/17', 'main']
      ],
      [['reportA', 'Phoenix Alt run 9/14', 'alt']]
    ]
  );
});

// A page Warcraft Logs refuses would leave a partial list, and progress
// rebuilt from it can lose a kill date; the team writes nothing that run.
Deno.test(
  "a reports page that fails is the team's error: nothing is written for it and the next team syncs",
  async () => {
    const { deps, db } = testDeps({
      state: { teams: [TEAM, { id: 2, wcl_guild_id: 778 }], configs: { 1: ONE_RAID, 2: ONE_RAID } },
      responses: [
        tokenResponse(),
        reportsPage([REPORTS[0]], true),
        graphqlError('Max query complexity should be 50000 but got 50401'),
        reportsResponse([REPORTS[1]]),
        zoneResponse('Test Raid Zone', ENCOUNTERS)
      ]
    });
    const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
    assertEquals(res, {
      status: 200,
      body: {
        success: true,
        teams: 2,
        synced: 1,
        errors: [{ teamId: 1, error: 'Reports page 2 not returned' }],
        reports: 1
      }
    });
    assertEquals(
      db.calls.map((c) => c.method),
      [
        'teams',
        'currentSeason',
        'teamConfig',
        'teamConfig',
        'raidZoneSeason',
        'upsertRaidZone',
        'upsertEncounters',
        'upsertReports',
        'upsertProgress',
        'insertKills'
      ]
    );
    assertEquals(
      reportsWritten(db).map((rows) => rows.map((r) => r.team_id)),
      [[2]]
    );
  }
);

// A report uploaded while the pages are read pushes the list down by one, so
// the next page repeats the last report of the one before it. One statement
// cannot rewrite a row twice, and a repeated report would count its pulls twice.
Deno.test('a report repeated across two pages is kept and counted once', async () => {
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: ONE_RAID } },
    responses: [
      tokenResponse(),
      reportsPage([REPORTS[0]], true),
      reportsResponse([REPORTS[0], REPORTS[1]]),
      zoneResponse('Test Raid Zone', ENCOUNTERS)
    ]
  });
  await handle(post({ 'x-cron-secret': CRON_SECRET }), deps);
  assertEquals(
    reportsWritten(db).map((rows) => rows.map((r) => r.report_code)),
    [['reportA', 'reportB']]
  );
  const progress = db.calls.find((c) => c.method === 'upsertProgress')?.args[0] as Array<Record<string, unknown>>;
  assertEquals(
    progress.map((row) => row.mythic_pulls),
    [3, 0]
  );
});
