// team_raid_fights (#1470): every Heroic and Mythic boss pull the progression
// sync reads, one row per fight, and rebuild_team_raid_progress(), which
// rebuilds a team's team_raid_progress rows from the fights of its main
// reports (team_raid_reports.effective_kind, #1469). The team reads the
// fights; the public reads the team's own raids' pulls through
// team_raid_pulls() (#1496). Only the sync's service role writes them.
//
// Each case mints its own team (seedTeam), so it never writes a seeded row.
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

const BOSS_ONE = 9201;
const BOSS_TWO = 9202;

async function seedRaid(q) {
  await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
           values (9200, 99200, 'Test Raid', 'MID2', 0)`);
  await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
           values (${BOSS_ONE}, 9200, 3001, 'Boss One', 0), (${BOSS_TWO}, 9200, 3002, 'Boss Two', 1)`);
}

// A report as the sync writes it, starting at 20:00 Eastern on its raid date.
const report = (q, teamId, code, raidDate, kind = 'main') =>
  q(
    `insert into public.team_raid_reports (team_id, report_code, title, started_at, raid_date, kind)
     values ($1, $2, $2, ($3::date + time '20:00') at time zone 'America/New_York', $3, $4)`,
    [teamId, code, raidDate, kind]
  );

// A pull, a minute per fight id into its report.
const fight = (q, teamId, code, id, encounter, difficulty, kill, pct) =>
  q(
    `insert into public.team_raid_fights
       (team_id, report_code, fight_id, encounter_id, difficulty, kill, boss_percentage, started_at, ended_at)
     select $1, $2, $3::integer, $4, $5, $6, $7, r.started_at + $3::integer * interval '1 minute', r.started_at + $3 * interval '1 minute'
       from public.team_raid_reports r where r.team_id = $1 and r.report_code = $2`,
    [teamId, code, id, encounter, difficulty, kill, pct]
  );

const rebuild = (q, teamId) => q('select public.rebuild_team_raid_progress($1)', [teamId]);

const PROGRESS = `select encounter_id,
         to_char(mythic_date, 'YYYY-MM-DD') as mythic_date, mythic_pulls, mythic_best_pct::float as mythic_best_pct,
         mythic_report_code, mythic_fight_id,
         to_char(heroic_date, 'YYYY-MM-DD') as heroic_date, heroic_pulls, heroic_best_pct::float as heroic_best_pct,
         heroic_report_code, heroic_fight_id
    from public.team_raid_progress where team_id = $1 order by encounter_id`;

// The corpus tests/edge/wcl-progression-sync/handler.test.ts pinned the old
// TypeScript count against. Report A: a Mythic wipe at 42.5% then a kill on
// boss one, a Heroic wipe at 12% on boss two. Report B, later: a second Mythic
// kill on boss one, a better Heroic wipe at 8.25% on boss two. The sync drops
// the other fights (a boss of no listed raid, a Normal kill) before writing.
async function seedCorpus(q, teamId, kindB = 'main') {
  await report(q, teamId, 'reportA', '2026-09-14');
  await report(q, teamId, 'reportB', '2026-09-17', kindB);
  await fight(q, teamId, 'reportA', 1, BOSS_ONE, 'mythic', false, 42.5);
  await fight(q, teamId, 'reportA', 2, BOSS_ONE, 'mythic', true, 0);
  await fight(q, teamId, 'reportA', 3, BOSS_TWO, 'heroic', false, 12);
  await fight(q, teamId, 'reportB', 1, BOSS_ONE, 'mythic', true, 0);
  await fight(q, teamId, 'reportB', 2, BOSS_TWO, 'heroic', false, 8.25);
}

// What the TypeScript count wrote for that corpus (handler.test.ts, before #1470).
const PINNED = [
  {
    encounter_id: BOSS_ONE,
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
    encounter_id: BOSS_TWO,
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
];

describe('rebuild_team_raid_progress', () => {
  it('writes the numbers the sync wrote before, for a team with no alt run', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId);
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual(PINNED);
    });
  });

  it('rewrites a row the sync left, and leaves another team alone', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      const other = await seedTeam(q);
      for (const t of [teamId, other.teamId]) {
        await q(
          `insert into public.team_raid_progress (team_id, encounter_id, mythic_pulls, heroic_pulls)
           values ($1, $2, 99, 99)`,
          [t, BOSS_ONE]
        );
      }
      await seedCorpus(q, teamId);
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual(PINNED);
      expect((await q(PROGRESS, [other.teamId])).rows.map((r) => r.mythic_pulls)).toEqual([99]);
    });
  });

  it('counts none of an alt run: not its pulls, not its kill date, not its best attempt', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      // The alt run kills boss two on Heroic a night before the main night,
      // which wipes on it twice, at 30% and at 20%.
      await report(q, teamId, 'altRun', '2026-09-13', 'alt');
      await report(q, teamId, 'mainNight', '2026-09-14');
      await fight(q, teamId, 'altRun', 1, BOSS_TWO, 'heroic', false, 5);
      await fight(q, teamId, 'altRun', 2, BOSS_TWO, 'heroic', true, 0);
      await fight(q, teamId, 'mainNight', 1, BOSS_TWO, 'heroic', false, 30);
      await fight(q, teamId, 'mainNight', 2, BOSS_TWO, 'heroic', false, 20);
      await rebuild(q, teamId);
      const [row] = (await q(PROGRESS, [teamId])).rows;
      expect(row).toMatchObject({
        encounter_id: BOSS_TWO,
        heroic_date: null,
        heroic_pulls: 2,
        heroic_best_pct: 20,
        heroic_report_code: 'mainNight',
        heroic_fight_id: 2
      });
    });
  });

  it('counts an alt run an officer marks as the team’s raid, and drops a main night marked alt', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId, 'alt');
      await rebuild(q, teamId);
      // Report B out: one Mythic kill and one Heroic wipe at 12%.
      expect(
        (await q(PROGRESS, [teamId])).rows.map((r) => [r.mythic_pulls, r.heroic_pulls, r.heroic_best_pct])
      ).toEqual([
        [2, 0, null],
        [0, 1, 12]
      ]);
      await q(
        `update public.team_raid_reports set kind_override = 'main', kind_override_at = now()
          where team_id = $1 and report_code = 'reportB'`,
        [teamId]
      );
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual(PINNED);
      await q(
        `update public.team_raid_reports set kind_override = 'alt', kind_override_at = now()
          where team_id = $1 and report_code = 'reportA'`,
        [teamId]
      );
      await rebuild(q, teamId);
      // Report A out: boss one's first kill is now report B's.
      const [one] = (await q(PROGRESS, [teamId])).rows;
      expect(one).toMatchObject({ mythic_date: '2026-09-17', mythic_pulls: 1, mythic_report_code: 'reportB' });
    });
  });

  // #1938: a deleted log never takes a kill off the card (Kat, 2026-11-27).
  const markMissing = (q, teamId, code) =>
    q(`update public.team_raid_reports set missing_since = now() where team_id = $1 and report_code = $2`, [
      teamId,
      code
    ]);

  it('keeps counting a report Warcraft Logs no longer returns, its only kill included', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId);
      await markMissing(q, teamId, 'reportA');
      await markMissing(q, teamId, 'reportB');
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual(PINNED);
    });
  });

  it('counts a pull logged in two reports once, and keeps it when one copy is deleted', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId);
      // A second raider's log of report A's night: the same three pulls.
      await report(q, teamId, 'reportA2', '2026-09-14');
      await fight(q, teamId, 'reportA2', 1, BOSS_ONE, 'mythic', false, 42.5);
      await fight(q, teamId, 'reportA2', 2, BOSS_ONE, 'mythic', true, 0);
      await fight(q, teamId, 'reportA2', 3, BOSS_TWO, 'heroic', false, 12);
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual(PINNED);
      // The copy that is still on Warcraft Logs is the one the card links to.
      await markMissing(q, teamId, 'reportA');
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual([{ ...PINNED[0], mythic_report_code: 'reportA2' }, PINNED[1]]);
      // Both copies gone: the kill stays.
      await markMissing(q, teamId, 'reportA2');
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual(PINNED);
    });
  });

  // A pull from `from` to `to` seconds after its report's 20:00 start, so two
  // logs of one pull can start a few seconds apart, as two PCs' clocks do.
  const pull = (q, teamId, code, id, kill, pct, from, to) =>
    q(
      `insert into public.team_raid_fights
         (team_id, report_code, fight_id, encounter_id, difficulty, kill, boss_percentage, started_at, ended_at)
       select $1, $2, $3, $4, 'heroic', $5, $6, r.started_at + $7 * interval '1 second', r.started_at + $8 * interval '1 second'
         from public.team_raid_reports r where r.team_id = $1 and r.report_code = $2`,
      [teamId, code, id, BOSS_TWO, kill, pct, from, to]
    );
  const heroic = async (q, teamId) => {
    const [row] = (await q(PROGRESS, [teamId])).rows;
    return [row.heroic_pulls, row.heroic_date, row.heroic_best_pct, row.heroic_report_code, row.heroic_fight_id];
  };

  it('counts a pull once when one log of it starts late or runs a little off', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await report(q, teamId, 'full', '2026-09-14');
      await report(q, teamId, 'late', '2026-09-14');
      await report(q, teamId, 'skewed', '2026-09-14');
      await pull(q, teamId, 'full', 1, false, 40, 0, 300);
      await pull(q, teamId, 'late', 1, false, 40, 50, 150); // joined mid-pull
      await pull(q, teamId, 'skewed', 1, false, 40, 20, 320); // clock 20 s ahead
      await rebuild(q, teamId);
      expect(await heroic(q, teamId)).toEqual([1, null, 40, 'full', 1]);
    });
  });

  it('never lets a log a few seconds off swallow the next pull in the other log', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      // Log A's wipe (20-120 s) touches both log B's wipe (0-100 s) and B's
      // kill right after (110-210 s); only the wipe is the same pull.
      await report(q, teamId, 'logA', '2026-09-14');
      await report(q, teamId, 'logB', '2026-09-14');
      await pull(q, teamId, 'logA', 1, false, 30, 20, 120);
      await pull(q, teamId, 'logB', 1, false, 30, 0, 100);
      await pull(q, teamId, 'logB', 2, true, 0, 110, 210);
      await rebuild(q, teamId);
      expect(await heroic(q, teamId)).toEqual([2, '2026-09-14', null, 'logB', 2]);
    });
  });

  it('never lets a log a few seconds off swallow the next pull, across three logs', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      // CodeRabbit on PR #1940: A's wipe (20-120 s) is B's wipe (0-100 s);
      // C holds only the next pull, a kill (110-210 s). Two pulls.
      await report(q, teamId, 'logA', '2026-09-14');
      await report(q, teamId, 'logB', '2026-09-14');
      await report(q, teamId, 'logC', '2026-09-14');
      await pull(q, teamId, 'logA', 1, false, 30, 20, 120);
      await pull(q, teamId, 'logB', 1, false, 30, 0, 100);
      await pull(q, teamId, 'logC', 1, true, 0, 110, 210);
      await rebuild(q, teamId);
      expect(await heroic(q, teamId)).toEqual([2, '2026-09-14', null, 'logC', 1]);
    });
  });

  it('never lets a copy that is itself dropped take a second pull with it', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      // CodeRabbit on PR #1940: A's wipe (30-130 s) is B's wipe (0-100 s), and
      // also covers most of B's short kill right after (105-145 s). Two pulls.
      await report(q, teamId, 'logA', '2026-09-14');
      await report(q, teamId, 'logB', '2026-09-14');
      await pull(q, teamId, 'logA', 1, false, 30, 30, 130);
      await pull(q, teamId, 'logB', 1, false, 30, 0, 100);
      await pull(q, teamId, 'logB', 2, true, 0, 105, 145);
      await rebuild(q, teamId);
      expect(await heroic(q, teamId)).toEqual([2, '2026-09-14', null, 'logB', 2]);
    });
  });

  it('keeps the kill when one log of the pull stopped before it and recorded a wipe', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await report(q, teamId, 'early', '2026-09-14');
      await report(q, teamId, 'whole', '2026-09-14');
      await pull(q, teamId, 'early', 1, false, 3, 0, 200);
      await pull(q, teamId, 'whole', 1, true, 0, 5, 210);
      await rebuild(q, teamId);
      expect(await heroic(q, teamId)).toEqual([1, '2026-09-14', null, 'whole', 1]);
    });
  });

  it('keeps the lowest health a copy of a wipe saw, even when that log is gone', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      // The first log stopped at 40%; the other saw the real 12% (Kat, 2026-11-27).
      await report(q, teamId, 'early', '2026-09-14');
      await report(q, teamId, 'whole', '2026-09-14');
      await pull(q, teamId, 'early', 1, false, 40, 0, 200);
      await pull(q, teamId, 'whole', 1, false, 12, 5, 210);
      await rebuild(q, teamId);
      expect(await heroic(q, teamId)).toEqual([1, null, 12, 'whole', 1]);
      await markMissing(q, teamId, 'whole');
      await rebuild(q, teamId);
      expect(await heroic(q, teamId)).toEqual([1, null, 12, 'whole', 1]);
    });
  });

  it('counts two pulls of one boss that do not overlap as two, across reports', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      // Same night, two logs, different pulls (a minute apart).
      await report(q, teamId, 'first', '2026-09-14');
      await report(q, teamId, 'second', '2026-09-14');
      await fight(q, teamId, 'first', 1, BOSS_TWO, 'heroic', false, 30);
      await fight(q, teamId, 'second', 2, BOSS_TWO, 'heroic', false, 20);
      await rebuild(q, teamId);
      const [row] = (await q(PROGRESS, [teamId])).rows;
      expect(row).toMatchObject({ heroic_pulls: 2, heroic_best_pct: 20, heroic_report_code: 'second' });
    });
  });

  it('keeps a row with no pulls for a boss whose only pulls are alt runs', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await report(q, teamId, 'altRun', '2026-09-13', 'alt');
      await fight(q, teamId, 'altRun', 1, BOSS_ONE, 'mythic', true, 0);
      await rebuild(q, teamId);
      expect((await q(PROGRESS, [teamId])).rows).toEqual([
        {
          ...PINNED[1],
          encounter_id: BOSS_ONE,
          heroic_pulls: 0,
          heroic_report_code: null,
          heroic_fight_id: null,
          heroic_best_pct: null
        }
      ]);
    });
  });

  it('runs for the sync’s service role only', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(
        `select r.rolname, has_function_privilege(r.rolname, 'public.rebuild_team_raid_progress(integer)', 'execute') as ok
           from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by r.rolname`
      );
      expect(rows).toEqual([
        { rolname: 'anon', ok: false },
        { rolname: 'authenticated', ok: false },
        { rolname: 'service_role', ok: true }
      ]);
    });
  });
});

describe('team_raid_fights', () => {
  // #1496: alt runs are in here, so the table is the team's; the public reads
  // its own raids' pulls through team_raid_pulls().
  it('shows a team’s pulls to its raiders, officers and site admins, not to another team or the public', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await seedRaid(q);
      const a = await seedTeam(q);
      const b = await seedTeam(q);
      await seedCorpus(q, a.teamId);
      const count = async (rows) => (await rows).rows.length;
      const READ = 'select report_code from public.team_raid_fights where team_id = $1';
      // A member of the team with no character on its roster yet reads nothing.
      expect(await count(asUser(a.raider.uid, READ, [a.teamId]))).toBe(0);
      await seedPlayer(q, { memberId: a.raider.memberId });
      expect(await count(asUser(a.raider.uid, READ, [a.teamId]))).toBe(5);
      expect(await count(asUser(a.officer.uid, READ, [a.teamId]))).toBe(5);
      expect(await count(asUser(SITE_ADMIN, READ, [a.teamId]))).toBe(5);
      expect(await count(asUser(b.officer.uid, READ, [a.teamId]))).toBe(0);
      expect(await count(asAnon(READ, [a.teamId]))).toBe(0);
    });
  });

  it('grants the site roles reading only, the sync inserting and rewriting, and nobody deleting', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(
        `select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
           from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'team_raid_fights'
            and grantee in ('anon', 'authenticated', 'service_role')
          group by grantee order by grantee`
      );
      expect(rows).toEqual([
        { grantee: 'anon', privileges: 'SELECT' },
        { grantee: 'authenticated', privileges: 'SELECT' },
        { grantee: 'service_role', privileges: 'INSERT,SELECT,UPDATE' }
      ]);
    });
  });

  it('goes with its report', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId);
      await q(`delete from public.team_raid_reports where team_id = $1 and report_code = 'reportA'`, [teamId]);
      const { rows } = await q('select count(*)::int as n from public.team_raid_fights where team_id = $1', [teamId]);
      expect(rows[0].n).toBe(2);
    });
  });
});

describe('team_raid_pulls() (#1496)', () => {
  const PULLS = `select report_code, fight_id, difficulty, raid_date::text, boss_percentage::float as boss_percentage, kill,
                        last_phase, last_phase_is_intermission
                   from public.team_raid_pulls($1, $2)`;

  it('gives anyone, signed in or not, the team’s own raids’ pulls of one boss, alt runs left out', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await seedRaid(q);
      const a = await seedTeam(q);
      const b = await seedTeam(q);
      await seedCorpus(q, a.teamId, 'alt');
      await q(
        `update public.team_raid_fights set last_phase = 2, last_phase_is_intermission = true
          where team_id = $1 and report_code = 'reportA' and fight_id = 1`,
        [a.teamId]
      );
      const expected = [
        {
          report_code: 'reportA',
          fight_id: 1,
          difficulty: 'mythic',
          raid_date: '2026-09-14',
          boss_percentage: 42.5,
          kill: false,
          last_phase: 2,
          last_phase_is_intermission: true
        },
        {
          report_code: 'reportA',
          fight_id: 2,
          difficulty: 'mythic',
          raid_date: '2026-09-14',
          boss_percentage: 0,
          kill: true,
          last_phase: null,
          last_phase_is_intermission: null
        }
      ];
      expect((await asAnon(PULLS, [a.teamId, BOSS_ONE])).rows).toEqual(expected);
      expect((await asUser(b.officer.uid, PULLS, [a.teamId, BOSS_ONE])).rows).toEqual(expected);
      expect((await asUser(a.officer.uid, PULLS, [a.teamId, BOSS_ONE])).rows).toEqual(expected);
    });
  });

  it('follows an officer’s choice each way', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId, 'alt');
      await q(
        `update public.team_raid_reports set kind_override = 'alt', kind_override_at = now()
          where team_id = $1 and report_code = 'reportA'`,
        [teamId]
      );
      await q(
        `update public.team_raid_reports set kind_override = 'main', kind_override_at = now()
          where team_id = $1 and report_code = 'reportB'`,
        [teamId]
      );
      const rows = (await asAnon(PULLS, [teamId, BOSS_ONE])).rows;
      expect(rows.map((r) => [r.report_code, r.fight_id])).toEqual([['reportB', 1]]);
    });
  });

  it('gives a pull two raiders logged once, as the progression card counts it', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId);
      // A second log of report A's night: the same two Mythic pulls.
      await report(q, teamId, 'reportC', '2026-09-14');
      await fight(q, teamId, 'reportC', 1, BOSS_ONE, 'mythic', false, 42.5);
      await fight(q, teamId, 'reportC', 2, BOSS_ONE, 'mythic', true, 0);
      await rebuild(q, teamId);
      const rows = (await asAnon(PULLS, [teamId, BOSS_ONE])).rows;
      const card = (await q(PROGRESS, [teamId])).rows.find((r) => r.encounter_id === BOSS_ONE);
      expect(rows.length).toBe(3);
      expect(rows.length).toBe(card.mythic_pulls);
    });
  });

  // CodeRabbit on PR #1946: the rebuild runs as its caller, the sync's service
  // role, and reads the shared matching, so that role must be able to run it.
  it('lets the sync’s service role rebuild the card through the shared matching', async () => {
    await withTxn(async ({ q }) => {
      await seedRaid(q);
      const { teamId } = await seedTeam(q);
      await seedCorpus(q, teamId);
      await q('set local role service_role');
      await q('select public.rebuild_team_raid_progress($1)', [teamId]);
      await q('reset role');
      expect((await q(PROGRESS, [teamId])).rows).toEqual(PINNED);
    });
  });

  it('is callable by anyone on the site, and the matching it shares with the rebuild only by the sync', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(
        `select r.rolname,
                has_function_privilege(r.rolname, 'public.team_raid_pulls(integer, integer)', 'execute') as pulls,
                has_function_privilege(r.rolname, 'public.team_main_pulls(integer)', 'execute') as matching
           from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') order by r.rolname`
      );
      expect(rows).toEqual([
        { rolname: 'anon', pulls: true, matching: false },
        { rolname: 'authenticated', pulls: true, matching: false },
        { rolname: 'service_role', pulls: false, matching: true }
      ]);
    });
  });
});
