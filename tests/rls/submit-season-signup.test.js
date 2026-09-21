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
// Since #934 the tier is the raider's pick (p_season, a seasons.code) and the
// gate is the team's team_seasons row for that tier (#939): no row means
// closed, and the seed carries none, so each case opens its own. No config
// key is read. Passed as null, the function takes the team's one open tier,
// which is what a browser still on the bundle before #934 asks for during
// the deploy window, and refuses when none or several are open.
//
// Uses the shared withTxn from helpers.js: each test runs in one rolled-back
// transaction, fixture writes happen as postgres, the RPC call happens as the
// impersonated caller, and assertions happen back as postgres.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedSeason, SIGNUP_OWNER_T1, RLS_DENIED } from './helpers.js';

const openSignups = (q, season = 'seed-season', open = true) =>
  q('insert into public.team_seasons (team_id, season_code, signups_open) values (1, $1, $2)', [season, open]);

// classes_specs id 1 is the only seeded row (Mage/Frost). p_season rides as a
// named argument so the positional defaults between it and p_spec stay put.
const submit = (asCaller, uid, overrides = {}) => {
  const p = {
    p_team_id: 1,
    p_name_realm: 'Newsignup-Illidan',
    p_class: 'Mage',
    p_spec: 'Frost',
    p_season: 'seed-season',
    ...overrides
  };
  const sql = 'select public.submit_season_signup($1, $2, $3, $4, p_season => $5) as id';
  const params = [p.p_team_id, p.p_name_realm, p.p_class, p.p_spec, p.p_season];
  return uid === undefined ? asCaller(sql, params) : asCaller(uid, sql, params);
};

const seasonOf = async (q, id) =>
  (await q('select season from public.season_signups where id = $1', [id])).rows[0].season;

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

  it('a signed-in caller inserts a pending signup owned by them, stamped with the tier they picked', async () => {
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

  it("raises when the team's signups are closed for that tier: no row, or a row with the switch off", async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(submit(asUser, SIGNUP_OWNER_T1)).rejects.toThrow(/signups are not open/);
      await openSignups(q, 'seed-season', false);
      await expect(submit(asUser, SIGNUP_OWNER_T1)).rejects.toThrow(/signups are not open/);
    });
  });

  it('raises for a tier the team has not opened, even with another tier open, and for a code that is no season', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      await seedSeason(q, 'signup-other-tier');
      await expect(submit(asUser, SIGNUP_OWNER_T1, { p_season: 'signup-other-tier' })).rejects.toThrow(
        /signups are not open/
      );
      await expect(submit(asUser, SIGNUP_OWNER_T1, { p_season: 'MIDX' })).rejects.toThrow(/signups are not open/);
    });
  });

  it("refuses the tier's display name where its code belongs, and stamps the code", async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedSeason(q, 'signup-code-tier', 'Signup Name Tier');
      await openSignups(q, 'signup-code-tier');
      await expect(submit(asUser, SIGNUP_OWNER_T1, { p_season: 'Signup Name Tier' })).rejects.toThrow(
        /signups are not open/
      );
      const res = await submit(asUser, SIGNUP_OWNER_T1, { p_season: 'signup-code-tier' });
      expect(await seasonOf(q, res.rows[0].id)).toBe('signup-code-tier');
    });
  });

  it('with no tier passed, takes the one tier the team has open', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const res = await submit(asUser, SIGNUP_OWNER_T1, { p_season: null });
      expect(await seasonOf(q, res.rows[0].id)).toBe('seed-season');
    });
  });

  it('with no tier passed, refuses when none is open and when more than one is', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(submit(asUser, SIGNUP_OWNER_T1, { p_season: null })).rejects.toThrow(/signups are not open/);
      await openSignups(q);
      await seedSeason(q, 'signup-second-tier');
      await openSignups(q, 'signup-second-tier');
      await expect(submit(asUser, SIGNUP_OWNER_T1, { p_season: null })).rejects.toThrow(/pick one/);
    });
  });

  it('reads no team_settings key: an empty config with the row open still accepts', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      await q("update public.team_settings set config = '{}'::jsonb where team_id = 1");
      const res = await submit(asUser, SIGNUP_OWNER_T1);
      expect(await seasonOf(q, res.rows[0].id)).toBe('seed-season');
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
