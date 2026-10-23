// Read-path and column-safety assertions for incoming_roster (#499): a
// public view over season_signups' approved rows not yet on the roster, and
// since #1342 their pending ones too, with the status, for the team's own
// members, guild officers and site admins only, narrowed to
// safe columns and scoped to the tiers the team has taken signups for. Since
// #934 that scope is the team's team_seasons row for the row's tier (#939),
// whichever way its switch is now: officers close signups and then push the
// approved rows onto the roster, and the tentative roster stays up across
// that gap. The seed carries no row, so each case makes its own and the
// seeded approved signups surface only then. Each case runs in one
// rolled-back transaction (helpers.js withTxn) so the row and the read share
// a connection; the column cases keep queryAs, which needs no fixture.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, queryAs, seedSeason, RAIDER_T1, RAIDER_T2, GUILD_OFFICER, SITE_ADMIN } from './helpers.js';

const openSignups = (q, team = 1, season = 'seed-season', open = true) =>
  q('insert into public.team_seasons (team_id, season_code, signups_open) values ($1, $2, $3)', [team, season, open]);

const countIncoming = async (asCaller, where) =>
  (await asCaller(`select count(*)::int as n from public.incoming_roster where ${where}`)).rows[0].n;

describe('incoming_roster is visible to everyone, scoped to the tiers the team has taken signups for', () => {
  it('anon sees the seeded approved signup for team 1 once the team has a row for its tier, and not before', async () => {
    await withTxn(async ({ q, asAnon }) => {
      expect(await countIncoming(asAnon, 'team_id = 1')).toBe(0);
      await openSignups(q);
      expect(await countIncoming(asAnon, 'team_id = 1')).toBeGreaterThan(0);
    });
  });

  it('raider sees the seeded approved signup for team 1', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      expect(await countIncoming((text) => asUser(RAIDER_T1, text), 'team_id = 1')).toBeGreaterThan(0);
    });
  });

  // Waiting signups are the team's own business (Kat, 2026-10-23): its
  // members, guild officers and site admins. Approved ones stay public until
  // cutover, for the current site's public roster.
  const pendingSeen = async (asCaller) =>
    (await asCaller("select status from public.incoming_roster where signup_name_realm = 'Seedsignup-Illidan'")).rows;

  it("shows the team's waiting signup to its own raider, marked pending (#1342)", async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      expect(await pendingSeen((text) => asUser(RAIDER_T1, text))).toEqual([{ status: 'pending' }]);
    });
  });

  it('shows it to a guild officer and a site admin', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      expect(await pendingSeen((text) => asUser(GUILD_OFFICER, text))).toHaveLength(1);
      expect(await pendingSeen((text) => asUser(SITE_ADMIN, text))).toHaveLength(1);
    });
  });

  it("hides it from anon and from another team's raider", async () => {
    await withTxn(async ({ q, asAnon, asUser }) => {
      await openSignups(q);
      expect(await pendingSeen(asAnon)).toEqual([]);
      expect(await pendingSeen((text) => asUser(RAIDER_T2, text))).toEqual([]);
    });
  });

  it('team 2 rows are visible too (the view has no team scoping of its own -- callers filter client-side)', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await openSignups(q, 2);
      expect(await countIncoming(asAnon, 'team_id = 2')).toBeGreaterThan(0);
    });
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

describe('incoming_roster respects the row per tier', () => {
  it('a signup on a tier the team has no row for is excluded, appears with the row, and stays when the switch turns off', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await openSignups(q);
      // The tier this case stamps (#932): season_signups.season is a foreign key to seasons.
      await seedSeason(q, 'incoming-roster-other-season');
      await q(
        `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status)
         values (1, 'Otherseason-Illidan', 1, 'incoming-roster-other-season', 'approved')`
      );
      const where = "signup_name_realm = 'Otherseason-Illidan'";
      expect(await countIncoming(asAnon, where)).toBe(0);
      await openSignups(q, 1, 'incoming-roster-other-season');
      expect(await countIncoming(asAnon, where)).toBe(1);
      await q(
        "update public.team_seasons set signups_open = false where team_id = 1 and season_code = 'incoming-roster-other-season'"
      );
      expect(await countIncoming(asAnon, where)).toBe(1);
      await q("delete from public.team_seasons where team_id = 1 and season_code = 'incoming-roster-other-season'");
      expect(await countIncoming(asAnon, where)).toBe(0);
    });
  });

  it('reads no team_settings key: an empty config with the row open still lists the rows', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await openSignups(q);
      await q("update public.team_settings set config = '{}'::jsonb where team_id = 1");
      expect(await countIncoming(asAnon, 'team_id = 1')).toBeGreaterThan(0);
    });
  });
});

afterAll(() => pool.end());
