// A raid night's difficulty (#1246). Each weekly rule (raid_schedule) and each
// added night (raid_schedule_exceptions) says heroic or mythic, or null for
// the team default in team_schedule_settings. raid_night_info() resolves it in
// its existing precedence: a cancelled date has none, an added night's own
// value then the default, the weekday rule's own value then the default.
// Officers of the team, guild officers and site admins write the default, as
// they write the schedule; anyone reads it, as anyone reads the schedule.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, OFFICER_T2, RAIDER_T1, GUILD_OFFICER, SITE_ADMIN, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

// 2026-10-06 is a Tuesday (weekday 2), 2026-10-08 a Thursday (4).
const TUESDAY = '2026-10-06';
const THURSDAY = '2026-10-08';

const rule = (q, { weekday = 2, difficulty = null, active = true } = {}) =>
  q(
    `insert into public.raid_schedule (team_id, weekday, start_time, active, difficulty)
     values (1, $1, '21:30', $2, $3)`,
    [weekday, active, difficulty]
  );

const exception = (q, { date, type = 'added', difficulty = null }) =>
  q(
    `insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type, start_time, duration_minutes, difficulty)
     values (1, $1, $2, case when $2 = 'added' then time '21:30' end, case when $2 = 'added' then 180 end, $3)`,
    [date, type, difficulty]
  );

const setDefault = (q, difficulty) =>
  q(
    `insert into public.team_schedule_settings (team_id, default_difficulty) values (1, $1)
     on conflict (team_id) do update set default_difficulty = excluded.default_difficulty`,
    [difficulty]
  );

const difficulty = async (q, date) =>
  (await q('select difficulty from public.raid_night_info(1, $1)', [date])).rows[0].difficulty;

describe('raid_night_info() difficulty', () => {
  it("returns a weekly night's own pick", async () => {
    await withTxn(async ({ q }) => {
      await setDefault(q, 'heroic');
      await rule(q, { difficulty: 'mythic' });
      expect(await difficulty(q, TUESDAY)).toBe('mythic');
    });
  });

  it('returns the team default for a weekly night left at default', async () => {
    await withTxn(async ({ q }) => {
      await setDefault(q, 'mythic');
      await rule(q);
      expect(await difficulty(q, TUESDAY)).toBe('mythic');
    });
  });

  it("returns an added night's own pick over a weekly rule of the other difficulty", async () => {
    await withTxn(async ({ q }) => {
      await rule(q, { difficulty: 'heroic' });
      await exception(q, { date: TUESDAY, difficulty: 'mythic' });
      expect(await difficulty(q, TUESDAY)).toBe('mythic');
    });
  });

  it('returns the team default for an added night left at default, not the weekly rule', async () => {
    await withTxn(async ({ q }) => {
      await setDefault(q, 'heroic');
      await rule(q, { difficulty: 'mythic' });
      await exception(q, { date: TUESDAY });
      expect(await difficulty(q, TUESDAY)).toBe('heroic');
    });
  });

  it('returns null when nothing is set and the team has no default row', async () => {
    await withTxn(async ({ q }) => {
      await rule(q);
      expect(await difficulty(q, TUESDAY)).toBe(null);
    });
  });

  it('returns null for a default row saved as Not set', async () => {
    await withTxn(async ({ q }) => {
      await setDefault(q, null);
      await rule(q);
      expect(await difficulty(q, TUESDAY)).toBe(null);
    });
  });

  it('returns null for a cancelled night, a day with no rule and an inactive rule', async () => {
    await withTxn(async ({ q }) => {
      await setDefault(q, 'mythic');
      await rule(q, { difficulty: 'mythic' });
      await exception(q, { date: TUESDAY, type: 'cancelled', difficulty: 'mythic' });
      await rule(q, { weekday: 5, active: false, difficulty: 'mythic' });
      expect(await difficulty(q, TUESDAY)).toBe(null);
      expect(await difficulty(q, THURSDAY)).toBe(null);
      expect(await difficulty(q, '2026-10-09')).toBe(null);
    });
  });

  it('a new default moves every night left at default and no night set explicitly', async () => {
    await withTxn(async ({ q }) => {
      await setDefault(q, 'heroic');
      await rule(q);
      await rule(q, { weekday: 4, difficulty: 'heroic' });
      await setDefault(q, 'mythic');
      expect(await difficulty(q, TUESDAY)).toBe('mythic');
      expect(await difficulty(q, THURSDAY)).toBe('heroic');
    });
  });

  it('gives a signed-out caller and a raider the same answer as an officer', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await setDefault(q, 'mythic');
      await rule(q);
      const sql = `select difficulty from public.raid_night_info(1, '${TUESDAY}')`;
      expect((await asAnon(sql)).rows[0].difficulty).toBe('mythic');
      expect((await asUser(RAIDER_T1, sql)).rows[0].difficulty).toBe('mythic');
      expect((await asUser(OFFICER_T1, sql)).rows[0].difficulty).toBe('mythic');
    });
  });

  it('refuses a difficulty other than Heroic or Mythic on the rule, the added night and the default', async () => {
    await withTxn(async ({ q }) => {
      await expect(rule(q, { difficulty: 'normal' })).rejects.toMatchObject({
        constraint: 'raid_schedule_difficulty_check'
      });
    });
    await withTxn(async ({ q }) => {
      await expect(exception(q, { date: TUESDAY, difficulty: 'normal' })).rejects.toMatchObject({
        constraint: 'raid_schedule_exceptions_difficulty_check'
      });
    });
    await withTxn(async ({ q }) => {
      await expect(setDefault(q, 'normal')).rejects.toMatchObject({
        constraint: 'team_schedule_settings_default_difficulty_check'
      });
    });
  });
});

describe('team_schedule_settings', () => {
  const SAVE = `insert into public.team_schedule_settings (team_id, default_difficulty) values (1, 'mythic')
                on conflict (team_id) do update set default_difficulty = excluded.default_difficulty`;
  const READ = 'select team_id, default_difficulty from public.team_schedule_settings order by team_id';

  it("is written by the team's officers, guild officers and site admins", async () => {
    for (const uid of [OFFICER_T1, GUILD_OFFICER, SITE_ADMIN]) {
      await withTxn(async ({ q, asUser }) => {
        await asUser(uid, SAVE);
        expect((await q(READ)).rows).toEqual([{ team_id: 1, default_difficulty: 'mythic' }]);
      });
    }
  });

  it("refuses another team's officer and a raider: the insert fails, the update and delete touch nothing", async () => {
    for (const uid of [OFFICER_T2, RAIDER_T1]) {
      await withTxn(async ({ q, asUser }) => {
        await expect(asUser(uid, SAVE)).rejects.toMatchObject({ code: RLS_DENIED });
        await setDefault(q, 'heroic');
        const updated = await asUser(uid, "update public.team_schedule_settings set default_difficulty = 'mythic'");
        const deleted = await asUser(uid, 'delete from public.team_schedule_settings');
        expect([updated.rowCount, deleted.rowCount]).toEqual([0, 0]);
        expect((await q(READ)).rows).toEqual([{ team_id: 1, default_difficulty: 'heroic' }]);
      });
    }
  });

  it('is readable by a signed-out visitor, like the schedule', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await setDefault(q, 'heroic');
      expect((await asAnon(READ)).rows).toEqual([{ team_id: 1, default_difficulty: 'heroic' }]);
    });
  });
});

// raid_night_info()'s return type changed, so the migration drops and creates
// it. The drop takes the function's comment and its grants with it (2026-09-28).
describe('raid_night_info() after the drop and create', () => {
  const FN = "'public.raid_night_info(integer, date)'::regprocedure";

  it('keeps a comment, and it names the difficulty', async () => {
    await withTxn(async ({ q }) => {
      const comment = (await q(`select obj_description(${FN}, 'pg_proc') as c`)).rows[0].c;
      expect(comment).toMatch(/difficulty/);
    });
  });

  // The service role could execute it through PUBLIC alone, so the check reads
  // the grants themselves: PUBLIC's, and the service role's own.
  it('keeps its grants: execute for anyone, and the service role by name', async () => {
    await withTxn(async ({ q }) => {
      const acl = (await q(`select proacl::text[] as acl from pg_proc where oid = ${FN}`)).rows[0].acl;
      expect(acl).toEqual(expect.arrayContaining(['=X/postgres', 'service_role=X/postgres']));
    });
  });
});
