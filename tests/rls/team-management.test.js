// Guild officers run their own guild's teams (#1643): create_team(),
// update_team(), set_team_archived() and set_team_unlisted() answer a
// guild_officer grant for the team's own guild, and nobody else: not a
// guild officer of another guild, not a team officer or raider, and not Staff
// without that grant. An unlisted team stays out of also_on_teams() and still
// opens by its address.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  pool,
  withTxn,
  GUILD_OFFICER,
  OFFICER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  RLS_DENIED,
  insertDiscordUser
} from './helpers.js';

afterAll(() => pool.end());

const WGA = "(select id from public.guilds where url_key = 'wga')";
const PHOENIX = 1;
const WRATHLESS = 4;

const create = (asUser, uid, name = 'Sandbox') =>
  asUser(uid, `select team_id, team_key from public.create_team(${WGA}, $1)`, [name]);

// A guild officer of a second guild, with a Discord login, and that guild's id.
async function otherGuildOfficer(q) {
  const uid = randomUUID();
  const discordId = `other-guild-officer-${uid}`;
  await insertDiscordUser(q, uid, discordId);
  const guild = (
    await q("insert into public.guilds (name, region, realm) values ('Other Guild', 'us', 'Stormrage') returning id")
  ).rows[0].id;
  await q(
    "insert into public.guild_grants (person_id, guild_id, grant_type) values (public.person_for_discord_id($1), $2, 'guild_officer')",
    [discordId, guild]
  );
  return { uid, guild };
}

describe('create_team()', () => {
  it('adds a team with a settings row and its creator as team leader, and audits it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team_id, team_key } = (await create(asUser, GUILD_OFFICER)).rows[0];
      expect(team_key).toMatch(/^[a-z0-9]+$/);
      const made = await q(
        `select t.name, t.unlisted, t.archived_at, ts.config, tm.role
           from public.teams t
           join public.team_settings ts on ts.team_id = t.id
           join public.team_members tm on tm.team_id = t.id
           join public.people pe on pe.id = tm.person_id
          where t.id = $1 and pe.auth_user_id = $2`,
        [team_id, GUILD_OFFICER]
      );
      expect(made.rows).toEqual([
        { name: 'Sandbox', unlisted: false, archived_at: null, config: {}, role: 'team_leader' }
      ]);
      const audit = await q("select team_id, detail from public.audit_log where action = 'Team Created'");
      expect(audit.rows).toEqual([{ team_id, detail: { name: 'Sandbox', key: team_key } }]);
    });
  });

  it('refuses a name the guild already has, ignoring case, and a blank one', async () => {
    await withTxn(async ({ asUser }) => {
      const phoenix = (await asUser(GUILD_OFFICER, 'select name from public.teams where id = 1')).rows[0].name;
      await expect(create(asUser, GUILD_OFFICER, phoenix.toUpperCase())).rejects.toThrow(/already has a team/);
      await expect(create(asUser, GUILD_OFFICER, '  ')).rejects.toThrow(/name/);
    });
  });

  it("refuses another guild's officer, a team officer, a raider, Staff and anon", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const other = await otherGuildOfficer(q);
      for (const uid of [other.uid, OFFICER_T1, RAIDER_T1, SITE_ADMIN]) {
        await expect(create(asUser, uid)).rejects.toThrow(/Not authorized/);
      }
      await expect(asAnon(`select * from public.create_team(${WGA}, 'X')`)).rejects.toMatchObject({
        code: RLS_DENIED
      });
      // ...and the other guild's officer runs their own guild's teams.
      const own = await asUser(other.uid, 'select team_id from public.create_team($1, $2)', [other.guild, 'Theirs']);
      expect(own.rows).toHaveLength(1);
      expect((await q("select count(*)::int as n from public.teams where name = 'Sandbox'")).rows[0].n).toBe(0);
    });
  });
});

describe('update_team()', () => {
  it('renames a team and changes its address; the old address still resolves', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const { team_id, team_key } = (await create(asUser, GUILD_OFFICER)).rows[0];
      await asUser(GUILD_OFFICER, 'select public.update_team($1, $2, $3)', [team_id, 'Test Bench', 'Test-Bench']);
      const team = await q('select name, slug from public.teams where id = $1', [team_id]);
      expect(team.rows).toEqual([{ name: 'Test Bench', slug: 'test-bench' }]);

      const old = await asAnon("select team_id, team_key, is_canonical from public.resolve_address('wga', $1)", [
        team_key
      ]);
      expect(old.rows).toEqual([{ team_id, team_key: 'test-bench', is_canonical: false }]);

      const audit = await q("select detail from public.audit_log where action = 'Team Updated'");
      expect(audit.rows).toEqual([
        { detail: { name: 'Test Bench', key: 'test-bench', old_name: 'Sandbox', old_key: team_key } }
      ]);
    });
  });

  it("refuses a bad address, another team's address, and another team's name", async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team_id } = (await create(asUser, GUILD_OFFICER)).rows[0];
      const phoenix = (await q('select name, slug from public.teams where id = 1')).rows[0];
      const update = (name, key) =>
        asUser(GUILD_OFFICER, 'select public.update_team($1, $2, $3)', [team_id, name, key]);
      await expect(update('Sandbox', 'no spaces')).rejects.toThrow(/address is 2 to 32/);
      await expect(update('Sandbox', 'x')).rejects.toThrow(/address is 2 to 32/);
      await expect(update('Sandbox', phoenix.slug)).rejects.toThrow(/already uses that address/);
      await expect(update(phoenix.name, 'sandbox')).rejects.toThrow(/already has a team/);
    });
  });

  it("refuses another guild's officer, a team officer, a raider, Staff and anon", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const other = await otherGuildOfficer(q);
      await expect(asAnon("select public.update_team(1, 'X', 'xx')")).rejects.toMatchObject({ code: RLS_DENIED });
      const phoenix = (await q('select name, slug from public.teams where id = 1')).rows[0];
      for (const uid of [other.uid, OFFICER_T1, RAIDER_T1, SITE_ADMIN]) {
        await expect(
          asUser(uid, 'select public.update_team($1, $2, $3)', [PHOENIX, 'Taken Over', phoenix.slug])
        ).rejects.toThrow(/Not authorized/);
      }
      expect((await q('select name from public.teams where id = 1')).rows[0].name).toBe(phoenix.name);
    });
  });
});

describe('set_team_archived()', () => {
  it('archives a team and brings it back, audited', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team_id } = (await create(asUser, GUILD_OFFICER)).rows[0];
      await asUser(GUILD_OFFICER, 'select public.set_team_archived($1, true)', [team_id]);
      expect(
        (await q('select archived_at is not null as a from public.teams where id = $1', [team_id])).rows[0].a
      ).toBe(true);
      await asUser(GUILD_OFFICER, 'select public.set_team_archived($1, false)', [team_id]);
      expect((await q('select archived_at from public.teams where id = $1', [team_id])).rows[0].archived_at).toBe(null);
      const audit = await q(
        "select action from public.audit_log where team_id = $1 and action in ('Team Archived', 'Team Restored') order by id",
        [team_id]
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['Team Archived', 'Team Restored']);
    });
  });

  it("refuses another guild's officer, a team officer, a raider, Staff and anon", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const other = await otherGuildOfficer(q);
      await expect(asAnon('select public.set_team_archived(1, true)')).rejects.toMatchObject({ code: RLS_DENIED });
      for (const uid of [other.uid, OFFICER_T1, RAIDER_T1, SITE_ADMIN]) {
        await expect(asUser(uid, 'select public.set_team_archived($1, true)', [PHOENIX])).rejects.toThrow(
          /Not authorized/
        );
      }
      expect((await q('select archived_at from public.teams where id = 1')).rows[0].archived_at).toBe(null);
    });
  });
});

describe('set_team_unlisted()', () => {
  it('unlists a team and lists it again, audited', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team_id } = (await create(asUser, GUILD_OFFICER)).rows[0];
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, true)', [team_id]);
      expect((await q('select unlisted from public.teams where id = $1', [team_id])).rows[0].unlisted).toBe(true);
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, false)', [team_id]);
      expect((await q('select unlisted from public.teams where id = $1', [team_id])).rows[0].unlisted).toBe(false);
      const audit = await q(
        "select action from public.audit_log where team_id = $1 and action in ('Team Unlisted', 'Team Listed') order by id",
        [team_id]
      );
      expect(audit.rows.map((r) => r.action)).toEqual(['Team Unlisted', 'Team Listed']);
    });
  });

  it("refuses another guild's officer, a team officer, a raider, Staff and anon", async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const other = await otherGuildOfficer(q);
      await expect(asAnon('select public.set_team_unlisted(1, true)')).rejects.toMatchObject({ code: RLS_DENIED });
      for (const uid of [other.uid, OFFICER_T1, RAIDER_T1, SITE_ADMIN]) {
        await expect(asUser(uid, 'select public.set_team_unlisted($1, true)', [PHOENIX])).rejects.toThrow(
          /Not authorized/
        );
      }
      expect((await q('select unlisted from public.teams where id = 1')).rows[0].unlisted).toBe(false);
    });
  });
});

describe('archive and unlist switches', () => {
  it('write nothing and log nothing when there is no change, and refuse a missing value', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { team_id } = (await create(asUser, GUILD_OFFICER)).rows[0];
      await asUser(GUILD_OFFICER, 'select public.set_team_archived($1, false)', [team_id]);
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, false)', [team_id]);
      const logged = await q(
        "select count(*)::int as n from public.audit_log where team_id = $1 and action in ('Team Restored', 'Team Listed')",
        [team_id]
      );
      expect(logged.rows[0].n).toBe(0);
      await expect(asUser(GUILD_OFFICER, 'select public.set_team_archived($1, null)', [team_id])).rejects.toThrow(
        /Say whether/
      );
      await expect(asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, null)', [team_id])).rejects.toThrow(
        /Say whether/
      );
    });
  });
});

describe('an unlisted team', () => {
  it('Wrathless is unlisted', async () => {
    await withTxn(async ({ q }) => {
      expect((await q('select unlisted from public.teams where id = $1', [WRATHLESS])).rows[0].unlisted).toBe(true);
    });
  });

  it('gives a Phoenix raider no "Also on" tag for it, until it is listed', async () => {
    await withTxn(async ({ q, asUser }) => {
      // discord-raider-1 is membership 3 on Phoenix; they join an unlisted
      // team with a character there.
      const main = (
        await q(
          "insert into public.players (team_id, name_realm, team_member_id) values (1, 'Alsomain-Illidan', 3) returning id"
        )
      ).rows[0].id;
      const { team_id } = (await create(asUser, GUILD_OFFICER)).rows[0];
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, true)', [team_id]);
      const member = (
        await q(
          "insert into public.team_members (team_id, discord_id, role) values ($1, 'discord-raider-1', 'raider') returning id",
          [team_id]
        )
      ).rows[0].id;
      await q(
        "insert into public.players (team_id, name_realm, team_member_id) values ($1, 'Alsosandbox-Illidan', $2)",
        [team_id, member]
      );

      const tags = async () =>
        (await asUser(OFFICER_T1, 'select * from public.also_on_teams(1)')).rows.filter((r) => r.player_id === main);
      expect(await tags()).toEqual([]);
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, false)', [team_id]);
      expect(await tags()).toEqual([{ player_id: main, team_name: 'Sandbox' }]);
    });
  });

  it('gives a Phoenix raider no earlier character from an unlisted team they left, until it is listed', async () => {
    await withTxn(async ({ q, asUser }) => {
      // discord-raider-1 (membership 3 on Phoenix) joins an unlisted team,
      // plays a character there, and leaves it.
      const main = (
        await q(
          "insert into public.players (team_id, name_realm, team_member_id) values (1, 'Earliermain-Illidan', 3) returning id"
        )
      ).rows[0].id;
      const { team_id } = (await create(asUser, GUILD_OFFICER)).rows[0];
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, true)', [team_id]);
      const member = (
        await q(
          "insert into public.team_members (team_id, discord_id, role) values ($1, 'discord-raider-1', 'raider') returning id",
          [team_id]
        )
      ).rows[0].id;
      const left = (
        await q(
          "insert into public.players (team_id, name_realm, team_member_id, archived_at) values ($1, 'Earliersandbox-Illidan', $2, now()) returning id",
          [team_id, member]
        )
      ).rows[0].id;

      const earlier = async () =>
        (await asUser(OFFICER_T1, 'select * from public.earlier_characters(1)')).rows.filter(
          (r) => r.player_id === main
        );
      expect(await earlier()).toEqual([]);
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, false)', [team_id]);
      expect(await earlier()).toEqual([{ player_id: main, earlier_player_id: left }]);
    });
  });

  it('is still read by its own members and opened by its address', async () => {
    await withTxn(async ({ asUser, asAnon }) => {
      const { team_id, team_key } = (await create(asUser, GUILD_OFFICER)).rows[0];
      await asUser(GUILD_OFFICER, 'select public.set_team_unlisted($1, true)', [team_id]);
      const own = await asUser(GUILD_OFFICER, 'select name, unlisted from public.teams where id = $1', [team_id]);
      expect(own.rows).toEqual([{ name: 'Sandbox', unlisted: true }]);
      const opened = await asAnon("select team_id from public.resolve_address('wga', $1)", [team_key]);
      expect(opened.rows).toEqual([{ team_id }]);
    });
  });
});
