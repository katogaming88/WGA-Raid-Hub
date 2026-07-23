// Read-path and column-safety assertions for incoming_roster (#499): a
// public view over season_signups' approved-unpromoted rows, narrowed to
// safe columns and scoped to the team's resolved season view (seasonView,
// falling back to seasonName -- #549). Lives alongside
// promotion.test.js/read-matrix.test.js since it needs the live local stack.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, countAs, queryAs, RAIDER_T1 } from './helpers.js';

describe('incoming_roster is visible to everyone, scoped to the active season', () => {
  it('anon sees the seeded approved signup for team 1', async () => {
    expect(await countAs('anon', null, 'incoming_roster', 'team_id = 1')).toBeGreaterThan(0);
  });

  it('raider sees the seeded approved signup for team 1', async () => {
    expect(await countAs('authenticated', RAIDER_T1, 'incoming_roster', 'team_id = 1')).toBeGreaterThan(0);
  });

  it('does not include the still-pending (not-yet-approved) seeded signup', async () => {
    expect(await countAs('anon', null, 'incoming_roster', "signup_name_realm = 'Seedsignup-Illidan'")).toBe(0);
  });

  it('team 2 rows are visible too (the view has no team scoping of its own -- callers filter client-side)', async () => {
    expect(await countAs('anon', null, 'incoming_roster', 'team_id = 2')).toBeGreaterThan(0);
  });
});

describe('incoming_roster excludes officer-only columns', () => {
  it('selecting officer-only columns by name fails', async () => {
    await expect(queryAs('anon', null, 'select player_note from public.incoming_roster limit 1')).rejects.toThrow();
    await expect(
      queryAs('anon', null, 'select signup_officer_note from public.incoming_roster limit 1')
    ).rejects.toThrow();
    await expect(queryAs('anon', null, 'select reviewed_by from public.incoming_roster limit 1')).rejects.toThrow();
  });
});

describe('incoming_roster respects season scoping', () => {
  it('a signup from a season other than the resolved season view is excluded', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status)
         values (1, 'Otherseason-Illidan', 1, 'not-the-active-season', 'approved')`
      );
      const res = await client.query(
        `select count(*)::int as n from public.incoming_roster where signup_name_realm = 'Otherseason-Illidan'`
      );
      expect(res.rows[0].n).toBe(0);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

afterAll(() => pool.end());
