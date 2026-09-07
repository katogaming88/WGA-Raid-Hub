// Behavior tests for officer_set_rotator_week() (#924, part of #640): the
// officer-driven week-level counterpart to set_own_rsvp() for Rotator roster
// status. Recomputes the raid nights in the target week the same way
// js/calendar.js's computeRaidNights() does client-side (raid_schedule's
// active weekday rule, minus a 'cancelled' exception, plus an 'added' one)
// and fans out into one 'Rotator-In' raid_rsvps row per night. Same
// withTxn/savepoint harness as tests/rls/raid-rsvps.test.js.
import { describe, it, expect } from 'vitest';
import { pool, RAIDER_T1, OFFICER_T1, OFFICER_T2 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint rotator_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint rotator_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    return await fn({ q, asUser });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

async function seedRotator(q, { id, isRotator = true } = {}) {
  const specId = await q(
    "insert into public.classes_specs (class, spec, role) values ('Seed', $1, 'Ranged') returning id",
    [`RotatorSpec${id}`]
  );
  await q(
    'insert into public.players (id, team_id, name_realm, class_spec_id, is_rotator) values ($1, 1, $2, $3, $4)',
    [id, `Rotatorplayer${id}-Illidan`, specId.rows[0].id, isRotator]
  );
}

const setWeek = (asUser, uid, teamId, playerId, weekStart, isIn) =>
  asUser(uid, 'select * from public.officer_set_rotator_week($1, $2, $3, $4)', [teamId, playerId, weekStart, isIn]);

describe('officer_set_rotator_week()', () => {
  it('inserts a Rotator-In row for every raid night in the week', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 301 });
      // Thursday = weekday 4. 2026-09-10 is a Thursday, inside the week
      // starting Sunday 2026-09-06.
      await q("insert into public.raid_schedule (team_id, weekday, start_time) values (1, 4, '20:00')");
      await setWeek(asUser, OFFICER_T1, 1, 301, '2026-09-06', true);
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and player_id = 301 order by raid_date'))
        .rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].raid_date.toISOString().slice(0, 10)).toBe('2026-09-10');
      expect(rows[0].status).toBe('Rotator-In');
    });
  });

  it('covers multiple recurring nights in the same week', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 302 });
      // Tuesday = 2, Thursday = 4.
      await q(
        "insert into public.raid_schedule (team_id, weekday, start_time) values (1, 2, '20:00'), (1, 4, '20:00')"
      );
      await setWeek(asUser, OFFICER_T1, 1, 302, '2026-09-06', true);
      const rows = (
        await q('select raid_date from public.raid_rsvps where team_id = 1 and player_id = 302 order by raid_date')
      ).rows;
      expect(rows.map((r) => r.raid_date.toISOString().slice(0, 10))).toEqual(['2026-09-08', '2026-09-10']);
    });
  });

  it('a cancelled exception excludes that recurring night', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 303 });
      await q("insert into public.raid_schedule (team_id, weekday, start_time) values (1, 4, '20:00')");
      await q(
        "insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type) values (1, '2026-09-10', 'cancelled')"
      );
      await setWeek(asUser, OFFICER_T1, 1, 303, '2026-09-06', true);
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and player_id = 303')).rows;
      expect(rows).toHaveLength(0);
    });
  });

  it('an added exception includes an extra night', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 304 });
      // Monday 2026-09-07, no recurring rule that day.
      await q(
        "insert into public.raid_schedule_exceptions (team_id, raid_date, exception_type, start_time) values (1, '2026-09-07', 'added', '20:00')"
      );
      await setWeek(asUser, OFFICER_T1, 1, 304, '2026-09-06', true);
      const rows = (await q('select raid_date from public.raid_rsvps where team_id = 1 and player_id = 304')).rows;
      expect(rows.map((r) => r.raid_date.toISOString().slice(0, 10))).toEqual(['2026-09-07']);
    });
  });

  it('p_in = false clears an existing Rotator-In assignment for the week', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 305 });
      await q("insert into public.raid_schedule (team_id, weekday, start_time) values (1, 4, '20:00')");
      await setWeek(asUser, OFFICER_T1, 1, 305, '2026-09-06', true);
      await setWeek(asUser, OFFICER_T1, 1, 305, '2026-09-06', false);
      const rows = (await q('select * from public.raid_rsvps where team_id = 1 and player_id = 305')).rows;
      expect(rows).toHaveLength(0);
    });
  });

  it('rejects a player who is not flagged as a rotator', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 306, isRotator: false });
      await expect(setWeek(asUser, OFFICER_T1, 1, 306, '2026-09-06', true)).rejects.toThrow(/not a rotator/);
    });
  });

  it('rejects a caller who is not an officer/team_leader on that team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 307 });
      await expect(setWeek(asUser, RAIDER_T1, 1, 307, '2026-09-06', true)).rejects.toThrow(/Not authorized/);
    });
  });

  it('rejects an officer on a different team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRotator(q, { id: 308 });
      await expect(setWeek(asUser, OFFICER_T2, 1, 308, '2026-09-06', true)).rejects.toThrow(/Not authorized/);
    });
  });
});
