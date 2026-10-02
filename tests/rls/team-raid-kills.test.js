// team_raid_kills (#1246): every boss kill the progression sync reads, one row
// per fight, beside team_raid_progress's first kill per boss. The team's
// raiders and officers read them; only the sync's service role writes.
// team_raid_kills_this_week answers which bosses are down since the Tuesday
// reset, and lockout_week_start() is that Tuesday.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedPlayer,
  RAIDER_T1,
  RAIDER_T2,
  OFFICER_T1,
  OFFICER_T2,
  GUILD_OFFICER,
  SITE_ADMIN,
  RLS_DENIED
} from './helpers.js';

afterAll(() => pool.end());

// p1 is RAIDER_T1's player on team 1 (team_members 3), p6 is RAIDER_T2's on
// team 2 (13). Two bosses of a raid in the open season.
async function seed(q) {
  const p1 = await seedPlayer(q, { memberId: 3 });
  const p6 = await seedPlayer(q, { memberId: 13 });
  await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
           values (9001, 99001, 'Test Raid', 'MID2', 0)`);
  await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
           values (9101, 9001, 99101, 'Second Boss', 2), (9102, 9001, 99102, 'First Boss', 1)`);
  return { p1, p6 };
}

const FIRST = 9102;
const SECOND = 9101;

// A report starts at 20:00 Eastern on its raid date unless a case says otherwise.
const kill = (q, { team = 1, encounter = FIRST, difficulty = 'mythic', report, fight = 1, date, started = null }) =>
  q(
    `insert into public.team_raid_kills
       (team_id, encounter_id, difficulty, report_code, fight_id, raid_date, report_started_at)
     values ($1, $2, $3, $4, $5, $6,
             coalesce($7::timestamptz, ($6::date + time '20:00') at time zone 'America/New_York'))`,
    [team, encounter, difficulty, report, fight, date, started]
  );

const KILLS = 'select team_id, report_code from public.team_raid_kills order by team_id, report_code';

describe('team_raid_kills', () => {
  const teams = async (asUser, uid) =>
    (await asUser(uid, 'select distinct team_id from public.team_raid_kills order by team_id')).rows.map(
      (r) => r.team_id
    );

  it('shows each team’s kills to its own raiders and officers, and every team’s to guild officers and site admins', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await kill(q, { team: 1, report: 'r1', date: '2026-09-29' });
      await kill(q, { team: 2, report: 'r2', date: '2026-09-29' });
      expect(await teams(asUser, RAIDER_T1)).toEqual([1]);
      expect(await teams(asUser, OFFICER_T1)).toEqual([1]);
      expect(await teams(asUser, RAIDER_T2)).toEqual([2]);
      expect(await teams(asUser, OFFICER_T2)).toEqual([2]);
      expect(await teams(asUser, GUILD_OFFICER)).toEqual([1, 2]);
      expect(await teams(asUser, SITE_ADMIN)).toEqual([1, 2]);
    });
  });

  it('hides them from a raider who has left the team, and from signed-out visitors', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { p1 } = await seed(q);
      await kill(q, { team: 1, report: 'r1', date: '2026-09-29' });
      await q('update public.players set archived_at = now() where id = $1', [p1]);
      expect(await teams(asUser, RAIDER_T1)).toEqual([]);
      expect((await asAnon('select * from public.team_raid_kills')).rows).toHaveLength(0);
    });
  });

  // No write policy: an insert is refused, and an update or delete matches no row.
  it('refuses direct writes, officers included; the sync writes them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await kill(q, { team: 1, report: 'r1', date: '2026-09-29' });
      await expect(
        asUser(
          OFFICER_T1,
          `insert into public.team_raid_kills (team_id, encounter_id, difficulty, report_code, fight_id, raid_date)
           values (1, $1, 'mythic', 'forged', 1, '2026-09-29')`,
          [FIRST]
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
      const updated = await asUser(OFFICER_T1, "update public.team_raid_kills set report_code = 'x'");
      const deleted = await asUser(OFFICER_T1, 'delete from public.team_raid_kills');
      expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
      expect((await q(KILLS)).rows).toEqual([{ team_id: 1, report_code: 'r1' }]);
    });
  });

  // The sync re-reads every report on every run; its upsert skips a fight already kept.
  it('keeps one row per fight when the sync sends it again', async () => {
    await withTxn(async ({ q }) => {
      await seed(q);
      const upsert = `insert into public.team_raid_kills (team_id, encounter_id, difficulty, report_code, fight_id, raid_date)
                      values (1, $1, 'mythic', 'r1', 7, '2026-09-29')
                      on conflict (team_id, report_code, fight_id) do nothing`;
      await q(upsert, [FIRST]);
      await q(upsert, [FIRST]);
      expect((await q(KILLS)).rows).toEqual([{ team_id: 1, report_code: 'r1' }]);
    });
  });

  it('refuses a difficulty other than Heroic or Mythic', async () => {
    await withTxn(async ({ q }) => {
      await seed(q);
      await expect(kill(q, { report: 'r1', difficulty: 'normal', date: '2026-09-29' })).rejects.toMatchObject({
        constraint: 'team_raid_kills_difficulty_check'
      });
    });
  });
});

describe('lockout_week_start()', () => {
  it('is the Tuesday on or before a raid date', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        `select d::text as day, public.lockout_week_start(d)::text as week
           from unnest('{2026-09-28,2026-09-29,2026-09-30,2026-10-04}'::date[]) d`
      );
      expect(res.rows).toEqual([
        { day: '2026-09-28', week: '2026-09-22' },
        { day: '2026-09-29', week: '2026-09-29' },
        { day: '2026-09-30', week: '2026-09-29' },
        { day: '2026-10-04', week: '2026-09-29' }
      ]);
    });
  });
});

// The lockout an instant falls in turns over at the reset, Tuesday 15:00 UTC,
// not at midnight: a Monday raid still pulling at 00:30 Tuesday Eastern is in
// the old week, and so is the morning before the servers come back.
describe('lockout_start_at()', () => {
  it('turns over at the Tuesday reset', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        `select at::text as at, public.lockout_start_at(at)::text as week
           from unnest('{2026-09-29 04:30+00,2026-09-29 14:59+00,2026-09-29 15:00+00,2026-10-06 03:00+00}'::timestamptz[]) at
          order by at`
      );
      expect(res.rows.map((r) => r.week)).toEqual(['2026-09-22', '2026-09-22', '2026-09-29', '2026-09-29']);
    });
  });
});

describe('team_raid_kills_this_week', () => {
  const WEEK = `select encounter_id, encounter_name, difficulty, raid_date::text, report_code, fight_id
                  from public.team_raid_kills_this_week order by encounter_id, difficulty`;

  // This lockout's Tuesday, the Thursday after it and the Monday before the reset.
  async function days(q) {
    const res = await q(
      `select public.lockout_start_at(now())::text as tue,
              (public.lockout_start_at(now()) + 2)::text as thu,
              (public.lockout_start_at(now()) - 1)::text as last_monday`
    );
    return res.rows[0];
  }

  // Reports arrive newest first, and two logs of one night share a raid date:
  // the week's first kill is the one from the earlier report.
  it('names the earliest report’s kill as the week’s first, whatever order they arrive in', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      const { tue } = await days(q);
      const at = (hhmm) => q(`select (($1::date + $2::time) at time zone 'America/New_York')::text as t`, [tue, hhmm]);
      const late = (await at('22:00')).rows[0].t;
      const early = (await at('20:30')).rows[0].t;
      await kill(q, { report: 'late', fight: 1, date: tue, started: late });
      await kill(q, { report: 'early', fight: 9, date: tue, started: early });
      const rows = (await asUser(OFFICER_T1, WEEK)).rows;
      expect(rows.map((r) => [r.report_code, r.fight_id])).toEqual([['early', 9]]);
    });
  });

  // First Boss goes down on Heroic and then Mythic on Tuesday, and on Mythic
  // again on Thursday: two rows for it, each from Tuesday.
  it('lists each boss killed since the reset once per difficulty, from its first kill', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      const { tue, thu, last_monday } = await days(q);
      await kill(q, { encounter: FIRST, difficulty: 'heroic', report: 'r1', fight: 2, date: tue });
      await kill(q, { encounter: FIRST, difficulty: 'mythic', report: 'r1', fight: 3, date: tue });
      await kill(q, { encounter: FIRST, difficulty: 'mythic', report: 'r2', fight: 5, date: thu });
      await kill(q, { encounter: FIRST, difficulty: 'heroic', report: 'r0', fight: 2, date: last_monday });
      await kill(q, { encounter: SECOND, difficulty: 'heroic', report: 'r1', fight: 4, date: tue });
      await kill(q, { team: 2, encounter: SECOND, difficulty: 'mythic', report: 'r9', fight: 1, date: tue });
      const first = { encounter_id: FIRST, encounter_name: 'First Boss', raid_date: tue, report_code: 'r1' };
      expect((await asUser(OFFICER_T1, WEEK)).rows).toEqual([
        {
          encounter_id: SECOND,
          encounter_name: 'Second Boss',
          difficulty: 'heroic',
          raid_date: tue,
          report_code: 'r1',
          fight_id: 4
        },
        { ...first, difficulty: 'heroic', fight_id: 2 },
        { ...first, difficulty: 'mythic', fight_id: 3 }
      ]);
      expect((await asUser(RAIDER_T1, WEEK)).rows).toHaveLength(3);
    });
  });

  it('answers a signed-out visitor with no rows, not an error', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await seed(q);
      const { tue } = await days(q);
      await kill(q, { report: 'r1', date: tue });
      expect((await asAnon(WEEK)).rows).toEqual([]);
    });
  });
});
