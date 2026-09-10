// The personas a snapshot mints are real grants, not impersonation (#1065).
//
// After `npm run db:snapshot` the seeded people are gone and every restored
// link into auth.users is null. The persona batch then mints, from the teams
// table, an officer, a team leader and a raider per team plus admin,
// guild-officer and boe-manager: an account, an identity, a grant row bound in
// the same batch, and for each raider one character of its own. Every gate
// reads auth_user_id = auth.uid() and nothing else, so to RLS these rows are
// exactly what a real officer's row is.
//
// The batch runs here against the seeded stack inside one rolled-back
// transaction. Deleting auth.users first is a faithful model of a --no-seed
// stack: the seed's grant rows stay and lose their links through ON DELETE SET
// NULL, which is the state the unlink step leaves a restore in. The
// precondition is asserted rather than assumed, because the link trigger fires
// on auth.users inserts and a fixture in the wrong order would quietly change
// what is under test (2026-09-04).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn } from './helpers.js';
import { PERSONAS_SQL } from '../../scripts/dev/snapshot-personas.js';

afterAll(() => pool.end());

const GRANT_TABLES = ['team_members', 'site_admins', 'guild_officers', 'boe_managers'];

const SEEDED = {
  members: "select count(*)::int as n from public.team_members where discord_id not like '9%'",
  players: "select count(*)::int as n from public.players where name_realm not like '%-Persona'"
};

/**
 * Empties auth.users, proves it, runs the batch, and hands the test its
 * transaction plus the seeded row counts taken before the batch ran.
 */
function onSnapshot(fn) {
  return withTxn(async (txn) => {
    const { q } = txn;
    await q('delete from auth.users');
    const empty = await q('select count(*)::int as n from auth.users');
    expect(empty.rows[0].n).toBe(0);
    const unlinked = await q(`select count(*)::int as n from public.team_members where auth_user_id is not null`);
    expect(unlinked.rows[0].n).toBe(0);
    const before = {
      members: (await q(SEEDED.members)).rows[0].n,
      players: (await q(SEEDED.players)).rows[0].n
    };
    await q(PERSONAS_SQL);
    return fn({ ...txn, before });
  });
}

async function uidOf(q, name) {
  const { rows } = await q('select id from auth.users where email = $1', [`${name}@wga.local`]);
  expect(rows.length, `${name} was not minted`).toBe(1);
  return rows[0].id;
}

describe('the persona batch on a snapshot-shaped stack (#1065)', () => {
  it('mints three people per team plus the three guild-wide ones, all at wga.local', () =>
    onSnapshot(async ({ q }) => {
      // Expected from the teams table, not written down: the seed holds two
      // teams and a migration adds a third (Wrathless), and production has
      // four. A team added anywhere gets its three people with no code change.
      const teams = await q('select slug from public.teams');
      const expected = ['admin', 'boe-manager', 'guild-officer'];
      for (const { slug } of teams.rows) expected.push(`${slug}-officer`, `${slug}-leader`, `${slug}-raider`);
      expect(teams.rows.length).toBeGreaterThan(1);

      const { rows } = await q("select email from auth.users where email like '%@wga.local' order by email");
      expect(rows.map((r) => r.email.replace('@wga.local', ''))).toEqual(expected.sort());
      const stray = await q("select count(*)::int as n from auth.users where email not like '%@wga.local'");
      expect(stray.rows[0].n).toBe(0);
    }));

  it('gives every account what the auth service needs to issue a link', () =>
    onSnapshot(async ({ q }) => {
      // The same three details the seed carries (#1053): aud and role,
      // token columns that are strings rather than nulls, and an identities
      // row so the account looks like one that signed in.
      const { rows } = await q(`
        select u.email
          from auth.users u
          left join auth.identities i on i.user_id = u.id
         where u.aud <> 'authenticated' or u.role <> 'authenticated'
            or u.confirmation_token is null or u.recovery_token is null
            or u.email_change is null or u.email_change_token_new is null
            or u.email_confirmed_at is null
            or i.user_id is null
      `);
      expect(rows.map((r) => r.email)).toEqual([]);
    }));

  it('reserves 20-digit ids starting with 9 and binds each account to its grant row directly', () =>
    onSnapshot(async ({ q }) => {
      // Not through the link trigger: the trigger is a convenience for real
      // sign-ins and the batch does not lean on it. provider_id still equals
      // the grant's discord_id, because the site reads it back off the session.
      for (const table of GRANT_TABLES) {
        const { rows } = await q(`
          select g.discord_id, u.raw_user_meta_data ->> 'provider_id' as provider_id
            from public.${table} g
            join auth.users u on u.id = g.auth_user_id
        `);
        expect(rows.length, `${table} got no persona`).toBeGreaterThan(0);
        for (const { discord_id, provider_id } of rows) {
          expect(discord_id).toMatch(/^9\d{19}$/);
          expect(provider_id).toBe(discord_id);
        }
      }
    }));

  it('only adds rows: the seeded grants stay unlinked and uncounted, the seeded players untouched', () =>
    onSnapshot(async ({ q, before }) => {
      for (const table of GRANT_TABLES) {
        const { rows } = await q(`
          select count(*)::int as linked
            from public.${table}
           where discord_id not like '9%' and auth_user_id is not null
        `);
        expect(rows[0].linked, `${table}: a seeded row was bound`).toBe(0);
      }
      expect((await q(SEEDED.members)).rows[0].n).toBe(before.members);
      expect((await q(SEEDED.players)).rows[0].n).toBe(before.players);
    }));

  it('answers the role helpers for the right persona and no other', () =>
    onSnapshot(async ({ q, asUser }) => {
      const officer = await uidOf(q, 'phoenix-officer');
      const leader = await uidOf(q, 'hellfire-leader');
      const admin = await uidOf(q, 'admin');
      const guild = await uidOf(q, 'guild-officer');
      const boe = await uidOf(q, 'boe-manager');
      const role = async (uid, team) => (await asUser(uid, 'select public.my_team_role($1) as r', [team])).rows[0].r;
      const flag = async (uid, fn) => (await asUser(uid, `select public.${fn}() as f`)).rows[0].f;

      expect(await role(officer, 1)).toBe('officer');
      expect(await role(officer, 2)).toBeNull();
      expect(await role(leader, 2)).toBe('team_leader');
      expect(await role(leader, 1)).toBeNull();
      expect(await role(admin, 1)).toBeNull();

      expect(await flag(admin, 'is_site_admin')).toBe(true);
      expect(await flag(officer, 'is_site_admin')).toBe(false);
      expect(await flag(guild, 'is_guild_officer')).toBe(true);
      expect(await flag(admin, 'is_guild_officer')).toBe(false);
      expect(await flag(boe, 'is_boe_manager')).toBe(true);
      expect(await flag(officer, 'is_boe_manager')).toBe(false);
    }));

  it('reads real rows through the policies, as an officer and as a raider', () =>
    onSnapshot(async ({ q, asUser }) => {
      const officer = await uidOf(q, 'phoenix-officer');
      const raider = await uidOf(q, 'phoenix-raider');
      const all = await q('select count(*)::int as n from public.team_members where team_id = 1');

      const asOfficer = await asUser(officer, 'select count(*)::int as n from public.team_members where team_id = 1');
      expect(asOfficer.rows[0].n).toBe(all.rows[0].n);

      const asRaider = await asUser(raider, 'select auth_user_id from public.team_members where team_id = 1');
      expect(asRaider.rows.map((r) => r.auth_user_id)).toEqual([raider]);
    }));

  it('gives each raider a character of its own, linked the way the profile page looks it up', () =>
    onSnapshot(async ({ q, asUser }) => {
      // js/discord.js resolves the signed-in character as
      // players.team_member_id = the member row, so a raider with none lands
      // on the claim flow, which on a snapshot offers only real people.
      const raider = await uidOf(q, 'phoenix-raider');
      const member = await asUser(raider, 'select id from public.team_members where auth_user_id = auth.uid()');
      expect(member.rows.length).toBe(1);
      const character = await asUser(
        raider,
        'select name_realm, team_id from public.players where team_member_id = $1 and archived_at is null',
        [member.rows[0].id]
      );
      expect(character.rows).toEqual([{ name_realm: 'Phoenixraider-Persona', team_id: 1 }]);

      const officer = await uidOf(q, 'phoenix-officer');
      const none = await asUser(officer, 'select id from public.team_members where auth_user_id = auth.uid()');
      const officerCharacter = await q('select count(*)::int as n from public.players where team_member_id = $1', [
        none.rows[0].id
      ]);
      expect(officerCharacter.rows[0].n).toBe(0);
    }));
});
