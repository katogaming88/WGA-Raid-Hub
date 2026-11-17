// wcl-sync's hourly attendance run (#1845): every team with a Warcraft Logs
// guild, the same refresh the officer's button runs, then the commit only
// when nothing this season needs a look. Warcraft Logs is a scripted fetch;
// the database is an in-memory set of tables behind just the supabase-js
// calls the refresh makes. attendance_items_waiting() and
// commit_attendance_scores() are SQL with their own tests in
// tests/rls/attendance-scheduled-sync.test.js; here the waiting count is
// worked out from the fake's rows by the same rule, and the commit is
// recorded, not run.
import { assertEquals } from 'jsr:@std/assert@1';
import { type Deps, handle } from '../../../supabase/functions/wcl-sync/handler.ts';

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

// ── The database ───────────────────────────────────────────────────────

function fakeDb(tables: Tables, failWrites: string[] = []) {
  const rpcCalls: Array<{ name: string; args: any }> = [];
  const rpcs: Record<string, (args: any) => unknown> = {
    current_season: () => 'MID2',
    attendance_items_waiting: ({ p_team_id }) =>
      (tables.attendance || []).filter(
        (r) =>
          r.team_id === p_team_id &&
          r.status === null &&
          (r.source === 'WCL (Late?)' || r.source === 'WCL (Absent?)') &&
          !r.report_excluded
      ).length,
    commit_attendance_scores: () => ({ committed: 3, totalNights: 1 }),
    // #1846: which RSVPs came before the start is SQL's call, tested in
    // tests/rls/attendance-rsvp-fill.test.js; the fake's rows all did.
    attendance_rsvps_before_start: ({ p_team_id, p_dates }) =>
      (tables.raid_rsvps || []).filter((r) => r.team_id === p_team_id && p_dates.includes(r.raid_date))
  };

  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let write: { kind: 'upsert'; rows: Row[]; keys: string[]; ignore: boolean } | { kind: 'update'; set: Row } | null =
      null;
    let slice: [number, number] | null = null;
    const rows = () => (tables[table] ??= []);
    const run = () => {
      if (write && failWrites.includes(table)) return { data: null, error: { message: table + ' write failed' } };
      if (write?.kind === 'upsert') {
        for (const row of write.rows) {
          const keys = (write as any).keys as string[];
          const existing = rows().find((r) => keys.every((k) => r[k] === row[k]));
          if (!existing) rows().push({ ...row });
          else if (!(write as any).ignore) Object.assign(existing, row);
        }
        return { data: null, error: null };
      }
      if (write?.kind === 'update') {
        for (const r of rows().filter((r) => filters.every((f) => f(r)))) Object.assign(r, write.set);
        return { data: null, error: null };
      }
      // PostgREST's cap: an unpaged read stops at 1000 rows, no error.
      const found = rows().filter((r) => filters.every((f) => f(r)));
      return { data: found.slice(...(slice ?? [0, 1000])), error: null };
    };
    const builder: any = {
      select: () => builder,
      order: () => builder,
      range: (from: number, to: number) => ((slice = [from, to + 1]), builder),
      eq: (col: string, value: unknown) => (filters.push((r) => r[col] === value), builder),
      is: (col: string, value: null) => (filters.push((r) => (r[col] ?? null) === value), builder),
      not: (col: string, _op: 'is', value: null) => (filters.push((r) => (r[col] ?? null) !== value), builder),
      upsert: (input: Row[], opts: { onConflict: string; ignoreDuplicates?: boolean }) => {
        write = { kind: 'upsert', rows: input, keys: opts.onConflict.split(','), ignore: !!opts.ignoreDuplicates };
        return builder;
      },
      update: (set: Row) => ((write = { kind: 'update', set }), builder),
      maybeSingle: () => {
        const { data } = run() as { data: Row[] };
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(resolve, reject)
    };
    return builder;
  }

  const client = {
    from,
    rpc(name: string, args: any) {
      rpcCalls.push({ name, args });
      const answer = rpcs[name];
      if (!answer) return Promise.resolve({ data: null, error: { message: 'no fake rpc ' + name } });
      return Promise.resolve({ data: answer(args), error: null });
    }
  };
  return { client, tables, rpcCalls };
}

// ── Warcraft Logs ──────────────────────────────────────────────────────

// 2026-09-15, 8:30 PM Eastern.
const NIGHT = '2026-09-15';
const NIGHT_MS = Date.UTC(2026, 8, 16, 0, 30);

type Log = { guildId: number; inLog: string[]; atFirstPull?: string[] };

type WclOpts = { tokenFails?: boolean; tokenThrows?: boolean; actorsFail?: boolean };

function wcl(logs: Log[], { tokenFails = false, tokenThrows = false, actorsFail = false }: WclOpts = {}) {
  const queries: string[] = [];
  const respond = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body)));
  const byCode = new Map(logs.map((log) => ['R' + log.guildId, log]));
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/oauth/token') && tokenThrows) return Promise.reject(new TypeError('network down'));
    if (url.endsWith('/oauth/token')) return respond(tokenFails ? {} : { access_token: 'wcl-token' });
    const query: string = JSON.parse(String(init?.body)).query;
    queries.push(query);
    const guild = /reports\(guildID: (\d+)/.exec(query);
    if (guild) {
      const log = logs.find((l) => l.guildId === Number(guild[1]));
      const data = log ? [{ code: 'R' + log.guildId, title: 'Raid night', startTime: NIGHT_MS }] : [];
      return respond({ data: { reportData: { reports: { data, has_more_pages: false } } } });
    }
    const log = byCode.get(/code: "([^"]+)"/.exec(query)?.[1] ?? '')!;
    const report = (r: Row) => respond({ data: { reportData: { report: r } } });
    if (query.includes('zone { id }')) return report({ zone: { id: 1 } });
    if (query.includes('rankings(')) return report({ rankings: JSON.stringify({ data: [] }) });
    if (query.includes('actors(type: "Player") { name }')) {
      if (actorsFail) return respond({ errors: [{ message: 'rate limited' }] });
      return report({ masterData: { actors: log.inLog.map((name) => ({ name })) } });
    }
    if (query.includes('fights { id startTime')) {
      return report({ fights: [{ id: 1, startTime: 0, difficulty: 4, encounterID: 50 }] });
    }
    if (query.includes('playerDetails(')) {
      const dps = (log.atFirstPull ?? log.inLog).map((name) => ({ name }));
      return report({ playerDetails: { data: { playerDetails: { dps, healers: [], tanks: [] } } } });
    }
    throw new Error('unscripted WCL query: ' + query);
  };
  return { fetch: fetch as typeof globalThis.fetch, queries };
}

// ── The run ────────────────────────────────────────────────────────────

const SECRET = 'cron-secret';

function cronRequest(secret = SECRET) {
  return new Request('http://edge.test/functions/v1/wcl-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-cron-secret': secret },
    body: '{}'
  });
}

function setup(tables: Tables, logs: Log[], opts: WclOpts & { failWrites?: string[] } = {}) {
  const db = fakeDb(tables, opts.failWrites);
  const w = wcl(logs, opts);
  let serviceBuilt = 0;
  const deps: Deps = {
    supabase() {
      throw new Error('the hourly run must not build a caller client');
    },
    service() {
      serviceBuilt++;
      return db.client as any;
    },
    cronSecret: SECRET,
    io: { fetch: w.fetch, env: () => 'x' }
  };
  return { deps, db, w, serviceBuilt: () => serviceBuilt };
}

function team1(players: Row[], attendance: Row[] = []): Tables {
  return {
    teams: [{ id: 1, wcl_guild_id: 11 }],
    team_settings: [{ team_id: 1, config: {} }],
    seasons: [{ code: 'MID2', starts_at: '2026-08-11' }],
    players: players.map((p) => ({ team_id: 1, is_bench: false, join_date: null, archived_at: null, ...p })),
    attendance,
    raid_night_participation: [],
    raid_night_bosses: []
  };
}

const ROSTER = [
  { id: 101, name_realm: 'Alpha-Stormrage' },
  { id: 102, name_realm: 'Bravo-Stormrage' }
];

const night = (tables: Tables) =>
  (tables.attendance || [])
    .filter((r) => r.raid_date === NIGHT)
    .map((r) => ({ player_id: r.player_id, status: r.status, source: r.source }))
    .sort((a, b) => a.player_id - b.player_id);

Deno.test(
  'a new night: present raiders recorded, a missing raider saved blank, a pug listed, nothing committed',
  async () => {
    const { deps, db } = setup(team1(ROSTER), [{ guildId: 11, inLog: ['Alpha', 'Pugguy-Area52'] }]);
    const res = await handle(cronRequest(), deps);
    assertEquals(res.status, 200);

    assertEquals(night(db.tables), [
      { player_id: 101, status: 'Present', source: 'WCL' },
      { player_id: 102, status: null, source: 'WCL (Absent?)' }
    ]);
    assertEquals(
      db.tables.attendance_log_names.map((r) => [r.team_id, r.raid_date, r.character_name]),
      [[1, NIGHT, 'pugguy']]
    );
    assertEquals(
      db.rpcCalls.some((c) => c.name === 'commit_attendance_scores'),
      false
    );
    const run = db.tables.team_settings[0].attendance_sync_last_run;
    assertEquals([run.main_nights, run.waiting, run.committed, run.error], [1, 1, null, null]);

    // The next hour, no new report: nothing changes.
    const before = JSON.stringify(db.tables.attendance);
    await handle(cronRequest(), deps);
    assertEquals(JSON.stringify(db.tables.attendance), before);
  }
);

Deno.test('a late arrival waits too: Late? holds back the commit', async () => {
  const { deps, db } = setup(team1(ROSTER), [{ guildId: 11, inLog: ['Alpha', 'Bravo'], atFirstPull: ['Alpha'] }]);
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables)[1], { player_id: 102, status: null, source: 'WCL (Late?)' });
  assertEquals(db.tables.team_settings[0].attendance_sync_last_run.waiting, 1);
  assertEquals(
    db.rpcCalls.some((c) => c.name === 'commit_attendance_scores'),
    false
  );
});

Deno.test('a night with nothing to look at commits the scores', async () => {
  const { deps, db } = setup(team1(ROSTER), [{ guildId: 11, inLog: ['Alpha', 'Bravo', 'Pugguy'] }]);
  await handle(cronRequest(), deps);
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'commit_attendance_scores').map((c) => c.args),
    [{ p_team_id: 1 }]
  );
  const run = db.tables.team_settings[0].attendance_sync_last_run;
  assertEquals([run.waiting, run.committed, run.error], [0, 3, null]);
});

Deno.test('a status an officer set is left alone', async () => {
  const officerRow = {
    team_id: 1,
    player_id: 102,
    raid_date: NIGHT,
    status: 'Excused',
    source: 'Officer',
    report_id: null,
    report_excluded: false
  };
  const { deps, db } = setup(team1(ROSTER, [officerRow]), [{ guildId: 11, inLog: ['Alpha'] }]);
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables), [
    { player_id: 101, status: 'Present', source: 'WCL' },
    { player_id: 102, status: 'Excused', source: 'Officer' }
  ]);
  assertEquals(db.tables.team_settings[0].attendance_sync_last_run.committed, 3);
});

Deno.test('a team with no Warcraft Logs guild is skipped', async () => {
  const tables = team1(ROSTER);
  tables.teams.push({ id: 4, wcl_guild_id: null });
  tables.team_settings.push({ team_id: 4, config: {} });
  const { deps, db, w } = setup(tables, [{ guildId: 11, inLog: ['Alpha', 'Bravo'] }]);
  const body = await (await handle(cronRequest(), deps)).json();
  assertEquals(Object.keys(body.teams), ['1']);
  assertEquals(w.queries.filter((q) => q.includes('reports(guildID')).length, 1);
  assertEquals(db.tables.team_settings[1].attendance_sync_last_run, undefined);
});

Deno.test('a failed Warcraft Logs sign-in is recorded on the team, not lost', async () => {
  const { deps, db } = setup(team1(ROSTER), [], { tokenFails: true });
  await handle(cronRequest(), deps);
  const run = db.tables.team_settings[0].attendance_sync_last_run;
  assertEquals(run.error, 'Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.');
  assertEquals(run.committed, null);
});

Deno.test('a wrong secret is refused before anything is built', async () => {
  const { deps, serviceBuilt } = setup(team1(ROSTER), []);
  const res = await handle(cronRequest('guess'), deps);
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { success: false, error: 'Not authorized' });
  assertEquals(serviceBuilt(), 0);
});

// CodeRabbit on PR #1858: the three ways a run could leave wrong or lost data.
Deno.test('a failed read of who was in the log writes nothing, so the next run tries the report again', async () => {
  const { deps, db } = setup(team1(ROSTER), [{ guildId: 11, inLog: ['Alpha'] }], { actorsFail: true });
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables), []);
  const run = db.tables.team_settings[0].attendance_sync_last_run;
  assertEquals(run.error, 'Could not read who was in Warcraft Logs report R11');
  assertEquals(run.committed, null);
});

Deno.test('a failed write of the not-on-roster names leaves the report new, so they are read again', async () => {
  const { deps, db } = setup(team1(ROSTER), [{ guildId: 11, inLog: ['Alpha', 'Pugguy'] }], {
    failWrites: ['attendance_log_names']
  });
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables), []);
  assertEquals(db.tables.team_settings[0].attendance_sync_last_run.error, 'attendance_log_names write failed');
});

Deno.test('a sign-in that throws is still recorded on every team', async () => {
  const { deps, db } = setup(team1(ROSTER), [], { tokenThrows: true });
  const res = await handle(cronRequest(), deps);
  assertEquals(res.status, 200);
  const run = db.tables.team_settings[0].attendance_sync_last_run;
  assertEquals(run.error, 'Failed to get WCL access token. Check WCL_CLIENT_ID/WCL_CLIENT_SECRET.');
});

// Fresh review on PR #1858: PostgREST answers 1000 rows at most, so a short
// read of the saved reports would make an old report look new every hour.
Deno.test('a report saved past the first 1000 rows is still known, and not read again', async () => {
  const old = Array.from({ length: 1000 }, (_, i) => ({
    team_id: 1,
    player_id: 101,
    raid_date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`,
    status: 'Present',
    source: 'WCL',
    report_id: 'old' + i,
    report_excluded: false
  }));
  const saved = { ...old[0], raid_date: NIGHT, report_id: 'R11' };
  const { deps, w } = setup(team1(ROSTER, [...old, saved]), [{ guildId: 11, inLog: ['Alpha'] }]);
  await handle(cronRequest(), deps);
  assertEquals(
    w.queries.filter((q) => q.includes('zone { id }')),
    []
  );
});

// #1846: a Calendar RSVP made before the start fills in what it can.
const rsvp = (player_id: number, status: string) => ({ team_id: 1, player_id, raid_date: NIGHT, status, note: null });

Deno.test('said Absent and not in the log: Excused from the Calendar, and nothing holds back the commit', async () => {
  const tables = { ...team1(ROSTER), raid_rsvps: [rsvp(102, 'Absent')] };
  const { deps, db } = setup(tables, [{ guildId: 11, inLog: ['Alpha'] }]);
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables)[1], { player_id: 102, status: 'Excused', source: 'Calendar (RSVP)' });
  assertEquals(db.tables.team_settings[0].attendance_sync_last_run.committed, 3);
  // Only the nights this run reads, in batches (CodeRabbit on PR #1861).
  assertEquals(
    db.rpcCalls.filter((c) => c.name === 'attendance_rsvps_before_start').map((c) => c.args),
    [{ p_team_id: 1, p_dates: [NIGHT] }]
  );
});

Deno.test('said Late and missed the first pull: Late (with notice)', async () => {
  const tables = { ...team1(ROSTER), raid_rsvps: [rsvp(102, 'Late')] };
  const { deps, db } = setup(tables, [{ guildId: 11, inLog: ['Alpha', 'Bravo'], atFirstPull: ['Alpha'] }]);
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables)[1], { player_id: 102, status: 'Late (with notice)', source: 'Calendar (RSVP)' });
});

Deno.test('said Absent but came on time: the log wins', async () => {
  const tables = { ...team1(ROSTER), raid_rsvps: [rsvp(102, 'Absent'), rsvp(101, 'Late')] };
  const { deps, db } = setup(tables, [{ guildId: 11, inLog: ['Alpha', 'Bravo'] }]);
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables), [
    { player_id: 101, status: 'Present', source: 'WCL' },
    { player_id: 102, status: 'Present', source: 'WCL' }
  ]);
});

Deno.test('said Tentative and not in the log: a look, unless the team picked a status', async () => {
  const waiting = { ...team1(ROSTER), raid_rsvps: [rsvp(102, 'Tentative')] };
  const first = setup(waiting, [{ guildId: 11, inLog: ['Alpha'] }]);
  await handle(cronRequest(), first.deps);
  assertEquals(night(first.db.tables)[1], { player_id: 102, status: null, source: 'WCL (Absent?)' });

  const picked: Tables = {
    ...team1(ROSTER),
    team_settings: [{ team_id: 1, config: { attendanceTentative: 'No Show' } }],
    raid_rsvps: [rsvp(102, 'Tentative')]
  };
  const second = setup(picked, [{ guildId: 11, inLog: ['Alpha'] }]);
  await handle(cronRequest(), second.deps);
  assertEquals(night(second.db.tables)[1], { player_id: 102, status: 'No Show', source: 'Calendar (RSVP)' });
});

Deno.test('an RSVP never touches a status an officer set', async () => {
  const officerRow = {
    team_id: 1,
    player_id: 102,
    raid_date: NIGHT,
    status: 'No Show',
    source: 'Officer',
    report_id: null,
    report_excluded: false
  };
  const tables = { ...team1(ROSTER, [officerRow]), raid_rsvps: [rsvp(102, 'Absent')] };
  const { deps, db } = setup(tables, [{ guildId: 11, inLog: ['Alpha'] }]);
  await handle(cronRequest(), deps);
  assertEquals(night(db.tables)[1], { player_id: 102, status: 'No Show', source: 'Officer' });
});

Deno.test('an archived team is skipped', async () => {
  const tables = team1(ROSTER);
  tables.teams.push({ id: 2, wcl_guild_id: 22, archived_at: '2026-10-01' });
  const { deps } = setup(tables, [{ guildId: 11, inLog: ['Alpha', 'Bravo'] }]);
  const body = await (await handle(cronRequest(), deps)).json();
  assertEquals(Object.keys(body.teams), ['1']);
});
