// #1649: my_permissions() lists what the caller's rank may do on one team and
// its guild, from the same grids has_team_permission() and
// has_guild_permission() read, so the app shows what the database allows.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedMember, grantGuild } from './helpers.js';

afterAll(() => pool.end());

const mine = async (asUser, uid, teamId, guildId = null) =>
  (await asUser(uid, 'select public.my_permissions($1, $2) as p', [teamId, guildId])).rows[0].p;

describe('my_permissions()', () => {
  it('an Officer has the officer tools on their own team and none on another', async () => {
    await withTxn(async ({ q, asUser }) => {
      const officer = await seedMember(q, { teamId: 1, role: 'officer' });
      const own = await mine(asUser, officer.uid, 1);
      expect(own.team).toEqual(expect.arrayContaining(['edit_roster', 'manage_loot', 'view_reports']));
      expect((await mine(asUser, officer.uid, 2)).team).toEqual([]);
    });
  });

  it('an Assistant has the roster tools and no loot import; a Raider has neither', async () => {
    await withTxn(async ({ q, asUser }) => {
      const assistant = await seedMember(q, { teamId: 1 });
      await q("update public.team_members set rank = 'assistant' where id = $1", [assistant.memberId]);
      const { team } = await mine(asUser, assistant.uid, 1);
      expect(team).toEqual(expect.arrayContaining(['edit_roster', 'attendance', 'view_reports']));
      expect(team).not.toContain('manage_loot');
      expect((await mine(asUser, (await seedMember(q, { teamId: 1 })).uid, 1)).team).toEqual([
        'own_character',
        'edit_own_wishlist'
      ]);
    });
  });

  it("a guild rank's powers come back for that guild only", async () => {
    await withTxn(async ({ q, asUser }) => {
      const admin = await seedMember(q, { teamId: 1 });
      await grantGuild(q, admin.discordId, 'guild_officer');
      const { guild } = await mine(asUser, admin.uid, 1);
      expect(guild).toEqual(expect.arrayContaining(['create_teams', 'rename_archive_teams']));
      const other = (await q(`insert into public.guilds (name, url_key) values ('Other', 'other-1649') returning id`))
        .rows[0].id;
      expect((await mine(asUser, admin.uid, null, other)).guild).toEqual([]);
      // A team's own guild wins over the guild argument.
      expect((await mine(asUser, admin.uid, 1, other)).guild).toEqual(guild);
    });
  });

  it('answers with empty lists when nothing is named', async () => {
    await withTxn(async ({ q, asUser }) => {
      expect(await mine(asUser, (await seedMember(q, { teamId: 1, role: 'officer' })).uid, null)).toEqual({
        team: [],
        guild: []
      });
    });
  });

  it('is closed to signed-out callers', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(
        "select has_function_privilege('anon', 'public.my_permissions(integer, integer)', 'execute') as anon, has_function_privilege('authenticated', 'public.my_permissions(integer, integer)', 'execute') as authed"
      );
      expect(rows[0]).toEqual({ anon: false, authed: true });
    });
  });
});
