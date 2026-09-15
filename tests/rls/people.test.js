// The people table (#942 step 1).
//
// A person is every sign-in account plus every Discord id listed on a grant
// before its owner signs in. team_members carries person_id, kept level with
// discord_id by trigger; the guild-wide grants are guild_grants rows naming the
// person (step 2); the sign-in trigger attaches the account.
// Nothing reads person_id yet, so these cases pin the row itself: who gets
// one, which row a grant points at, and the Battle.net-first merge.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser, grantGuild, RAIDER_T1, OFFICER_T2 } from './helpers.js';

afterAll(() => pool.end());

// Team 4 'Wrathless' seeds three members (team_members ids 9 to 11). The
// Discord ids below are invented, so a team_members row here collides with
// none of them; a case counting team 4 rows has to allow for the seeded three.
const WRATHLESS = 4;

// Invented here; no other file uses these ids.
const LISTED = 'people-listed-1';
const LISTED_UID = '00000000-0000-0000-0000-0000000000f1';
const FRESH = 'people-fresh-1';
const FRESH_UID = '00000000-0000-0000-0000-0000000000f2';
const BNET_UID = '00000000-0000-0000-0000-0000000000f3';
const BNET_DISCORD = 'people-bnet-discord-1';
const BNET_LISTED_UID = '00000000-0000-0000-0000-0000000000f4';
const BNET_LISTED = 'people-bnet-listed-1';
const TAMPER = 'people-tamper-1';

async function insertBattlenetUser(q, uid) {
  await q('insert into auth.users (id) values ($1)', [uid]);
  await q(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
     values ($1::text, $2::uuid, jsonb_build_object('sub', $3::text), 'custom:battlenet', now(), now())`,
    [`bnet-${uid}`, uid, uid]
  );
}

async function connectDiscord(q, uid, discordId) {
  await q(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
     values ($1::text, $2::uuid, jsonb_build_object('sub', $3::text), 'discord', now(), now())`,
    [discordId, uid, uid]
  );
}

const personByDiscord = (q, discordId) =>
  q('select id, auth_user_id, discord_id from public.people where discord_id = $1', [discordId]).then((r) => r.rows[0]);
const personByAccount = (q, uid) =>
  q('select id, auth_user_id, discord_id from public.people where auth_user_id = $1', [uid]).then((r) => r.rows[0]);

describe('every grant row points at a person (#942)', () => {
  it('backfilled seeded grants: every row has a person holding its Discord id', async () => {
    await withTxn(async ({ q }) => {
      const { rows } = await q(`
        select t.tbl, count(*)::int n
          from (
            select 'team_members' tbl, person_id, discord_id from public.team_members
            union all select 'site_admins', person_id, discord_id from public.site_admins
            union all select 'guild_officers', person_id, discord_id from public.guild_officers
            union all select 'boe_managers', person_id, discord_id from public.boe_managers
          ) t
          left join public.people p on p.id = t.person_id and p.discord_id = t.discord_id
         where p.id is null
         group by t.tbl`);
      expect(rows).toEqual([]);
    });
  });

  it('one person across both teams and all three guild grants for one Discord id', async () => {
    await withTxn(async ({ q }) => {
      await q('insert into public.team_members (team_id, discord_id, role) values (3, $1, $2), ($3, $1, $2)', [
        LISTED,
        'officer',
        WRATHLESS
      ]);
      await grantGuild(q, LISTED, 'site_admin');
      await grantGuild(q, LISTED, 'guild_officer');
      await grantGuild(q, LISTED, 'boe_manager');

      const person = await personByDiscord(q, LISTED);
      expect(person.auth_user_id).toBeNull();
      const { rows } = await q(
        `select distinct person_id from (
           select person_id from public.team_members where discord_id = $1
           union all select person_id from public.site_admins where discord_id = $1
           union all select person_id from public.guild_officers where discord_id = $1
           union all select person_id from public.boe_managers where discord_id = $1) x`,
        [LISTED]
      );
      expect(rows).toEqual([{ person_id: person.id }]);
    });
  });

  it('a person_id written directly is replaced by the one discord_id names', async () => {
    await withTxn(async ({ q }) => {
      const other = await q('select person_id from public.team_members where auth_user_id = $1', [OFFICER_T2]);
      await q('insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3)', [
        WRATHLESS,
        TAMPER,
        'raider'
      ]);
      await q('update public.team_members set person_id = $1 where discord_id = $2', [other.rows[0].person_id, TAMPER]);
      const { rows } = await q('select person_id from public.team_members where discord_id = $1', [TAMPER]);
      expect(rows[0].person_id).toBe((await personByDiscord(q, TAMPER)).id);
    });
  });
});

describe('signing in attaches the account to the person (#942)', () => {
  it('a listed Discord id gets its account on first sign-in, and no second person', async () => {
    await withTxn(async ({ q }) => {
      await q('insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3)', [
        WRATHLESS,
        LISTED,
        'officer'
      ]);
      const before = await personByDiscord(q, LISTED);

      await insertDiscordUser(q, LISTED_UID, LISTED);

      expect(await personByDiscord(q, LISTED)).toEqual({ ...before, auth_user_id: LISTED_UID });
      expect((await personByAccount(q, LISTED_UID)).id).toBe(before.id);
    });
  });

  it('a Discord sign-up nobody listed becomes a person with both ids', async () => {
    await withTxn(async ({ q }) => {
      await insertDiscordUser(q, FRESH_UID, FRESH);
      expect(await personByAccount(q, FRESH_UID)).toMatchObject({ auth_user_id: FRESH_UID, discord_id: FRESH });
    });
  });

  it('a Battle.net sign-in becomes a person, and connecting Discord later adds the id to it', async () => {
    await withTxn(async ({ q }) => {
      await insertBattlenetUser(q, BNET_UID);
      const person = await personByAccount(q, BNET_UID);
      expect(person.discord_id).toBeNull();

      await connectDiscord(q, BNET_UID, BNET_DISCORD);

      expect(await personByAccount(q, BNET_UID)).toEqual({ ...person, discord_id: BNET_DISCORD });
    });
  });

  it('Battle.net first, then a Discord id someone listed: the listed person takes the account', async () => {
    await withTxn(async ({ q }) => {
      await q('insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3)', [
        WRATHLESS,
        BNET_LISTED,
        'officer'
      ]);
      const listed = await personByDiscord(q, BNET_LISTED);
      await insertBattlenetUser(q, BNET_LISTED_UID);
      const own = await personByAccount(q, BNET_LISTED_UID);
      expect(own.id).not.toBe(listed.id);

      await connectDiscord(q, BNET_LISTED_UID, BNET_LISTED);

      expect(await personByAccount(q, BNET_LISTED_UID)).toEqual({ ...listed, auth_user_id: BNET_LISTED_UID });
      const gone = await q('select 1 from public.people where id = $1', [own.id]);
      expect(gone.rowCount).toBe(0);
    });
  });

  it('discarding an empty Battle.net account removes its person; a listed person keeps its row', async () => {
    await withTxn(async ({ q }) => {
      await insertBattlenetUser(q, BNET_UID);
      const empty = await personByAccount(q, BNET_UID);
      await q('insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3)', [
        WRATHLESS,
        LISTED,
        'officer'
      ]);
      await insertDiscordUser(q, LISTED_UID, LISTED);
      const listed = await personByDiscord(q, LISTED);

      await q('delete from auth.users where id = any($1::uuid[])', [[BNET_UID, LISTED_UID]]);

      expect((await q('select 1 from public.people where id = $1', [empty.id])).rowCount).toBe(0);
      expect(await personByDiscord(q, LISTED)).toEqual({ ...listed, auth_user_id: null });
    });
  });
});

describe('who reads people (#942)', () => {
  it('a signed-in account reads only its own row; anon reads none', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const own = await personByAccount(q, RAIDER_T1);
      const { rows } = await asUser(RAIDER_T1, 'select id from public.people');
      expect(rows).toEqual([{ id: own.id }]);
      expect((await asAnon('select id from public.people')).rowCount).toBe(0);
    });
  });

  // No write rule exists, so the default table grants reach nothing.
  it('a signed-in account writes no people row directly, not even its own', async () => {
    await withTxn(async ({ q, asUser }) => {
      await expect(asUser(RAIDER_T1, "insert into public.people (discord_id) values ('x')")).rejects.toThrow(
        /row-level security/
      );
      expect((await asUser(RAIDER_T1, "update public.people set discord_id = 'x'")).rowCount).toBe(0);
      expect((await asUser(RAIDER_T1, 'delete from public.people')).rowCount).toBe(0);
      expect(await personByAccount(q, RAIDER_T1)).toBeDefined();
    });
  });
});
