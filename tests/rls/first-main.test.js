// A first main is self-service (#1463): someone on a team with no character
// on its roster adds one of their own, straight onto the roster, and an
// officer undoes a mistake afterwards. A main swap still goes through an
// officer (main-swap-requests.test.js). Each case mints its own team.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedTeam, seedPlayer, rowLockModes } from './helpers.js';

afterAll(() => pool.end());

// classes_specs 1 is Mage Frost.
const FROST_MAGE = 1;

const addFirstMain = (asUser, uid, teamId, characterId, specId = FROST_MAGE) =>
  asUser(uid, 'select public.add_own_first_main($1, $2, $3) as id', [teamId, characterId, specId]);

// A character on the member's own account, from Battle.net.
async function character(q, memberId, { name = 'Firstmain', characterClass = 'Mage' } = {}) {
  const person = await q('select person_id from public.team_members where id = $1', [memberId]);
  const { rows } = await q(
    `insert into public.characters (person_id, blizzard_id, name, realm, realm_slug, class_name, spec_name, level)
     values ($1, $2, $3, 'Illidan', 'illidan', $4, 'Frost', 90) returning id`,
    [person.rows[0].person_id, Math.floor(Math.random() * 1e9), name, characterClass]
  );
  return { characterId: rows[0].id, nameRealm: `${name}-Illidan` };
}

const playerRow = async (q, id) => (await q('select * from public.players where id = $1', [id])).rows[0];

describe('add_own_first_main()', () => {
  it('puts a new character on the roster as a trial joining today, linked to them', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId, nameRealm } = await character(q, team.raider.memberId);
      const id = (await addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rows[0].id;
      const row = await playerRow(q, id);
      const today = (await q("select (now() at time zone 'America/New_York')::date as d")).rows[0].d;
      expect(row).toMatchObject({
        team_id: team.teamId,
        name_realm: nameRealm,
        class_spec_id: FROST_MAGE,
        team_member_id: team.raider.memberId,
        is_trial: true,
        is_backup_tank: false,
        is_backup_healer: false,
        archived_at: null
      });
      expect(row.join_date).toEqual(today);
    });
  });

  it('brings back a character they played here before with its own trial flag and join date', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId, nameRealm } = await character(q, team.raider.memberId);
      const old = await seedPlayer(q, { memberId: team.raider.memberId, nameRealm, archivedAt: new Date('2026-03-01') });
      await q("update public.players set is_trial = false, join_date = '2026-02-01' where id = $1", [old]);
      const id = (await addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rows[0].id;
      expect(id).toBe(old);
      const row = await playerRow(q, id);
      expect(row).toMatchObject({ is_trial: false, archived_at: null, team_member_id: team.raider.memberId });
      expect(row.join_date.toISOString().slice(0, 10)).toBe('2026-02-01');
    });
  });

  it('writes "Player Added" with "first main, self-added" to the Audit Log', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId } = await character(q, team.raider.memberId);
      const id = (await addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rows[0].id;
      const { rows } = await q(
        "select actor_id, detail from public.audit_log where target_type = 'players' and target_id = $1 and action = 'Player Added'",
        [id]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_id).toBe(team.raider.uid);
      expect(rows[0].detail).toBe('Mage Frost Ranged, first main, self-added');
    });
  });

  it('holds their membership, so it queues behind Archive Member (#1432)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId } = await character(q, team.raider.memberId);
      await addFirstMain(asUser, team.raider.uid, team.teamId, characterId);
      expect(await rowLockModes(q, 'team_members', team.raider.memberId)).toContain('For No Key Update');
    });
  });

  it('refuses someone who is not on the team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const other = await seedTeam(q);
      const { characterId } = await character(q, team.raider.memberId);
      await expect(addFirstMain(asUser, team.raider.uid, other.teamId, characterId)).rejects.toThrow(
        /You are not on this team/
      );
    });
  });

  it('refuses an ended membership (#1401)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId } = await character(q, team.raider.memberId);
      await asUser(team.officer.uid, 'select public.archive_team_member($1, $2, $3, $4)', [
        team.teamId,
        team.raider.memberId,
        'moved_guilds',
        'Joined another guild'
      ]);
      await expect(addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rejects.toThrow(
        /Your place on this team has ended/
      );
    });
  });

  it('refuses someone who already has a character on the roster: that is a main swap', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      await seedPlayer(q, { memberId: team.raider.memberId });
      const { characterId } = await character(q, team.raider.memberId);
      await expect(addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rejects.toThrow(
        /already have a character on this team's roster. Ask for a main swap/
      );
    });
  });

  it('refuses a character already on the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId, nameRealm } = await character(q, team.raider.memberId);
      await seedPlayer(q, { teamId: team.teamId, nameRealm });
      await expect(addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rejects.toThrow(
        /Firstmain-Illidan is already on this roster/
      );
    });
  });

  it('refuses a removed character that belonged to someone else here', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId, nameRealm } = await character(q, team.raider.memberId);
      await seedPlayer(q, { memberId: team.leader.memberId, nameRealm, archivedAt: new Date('2026-03-01') });
      await expect(addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rejects.toThrow(
        /Firstmain-Illidan was someone else's on this team/
      );
    });
  });

  it('refuses a character that is not on their account', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId } = await character(q, team.leader.memberId);
      await expect(addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rejects.toThrow(
        /That character is not on your account/
      );
    });
  });

  it('refuses a spec of another class', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const { characterId } = await character(q, team.raider.memberId, { characterClass: 'Evoker' });
      await expect(addFirstMain(asUser, team.raider.uid, team.teamId, characterId)).rejects.toThrow(
        /is a Evoker, not a Mage/
      );
    });
  });
});
