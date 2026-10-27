// #1645: guild and team ranks, each rank's permissions stored, and both kept
// in step with today's roles (team_members.role, the guild_officer grant) so
// the current site sees the same powers until cutover.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  pool,
  withTxn,
  seedMember,
  seedTeam,
  insertDiscordUser,
  RLS_DENIED,
  SITE_ADMIN,
  GUILD_OFFICER,
  TEAM_LEADER_T1,
  RAIDER_T1,
  RAIDER_T2
} from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";

const member = async (q, id) => (await q('select rank, role from public.team_members where id = $1', [id])).rows[0];

const guildRank = async (q, discordId, guildId) =>
  (
    await q(
      `select rank from public.guild_ranks
        where person_id = public.person_for_discord_id($1) and guild_id = coalesce($2, ${WGA})`,
      [discordId, guildId ?? null]
    )
  ).rows[0]?.rank ?? null;

const hasGrant = async (q, discordId, guildId) =>
  (
    await q(
      `select count(*)::int as n from public.guild_grants
        where person_id = public.person_for_discord_id($1) and guild_id = coalesce($2, ${WGA})
          and grant_type = 'guild_officer'`,
      [discordId, guildId ?? null]
    )
  ).rows[0].n === 1;

const can = async (asUser, uid, fn, id, permission) =>
  (await asUser(uid, `select public.${fn}($1, $2) as ok`, [id, permission])).rows[0].ok;

describe('team ranks follow team_members.role', () => {
  it('each seeded team leader is the owner, and the other roles keep their names', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q('select role, rank from public.team_members where team_id between 1 and 4');
      for (const r of rows) {
        expect(r.rank).toBe({ team_leader: 'owner', officer: 'officer', raider: 'raider' }[r.role]);
      }
    });
  });

  it("the current site's Grant and Revoke Officer move the rank too", async () => {
    await withTxn(async ({ q, asUser }) => {
      const raider = await seedMember(q, { teamId: 1 });
      await asUser(TEAM_LEADER_T1, "update public.team_members set role = 'officer' where id = $1", [raider.memberId]);
      expect(await member(q, raider.memberId)).toEqual({ rank: 'officer', role: 'officer' });
      await asUser(TEAM_LEADER_T1, "update public.team_members set role = 'raider' where id = $1", [raider.memberId]);
      expect(await member(q, raider.memberId)).toEqual({ rank: 'raider', role: 'raider' });
    });
  });

  it('a second team leader is an officer by rank and still a team leader on the current site', async () => {
    await withTxn(async ({ q }) => {
      const coLeader = await seedMember(q, { teamId: 1, role: 'team_leader' });
      expect(await member(q, coLeader.memberId)).toEqual({ rank: 'officer', role: 'team_leader' });
    });
  });

  it('bringing an archived owner back to a team with an owner makes them an officer', async () => {
    await withTxn(async ({ q }) => {
      const { teamId, leader } = await seedTeam(q);
      await q('update public.team_members set archived_at = now() where id = $1', [leader.memberId]);
      const next = await seedMember(q, { teamId, role: 'team_leader' });
      expect((await member(q, next.memberId)).rank).toBe('owner');

      await q('update public.team_members set archived_at = null where id = $1', [leader.memberId]);
      expect(await member(q, leader.memberId)).toEqual({ rank: 'officer', role: 'team_leader' });
    });
  });
});

describe('team_members.role follows the rank', () => {
  it('each rank sets the role the current site reads', async () => {
    await withTxn(async ({ q }) => {
      const { leader, raider } = await seedTeam(q);
      const set = (id, rank) => q('update public.team_members set rank = $2 where id = $1', [id, rank]);

      await set(raider.memberId, 'assistant');
      expect(await member(q, raider.memberId)).toEqual({ rank: 'assistant', role: 'raider' });
      await set(raider.memberId, 'officer');
      expect(await member(q, raider.memberId)).toEqual({ rank: 'officer', role: 'officer' });

      // Handing the team over: the old owner steps down first.
      await set(leader.memberId, 'officer');
      await set(raider.memberId, 'owner');
      expect(await member(q, leader.memberId)).toEqual({ rank: 'officer', role: 'officer' });
      expect(await member(q, raider.memberId)).toEqual({ rank: 'owner', role: 'team_leader' });
    });
  });

  it('a new member named by rank alone gets the matching role', async () => {
    await withTxn(async ({ q }) => {
      const discordId = `discord-1645-${randomUUID()}`;
      const { rows } = await q(
        "insert into public.team_members (team_id, discord_id, rank) values (1, $1, 'assistant') returning role",
        [discordId]
      );
      expect(rows[0].role).toBe('raider');
    });
  });

  it('a team has one owner', async () => {
    await withTxn(async ({ q }) => {
      const { raider } = await seedTeam(q);
      await expect(q("update public.team_members set rank = 'owner' where id = $1", [raider.memberId])).rejects.toThrow(
        /team_members_one_owner/
      );
    });
  });

  it('a rank and role that disagree are refused', async () => {
    await withTxn(async ({ q }) => {
      await expect(
        q("insert into public.team_members (team_id, discord_id, role, rank) values (1, $1, 'officer', 'raider')", [
          `discord-1645-${randomUUID()}`
        ])
      ).rejects.toThrow(/team_members_rank_matches_role/);
    });
  });
});

describe('guild ranks and the guild_officer grant', () => {
  it('seeded guild officers are admins', async () => {
    await withTxn(async ({ q }) => {
      expect(await guildRank(q, 'discord-guildofficer-1')).toBe('admin');
    });
  });

  it("the current site's Grant and Revoke Guild Officer move the rank", async () => {
    await withTxn(async ({ q, asUser }) => {
      const who = `discord-1645-${randomUUID()}`;
      await asUser(SITE_ADMIN, `select public.admin_grant_guild_officer($1, ${WGA})`, [who]);
      expect(await guildRank(q, who)).toBe('admin');
      await asUser(SITE_ADMIN, `select public.admin_revoke_guild_officer($1, ${WGA})`, [who]);
      expect(await guildRank(q, who)).toBe('member');
    });
  });

  it('owner and admin carry the grant; team lead and member do not', async () => {
    await withTxn(async ({ q }) => {
      const who = `discord-1645-${randomUUID()}`;
      await q(
        `insert into public.guild_ranks (guild_id, person_id, rank)
         values (${WGA}, public.person_for_discord_id($1), 'team_lead')`,
        [who]
      );
      expect(await hasGrant(q, who)).toBe(false);
      for (const [rank, grant] of [
        ['admin', true],
        ['owner', true],
        ['member', false]
      ]) {
        await q('update public.guild_ranks set rank = $2 where person_id = public.person_for_discord_id($1)', [
          who,
          rank
        ]);
        expect(await hasGrant(q, who)).toBe(grant);
      }
    });
  });

  it("a guild has one owner, whose guild officer grant can't be revoked", async () => {
    await withTxn(async ({ q, asUser }) => {
      const [a, b] = [`discord-1645-${randomUUID()}`, `discord-1645-${randomUUID()}`];
      const add = (who) =>
        q(
          `insert into public.guild_ranks (guild_id, person_id, rank)
           values (${WGA}, public.person_for_discord_id($1), 'owner')`,
          [who]
        );
      await add(a);
      await expect(asUser(SITE_ADMIN, `select public.admin_revoke_guild_officer($1, ${WGA})`, [a])).rejects.toThrow(
        /guild's Owner/
      );
      // Last: a failed statement outside asUser ends the transaction.
      await expect(add(b)).rejects.toThrow(/guild_ranks_one_owner/);
    });
  });

  it('whoever creates a guild owns it and is its guild officer', async () => {
    await withTxn(async ({ q, asUser }) => {
      await asUser(SITE_ADMIN, 'select public.admin_set_guild_creation_open(true)');
      const uid = randomUUID();
      const discordId = `newcomer-${uid}`;
      await insertDiscordUser(q, uid, discordId);
      const { rows } = await asUser(uid, "select guild_key from public.create_guild('Ranked', 'us', 'Illidan')");
      const guildId = (await q('select id from public.guilds where url_key = $1', [rows[0].guild_key])).rows[0].id;
      expect(await guildRank(q, discordId, guildId)).toBe('owner');
      expect(await hasGrant(q, discordId, guildId)).toBe(true);
      const team = (await q('select id from public.teams where guild_id = $1', [guildId])).rows[0].id;
      expect(await can(asUser, uid, 'has_team_permission', team, 'manage_loot')).toBe(true);
    });
  });
});

describe('the permission checks', () => {
  it('a new team answers from the default grid', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { teamId, officer, leader, raider } = await seedTeam(q);
      await q("update public.team_members set rank = 'assistant' where id = $1", [raider.memberId]);
      const plain = await seedMember(q, { teamId });
      const check = (who, permission) => can(asUser, who.uid, 'has_team_permission', teamId, permission);

      expect(await check(plain, 'own_character')).toBe(true);
      expect(await check(plain, 'edit_roster')).toBe(false);
      expect(await check(raider, 'edit_roster')).toBe(true);
      expect(await check(raider, 'manage_loot')).toBe(false);
      expect(await check(officer, 'manage_loot')).toBe(true);
      expect(await check(leader, 'view_team_audit_log')).toBe(true);
      // Not a team permission, or misspelt: nobody has it.
      expect(await check(leader, 'record_boe')).toBe(false);
      expect(await check(leader, 'manage_lot')).toBe(false);
      // Not on the team.
      expect(await can(asUser, RAIDER_T1, 'has_team_permission', teamId, 'own_character')).toBe(false);
    });
  });

  it("a team's own grid wins over the defaults", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { teamId, raider } = await seedTeam(q);
      expect(await can(asUser, raider.uid, 'has_team_permission', teamId, 'edit_own_wishlist')).toBe(true);
      await q(
        "delete from public.team_rank_permissions where team_id = $1 and rank = 'raider' and permission = 'edit_own_wishlist'",
        [teamId]
      );
      expect(await can(asUser, raider.uid, 'has_team_permission', teamId, 'edit_own_wishlist')).toBe(false);
    });
  });

  it('"Officer on every team" answers as an officer on every team in the guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { teamId } = await seedTeam(q);
      expect(await can(asUser, RAIDER_T1, 'has_team_permission', teamId, 'manage_loot')).toBe(false);
      await q(
        `insert into public.guild_ranks (guild_id, person_id, officer_on_every_team)
         values (${WGA}, public.person_for_discord_id('discord-raider-1'), true)`
      );
      expect(await can(asUser, RAIDER_T1, 'has_team_permission', teamId, 'manage_loot')).toBe(true);

      // Only in that guild: a team in another guild stays shut.
      const otherGuild = (await q("insert into public.guilds (name) values ('Other') returning id")).rows[0].id;
      const otherTeam = (
        await q("insert into public.teams (name, guild_id) values ('Other Team', $1) returning id", [otherGuild])
      ).rows[0].id;
      expect(await can(asUser, RAIDER_T1, 'has_team_permission', otherTeam, 'manage_loot')).toBe(false);
    });
  });

  it('guild ranks answer from the default grid', async () => {
    await withTxn(async ({ q, asUser }) => {
      const wga = (await q(`select ${WGA} as id`)).rows[0].id;
      const check = (uid, permission) => can(asUser, uid, 'has_guild_permission', wga, permission);

      expect(await check(RAIDER_T1, 'create_teams')).toBe(false);
      expect(await check(GUILD_OFFICER, 'record_boe')).toBe(true);
      expect(await check(GUILD_OFFICER, 'export_guild_data')).toBe(false);

      await q(
        `insert into public.guild_ranks (guild_id, person_id, rank)
         values ($1, public.person_for_discord_id('discord-raider-1'), 'team_lead')`,
        [wga]
      );
      expect(await check(RAIDER_T1, 'create_teams')).toBe(true);
      expect(await check(RAIDER_T1, 'record_boe')).toBe(false);

      await q(
        "update public.guild_ranks set rank = 'owner' where person_id = public.person_for_discord_id('discord-raider-1')"
      );
      expect(await check(RAIDER_T1, 'export_guild_data')).toBe(true);
      expect(await check(RAIDER_T1, 'manage_loot')).toBe(false);
    });
  });

  it('nobody outside a guild has its permissions', async () => {
    await withTxn(async ({ q, asUser }) => {
      const guildId = (await q("insert into public.guilds (name) values ('Other') returning id")).rows[0].id;
      expect(await can(asUser, GUILD_OFFICER, 'has_guild_permission', guildId, 'record_boe')).toBe(false);
      expect(
        (await q('select count(*)::int as n from public.guild_rank_permissions where guild_id = $1', [guildId])).rows[0]
          .n
      ).toBeGreaterThan(0);
    });
  });
});

describe('access', () => {
  it('no client role writes the new tables', async () => {
    await withTxn(async ({ asUser }) => {
      for (const sql of [
        "insert into public.rank_permissions (permission, scope, position, default_ranks) values ('x', 'team', 99, '{}')",
        'delete from public.team_rank_permissions where team_id = 1',
        'delete from public.guild_rank_permissions',
        `insert into public.guild_ranks (guild_id, person_id, rank) values (${WGA}, public.my_person_id(), 'owner')`
      ]) {
        await expect(asUser(SITE_ADMIN, sql)).rejects.toMatchObject({ code: RLS_DENIED });
      }
    });
  });

  it('a guild rank reads to the person, guild officers and site admins only', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const read = async (uid, rank = 'admin') =>
        (await asUser(uid, 'select count(*)::int as n from public.guild_ranks where rank = $1', [rank])).rows[0].n;
      expect(await read(GUILD_OFFICER)).toBeGreaterThan(0);
      expect(await read(SITE_ADMIN)).toBeGreaterThan(0);
      expect(await read(RAIDER_T1)).toBe(0);

      await q(
        `insert into public.guild_ranks (guild_id, person_id, rank)
         values (${WGA}, public.person_for_discord_id('discord-raider-1'), 'team_lead')`
      );
      expect(await read(RAIDER_T1, 'team_lead')).toBe(1);
      expect(await read(RAIDER_T2, 'team_lead')).toBe(0);
      await expect(asAnon('select 1 from public.guild_ranks')).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});
