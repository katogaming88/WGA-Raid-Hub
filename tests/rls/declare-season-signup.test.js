// A season signup records who signed up and which of their characters (#1465,
// part of #1342): declare_season_signup() signs the signed-in person up from
// their own saved characters, one signup per person per team per tier, and
// add_signup_to_roster() links the roster row to the signer's membership.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, RAIDER_T1 } from './helpers.js';

afterAll(() => pool.end());

// Seeded: membership 3 is the raider on Phoenix (team 1); classes_specs 1 is
// Mage Frost. Signups are for a tier that has not started (Kat, 2026-10-23),
// so each case makes its own future tier and opens it. The seeded tier began
// in January, which is the started case.
const PHOENIX_RAIDER_MEMBER = 3;
const FROST_MAGE = 1;
const STARTS = { 'next-season': '2099-01-01', 'closed-season': '2099-06-01' };

async function openSignups(q, season = 'next-season', open = true) {
  if (STARTS[season]) {
    // The running tier ends before the next one, as the migration adding a
    // tier sets it (the seed leaves MID2 open-ended).
    await q("update public.seasons set ends_at = '2098-12-31' where ends_at is null");
    await q('insert into public.seasons (code, display_name, starts_at, ends_at) values ($1, $1, $2, $2::date + 60)', [
      season,
      STARTS[season]
    ]);
  }
  await q('insert into public.team_seasons (team_id, season_code, signups_open) values (1, $1, $2)', [season, open]);
}

const personOf = async (q, memberId = PHOENIX_RAIDER_MEMBER) =>
  (await q('select person_id from public.team_members where id = $1', [memberId])).rows[0].person_id;

async function character(q, personId, { name = 'Nextmain', characterClass = 'Mage' } = {}) {
  const { rows } = await q(
    `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level)
     values ($1, $2, $3, 'Illidan', 'illidan', $4, 'Frost', 90) returning id`,
    [personId, Math.floor(Math.random() * 1e9), name, characterClass]
  );
  return rows[0].id;
}

const declare = (
  asUser,
  uid,
  characterId,
  {
    season = 'next-season',
    spec = FROST_MAGE,
    offSpecs = null,
    note = null,
    backupTank = false,
    backupHealer = false
  } = {}
) =>
  asUser(uid, 'select public.declare_season_signup(1, $1, $2, $3, $4, $5, $6, $7) as id', [
    season,
    characterId,
    spec,
    offSpecs,
    note,
    backupTank,
    backupHealer
  ]);

const signup = async (q, id) => (await q('select * from public.season_signups where id = $1', [id])).rows[0];

describe('declare_season_signup()', () => {
  it("records the signer and their character, pending for the current site's Signups tab", async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const personId = await personOf(q);
      const characterId = await character(q, personId);
      const id = (await declare(asUser, RAIDER_T1, characterId, { offSpecs: 'Fire', note: 'Ready' })).rows[0].id;
      expect(await signup(q, id)).toMatchObject({
        team_id: 1,
        season: 'next-season',
        person_id: personId,
        character_id: characterId,
        signup_name_realm: 'Nextmain-Illidan',
        class_spec_id: FROST_MAGE,
        off_specs: 'Fire',
        player_note: 'Ready',
        status: 'pending',
        auth_user_id: RAIDER_T1
      });
    });
  });

  it('marks a new main when the signer already has another character on the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const personId = await personOf(q);
      await q(
        `insert into public.players (team_id, name_realm, class_spec_id, team_member_id)
         values (1, 'Oldmain-Illidan', 1, $1)`,
        [PHOENIX_RAIDER_MEMBER]
      );
      const id = (await declare(asUser, RAIDER_T1, await character(q, personId))).rows[0].id;
      expect(await signup(q, id)).toMatchObject({
        main_swap: true,
        swap_from_name_realm: 'Oldmain-Illidan',
        swap_class_spec_id: FROST_MAGE,
        class_spec_id: null
      });
    });
  });

  it('is not a swap when the picked character is one of two already on the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const personId = await personOf(q);
      for (const name of ['Firstmain-Illidan', 'Nextmain-Illidan']) {
        await q(
          'insert into public.players (team_id, name_realm, class_spec_id, team_member_id) values (1, $1, 1, $2)',
          [name, PHOENIX_RAIDER_MEMBER]
        );
      }
      const id = (await declare(asUser, RAIDER_T1, await character(q, personId))).rows[0].id;
      expect(await signup(q, id)).toMatchObject({ main_swap: false, class_spec_id: FROST_MAGE });
    });
  });

  it("replaces the signer's earlier signup for the tier instead of adding a second", async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const personId = await personOf(q);
      const first = (await declare(asUser, RAIDER_T1, await character(q, personId))).rows[0].id;
      const other = await character(q, personId, { name: 'Changedmind' });
      const second = (await declare(asUser, RAIDER_T1, other, { note: 'Switched' })).rows[0].id;
      expect(second).toBe(first);
      const rows = await q('select * from public.season_signups where person_id = $1', [personId]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({
        character_id: other,
        signup_name_realm: 'Changedmind-Illidan',
        player_note: 'Switched'
      });
    });
  });

  it('replaces a signup the current site took from the same account', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const old = await q(
        `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status, auth_user_id)
         values (1, 'Typed-Illidan', 1, 'next-season', 'approved', $1) returning id`,
        [RAIDER_T1]
      );
      const id = (await declare(asUser, RAIDER_T1, await character(q, await personOf(q)))).rows[0].id;
      expect(id).toBe(old.rows[0].id);
      expect(await signup(q, id)).toMatchObject({ status: 'pending', signup_name_realm: 'Nextmain-Illidan' });
    });
  });

  it('refuses once the signup is on the roster, and ignores a rejected one', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const personId = await personOf(q);
      const rejected = await q(
        `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status, person_id)
         values (1, 'Turneddown-Illidan', 1, 'next-season', 'rejected', $1) returning id`,
        [personId]
      );
      const id = (await declare(asUser, RAIDER_T1, await character(q, personId))).rows[0].id;
      expect(id).not.toBe(rejected.rows[0].id);
      const player = await q(
        "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Added-Illidan', 1) returning id"
      );
      await q("update public.season_signups set status = 'added', approved_player_id = $1 where id = $2", [
        player.rows[0].id,
        id
      ]);
      await expect(declare(asUser, RAIDER_T1, await character(q, personId, { name: 'Late' }))).rejects.toThrow(
        /already on this season's roster/
      );
    });
  });

  it('refuses a character that is not theirs, a spec of another class, a closed tier and no session', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      await openSignups(q, 'closed-season', false);
      const mine = await character(q, await personOf(q));
      const theirs = await character(q, await personOf(q, 1), { name: 'Notyours' });
      const priest = await character(q, await personOf(q), { name: 'Priesty', characterClass: 'Priest' });
      await expect(declare(asUser, RAIDER_T1, theirs)).rejects.toThrow(/not on your account/);
      await expect(declare(asUser, RAIDER_T1, priest)).rejects.toThrow(/is a Priest, not a Mage/);
      await expect(declare(asUser, RAIDER_T1, mine, { season: 'closed-season' })).rejects.toThrow(/not open/);
      await expect(declare(asUser, RAIDER_T1, mine, { season: 'never-opened' })).rejects.toThrow(/not open/);
      // A tier already under way, even with its switch still on.
      await openSignups(q, 'seed-season');
      await expect(declare(asUser, RAIDER_T1, mine, { season: 'seed-season' })).rejects.toThrow(/already started/);
      await expect(declare(asUser, null, mine)).rejects.toThrow(/Not signed in/);
    });
  });

  // The raider's own "I can backup tank / heal" ticks (#1622) set the same
  // flags as the officer boxes on the Projected Roster.
  describe('backup tank and heal answers', () => {
    const specs = async (q) => {
      const { rows } = await q(
        `insert into public.classes_specs (class, spec, role) values
           ('Death Knight', 'Blood', 'Tank'), ('Death Knight', 'Frost', 'Melee'), ('Warlock', 'Demonology', 'Ranged')
         returning spec, id`
      );
      return Object.fromEntries(rows.map((r) => [r.spec, r.id]));
    };
    const flags = async (q, id) => {
      const { is_backup_tank, is_backup_healer } = await signup(q, id);
      return { is_backup_tank, is_backup_healer };
    };

    it('stores them on a new signup, and false for a role the class has no spec in', async () => {
      await withTxn(async ({ q, asUser }) => {
        await openSignups(q);
        const { Frost } = await specs(q);
        const dk = await character(q, await personOf(q), { name: 'Deeka', characterClass: 'Death Knight' });
        const id = (await declare(asUser, RAIDER_T1, dk, { spec: Frost, backupTank: true, backupHealer: true }))
          .rows[0].id;
        expect(await flags(q, id)).toEqual({ is_backup_tank: true, is_backup_healer: false });
      });
    });

    it('sets them again on a change, so a Death Knight changed to a Warlock loses backup tank', async () => {
      await withTxn(async ({ q, asUser }) => {
        await openSignups(q);
        const { Frost, Demonology } = await specs(q);
        const personId = await personOf(q);
        const dk = await character(q, personId, { name: 'Deeka', characterClass: 'Death Knight' });
        const id = (await declare(asUser, RAIDER_T1, dk, { spec: Frost, backupTank: true })).rows[0].id;
        const lock = await character(q, personId, { name: 'Locky', characterClass: 'Warlock' });
        await declare(asUser, RAIDER_T1, lock, { spec: Demonology, backupTank: true });
        expect(await flags(q, id)).toEqual({ is_backup_tank: false, is_backup_healer: false });
      });
    });

    it("replaces an officer's ticks with the raider's answers on a change", async () => {
      await withTxn(async ({ q, asUser }) => {
        await openSignups(q);
        const { Frost } = await specs(q);
        const dk = await character(q, await personOf(q), { name: 'Deeka', characterClass: 'Death Knight' });
        const id = (await declare(asUser, RAIDER_T1, dk, { spec: Frost })).rows[0].id;
        await q('update public.season_signups set is_backup_tank = true, is_trial = true where id = $1', [id]);
        await declare(asUser, RAIDER_T1, dk, { spec: Frost });
        expect(await signup(q, id)).toMatchObject({ is_backup_tank: false, is_trial: true });
      });
    });

    it('stores false when the main spec is the role itself', async () => {
      await withTxn(async ({ q, asUser }) => {
        await openSignups(q);
        const { Blood } = await specs(q);
        const dk = await character(q, await personOf(q), { name: 'Deeka', characterClass: 'Death Knight' });
        const id = (await declare(asUser, RAIDER_T1, dk, { spec: Blood, backupTank: true })).rows[0].id;
        expect(await flags(q, id)).toEqual({ is_backup_tank: false, is_backup_healer: false });
      });
    });
  });

  it('keeps one signup per person per team per tier in the table itself', async () => {
    await withTxn(async ({ q }) => {
      const personId = await personOf(q);
      const insert = () =>
        q(
          `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status, person_id)
           values (1, 'Twice-Illidan', 1, 'seed-season', 'pending', $1)`,
          [personId]
        );
      await insert();
      await expect(insert()).rejects.toThrow(/season_signups_one_per_person/);
    });
  });
});

describe('add_signup_to_roster() with a declared character', () => {
  it("links a new character to the signer's membership", async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const id = (await declare(asUser, RAIDER_T1, await character(q, await personOf(q)))).rows[0].id;
      await q("update public.season_signups set status = 'approved' where id = $1", [id]);
      const playerId = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [id])).rows[0].id;
      const player = await q('select name_realm, team_member_id from public.players where id = $1', [playerId]);
      expect(player.rows[0]).toEqual({ name_realm: 'Nextmain-Illidan', team_member_id: PHOENIX_RAIDER_MEMBER });
    });
  });

  // Found in the fresh-agent review: the signer can still retype the name
  // through update_own_signup(), so the add checks the character again.
  it('does not link a roster row whose name the signer retyped after signing up', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const id = (await declare(asUser, RAIDER_T1, await character(q, await personOf(q)))).rows[0].id;
      const unclaimed = await q(
        "insert into public.players (team_id, name_realm, class_spec_id) values (1, 'Unclaimed-Illidan', 1) returning id"
      );
      await asUser(RAIDER_T1, "select public.update_own_signup($1, 'Unclaimed-Illidan', 'Mage', 'Frost')", [id]);
      await q("update public.season_signups set status = 'approved' where id = $1", [id]);
      const playerId = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [id])).rows[0].id;
      expect(playerId).toBe(unclaimed.rows[0].id);
      const player = await q('select team_member_id from public.players where id = $1', [playerId]);
      expect(player.rows[0].team_member_id).toBeNull();
    });
  });

  it('does not link a character that has moved to someone else since the signup', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openSignups(q);
      const characterId = await character(q, await personOf(q));
      const id = (await declare(asUser, RAIDER_T1, characterId)).rows[0].id;
      await q('update public.characters set person_id = $1 where id = $2', [await personOf(q, 1), characterId]);
      await q("update public.season_signups set status = 'approved' where id = $1", [id]);
      const playerId = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [id])).rows[0].id;
      const player = await q('select team_member_id from public.players where id = $1', [playerId]);
      expect(player.rows[0].team_member_id).toBeNull();
    });
  });

  it('leaves a typed signup with no character unlinked, as today', async () => {
    await withTxn(async ({ q, asUser }) => {
      const signupRow = await q(
        `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status, auth_user_id)
         values (1, 'Typedonly-Illidan', 1, 'seed-season', 'approved', $1) returning id`,
        [RAIDER_T1]
      );
      const playerId = (
        await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [signupRow.rows[0].id])
      ).rows[0].id;
      const player = await q('select team_member_id from public.players where id = $1', [playerId]);
      expect(player.rows[0].team_member_id).toBeNull();
    });
  });
});
