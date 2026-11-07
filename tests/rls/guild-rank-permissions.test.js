// #1652: the guild's rank permissions grid. The seed makes TEAM_LEADER_T3 We Go
// Again's Owner and GUILD_OFFICER an Admin; RAIDER_T1 is a Member by being on
// Phoenix.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, GUILD_OFFICER, RAIDER_T1, TEAM_LEADER_T3 } from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";
const OWNER = TEAM_LEADER_T3;

const change = (rank, permission, on) => ({ rank, permission, on });
const save = (asUser, uid, changes) =>
  asUser(uid, `select public.set_guild_rank_permissions(${WGA}, $1::jsonb)`, [JSON.stringify(changes)]);
const has = async (asUser, uid, permission) =>
  (await asUser(uid, `select public.has_guild_permission(${WGA}, $1) as ok`, [permission])).rows[0].ok;
const audits = (q) => q(`select detail from public.audit_log where action = 'Guild Permissions Changed' order by id`);

describe('set_guild_rank_permissions', () => {
  it('a saved switch changes what that rank can do at once, both ways, and is audited', async () => {
    await withTxn(async ({ q, asUser }) => {
      expect(await has(asUser, GUILD_OFFICER, 'record_boe')).toBe(true);
      await save(asUser, OWNER, [change('admin', 'record_boe', false)]);
      expect(await has(asUser, GUILD_OFFICER, 'record_boe')).toBe(false);

      expect(await has(asUser, RAIDER_T1, 'create_teams')).toBe(false);
      await save(asUser, OWNER, [change('member', 'create_teams', true)]);
      expect(await has(asUser, RAIDER_T1, 'create_teams')).toBe(true);

      const { rows } = await audits(q);
      expect(rows.map((r) => r.detail)).toEqual([{ 'admin record_boe': false }, { 'member create_teams': true }]);
    });
  });

  it('leaves a permission it does not name as it is, the hidden export switch included', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        `insert into public.guild_rank_permissions (guild_id, rank, permission)
         values (${WGA}, 'admin', 'export_guild_data')`
      );
      await save(asUser, OWNER, [change('admin', 'record_boe', false)]);
      expect(await has(asUser, GUILD_OFFICER, 'export_guild_data')).toBe(true);
      expect(await has(asUser, GUILD_OFFICER, 'pay_any_boe')).toBe(true);
    });
  });

  it('a save that changes nothing logs nothing', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, OWNER, [change('admin', 'record_boe', true), change('member', 'record_boe', false)]);
      await save(asUser, OWNER, []);
      expect((await audits(q)).rows).toEqual([]);
    });
  });

  it('applies all of a save or none of it', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('savepoint before_save');
      await expect(
        save(asUser, OWNER, [change('admin', 'record_boe', false), change('admin', 'no_such_permission', true)])
      ).rejects.toThrow(/not a guild permission/);
      await q('rollback to savepoint before_save');
      expect(await has(asUser, GUILD_OFFICER, 'record_boe')).toBe(true);
    });
  });

  it('only the Owner can save: an Admin, a Member and a signed-out caller are refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      for (const uid of [GUILD_OFFICER, RAIDER_T1]) {
        await q('savepoint attempt');
        await expect(save(asUser, uid, [change('admin', 'record_boe', false)])).rejects.toThrow(/Not authorized/);
        await q('rollback to savepoint attempt');
      }
      expect(await has(asUser, GUILD_OFFICER, 'record_boe')).toBe(true);
    });
    await withTxn(async ({ q }) => {
      await q('set local role anon');
      await expect(q(`select public.set_guild_rank_permissions(${WGA}, '[]'::jsonb)`)).rejects.toThrow(
        /permission denied/
      );
    });
  });

  it("is refused for another guild's Owner", async () => {
    await withTxn(async ({ q, asUser }) => {
      const other = (await q("insert into public.guilds (name) values ('Other') returning id")).rows[0].id;
      await expect(
        asUser(OWNER, 'select public.set_guild_rank_permissions($1, $2::jsonb)', [
          other,
          JSON.stringify([change('admin', 'record_boe', false)])
        ])
      ).rejects.toThrow(/Not authorized/);
    });
  });

  it.each([
    ['the Owner rank, whose column is fixed', [change('owner', 'record_boe', false)], /A rank is/],
    ['a team permission', [change('admin', 'manage_loot', true)], /not a guild permission/],
    ['a change with no on or off', [{ rank: 'admin', permission: 'record_boe' }], /on or off/],
    ['something that is not a list', { rank: 'admin' }, /must be a list/]
  ])('refuses %s', async (_label, changes, message) => {
    await withTxn(async ({ asUser }) => {
      await expect(save(asUser, OWNER, changes)).rejects.toThrow(message);
    });
  });
});

describe('Member no longer stacks under the higher ranks', () => {
  it('a box ticked for Member leaves an Admin on a team with what their own column says', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        `insert into public.team_members (team_id, discord_id, person_id, role)
         values (1, 'discord-officer-1', public.person_for_discord_id('discord-officer-1'), 'raider')
         on conflict do nothing`
      );
      await save(asUser, OWNER, [change('member', 'record_boe', true), change('admin', 'record_boe', false)]);
      expect(await has(asUser, RAIDER_T1, 'record_boe')).toBe(true);
      expect(await has(asUser, GUILD_OFFICER, 'record_boe')).toBe(false);
    });
  });

  it('a leftover member row gives nothing to someone who has left every team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await save(asUser, OWNER, [change('member', 'create_teams', true)]);
      await q(
        `insert into public.guild_ranks (guild_id, person_id, rank)
         values (${WGA}, public.person_for_discord_id('discord-raider-1'), 'member')`
      );
      expect(await has(asUser, RAIDER_T1, 'create_teams')).toBe(true);
      await q(
        "update public.team_members set archived_at = now() where person_id = public.person_for_discord_id('discord-raider-1')"
      );
      expect(await has(asUser, RAIDER_T1, 'create_teams')).toBe(false);
    });
  });

  it('the Owner keeps every permission whatever the grid says', async () => {
    await withTxn(async ({ asUser }) => {
      await save(asUser, OWNER, [change('admin', 'record_boe', false)]);
      expect(await has(asUser, OWNER, 'record_boe')).toBe(true);
    });
  });
});
