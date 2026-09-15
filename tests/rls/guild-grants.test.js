// guild_grants (#942 step 2): the site admin, guild officer and BoE manager
// grants as one table. The read and write rules are covered where the three
// tables were (read-matrix, write-policies, boe), and the admin functions
// where each grant is used; these cases pin what is new in the table itself.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, grantGuild, SITE_ADMIN, OFFICER_T1 } from './helpers.js';

afterAll(() => pool.end());

// Invented here; no other file uses these ids.
const LATER = 'guild-grants-later-1';
const LATER_UID = '00000000-0000-0000-0000-0000000000b1';

describe('guild_grants rows', () => {
  it('refuses a grant type that is not one of the three', async () => {
    await withTxn(async ({ q }) => {
      await expect(grantGuild(q, LATER, 'team_leader')).rejects.toThrow(/guild_grants_grant_type_check/);
    });
  });

  it('holds one row per person per grant per guild', async () => {
    await withTxn(async ({ q }) => {
      await grantGuild(q, LATER, 'boe_manager');
      await expect(grantGuild(q, LATER, 'boe_manager')).rejects.toThrow(
        /guild_grants_person_id_guild_id_grant_type_key/
      );
    });
  });

  it('a grant to someone who has not signed in activates on their first sign-in', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(SITE_ADMIN, 'select public.admin_grant_site_admin($1)', [LATER]);
      const listed = await q('select auth_user_id from public.site_admins where discord_id = $1', [LATER]);
      expect(listed.rows[0].auth_user_id).toBeNull();

      await insertDiscordUser(q, LATER_UID, LATER);

      expect((await asUser(LATER_UID, 'select public.is_site_admin() as yes')).rows[0].yes).toBe(true);
      const list = await asUser(SITE_ADMIN, 'select * from public.admin_list_site_admins()');
      expect(list.rows.find((r) => r.discord_id === LATER).auth_user_id).toBe(LATER_UID);
    });
  });

  it('a grant of one type answers only that check', async () => {
    await withTxn(async ({ q, asUser }) => {
      await insertDiscordUser(q, LATER_UID, LATER);
      await grantGuild(q, LATER, 'guild_officer');
      const { rows } = await asUser(
        LATER_UID,
        'select public.is_site_admin() as admin, public.is_guild_officer() as officer, public.is_boe_manager() as boe'
      );
      expect(rows[0]).toEqual({ admin: false, officer: true, boe: false });
    });
  });

  it('revoking the last site admin is still refused', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(SITE_ADMIN, "select public.admin_revoke_site_admin('discord-site-admin')")).rejects.toThrow(
        /last remaining site admin/
      );
    });
  });
});

describe('the shared admin bodies and the guild lookup', () => {
  it('a signed-in caller, even a site admin, cannot call the shared bodies directly', async () => {
    await withTxn(async ({ asUser }) => {
      for (const sql of [
        "select * from public.admin_list_grants('site_admin')",
        "select public.admin_grant('site_admin', 'x', 'site admin')",
        "select public.admin_revoke('boe_manager', 'discord-officer-1', 'BoE manager')",
        'select public.only_guild_id()'
      ]) {
        await expect(asUser(SITE_ADMIN, sql)).rejects.toThrow(/permission denied/);
      }
    });
  });

  it('a new grant refuses to guess once there is a second guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.guilds (name, url_key) values ('Second Guild', 'second-guild')");
      await expect(asUser(SITE_ADMIN, 'select public.admin_grant_boe_manager($1)', [LATER])).rejects.toThrow(
        /more than one/
      );
      // The checks still ask "in any guild", so existing grants keep working.
      expect((await asUser(OFFICER_T1, 'select public.is_boe_manager() as yes')).rows[0].yes).toBe(true);
    });
  });
});
