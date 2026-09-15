// wcl-progression-sync's handler (#932): the cron gate, the one read of the
// guild's current tier before any WarcraftLogs call, and the raid_zones
// stamp taken from that tier rather than from the team being synced. The
// progress rows are the ones the pre-split aggregation produced over this
// corpus, recorded before the split, so the move is measured against what
// was deployed. The runner grants no permission: a path that reached the
// platform fetch or Deno.env would throw into the catch-all and fail the
// body assertion.
import { assertEquals, assertMatch } from 'jsr:@std/assert@1';
import { type Deps, handle } from '../../../supabase/functions/wcl-progression-sync/handler.ts';
import { VERSION } from '../../../supabase/functions/wcl-progression-sync/version.ts';
import { envOf } from '../_support/corpus.ts';
import { recordingFetch } from '../_support/fetch.ts';
import { CURRENT_SEASON, type FakeDb, type FakeDbState, fakeDb } from './fake-db.ts';

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
const reportsResponse = (data: unknown[]) =>
  wclJson({ data: { reportData: { reports: { data, has_more_pages: false } } } });

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
    startTime: REPORT_A_START,
    fights: [
      { id: 1, encounterID: 3001, difficulty: 5, kill: false, bossPercentage: 42.5 },
      { id: 2, encounterID: 3001, difficulty: 5, kill: true, bossPercentage: 0 },
      { id: 3, encounterID: 3002, difficulty: 4, kill: false, bossPercentage: 12 }
    ]
  },
  {
    code: 'reportB',
    startTime: REPORT_B_START,
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
const TWO_RAIDS = {
  raidProgression: [
    { wclZoneId: 44, name: 'Test Raid' },
    { wclZoneId: '45', name: 'Mini Raid', isMiniRaid: true }
  ],
  seasonName: 'A Name The Stamp Must Not Use'
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

Deno.test('no team with a guild id answers teams: 0 without reading the season', async () => {
  const { deps, calls, db } = testDeps({ state: { teams: [] } });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 0, synced: 0 } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams']
  );
  assertEquals(calls, []);
});

Deno.test('no current season refuses the run before WarcraftLogs is called and writes nothing', async () => {
  const { deps, calls, db } = testDeps({ state: { teams: [TEAM], seasons: [] } });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 500, body: { success: false, error: 'No current season' } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason']
  );
  assertEquals(calls, []);
});

Deno.test('two current seasons is refused the same way', async () => {
  const { deps, calls, db } = testDeps({
    state: {
      teams: [TEAM],
      seasons: [CURRENT_SEASON, { code: 'MID3', display_name: 'Midnight Season 3' }]
    }
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 500, body: { success: false, error: 'No current season' } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason']
  );
  assertEquals(calls, []);
});

Deno.test('a team with no raid list makes no WarcraftLogs zone call and writes nothing', async () => {
  const { deps, calls, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: { seasonName: 'Midnight Season 2' } } },
    responses: [tokenResponse()]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 0, errors: [] } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason', 'teamConfig']
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, 'https://www.warcraftlogs.com/oauth/token');
  assertEquals(calls[0].body, 'grant_type=client_credentials');
});

Deno.test('a failed token answers 500 after the season read', async () => {
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: TWO_RAIDS } },
    responses: [wclJson({ error: 'invalid_client' })]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 500, body: { success: false, error: 'Failed to get WCL access token' } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason']
  );
});

Deno.test('stamps raid_zones with the current tier, not the team, and writes the pinned progress rows', async () => {
  const { deps, calls, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: TWO_RAIDS } },
    responses: [
      tokenResponse(),
      zoneResponse('Test Raid Zone', ENCOUNTERS),
      reportsResponse(REPORTS),
      zoneResponse('Mini Raid Zone', [])
    ]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 2, errors: [] } });

  // Token, zone 44, its reports, zone 45 (no encounters, so no reports call).
  assertEquals(calls.length, 4);
  assertMatch(calls[1].body ?? '', /zone\(id: 44\)/);
  assertMatch(calls[2].body ?? '', /reports\(guildID: 777, limit: 50, page: 1\)/);
  assertMatch(calls[3].body ?? '', /zone\(id: 45\)/);

  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason', 'teamConfig', 'upsertRaidZone', 'upsertEncounters', 'upsertProgress']
  );
  assertEquals(db.calls[3].args, [
    { wcl_zone_id: 44, name: 'Test Raid', season: CURRENT_SEASON.display_name, is_mini_raid: false, sort_index: 0 }
  ]);
  assertEquals(db.calls[4].args, [
    [
      { zone_id: 900, wcl_encounter_id: 3001, name: 'Boss One', sort_index: 0 },
      { zone_id: 900, wcl_encounter_id: 3002, name: 'Boss Two', sort_index: 1 }
    ]
  ]);

  const rows = (db.calls[5].args[0] as Array<Record<string, unknown>>).map((row) => {
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

Deno.test('a zone WarcraftLogs does not know is skipped and counted as not synced', async () => {
  const { deps, db } = testDeps({
    state: { teams: [TEAM], configs: { 1: { raidProgression: [{ wclZoneId: 44, name: 'Test Raid' }] } } },
    responses: [tokenResponse(), unknownZoneResponse()]
  });
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, { status: 200, body: { success: true, teams: 1, synced: 0, errors: [] } });
  assertEquals(
    db.calls.map((c) => c.method),
    ['teams', 'currentSeason', 'teamConfig']
  );
});

Deno.test('a write that fails is reported per team and the run goes on', async () => {
  const failing = fakeDb({ teams: [TEAM, { id: 2, wcl_guild_id: 778 }], configs: { 1: TWO_RAIDS, 2: {} } });
  failing.upsertRaidZone = () => Promise.reject(new Error('raid_zones is read-only tonight'));
  const { fetch } = recordingFetch([
    tokenResponse(),
    zoneResponse('Test Raid Zone', ENCOUNTERS),
    reportsResponse(REPORTS)
  ]);
  const deps: Deps = { fetch, env: fullEnv(), db: failing };
  const res = await json(await handle(post({ 'x-cron-secret': CRON_SECRET }), deps));
  assertEquals(res, {
    status: 200,
    body: { success: true, teams: 2, synced: 0, errors: [{ teamId: 1, error: 'raid_zones is read-only tonight' }] }
  });
});
