// wishlist_setup_status(): the bot's wishlist nudge reads missing_bis_rows
// from it, one row per active player on the team whose membership resolves to
// a person. Since #935 the raider's own tags are the only coverage. Uses the
// shared withTxn from helpers.js; every player is minted here, linked to the
// seeded team 1 raider membership so the people join finds them.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, OFFICER_T1 } from './helpers.js';

const RAIDER_T1_MEMBER = 3;
const STAFF = 1; // Seed Test Staff, Two-Hand
const ROBE = 2; // Seed Test Robe, Chest

const tag = (q, playerId, itemId, status, slot = null) =>
  q('insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, $1, $2, $3, $4)', [
    playerId,
    itemId,
    status,
    slot
  ]);

async function statusFor(asUser, playerId) {
  const res = await asUser(OFFICER_T1, 'select * from public.wishlist_setup_status(1)');
  return res.rows.find((r) => r.player_id === playerId);
}

describe('wishlist_setup_status', () => {
  it('a BiS tag covers its row and any other tag leaves the row missing', async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      await tag(q, player, STAFF, 'bis');
      await tag(q, player, ROBE, 'good');
      const row = await statusFor(asUser, player);
      expect(row).toBeTruthy();
      expect(row.wishlist_count).toBe(2);
      expect(row.missing_bis_rows).not.toContain('Weapon');
      expect(row.missing_bis_rows).toContain('Chest');
      // A Two-Hand BiS fills the weapon row on its own; Off Hand is not required.
      expect(row.missing_bis_rows).not.toContain('Off Hand');
    });
  });

  it('a One-Hand BiS makes Off Hand a required row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      const dagger = (
        await q(
          "insert into public.items (wow_item_id, name, slot, armor_type, is_boe) values (100901, 'Setup Status Dagger', 'One-Hand', null, false) returning id"
        )
      ).rows[0].id;
      await tag(q, player, dagger, 'bis', 'Weapon');
      const row = await statusFor(asUser, player);
      expect(row.missing_bis_rows).not.toContain('Weapon');
      expect(row.missing_bis_rows).toContain('Off Hand');
    });
  });

  it('a player whose membership resolves to no person is not listed', async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await seedPlayer(q, { teamId: 1 });
      await tag(q, player, STAFF, 'bis');
      expect(await statusFor(asUser, player)).toBeUndefined();
    });
  });
});

afterAll(() => pool.end());
