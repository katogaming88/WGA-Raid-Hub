// set_encounter_cap() and set_lineup_role_targets(), and the
// team_lineup_settings table they back (#1244): a boss's cap override is
// guild-wide reference data (raid_encounters has no team of its own), so it
// is gated to guild officers and site admins rather than a team's own
// officers. Role targets are per-team, gated the same way set_boss_group()
// is.
import { describe, it, expect } from 'vitest';
import { withTxn, RAIDER_T1, OFFICER_T1, OFFICER_T2, GUILD_OFFICER, SITE_ADMIN } from './helpers.js';

const FIRST = 9102;

async function seed(q) {
  await q(`insert into public.raid_zones (id, wcl_zone_id, name, season, sort_index)
           values (9001, 99001, 'Test Raid', 'MID2', 0)`);
  await q(`insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name, sort_index)
           values (${FIRST}, 9001, 99102, 'First Boss', 1)`);
}

const setCap = (asUser, uid, cap = null) => asUser(uid, 'select public.set_encounter_cap($1, $2)', [FIRST, cap]);

const setTargets = (asUser, uid, tanks, healers, team = 1) =>
  asUser(uid, 'select public.set_lineup_role_targets($1, $2, $3)', [team, tanks, healers]);

const capOf = async (q) => (await q('select cap from public.raid_encounters where id = $1', [FIRST])).rows[0].cap;

const targetsOf = async (q, team = 1) =>
  (await q('select tanks_wanted, healers_wanted from public.team_lineup_settings where team_id = $1', [team])).rows[0];

describe('set_encounter_cap()', () => {
  it('lets a guild officer or a site admin set a boss cap, and clear it', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setCap(asUser, GUILD_OFFICER, 25);
      expect(await capOf(q)).toBe(25);
      await setCap(asUser, SITE_ADMIN, null);
      expect(await capOf(q)).toBeNull();
    });
  });

  it('refuses a team officer, a team leader and a raider -- there is no team to check', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(setCap(asUser, OFFICER_T1, 25)).rejects.toMatchObject({ message: /Not authorized/ });
      await expect(setCap(asUser, RAIDER_T1, 25)).rejects.toMatchObject({ message: /Not authorized/ });
      expect(await capOf(q)).toBeNull();
    });
  });

  it('refuses a cap outside 1 to 30, and a boss that does not exist', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await expect(setCap(asUser, GUILD_OFFICER, 0)).rejects.toMatchObject({ message: /between 1 and 30/ });
      await expect(setCap(asUser, GUILD_OFFICER, 31)).rejects.toMatchObject({ message: /between 1 and 30/ });
      await expect(asUser(GUILD_OFFICER, 'select public.set_encounter_cap(999999, 20)')).rejects.toMatchObject({
        message: /not in the raid list/
      });
    });
  });

  it('writes an audit entry with no team (guild-wide)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seed(q);
      await setCap(asUser, GUILD_OFFICER, 25);
      const row = (
        await q("select team_id, action, target_id, detail from public.audit_log where action = 'Set Boss Cap'")
      ).rows[0];
      expect(row.team_id).toBeNull();
      expect(row.target_id).toBe(FIRST);
      expect(row.detail).toEqual({ cap: 25 });
    });
  });

  it('is unauthenticated to anon, and a direct update touches no row', async () => {
    await withTxn(async ({ q, asAnon, asUser }) => {
      await seed(q);
      await expect(asAnon('select public.set_encounter_cap($1, $2)', [FIRST, 25])).rejects.toMatchObject({
        message: /Not signed in/
      });
      // raid_encounters carries no policy for UPDATE, only SELECT: Postgres's
      // default-deny for the command leaves the WHERE clause matching
      // nothing, so the statement succeeds and changes zero rows rather than
      // raising (the same shape as an INSERT's WITH CHECK failure, which does
      // raise -- see boss-lineups.test.js's 'refuses direct writes').
      const result = await asUser(GUILD_OFFICER, 'update public.raid_encounters set cap = 25 where id = $1', [FIRST]);
      expect(result.rowCount).toBe(0);
      expect(await capOf(q)).toBeNull();
    });
  });
});

describe('set_lineup_role_targets()', () => {
  it('lets the team’s own officer set its role targets, upserting the first time', async () => {
    await withTxn(async ({ q, asUser }) => {
      await setTargets(asUser, OFFICER_T1, 3, 5);
      expect(await targetsOf(q)).toEqual({ tanks_wanted: 3, healers_wanted: 5 });
      await setTargets(asUser, OFFICER_T1, 2, 4);
      expect(await targetsOf(q)).toEqual({ tanks_wanted: 2, healers_wanted: 4 });
    });
  });

  it('lets a guild officer or a site admin set another team’s targets', async () => {
    await withTxn(async ({ q, asUser }) => {
      await setTargets(asUser, GUILD_OFFICER, 3, 6);
      expect(await targetsOf(q)).toEqual({ tanks_wanted: 3, healers_wanted: 6 });
      await setTargets(asUser, SITE_ADMIN, 2, 4);
      expect(await targetsOf(q)).toEqual({ tanks_wanted: 2, healers_wanted: 4 });
    });
  });

  it('refuses another team’s officer and a raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(setTargets(asUser, OFFICER_T2, 3, 5)).rejects.toMatchObject({ message: /Not authorized/ });
      await expect(setTargets(asUser, RAIDER_T1, 3, 5)).rejects.toMatchObject({ message: /Not authorized/ });
      const rows = (await q('select 1 from public.team_lineup_settings where team_id = 1')).rows;
      expect(rows).toHaveLength(0);
    });
  });

  it('refuses a target outside 0 to 20', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(setTargets(asUser, OFFICER_T1, -1, 4)).rejects.toMatchObject({ message: /between 0 and 20/ });
      await expect(setTargets(asUser, OFFICER_T1, 2, 21)).rejects.toMatchObject({ message: /between 0 and 20/ });
    });
  });

  it('reads publicly, and a direct write touches no row', async () => {
    await withTxn(async ({ q, asAnon, asUser }) => {
      await setTargets(asUser, OFFICER_T1, 3, 5);
      const asAnonRow = (await asAnon('select tanks_wanted from public.team_lineup_settings where team_id = 1'))
        .rows[0];
      expect(asAnonRow.tanks_wanted).toBe(3);
      // Same default-deny shape as raid_encounters above: no UPDATE policy
      // means the statement succeeds and changes nothing.
      const result = await asUser(
        OFFICER_T1,
        'update public.team_lineup_settings set tanks_wanted = 9 where team_id = 1'
      );
      expect(result.rowCount).toBe(0);
      expect(await targetsOf(q)).toEqual({ tanks_wanted: 3, healers_wanted: 5 });
    });
  });
});
