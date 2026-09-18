// RLS assertions for the Bonus Roll target self-service update
// (20260809220657_players_bonus_roll_target.sql): a raider can UPDATE
// bonus_roll_encounter_id on their own players row via is_own_player(id),
// but the restrict_players_self_update_to_bonus_roll trigger blocks them
// from touching any other column through that same policy -- an officer
// updating other columns (via the pre-existing "Officers write players"
// policy) is unaffected. Uses the shared withTxn from helpers.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, OFFICER_T1, RAIDER_T1 } from './helpers.js';

// Each case mints the team 1 character it writes (#1123): linked to
// team_members 3 (RAIDER_T1's row) when the raider is meant to own it, and
// unlinked when nobody has claimed it.
const ownCharacter = (q) => seedPlayer(q, { memberId: 3 });
const unclaimedCharacter = (q) => seedPlayer(q, { teamId: 1 });

const target = async (q, id) =>
  (await q('select bonus_roll_encounter_id from public.players where id = $1', [id])).rows[0].bonus_roll_encounter_id;

async function seedEncounter(q, id) {
  await q("insert into public.raid_zones (id, wcl_zone_id, name, season) values ($1, $1, 'Seed Zone', 'seed-season')", [
    id
  ]);
  await q("insert into public.raid_encounters (id, zone_id, wcl_encounter_id, name) values ($1, $1, $1, 'Seed Boss')", [
    id
  ]);
}

describe('players.bonus_roll_encounter_id self-service', () => {
  it('a linked raider can set their own bonus_roll_encounter_id', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownCharacter(q);
      await seedEncounter(q, 901);

      await asUser(RAIDER_T1, 'update public.players set bonus_roll_encounter_id = 901 where id = $1', [pid]);
      expect(await target(q, pid)).toBe(901);
    });
  });

  it('a linked raider can clear their own bonus_roll_encounter_id back to null', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownCharacter(q);
      await seedEncounter(q, 902);
      await q('update public.players set bonus_roll_encounter_id = 902 where id = $1', [pid]);

      await asUser(RAIDER_T1, 'update public.players set bonus_roll_encounter_id = null where id = $1', [pid]);
      expect(await target(q, pid)).toBeNull();
    });
  });

  it('a raider cannot use this policy to change another column on their own row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownCharacter(q);
      await expect(
        asUser(RAIDER_T1, "update public.players set nickname = 'Sneaky' where id = $1", [pid])
      ).rejects.toThrow(/bonus_roll_encounter_id/);
      const row = (await q('select nickname from public.players where id = $1', [pid])).rows[0];
      expect(row.nickname).toBeNull();
    });
  });

  it('an unlinked raider cannot update a player row they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      // The character stays unlinked. RLS's USING clause silently matches 0
      // rows rather than erroring, so this reads the row as postgres first
      // and confirms the value survives untouched.
      const pid = await unclaimedCharacter(q);
      await seedEncounter(q, 903);
      await q('update public.players set bonus_roll_encounter_id = 903 where id = $1', [pid]);
      expect(await target(q, pid)).toBe(903);
      const res = await asUser(RAIDER_T1, 'update public.players set bonus_roll_encounter_id = null where id = $1', [
        pid
      ]);
      expect(res.rowCount).toBe(0);
      expect(await target(q, pid)).toBe(903);
    });
  });

  it('an officer can still update other columns on a players row unaffected by the restrict trigger', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await unclaimedCharacter(q);
      await asUser(OFFICER_T1, "update public.players set nickname = 'OfficerSet' where id = $1", [pid]);
      const row = (await q('select nickname from public.players where id = $1', [pid])).rows[0];
      expect(row.nickname).toBe('OfficerSet');
    });
  });
});

afterAll(() => pool.end());
