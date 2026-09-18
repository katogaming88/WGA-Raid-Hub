// Behavior tests for claim_character() and the team_members self-read policy
// (#212), plus the on_auth_user_created trigger capture (#211 login link).
// Lives in the RLS suite because it needs the live local stack: the function
// is SECURITY DEFINER, its authorization is RLS-shaped, and the trigger fires
// on auth.users.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn): fixture
// writes happen as postgres (bypasses RLS), the claim happens as the
// impersonated caller, and assertions happen back as postgres. A savepoint
// wraps each impersonated call so an expected raise does not abort the whole
// transaction (and does not mask the real error when the role reset runs
// inside an aborted transaction).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, grantGuild, RAIDER_T1 } from './helpers.js';

// Seeded rows this file leans on (supabase/seed.sql): player 1 is team 1
// 'Seedraider-Illidan', player 2 is team 1 'Seedplayertwo-Illidan', player 3
// is team 2. team_members 3 is the team 1 raider (auth_user_id = RAIDER_T1,
// name_realm 'Seedraider-Illidan'). The migration's one-time name_realm
// backfill is a no-op on a fresh DB (it runs before seed.sql loads), so every
// seeded player starts unlinked.

const claim = (asUser, uid, teamId, nameRealm) =>
  asUser(uid, 'select * from public.claim_character($1, $2)', [teamId, nameRealm]);

// An account and the Discord identity behind it, which is what fires the link
// trigger since #1135; callers pass a distinct uuid and Discord id per test.
const addAuthUser = (q, uid, providerId) => insertDiscordUser(q, uid, providerId);

describe('team_members self-read policy', () => {
  it('a raider sees exactly their own row', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(RAIDER_T1, 'select id, team_id from public.team_members');
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].team_id).toBe(1);
    });
  });

  it("a raider does not see another team's members", async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(RAIDER_T1, 'select id from public.team_members where team_id = 2');
      expect(res.rows).toHaveLength(0);
    });
  });

  it('anon sees no team_members', async () => {
    await withTxn(async ({ asAnon }) => {
      const res = await asAnon('select id from public.team_members');
      expect(res.rows).toHaveLength(0);
    });
  });
});

describe('claim_character rejects invalid claims', () => {
  it('anon cannot execute the function', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select * from public.claim_character(1, $1)', ['Seedplayertwo-Illidan'])).rejects.toThrow();
    });
  });

  it('a character not on the roster is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(claim(asUser, RAIDER_T1, 1, 'Ghost-Illidan')).rejects.toThrow(/not found on roster/);
    });
  });

  it('an archived character is rejected', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        "insert into public.players (team_id, name_realm, class_spec_id, archived_at) values (1, 'Archived-Illidan', 1, now())"
      );
      await expect(claim(asUser, RAIDER_T1, 1, 'Archived-Illidan')).rejects.toThrow(/not found on roster/);
    });
  });

  it('an already-claimed character is rejected', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = 1 where id = 2');
      await expect(claim(asUser, RAIDER_T1, 1, 'Seedplayertwo-Illidan')).rejects.toThrow(/already claimed/);
    });
  });
});

describe('claim_character links a character to the caller', () => {
  it('a brand-new user gets a raider team_members row and the player link', async () => {
    await withTxn(async ({ q, asUser }) => {
      const uid = '00000000-0000-0000-0000-0000000000aa';
      await addAuthUser(q, uid, 'discord-brandnew');

      const res = await claim(asUser, uid, 1, 'Seedplayertwo-Illidan');
      expect(res.rows[0].name_realm).toBe('Seedplayertwo-Illidan');
      expect(res.rows[0].role).toBe('raider');

      const members = (await q('select * from public.team_members where auth_user_id = $1', [uid])).rows;
      expect(members).toHaveLength(1);
      expect(members[0].discord_id).toBe('discord-brandnew');
      expect(members[0].role).toBe('raider');
      expect(members[0].team_id).toBe(1);

      const player = (
        await q("select team_member_id from public.players where name_realm = 'Seedplayertwo-Illidan' and team_id = 1")
      ).rows[0];
      expect(player.team_member_id).toBe(members[0].id);
    });
  });

  it('reuses an unlinked Discord-id row instead of inserting a duplicate', async () => {
    await withTxn(async ({ q, asUser }) => {
      const uid = '00000000-0000-0000-0000-0000000000bb';
      // Insert the auth user first so the login trigger runs before the
      // team_members row exists. That leaves the row unlinked, which is the
      // case claim_character's discord_id fallback covers -- a blind insert
      // here would violate team_members_team_id_discord_id_key.
      await addAuthUser(q, uid, 'discord-late');
      await q(
        "insert into public.team_members (team_id, discord_id, role, name_realm) values (1, 'discord-late', 'raider', 'Latecomer-Illidan')"
      );

      await claim(asUser, uid, 1, 'Seedplayertwo-Illidan');

      const rows = (await q("select id, auth_user_id from public.team_members where discord_id = 'discord-late'")).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0].auth_user_id).toBe(uid);
      const player = (
        await q("select team_member_id from public.players where name_realm = 'Seedplayertwo-Illidan' and team_id = 1")
      ).rows[0];
      expect(player.team_member_id).toBe(rows[0].id);
    });
  });

  it('an existing member claiming a second character reuses their row (alts)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const before = (await q('select count(*)::int as n from public.team_members')).rows[0].n;
      await claim(asUser, RAIDER_T1, 1, 'Seedplayertwo-Illidan');
      const after = (await q('select count(*)::int as n from public.team_members')).rows[0].n;
      expect(after).toBe(before);

      const memberId = (await q('select id from public.team_members where auth_user_id = $1', [RAIDER_T1])).rows[0].id;
      const player = (
        await q("select team_member_id from public.players where name_realm = 'Seedplayertwo-Illidan' and team_id = 1")
      ).rows[0];
      expect(player.team_member_id).toBe(memberId);
    });
  });
});

// #1117 put a guard on the discord_id fallback, which used to resolve the
// caller from raw_user_meta_data and so handed over a team_members row that
// already belonged to somebody. #1135 resolved the same fallback from
// auth.identities, which closes that route one step earlier: an account cannot
// present as a Discord id it does not hold, so it never reaches the guard.
//
// Both halves are worth a case. The first group is the forgery, which now goes
// nowhere. The second constructs the collision #1117's guard exists for, which
// after #1135 only legacy data can produce, and checks the guard still refuses.
describe('a forged Discord id in metadata reaches nobody else row', () => {
  const IMPOSTOR = '00000000-0000-0000-0000-0000000000c1';
  // team_members 4 is the hellfire officer (discord-officer-2), linked to user
  // 5, and hellfire has an unclaimed seeded character.
  const OFFICER_DISCORD = 'discord-officer-2';
  const OFFICER_UID = '00000000-0000-0000-0000-000000000005';
  const IMPOSTOR_DISCORD = 'discord-impostor-claim';
  const HELLFIRE = 2;
  const TARGET = 'Seedhellfire-Illidan';

  // Metadata claiming the officer Discord id, over an identity row that says
  // otherwise. The metadata is exactly what the account itself can write.
  const addImpostor = (q) => insertDiscordUser(q, IMPOSTOR, IMPOSTOR_DISCORD, OFFICER_DISCORD);

  it('leaves the officer row with its owner', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addImpostor(q);
      await claim(asUser, IMPOSTOR, HELLFIRE, TARGET);

      const row = (await q('select auth_user_id from public.team_members where id = 4')).rows[0];
      expect(row.auth_user_id).toBe(OFFICER_UID);
    });
  });

  it('gives the impostor a raider row on their own Discord id, not the officer role', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addImpostor(q);
      const res = await claim(asUser, IMPOSTOR, HELLFIRE, TARGET);
      expect(res.rows[0].role).toBe('raider');

      const rows = (await q('select discord_id, role from public.team_members where auth_user_id = $1', [IMPOSTOR]))
        .rows;
      expect(rows).toEqual([{ discord_id: IMPOSTOR_DISCORD, role: 'raider' }]);
    });
  });

  it('still lets the rightful owner claim on that team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await claim(asUser, OFFICER_UID, HELLFIRE, TARGET);
      expect(res.rows[0].role).toBe('officer');

      const player = (
        await q('select team_member_id from public.players where name_realm = $1 and team_id = $2', [TARGET, HELLFIRE])
      ).rows[0];
      expect(player.team_member_id).toBe(4);
    });
  });
});

describe("a team_members row's account is always its person's (#942 step 3)", () => {
  const CALLER = '00000000-0000-0000-0000-0000000000c2';
  const OTHER = '00000000-0000-0000-0000-000000000005';
  const SHARED_DISCORD = 'discord-legacy-collision';
  const HELLFIRE = 2;
  const TARGET = 'Seedhellfire-Illidan';

  // Until step 3, claim_character refused a row carrying the caller's own
  // Discord id but linked to somebody else (#1117). That row can no longer be
  // written: whatever auth_user_id a write names, the row gets the account of
  // the person its Discord id belongs to.
  it('a row written with another account gets the Discord id owner instead, and the owner can claim', async () => {
    await withTxn(async ({ q, asUser }) => {
      await insertDiscordUser(q, CALLER, SHARED_DISCORD);
      const memberId = (
        await q(
          `insert into public.team_members (team_id, discord_id, auth_user_id, role)
           values ($1, $2, $3, 'officer') returning id`,
          [HELLFIRE, SHARED_DISCORD, OTHER]
        )
      ).rows[0].id;
      expect(
        (await q('select auth_user_id from public.team_members where id = $1', [memberId])).rows[0].auth_user_id
      ).toBe(CALLER);

      await claim(asUser, CALLER, HELLFIRE, TARGET);
      const player = (
        await q('select team_member_id from public.players where name_realm = $1 and team_id = $2', [TARGET, HELLFIRE])
      ).rows[0];
      expect(player.team_member_id).toBe(memberId);
    });
  });

  it('a team leader cannot point a membership on their team at another account', async () => {
    await withTxn(async ({ q, asUser }) => {
      // team_members id 3 is the seeded team 1 raider (RAIDER_T1).
      await asUser(
        '00000000-0000-0000-0000-000000000002',
        'update public.team_members set auth_user_id = $1 where id = 3',
        [OTHER]
      );
      expect((await q('select auth_user_id from public.team_members where id = 3')).rows[0].auth_user_id).toBe(
        RAIDER_T1
      );
    });
  });
});

describe('the one-time name_realm backfill links matching players', () => {
  it('sets team_member_id where a team_members.name_realm matches a player', async () => {
    await withTxn(async ({ q }) => {
      // player 1 matches team_members 3 by name_realm but starts unlinked (the
      // migration backfill ran before seed.sql loaded this row).
      const before = (
        await q("select team_member_id from public.players where name_realm = 'Seedraider-Illidan' and team_id = 1")
      ).rows[0];
      expect(before.team_member_id).toBeNull();

      await q(`update public.players p
                  set team_member_id = tm.id
                 from public.team_members tm
                where p.team_id = tm.team_id
                  and p.name_realm = tm.name_realm
                  and p.team_member_id is null`);

      const after = (
        await q("select team_member_id from public.players where name_realm = 'Seedraider-Illidan' and team_id = 1")
      ).rows[0];
      const member3 = (await q("select id from public.team_members where discord_id = 'discord-raider-1'")).rows[0].id;
      expect(after.team_member_id).toBe(member3);
    });
  });
});

describe('on_auth_user_created backfills auth_user_id (trigger capture)', () => {
  it('links a team_members row by Discord provider_id on user insert', async () => {
    await withTxn(async ({ q }) => {
      const uid = '00000000-0000-0000-0000-0000000000cc';
      await q(
        "insert into public.team_members (team_id, discord_id, role, name_realm) values (1, 'discord-trig', 'raider', 'Trig-Illidan')"
      );
      await addAuthUser(q, uid, 'discord-trig');
      const member = (await q("select auth_user_id from public.team_members where discord_id = 'discord-trig'"))
        .rows[0];
      expect(member.auth_user_id).toBe(uid);
    });
  });

  it('links a site admin grant by Discord provider_id on user insert', async () => {
    await withTxn(async ({ q }) => {
      const uid = '00000000-0000-0000-0000-0000000000dd';
      await grantGuild(q, 'discord-admin-trig', 'site_admin');
      await addAuthUser(q, uid, 'discord-admin-trig');
      const admin = (await q("select auth_user_id from public.site_admins where discord_id = 'discord-admin-trig'"))
        .rows[0];
      expect(admin.auth_user_id).toBe(uid);
    });
  });
});

afterAll(() => pool.end());
