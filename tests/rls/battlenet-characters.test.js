// A person's characters from Battle.net (#942 step 5, #1162): the characters
// table, and the two writes the battlenet-characters Edge Function makes with
// the service role. The function's own gate (the token belongs to the caller)
// is tested under tests/edge/battlenet-characters/.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  insertDiscordUser,
  OFFICER_T1,
  OFFICER_T2,
  RAIDER_T1,
  SITE_ADMIN,
  GUILD_OFFICER
} from './helpers.js';

afterAll(() => pool.end());

// Invented here; no other file uses these ids.
const NEWBIE = '00000000-0000-0000-0000-0000000000d1';
const NEWBIE_DISCORD = 'discord-bnet-chars-1';
const BNET_ONLY = '00000000-0000-0000-0000-0000000000d2';

const personOf = async (q, uid) => (await q('select id from public.people where auth_user_id = $1', [uid])).rows[0].id;

const asService = async (q, text, params) => {
  await q('set local role service_role');
  try {
    return await q(text, params);
  } finally {
    await q('reset role');
  }
};

const link = (q, personId, characters) =>
  asService(q, 'select * from public.link_battlenet_roster_characters($1, $2::jsonb) order by player_id', [
    personId,
    JSON.stringify(characters)
  ]).then((r) => r.rows);

const save = (q, personId, characters) =>
  asService(q, 'select * from public.save_battlenet_characters($1, $2::jsonb)', [
    personId,
    JSON.stringify(characters)
  ]).then((r) => r.rows);

const newPlayer = (q, teamId, nameRealm, teamMemberId = null) =>
  q('insert into public.players (team_id, name_realm, team_member_id) values ($1, $2, $3) returning id', [
    teamId,
    nameRealm,
    teamMemberId
  ]).then((r) => r.rows[0].id);

const alt = (overrides = {}) => ({
  blizzard_id: 9001,
  name: 'Grihzy',
  realm: 'Illidan',
  realm_slug: 'illidan',
  class_name: 'Evoker',
  spec_name: 'Preservation',
  level: 90,
  item_level: 701,
  ...overrides
});

describe('link_battlenet_roster_characters()', () => {
  it('links an unclaimed roster character and makes the person a raider on that team', async () => {
    await withTxn(async ({ q }) => {
      await insertDiscordUser(q, NEWBIE, NEWBIE_DISCORD);
      const person = await personOf(q, NEWBIE);
      const playerId = await newPlayer(q, 2, 'Bnetfind-Area 52');

      const rows = await link(q, person, [{ name: 'Bnetfind', realm: 'Area 52' }]);
      expect(rows).toEqual([{ player_id: playerId, team_id: 2, name_realm: 'Bnetfind-Area 52', outcome: 'linked' }]);

      const member = (
        await q(
          'select tm.role, tm.person_id from public.players p join public.team_members tm on tm.id = p.team_member_id where p.id = $1',
          [playerId]
        )
      ).rows[0];
      expect(member).toEqual({ role: 'raider', person_id: person });
    });
  });

  it('matches on the name-realm key, so spacing and case do not matter', async () => {
    await withTxn(async ({ q }) => {
      await insertDiscordUser(q, NEWBIE, NEWBIE_DISCORD);
      const person = await personOf(q, NEWBIE);
      await newPlayer(q, 2, 'Bnetfind-Area52');

      const rows = await link(q, person, [{ name: 'BNETFIND', realm: 'Area 52' }]);
      expect(rows.map((r) => r.outcome)).toEqual(['linked']);
    });
  });

  it('reuses an existing membership on that team', async () => {
    await withTxn(async ({ q }) => {
      // RAIDER_T1 is team_members id 3 on team 1.
      const person = await personOf(q, RAIDER_T1);
      const playerId = await newPlayer(q, 1, 'Secondchar-Illidan');

      expect((await link(q, person, [{ name: 'Secondchar', realm: 'Illidan' }]))[0].outcome).toBe('linked');
      expect(
        (await q('select team_member_id from public.players where id = $1', [playerId])).rows[0].team_member_id
      ).toBe(3);
      expect(
        (await q('select count(*)::int n from public.team_members where person_id = $1', [person])).rows[0].n
      ).toBe(1);
    });
  });

  it("reports a character already the person's, and leaves someone else's claim alone", async () => {
    await withTxn(async ({ q }) => {
      const person = await personOf(q, RAIDER_T1);
      const mine = await newPlayer(q, 1, 'Minealready-Illidan', 3);
      // team_members id 1 is OFFICER_T1.
      const theirs = await newPlayer(q, 1, 'Theirsalready-Illidan', 1);

      const rows = await link(q, person, [
        { name: 'Minealready', realm: 'Illidan' },
        { name: 'Theirsalready', realm: 'Illidan' }
      ]);
      expect(rows).toEqual([
        { player_id: mine, team_id: 1, name_realm: 'Minealready-Illidan', outcome: 'already_yours' },
        { player_id: theirs, team_id: 1, name_realm: 'Theirsalready-Illidan', outcome: 'claimed_by_someone_else' }
      ]);
      expect(
        (await q('select team_member_id from public.players where id = $1', [theirs])).rows[0].team_member_id
      ).toBe(1);
    });
  });

  it('asks a person with no Discord linked to connect it, and links nothing', async () => {
    await withTxn(async ({ q }) => {
      await q('insert into auth.users (id) values ($1)', [BNET_ONLY]);
      await q(
        `insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
         values ('bnet-123', $1::uuid, jsonb_build_object('sub', $2::text), 'custom:battlenet', now(), now())`,
        [BNET_ONLY, BNET_ONLY]
      );
      const person = await personOf(q, BNET_ONLY);
      const playerId = await newPlayer(q, 2, 'Nodiscord-Illidan');

      expect((await link(q, person, [{ name: 'Nodiscord', realm: 'Illidan' }]))[0].outcome).toBe('needs_discord');
      expect(
        (await q('select team_member_id from public.players where id = $1', [playerId])).rows[0].team_member_id
      ).toBeNull();
    });
  });

  it('ignores archived roster rows and characters on no roster', async () => {
    await withTxn(async ({ q }) => {
      await insertDiscordUser(q, NEWBIE, NEWBIE_DISCORD);
      const person = await personOf(q, NEWBIE);
      const archived = await newPlayer(q, 2, 'Oldmain-Illidan');
      await q('update public.players set archived_at = now() where id = $1', [archived]);

      expect(
        await link(q, person, [
          { name: 'Oldmain', realm: 'Illidan' },
          { name: 'Nobody', realm: 'Nowhere' }
        ])
      ).toEqual([]);
    });
  });
});

describe('save_battlenet_characters()', () => {
  it('saves the picked characters and replaces an earlier pick', async () => {
    await withTxn(async ({ q }) => {
      const person = await personOf(q, RAIDER_T1);
      await save(q, person, [alt(), alt({ blizzard_id: 9002, name: 'Grihzdruid', class_name: 'Druid' })]);

      const rows = await save(q, person, [alt({ item_level: 705 })]);
      expect(rows.map((r) => [r.blizzard_id, r.name_realm, r.name_realm_key, r.item_level])).toEqual([
        ['9001', 'Grihzy-Illidan', 'grihzy-illidan', 705]
      ]);
    });
  });

  it('moves a character another person had saved, since the token shows it is this person now', async () => {
    await withTxn(async ({ q }) => {
      const before = await personOf(q, OFFICER_T1);
      const after = await personOf(q, RAIDER_T1);
      await save(q, before, [alt()]);
      await save(q, after, [alt()]);

      expect((await q('select person_id from public.characters where blizzard_id = 9001')).rows[0].person_id).toBe(
        after
      );
    });
  });

  it('is not callable by a signed-in account, only by the service role', async () => {
    await withTxn(async ({ q, asUser }) => {
      const person = await personOf(q, RAIDER_T1);
      for (const sql of [
        'select * from public.save_battlenet_characters($1, $2::jsonb)',
        'select * from public.link_battlenet_roster_characters($1, $2::jsonb)'
      ]) {
        await expect(asUser(RAIDER_T1, sql, [person, '[]'])).rejects.toThrow(/permission denied/);
      }
      await expect(asUser(RAIDER_T1, 'select public.battlenet_account_id($1)', [RAIDER_T1])).rejects.toThrow(
        /permission denied/
      );
    });
  });
});

describe('who reads characters', () => {
  it('the person, an officer of their team, a site admin and a guild officer; not another team or anon', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      // RAIDER_T1 is on team 1.
      const person = await personOf(q, RAIDER_T1);
      await save(q, person, [alt()]);
      const count = async (run) => (await run('select id from public.characters where blizzard_id = 9001')).rows.length;

      expect(await count((t) => asUser(RAIDER_T1, t))).toBe(1);
      expect(await count((t) => asUser(OFFICER_T1, t))).toBe(1);
      expect(await count((t) => asUser(SITE_ADMIN, t))).toBe(1);
      expect(await count((t) => asUser(GUILD_OFFICER, t))).toBe(1);
      expect(await count((t) => asUser(OFFICER_T2, t))).toBe(0);
      expect(await count(asAnon)).toBe(0);
    });
  });

  it('no signed-in account writes characters directly', async () => {
    await withTxn(async ({ q, asUser }) => {
      const person = await personOf(q, RAIDER_T1);
      await expect(
        asUser(
          RAIDER_T1,
          `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug) values (${person}, 1, 'x', 'y', 'y')`
        )
      ).rejects.toThrow(/row-level security/);
    });
  });
});
