// Behavior tests for submit_season_signup() (#403), the only write path into
// season_signups. Lives in the RLS suite because it is SECURITY DEFINER and
// its authorization is auth.uid()-shaped rather than table-policy-shaped.
//
// Written for #1020. Two migrations define this function a day apart and sort
// in the opposite order to the one they were written in, so a database rebuilt
// from supabase/migrations/ ends on the older definition: it records auth.uid()
// only when one happens to be present, where production raises without a
// session. The first case below is the one that separates them; the rest are
// controls that hold on either definition.
//
// Uses the shared withTxn from helpers.js: each test runs in one rolled-back
// transaction, fixture writes happen as postgres, the RPC call happens as the
// impersonated caller, and assertions happen back as postgres.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, SIGNUP_OWNER_T1, RLS_DENIED } from './helpers.js';

// supabase/seed.sql gives team 1 an activeSignupSeason and no signupsOpen key,
// so the flag is set per test rather than assumed.
const openSignups = (q) =>
  q(`update public.team_settings set config = config || '{"signupsOpen":true}'::jsonb where team_id = 1`);

// classes_specs id 1 is the only seeded row (Mage/Frost).
const submit = (asCaller, uid, overrides = {}) => {
  const p = {
    p_team_id: 1,
    p_name_realm: 'Newsignup-Illidan',
    p_class: 'Mage',
    p_spec: 'Frost',
    ...overrides
  };
  const sql = 'select public.submit_season_signup($1, $2, $3, $4) as id';
  const params = [p.p_team_id, p.p_name_realm, p.p_class, p.p_spec];
  return uid === undefined ? asCaller(sql, params) : asCaller(uid, sql, params);
};

describe('submit_season_signup', () => {
  it('raises when the caller has no session, instead of inserting an unowned row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      // An authenticated role with no sub claim: auth.uid() is null.
      await expect(submit(asUser, null)).rejects.toThrow(/Not signed in/);
      const { rows } = await q(
        "select count(*)::int as n from public.season_signups where signup_name_realm = 'Newsignup-Illidan'"
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('a signed-in caller inserts a pending signup owned by them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const res = await submit(asUser, SIGNUP_OWNER_T1);
      const signup = (await q('select * from public.season_signups where id = $1', [res.rows[0].id])).rows[0];
      expect(signup.auth_user_id).toBe(SIGNUP_OWNER_T1);
      expect(signup.status).toBe('pending');
      expect(signup.season).toBe('seed-season');
      expect(signup.class_spec_id).toBe(1);
      expect(signup.signup_name_realm).toBe('Newsignup-Illidan');
    });
  });

  it('anon cannot execute the function at all (no grant)', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await openSignups(q);
      await expect(submit(asAnon, undefined)).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it("raises when the team's signups are closed", async () => {
    await withTxn(async ({ asUser }) => {
      await expect(submit(asUser, SIGNUP_OWNER_T1)).rejects.toThrow(/signups are not open/);
    });
  });

  it('raises on a class/spec that does not exist', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      await expect(submit(asUser, SIGNUP_OWNER_T1, { p_spec: 'Nope' })).rejects.toThrow(/unknown class\/spec/);
    });
  });
});

afterAll(() => pool.end());
