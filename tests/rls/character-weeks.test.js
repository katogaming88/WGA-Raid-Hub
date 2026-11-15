// #1635: the roster audit's weekly row, one per character per week. The
// character's teams and its owner read it; only the syncs write it.
//
// Seeded: seedraider-illidan is on team 1, seedhellfire-illidan on team 2.
// SIGNUP_OWNER_T1 is on no team, so they play a character's owner.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  OFFICER_T1,
  RAIDER_T1,
  RAIDER_T2,
  SITE_ADMIN,
  GUILD_OFFICER,
  SIGNUP_OWNER_T1,
  RLS_DENIED
} from './helpers.js';

afterAll(() => pool.end());

const WEEK = '2026-11-10';
const write = (as, nameRealm, week = WEEK) =>
  as(
    `insert into public.character_weeks (week_of, name_realm, crests, crests_at)
     values ($1, $2, '{"Myth": 180}', now())`,
    [week, nameRealm]
  );
const keys = async (as) =>
  (await as('select name_realm_key from public.character_weeks order by 1')).rows.map((r) => r.name_realm_key);

// Rows for both seeded roster characters and one nobody has rostered.
async function seedWeeks(q) {
  await write(q, 'Seedraider-Illidan');
  await write(q, 'Seedhellfire-Illidan');
  await write(q, 'Katorrí-Stormrage');
}

describe('character_weeks', () => {
  it('a team member reads their own team’s characters, not another team’s', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedWeeks(q);
      expect(await keys((t, p) => asUser(RAIDER_T1, t, p))).toEqual(['seedraider-illidan']);
      expect(await keys((t, p) => asUser(RAIDER_T2, t, p))).toEqual(['seedhellfire-illidan']);
      expect(await keys((t, p) => asUser(OFFICER_T1, t, p))).toEqual(['seedraider-illidan']);
    });
  });

  it('a character on two teams is one row, read by both teams', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedWeeks(q);
      await q("insert into public.players (team_id, name_realm, class_spec_id) values (2, 'Seedraider-Illidan', 1)");
      expect(await keys((t, p) => asUser(RAIDER_T2, t, p))).toEqual(['seedhellfire-illidan', 'seedraider-illidan']);
      await expect(write(q, 'Seedraider-Illidan')).rejects.toThrow('duplicate key');
    });
  });

  it('a character that leaves the roster drops out of its team’s audit; its owner still reads it', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedWeeks(q);
      // RAIDER_T1 owns seedraider through their roster row.
      const member = (
        await q(
          'select tm.id from public.team_members tm join public.people pe on pe.id = tm.person_id where pe.auth_user_id = $1 and tm.team_id = 1',
          [RAIDER_T1]
        )
      ).rows[0].id;
      await q("update public.players set team_member_id = $1 where name_realm_key = 'seedraider-illidan'", [member]);
      await q("update public.players set archived_at = now() where name_realm_key = 'seedraider-illidan'");
      expect(await keys((t, p) => asUser(OFFICER_T1, t, p))).toEqual([]);
      expect(await keys((t, p) => asUser(RAIDER_T1, t, p))).toEqual(['seedraider-illidan']);
    });
  });

  it('a member who has left the team no longer reads its characters', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedWeeks(q);
      await q(
        'update public.team_members set archived_at = now() where team_id = 1 and person_id = (select id from public.people where auth_user_id = $1)',
        [RAIDER_T1]
      );
      expect(await keys((t, p) => asUser(RAIDER_T1, t, p))).toEqual([]);
    });
  });

  it('the owner reads their own character, rostered or not; nobody else on a team does', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedWeeks(q);
      const me = (await q('select id from public.people where auth_user_id = $1', [SIGNUP_OWNER_T1])).rows[0].id;
      await q(
        `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level, item_level)
         values ($1, 990001, 'Katorrí', 'Stormrage', 'stormrage', 'Warlock', 'Demonology', 90, 720)`,
        [me]
      );
      expect(await keys((t, p) => asUser(SIGNUP_OWNER_T1, t, p))).toEqual(['katorrí-stormrage']);
      expect(await keys((t, p) => asUser(RAIDER_T1, t, p))).not.toContain('katorrí-stormrage');
    });
  });

  it('a guild rank that sees every team and a site admin read across teams; signed out reads nothing', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await seedWeeks(q);
      expect(await keys((t, p) => asUser(GUILD_OFFICER, t, p))).toEqual(
        expect.arrayContaining(['seedhellfire-illidan', 'seedraider-illidan'])
      );
      expect(await keys((t, p) => asUser(SITE_ADMIN, t, p))).toEqual([
        'katorrí-stormrage',
        'seedhellfire-illidan',
        'seedraider-illidan'
      ]);
      await expect(asAnon('select * from public.character_weeks')).rejects.toMatchObject({ code: RLS_DENIED });
      // Team 1's two roster characters.
      expect((await asUser(RAIDER_T1, 'select public.my_audit_character_keys() as k')).rows[0].k.sort()).toEqual([
        'seedplayertwo-illidan',
        'seedraider-illidan'
      ]);
    });
  });

  it('only the syncs write it', async () => {
    await withTxn(async ({ q, asUser, asRole }) => {
      await seedWeeks(q);
      const officer = (t, p) => asUser(OFFICER_T1, t, p);
      await expect(write(officer, 'Seedraider-Illidan', '2026-11-17')).rejects.toMatchObject({
        code: RLS_DENIED
      });
      await expect(officer("update public.character_weeks set crests = '{}'")).rejects.toMatchObject({
        code: RLS_DENIED
      });
      await expect(officer('delete from public.character_weeks')).rejects.toMatchObject({ code: RLS_DENIED });
      const sync = asRole('service_role', null);
      await write(sync, 'Seedraider-Illidan', '2026-11-17');
      await sync(
        "update public.character_weeks set mplus_rating = 2950.5, mplus_at = now() where week_of = '2026-11-17'"
      );
      await expect(sync('delete from public.character_weeks')).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('a week is named by its reset Tuesday, and the key is built from the name as on the roster', async () => {
    await withTxn(async ({ q }) => {
      await write(q, 'Seed Raider-Illidan');
      const row = (await q('select name_realm_key from public.character_weeks')).rows[0];
      expect(row.name_realm_key).toBe('seedraider-illidan');
      await expect(write(q, 'Seedraider-Illidan', '2026-11-11')).rejects.toThrow('character_weeks_week_of_check');
    });
  });
});
