// Behavior tests for #941: the person link kept on archived characters,
// is_own_player()'s archived filter, the normalised name_realm key,
// add_signup_to_roster()'s swap and revive, and resolve_person().
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, RAIDER_T1, OFFICER_T1, OFFICER_T2, SITE_ADMIN, GUILD_OFFICER } from './helpers.js';

afterAll(() => pool.end());

// Seeded (supabase/seed.sql): team 1 members 1 officer, 3 raider
// ('discord-raider-1', RAIDER_T1), 5 the guild officer's raider row; team 2
// member 4 is its officer. Players 1 and 2 are unlinked team 1 characters.
// Signup 2 is team 1 'Seedapproved-Illidan', approved, with no account.
const RAIDER_T1_MEMBER = 3;
const OTHER_T1_MEMBER = 5;
const APPROVED_SIGNUP = 2;

const player = async (q, id) =>
  (await q('select name_realm, archived_at, team_member_id from public.players where id = $1', [id])).rows[0];

describe('is_own_player() and archived characters', () => {
  it('matches a live linked character and not an archived one', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = $1 where id = 1', [RAIDER_T1_MEMBER]);
      const own = async () => (await asUser(RAIDER_T1, 'select public.is_own_player(1) as own')).rows[0].own;
      expect(await own()).toBe(true);
      await q('update public.players set archived_at = now() where id = 1');
      expect(await own()).toBe(false);
    });
  });

  it("an archived character is not writable through a raider's own-row rule", async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = $1, archived_at = now() where id = 1', [RAIDER_T1_MEMBER]);
      const res = await asUser(RAIDER_T1, 'update public.players set bonus_roll_encounter_id = null where id = 1');
      expect(res.rowCount).toBe(0);
    });
  });
});

describe('name_realm_key', () => {
  it('is lower case with spaces removed', async () => {
    await withTxn(async ({ q }) => {
      const res = await q(
        "insert into public.players (team_id, name_realm) values (1, 'Fxd-Area 52') returning name_realm_key"
      );
      expect(res.rows[0].name_realm_key).toBe('fxd-area52');
    });
  });

  it('rejects a spelling that differs only by spaces or case on the same team', async () => {
    await withTxn(async ({ q, asRole }) => {
      await q("insert into public.players (team_id, name_realm) values (1, 'Fxd-Area 52')");
      await expect(
        asRole('postgres', null)("insert into public.players (team_id, name_realm) values (1, 'fxd-Area52')")
      ).rejects.toThrow(/players_team_id_name_realm_key_key/);
    });
  });

  it('allows the same character on another team', async () => {
    await withTxn(async ({ q }) => {
      await q("insert into public.players (team_id, name_realm) values (1, 'Fxd-Area 52')");
      await q("insert into public.players (team_id, name_realm) values (2, 'Fxd-Area52')");
    });
  });
});

describe('add_signup_to_roster()', () => {
  it('a main swap keeps the link on the archived character and carries it to the new one', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = $1 where id = 2', [RAIDER_T1_MEMBER]);
      const newId = (
        await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1, $2, $3) as id', [APPROVED_SIGNUP, true, 2])
      ).rows[0].id;
      const old = await player(q, 2);
      expect(old.archived_at).not.toBeNull();
      expect(old.team_member_id).toBe(RAIDER_T1_MEMBER);
      expect((await player(q, newId)).team_member_id).toBe(RAIDER_T1_MEMBER);
    });
  });

  it('reviving a reused character name moves the link to the person signing up', async () => {
    await withTxn(async ({ q, asUser }) => {
      const prior = (
        await q(
          "insert into public.players (team_id, name_realm, archived_at, team_member_id) values (1, 'Seedapproved-Illidan', now(), $1) returning id",
          [OTHER_T1_MEMBER]
        )
      ).rows[0].id;
      await q('update public.season_signups set auth_user_id = $1 where id = $2', [RAIDER_T1, APPROVED_SIGNUP]);
      const id = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [APPROVED_SIGNUP])).rows[0]
        .id;
      expect(id).toBe(prior);
      const row = await player(q, id);
      expect(row.archived_at).toBeNull();
      expect(row.team_member_id).toBe(RAIDER_T1_MEMBER);
    });
  });

  it('reviving keeps the link when the same person signs up again', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        "insert into public.players (team_id, name_realm, archived_at, team_member_id) values (1, 'Seedapproved-Illidan', now(), $1)",
        [RAIDER_T1_MEMBER]
      );
      await q('update public.season_signups set auth_user_id = $1 where id = $2', [RAIDER_T1, APPROVED_SIGNUP]);
      const id = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [APPROVED_SIGNUP])).rows[0]
        .id;
      expect((await player(q, id)).team_member_id).toBe(RAIDER_T1_MEMBER);
    });
  });

  it('reviving keeps the link when the signup has no account to compare', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        "insert into public.players (team_id, name_realm, archived_at, team_member_id) values (1, 'Seedapproved-Illidan', now(), $1)",
        [OTHER_T1_MEMBER]
      );
      const id = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [APPROVED_SIGNUP])).rows[0]
        .id;
      expect((await player(q, id)).team_member_id).toBe(OTHER_T1_MEMBER);
    });
  });

  it('a signup spelled without the realm space revives the archived row instead of failing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const prior = (
        await q(
          "insert into public.players (team_id, name_realm, archived_at) values (1, 'Seedapproved-Area 52', now()) returning id"
        )
      ).rows[0].id;
      await q("update public.season_signups set signup_name_realm = 'Seedapproved-Area52' where id = $1", [
        APPROVED_SIGNUP
      ]);
      const id = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [APPROVED_SIGNUP])).rows[0]
        .id;
      expect(id).toBe(prior);
      const row = await player(q, id);
      expect(row.archived_at).toBeNull();
      expect(row.name_realm).toBe('Seedapproved-Area 52');
    });
  });
});

describe('resolve_person()', () => {
  const resolve = async (run, uid, discordId) =>
    (await run(uid, 'select public.resolve_person($1) as person', [discordId])).rows[0].person;

  it('a raider sees themself, with their characters, archived ones included', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = $1 where id in (1, 2)', [RAIDER_T1_MEMBER]);
      await q('update public.players set archived_at = now() where id = 2');
      const person = await resolve(asUser, RAIDER_T1, 'discord-raider-1');
      expect(person).toMatchObject({
        discord_id: 'discord-raider-1',
        auth_user_id: RAIDER_T1,
        site_admin: false,
        guild_officer: false,
        boe_manager: false
      });
      expect(person.teams).toHaveLength(1);
      expect(person.teams[0]).toMatchObject({ team_id: 1, team_member_id: RAIDER_T1_MEMBER, role: 'raider' });
      const chars = person.teams[0].characters;
      expect(chars.map((c) => c.player_id)).toEqual([1, 2]);
      expect(chars[0].archived_at).toBeNull();
      expect(chars[1].archived_at).not.toBeNull();
    });
  });

  it('finds someone known only through a guild-wide grant', async () => {
    await withTxn(async ({ asUser }) => {
      const person = await resolve(asUser, SITE_ADMIN, 'discord-site-admin');
      expect(person).toMatchObject({ site_admin: true, teams: [] });
    });
  });

  it('returns null for a Discord account nobody knows', async () => {
    await withTxn(async ({ asUser }) => {
      expect(await resolve(asUser, SITE_ADMIN, 'discord-nobody')).toBeNull();
    });
  });

  it('refuses a raider asking about someone else', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(resolve(asUser, RAIDER_T1, 'discord-officer-1')).rejects.toThrow(/Not authorized/);
    });
  });

  it('shows an officer only the teams they run, and hides the site admin and guild officer flags', async () => {
    await withTxn(async ({ asUser }) => {
      const fromOwnTeam = await resolve(asUser, OFFICER_T1, 'discord-raider-1');
      expect(fromOwnTeam.teams.map((t) => t.team_id)).toEqual([1]);
      expect(fromOwnTeam.site_admin).toBeNull();
      expect(fromOwnTeam.guild_officer).toBeNull();
      const fromOtherTeam = await resolve(asUser, OFFICER_T2, 'discord-raider-1');
      expect(fromOtherTeam.teams).toEqual([]);
    });
  });

  it('shows a guild officer every team', async () => {
    await withTxn(async ({ asUser }) => {
      const person = await resolve(asUser, GUILD_OFFICER, 'discord-officer-2');
      expect(person.teams.map((t) => t.team_id)).toEqual([2]);
      expect(person.site_admin).toBeNull();
    });
  });

  it('is not callable signed out', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon("select public.resolve_person('discord-raider-1')")).rejects.toThrow(/permission denied/);
    });
  });
});
