// set_own_missing_spec() (#1724): a raider sets the spec of their own roster
// character, once, while it has none. After that only an officer changes it.
// Each case mints its own team; everything is rolled back (#1021).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer } from './helpers.js';

afterAll(() => pool.end());

const setSpec = (asUser, uid, playerId, specId) =>
  asUser(uid, 'select public.set_own_missing_spec($1, $2)', [playerId, specId]);
const specOf = async (q, id) =>
  (await q('select class_spec_id from public.players where id = $1', [id])).rows[0].class_spec_id;
// The spec's id, added when the seed doesn't have it (the seed holds only Frost Mage).
const specId = async (q, cls, spec, role) =>
  (
    await q(
      `insert into public.classes_specs (class, spec, role) values ($1, $2, $3)
       on conflict (class, spec) do update set class = excluded.class returning id`,
      [cls, spec, role]
    )
  ).rows[0].id;

// A raider on a new team with one character that has no spec.
async function noSpecRaider(q, name = 'Lowbie') {
  const team = await seedTeam(q);
  const playerId = await seedPlayer(q, {
    memberId: team.raider.memberId,
    nameRealm: `${name}-Illidan`,
    classSpecId: null
  });
  return { team, playerId };
}

// The raider's saved Battle.net record of that character, naming its class.
async function saved(q, memberId, name, characterClass) {
  const person = (await q('select person_id from public.team_members where id = $1', [memberId])).rows[0].person_id;
  await q(
    `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, level)
     values ($1, $2, $3, 'Illidan', 'illidan', $4, 84)`,
    [person, Math.floor(Math.random() * 1e9), name, characterClass]
  );
}

describe('set_own_missing_spec()', () => {
  it('sets the spec on the raider’s own character that has none, and logs it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const FROST_MAGE = await specId(q, 'Mage', 'Frost', 'Ranged');
      const { team, playerId } = await noSpecRaider(q);
      await setSpec(asUser, team.raider.uid, playerId, FROST_MAGE);
      expect(await specOf(q, playerId)).toBe(FROST_MAGE);
      const logged = (
        await q("select detail from public.audit_log where target_id = $1 and action = 'Spec Set by Raider'", [
          playerId
        ])
      ).rows;
      expect(logged).toHaveLength(1);
    });
  });

  it('refuses once a spec is set: only an officer changes it after that', async () => {
    await withTxn(async ({ q, asUser }) => {
      const FROST_MAGE = await specId(q, 'Mage', 'Frost', 'Ranged');
      const { team, playerId } = await noSpecRaider(q);
      await setSpec(asUser, team.raider.uid, playerId, FROST_MAGE);
      const fire = await specId(q, 'Mage', 'Fire', 'Ranged');
      await expect(setSpec(asUser, team.raider.uid, playerId, fire)).rejects.toThrow(/already has a spec/);
      expect(await specOf(q, playerId)).toBe(FROST_MAGE);
    });
  });

  it('refuses someone else’s character, an officer’s included', async () => {
    await withTxn(async ({ q, asUser }) => {
      const FROST_MAGE = await specId(q, 'Mage', 'Frost', 'Ranged');
      const { team, playerId } = await noSpecRaider(q);
      await expect(setSpec(asUser, team.officer.uid, playerId, FROST_MAGE)).rejects.toThrow(/not your character/);
      expect(await specOf(q, playerId)).toBeNull();
    });
  });

  it('refuses a raider from another team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const FROST_MAGE = await specId(q, 'Mage', 'Frost', 'Ranged');
      const { playerId } = await noSpecRaider(q);
      const other = await seedTeam(q);
      await expect(setSpec(asUser, other.raider.uid, playerId, FROST_MAGE)).rejects.toThrow(/not your character/);
      expect(await specOf(q, playerId)).toBeNull();
    });
  });

  it('refuses a spec of another class than the saved Battle.net character’s', async () => {
    await withTxn(async ({ q, asUser }) => {
      const FROST_MAGE = await specId(q, 'Mage', 'Frost', 'Ranged');
      const { team, playerId } = await noSpecRaider(q, 'Deathy');
      await saved(q, team.raider.memberId, 'Deathy', 'Death Knight');
      await expect(setSpec(asUser, team.raider.uid, playerId, FROST_MAGE)).rejects.toThrow(/not one of Death Knight/);
      const blood = await specId(q, 'Death Knight', 'Blood', 'Tank');
      await setSpec(asUser, team.raider.uid, playerId, blood);
      expect(await specOf(q, playerId)).toBe(blood);
    });
  });

  it('refuses an unknown spec, and a signed-out caller', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const FROST_MAGE = await specId(q, 'Mage', 'Frost', 'Ranged');
      const { team, playerId } = await noSpecRaider(q);
      await expect(setSpec(asUser, team.raider.uid, playerId, 999999)).rejects.toThrow(/Unknown spec/);
      await expect(asAnon('select public.set_own_missing_spec($1, $2)', [playerId, FROST_MAGE])).rejects.toThrow(
        /permission denied/
      );
    });
  });
});
