// set_team_season() and the team_seasons table it writes (#939): a team's two
// switches, signups open and wishlist editing open, one row per team and tier.
// No row means both closed, so the seed carries none and every case mints its
// own. The gate is the one team_settings' write policy admits today: the
// team's leader and site admins.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  RAIDER_T1,
  OFFICER_T1,
  TEAM_LEADER_T1,
  TEAM_LEADER_T2,
  SITE_ADMIN,
  RLS_DENIED
} from './helpers.js';

const set = (asUser, uid, signups, wishlist, team = 1, season = 'seed-season') =>
  asUser(uid, 'select public.set_team_season($1, $2, $3, $4)', [team, season, signups, wishlist]);

const rowsOf = async (q, team = 1) =>
  (
    await q(
      'select season_code, signups_open, wishlist_open from public.team_seasons where team_id = $1 order by season_code',
      [team]
    )
  ).rows;

const auditOf = async (q) =>
  (await q("select action, detail from public.audit_log where target_type = 'team_seasons' order by id")).rows;

describe('set_team_season()', () => {
  it('lets the team leader make the tier’s row on the first call, and a null switch keeps the other', async () => {
    await withTxn(async ({ q, asUser }) => {
      expect(await rowsOf(q)).toEqual([]);
      await set(asUser, TEAM_LEADER_T1, true, null);
      expect(await rowsOf(q)).toEqual([{ season_code: 'seed-season', signups_open: true, wishlist_open: false }]);
      await set(asUser, TEAM_LEADER_T1, null, true);
      expect(await rowsOf(q)).toEqual([{ season_code: 'seed-season', signups_open: true, wishlist_open: true }]);
      await set(asUser, TEAM_LEADER_T1, false, null);
      expect(await rowsOf(q)).toEqual([{ season_code: 'seed-season', signups_open: false, wishlist_open: true }]);
    });
  });

  it('lets a site admin set any team’s switches', async () => {
    await withTxn(async ({ q, asUser }) => {
      await set(asUser, SITE_ADMIN, null, true, 2);
      expect(await rowsOf(q, 2)).toEqual([{ season_code: 'seed-season', signups_open: false, wishlist_open: true }]);
    });
  });

  it('refuses a team officer, a raider, another team’s leader and a caller with no session', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await expect(set(asUser, OFFICER_T1, true, null)).rejects.toThrow(/Not authorized/);
      await expect(set(asUser, RAIDER_T1, true, null)).rejects.toThrow(/Not authorized/);
      await expect(set(asUser, TEAM_LEADER_T2, true, null)).rejects.toThrow(/Not authorized/);
      await expect(set(asUser, null, true, null)).rejects.toThrow(/Not signed in/);
      await expect(asAnon('select public.set_team_season(1, $1, true, null)', ['seed-season'])).rejects.toMatchObject({
        code: RLS_DENIED
      });
      expect(await rowsOf(q)).toEqual([]);
    });
  });

  it('refuses a tier that is not in seasons', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(set(asUser, TEAM_LEADER_T1, true, null, 1, 'MID9')).rejects.toThrow(/not a season/);
      expect(await rowsOf(q)).toEqual([]);
    });
  });

  it('writes one audit entry per accepted call, named the way the site named them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await set(asUser, TEAM_LEADER_T1, true, null);
      await set(asUser, TEAM_LEADER_T1, null, true);
      await set(asUser, TEAM_LEADER_T1, null, false);
      await set(asUser, TEAM_LEADER_T1, false, null);
      expect(await auditOf(q)).toEqual([
        { action: 'Signups Opened', detail: { season: 'seed-season' } },
        { action: 'Wishlist Editing Opened', detail: { season: 'seed-season' } },
        { action: 'Wishlist Editing Closed', detail: { season: 'seed-season' } },
        { action: 'Signups Closed', detail: { season: 'seed-season' } }
      ]);
    });
  });
});

describe('team_seasons', () => {
  it('is readable by anyone and written by nobody through the API roles', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await set(asUser, TEAM_LEADER_T1, true, true);
      const anon = await asAnon('select team_id, season_code, signups_open from public.team_seasons');
      expect(anon.rows).toEqual([{ team_id: 1, season_code: 'seed-season', signups_open: true }]);
      const raider = await asUser(RAIDER_T1, 'select wishlist_open from public.team_seasons where team_id = 1');
      expect(raider.rows).toEqual([{ wishlist_open: true }]);
      const insert =
        "insert into public.team_seasons (team_id, season_code, signups_open) values (2, 'seed-season', true)";
      await expect(asUser(TEAM_LEADER_T2, insert)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(SITE_ADMIN, insert)).rejects.toMatchObject({ code: RLS_DENIED });
      const update = 'update public.team_seasons set signups_open = false where team_id = 1';
      expect((await asUser(TEAM_LEADER_T1, update)).rowCount).toBe(0);
      expect(await rowsOf(q)).toEqual([{ season_code: 'seed-season', signups_open: true, wishlist_open: true }]);
    });
  });

  it('holds one row per team and tier', async () => {
    await withTxn(async ({ q }) => {
      await q("insert into public.team_seasons (team_id, season_code) values (1, 'seed-season')");
      await expect(
        q("insert into public.team_seasons (team_id, season_code) values (1, 'seed-season')")
      ).rejects.toMatchObject({ constraint: 'team_seasons_team_id_season_code_key' });
    });
  });
});

afterAll(() => pool.end());
