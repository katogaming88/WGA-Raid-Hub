// #1324: a guild officer acts in their own guild only, and granting a role or
// adding a team names the guild it is for. Each case makes a second guild with
// a team of its own, inside one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, seedMember, insertDiscordUser, RLS_DENIED, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";

// A second guild with one team, its own guild officer and one raider.
const secondGuild = async (q) => {
  const guildId = (await q("insert into public.guilds (name) values ('Second Guild') returning id")).rows[0].id;
  const teamId = (
    await q("insert into public.teams (name, guild_id) values ('Second Team', $1) returning id", [guildId])
  ).rows[0].id;
  await q("insert into public.team_settings (team_id, config) values ($1, '{}'::jsonb)", [teamId]);
  const officer = { uid: randomUUID(), discordId: `discord-1324-${randomUUID()}` };
  await insertDiscordUser(q, officer.uid, officer.discordId);
  await q(
    `insert into public.guild_grants (person_id, guild_id, grant_type)
     values (public.person_for_discord_id($1), $2, 'guild_officer')`,
    [officer.discordId, guildId]
  );
  const raider = await seedMember(q, { teamId });
  return { guildId, teamId, officer, raider };
};

const grantsOf = async (asUser, fn, discordId) =>
  (
    await asUser(SITE_ADMIN, `select guild_id from public.${fn}() where discord_id = $1 order by guild_id`, [discordId])
  ).rows.map((r) => r.guild_id);

describe('grants name their guild', () => {
  it('a site admin grants and revokes guild officer in each guild separately', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { guildId } = await secondGuild(q);
      const wga = (await q(`select ${WGA} as id`)).rows[0].id;
      const who = 'discord-1324-grantee';

      await asUser(SITE_ADMIN, 'select public.admin_grant_guild_officer($1, $2)', [who, guildId]);
      await asUser(SITE_ADMIN, 'select public.admin_grant_guild_officer($1, $2)', [who, wga]);
      expect(await grantsOf(asUser, 'admin_list_guild_officers', who)).toEqual([wga, guildId].sort((a, b) => a - b));

      await expect(
        asUser(SITE_ADMIN, 'select public.admin_grant_guild_officer($1, $2)', [who, guildId])
      ).rejects.toThrow(/already has guild officer access/);
      // Left out, the guild is a guess once there are two.
      await expect(asUser(SITE_ADMIN, 'select public.admin_grant_guild_officer($1)', [who])).rejects.toThrow(
        /more than one guild/
      );

      await asUser(SITE_ADMIN, 'select public.admin_revoke_guild_officer($1, $2)', [who, guildId]);
      expect(await grantsOf(asUser, 'admin_list_guild_officers', who)).toEqual([wga]);
    });
  });

  it('BoE manager takes the guild too', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { guildId } = await secondGuild(q);
      await asUser(SITE_ADMIN, "select public.admin_grant_boe_manager('discord-1324-boe', $1)", [guildId]);
      expect(await grantsOf(asUser, 'admin_list_boe_managers', 'discord-1324-boe')).toEqual([guildId]);
      await asUser(SITE_ADMIN, "select public.admin_revoke_boe_manager('discord-1324-boe', $1)", [guildId]);
      expect(await grantsOf(asUser, 'admin_list_boe_managers', 'discord-1324-boe')).toEqual([]);
    });
  });

  it('site admin is site-wide: granting and revoking need no guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      await secondGuild(q);
      await asUser(SITE_ADMIN, "select public.admin_grant_site_admin('discord-1324-admin')");
      await expect(asUser(SITE_ADMIN, "select public.admin_grant_site_admin('discord-1324-admin')")).rejects.toThrow(
        /already has site admin access/
      );
      await asUser(SITE_ADMIN, "select public.admin_revoke_site_admin('discord-1324-admin')");
      expect(await grantsOf(asUser, 'admin_list_site_admins', 'discord-1324-admin')).toEqual([]);
    });
  });

  it('admin_create_team puts the team in the named guild', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { guildId } = await secondGuild(q);
      const id = (
        await asUser(SITE_ADMIN, "select public.admin_create_team('Named Team', 'named-team', $1) as id", [guildId])
      ).rows[0].id;
      expect((await q('select guild_id from public.teams where id = $1', [id])).rows[0].guild_id).toBe(guildId);
      await expect(asUser(SITE_ADMIN, "select public.admin_create_team('Guess Team', 'guess-team')")).rejects.toThrow(
        /more than one guild/
      );
    });
  });
});

describe('only a site admin grants or adds a team, in either guild', () => {
  it('refuses a guild officer of that guild, and anyone signed out', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { guildId, officer } = await secondGuild(q);
      const wga = (await q(`select ${WGA} as id`)).rows[0].id;
      const calls = [
        'select public.admin_grant_guild_officer($1, $2)',
        'select public.admin_revoke_guild_officer($1, $2)',
        'select public.admin_grant_boe_manager($1, $2)',
        'select public.admin_revoke_boe_manager($1, $2)',
        "select public.admin_create_team($1, 'probe-team', $2)"
      ];
      for (const [uid, guild] of [
        [officer.uid, guildId],
        [GUILD_OFFICER, wga]
      ]) {
        for (const sql of calls) {
          await expect(asUser(uid, sql, ['discord-1324-probe', guild])).rejects.toThrow(/Not authorized/);
        }
      }
      for (const sql of calls) {
        await expect(asAnon(sql, ['discord-1324-probe', guildId])).rejects.toThrow(/permission denied/);
      }
    });
  });

  it('says so when the guild does not exist', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(SITE_ADMIN, "select public.admin_grant_boe_manager('discord-1324-probe', -1)")
      ).rejects.toThrow(/no such guild/);
      await expect(asUser(SITE_ADMIN, "select public.admin_create_team('Probe', 'probe', -1)")).rejects.toThrow(
        /no such guild/
      );
    });
  });
});

describe('a guild officer acts in their own guild', () => {
  it('reads their own guild and not the other', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { teamId, officer, raider } = await secondGuild(q);
      const members = async (uid, team) =>
        (await asUser(uid, 'select count(*)::int as n from public.team_members where team_id = $1', [team])).rows[0].n;
      const person = async (uid, discordId) =>
        (await asUser(uid, 'select count(*)::int as n from public.people where discord_id = $1', [discordId])).rows[0]
          .n;

      expect(await members(officer.uid, teamId)).toBe(1);
      expect(await members(officer.uid, 1)).toBe(0);
      expect(await members(GUILD_OFFICER, teamId)).toBe(0);
      expect(await members(GUILD_OFFICER, 1)).toBeGreaterThan(0);
      expect(await person(officer.uid, raider.discordId)).toBe(1);
      expect(await person(GUILD_OFFICER, raider.discordId)).toBe(0);
    });
  });

  it("writes their own guild's rows and not the other's", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { teamId, officer } = await secondGuild(q);
      const addPlayer = (uid, team) =>
        asUser(uid, "insert into public.players (team_id, name_realm) values ($1, 'Probe-Stormrage')", [team]);

      await expect(addPlayer(GUILD_OFFICER, teamId)).rejects.toMatchObject({ code: RLS_DENIED });
      await addPlayer(officer.uid, teamId);
      await expect(addPlayer(officer.uid, 1)).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it("calls a team function for their own guild's team and not the other's", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { teamId, officer } = await secondGuild(q);
      await expect(asUser(GUILD_OFFICER, 'select public.team_invite_link_reset($1)', [teamId])).rejects.toThrow(
        /Not authorized/
      );
      await asUser(officer.uid, 'select public.team_invite_link_reset($1)', [teamId]);
      await expect(asUser(officer.uid, 'select public.team_invite_link_reset(1)')).rejects.toThrow(/Not authorized/);
      // A row with no team is a site admin's to write.
      await expect(asUser(officer.uid, "select public.write_audit_log(null, 'Probe')")).rejects.toThrow(
        /Not authorized/
      );
    });
  });

  it('the helpers answer for the caller only', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { teamId, officer } = await secondGuild(q);
      const ids = async (uid) => (await asUser(uid, 'select public.my_guild_officer_team_ids() as v')).rows[0].v;
      expect(await ids(officer.uid)).toEqual([teamId]);
      expect(await ids(GUILD_OFFICER)).not.toContain(teamId);
      expect(await ids(SITE_ADMIN)).toEqual([]);
      expect((await asAnon('select public.my_guild_officer_team_ids() as v')).rows[0].v).toEqual([]);
      // is_guild_officer_of_team() went in #1647: nothing asked it any more.
      const sees = async (uid) => (await asUser(uid, 'select public.my_sees_every_team_ids() as v')).rows[0].v;
      expect(await sees(officer.uid)).toEqual([teamId]);
      expect((await asAnon('select public.my_sees_every_team_ids() as v')).rows[0].v).toEqual([]);
    });
  });
});

describe('no check asks about any guild', () => {
  it('no access rule, view or other function calls is_guild_officer()', async () => {
    // rls-pool-read-only: reads the catalog, writes nothing.
    const { rows } = await pool.query(`
      select 'function ' || proname as what, regexp_replace(prosrc, '--[^\\n]*', '', 'g') as body
        from pg_proc where pronamespace = 'public'::regnamespace and proname <> 'is_guild_officer'
      union all
      select 'rule ' || tablename || ': ' || policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '')
        from pg_policies where schemaname = 'public'
      union all
      select 'view ' || viewname, definition from pg_views where schemaname = 'public'
    `);
    // The bio cards moved to the guild in #1647, so nothing is left.
    // Any call, with or without arguments (CodeRabbit).
    expect(rows.filter((r) => /\bis_guild_officer\s*\(/.test(r.body)).map((r) => r.what)).toEqual([]);
  });

  it('no access rule, view or other function calls is_boe_manager() (#1647)', async () => {
    // rls-pool-read-only: reads the catalog, writes nothing.
    const { rows } = await pool.query(`
      select 'function ' || proname as what, regexp_replace(prosrc, '--[^\\n]*', '', 'g') as body
        from pg_proc where pronamespace = 'public'::regnamespace and proname <> 'is_boe_manager'
      union all
      select 'rule ' || tablename || ': ' || policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '')
        from pg_policies where schemaname = 'public'
      union all
      select 'view ' || viewname, definition from pg_views where schemaname = 'public'
    `);
    expect(rows.filter((r) => /\bis_boe_manager\s*\(/.test(r.body)).map((r) => r.what)).toEqual([]);
  });
});
