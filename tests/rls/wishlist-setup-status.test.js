// wishlist_setup_status(): the bot's wishlist nudge reads missing_bis_rows
// from it, one row per active player on the team whose membership resolves to
// a person. Since #935 the raider's own tags are the only coverage. Uses the
// shared withTxn from helpers.js; every player is minted here, linked to the
// seeded team 1 raider membership so the people join finds them. Picks are
// stamped with the live tier, MID2, and a case opens its switch itself.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, OFFICER_T1 } from './helpers.js';

const RAIDER_T1_MEMBER = 3;
const STAFF = 1; // Seed Test Staff, Two-Hand
const ROBE = 2; // Seed Test Robe, Chest
const LIVE = 'MID2';

const tag = (q, playerId, itemId, status, slot = null, season = LIVE) =>
  q(
    'insert into public.item_preferences (team_id, player_id, item_id, status, slot, season) values (1, $1, $2, $3, $4, $5)',
    [playerId, itemId, status, slot, season]
  );

const openWishlist = (q, season = LIVE) =>
  q('insert into public.team_seasons (team_id, season_code, wishlist_open) values (1, $1, true)', [season]);

async function statusFor(asUser, playerId) {
  const res = await asUser(OFFICER_T1, 'select * from public.wishlist_setup_status(1)');
  return res.rows.find((r) => r.player_id === playerId);
}

async function rowsFor(asUser, playerId) {
  const res = await asUser(OFFICER_T1, 'select * from public.wishlist_setup_status(1)');
  return res.rows.filter((r) => r.player_id === playerId);
}

// A tier after the live one, made the way the migration that adds a tier
// makes it: MID2 closes a month from today and the new tier starts the day
// after, so MID2 stays the live tier. tests/rls/seasons.test.js closes MID2
// inside its transaction the same way.
async function laterTier(q) {
  const code = `L${randomUUID().slice(0, 7)}`;
  await q("update public.seasons set ends_at = (now() at time zone 'America/New_York')::date + 29 where code = $1", [
    LIVE
  ]);
  await q(
    "insert into public.seasons (code, display_name, starts_at) values ($1, $2, (now() at time zone 'America/New_York')::date + 30)",
    [code, `Later Tier ${code}`]
  );
  return code;
}

describe('wishlist_setup_status', () => {
  it('a BiS tag covers its row and any other tag leaves the row missing', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openWishlist(q);
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
      await openWishlist(q);
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
      await openWishlist(q);
      const player = await seedPlayer(q, { teamId: 1 });
      await tag(q, player, STAFF, 'bis');
      expect(await statusFor(asUser, player)).toBeUndefined();
    });
  });
});

// The nudge chases what a raider's own page lets them edit (#1268, on #936's
// rule): the tiers the team opened from the live one on, plus the live tier
// for a raider with the per-raider override. One row per raider per tier.
describe('wishlist_setup_status answers for the tiers a raider can edit (#1268)', () => {
  it('names the tier on its row', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openWishlist(q);
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      await tag(q, player, STAFF, 'bis');
      const rows = await rowsFor(asUser, player);
      expect(rows.map((r) => [r.season, r.season_name])).toEqual([[LIVE, 'Midnight Season 2']]);
    });
  });

  it('counts only the picks stamped with its tier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openWishlist(q);
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      await tag(q, player, STAFF, 'bis', null, 'MID1');
      await tag(q, player, ROBE, 'bis', null, null);
      const [row] = await rowsFor(asUser, player);
      expect(row.wishlist_count).toBe(0);
      expect(row.missing_bis_rows).toContain('Weapon');
      expect(row.missing_bis_rows).toContain('Chest');
    });
  });

  it('gives a raider no row when the team has no tier open', async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      await tag(q, player, STAFF, 'bis');
      expect(await rowsFor(asUser, player)).toEqual([]);
    });
  });

  // Nothing turns a finished tier's switch off, and neither site lets a raider
  // go back to it.
  it('does not chase a tier before the live one, though its switch is on', async () => {
    await withTxn(async ({ q, asUser }) => {
      await openWishlist(q, 'MID1');
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      await tag(q, player, STAFF, 'bis', null, 'MID1');
      expect(await rowsFor(asUser, player)).toEqual([]);
    });
  });

  it('chases an override raider for the live tier with its switch off, and once with it on', async () => {
    await withTxn(async ({ q, asUser }) => {
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      await q('update public.players set wishlist_allowed = true where id = $1', [player]);
      expect((await rowsFor(asUser, player)).map((r) => r.season)).toEqual([LIVE]);
      await openWishlist(q);
      expect((await rowsFor(asUser, player)).map((r) => r.season)).toEqual([LIVE]);
    });
  });

  it('chases a tier the team opened after the live one on a row of its own', async () => {
    await withTxn(async ({ q, asUser }) => {
      const later = await laterTier(q);
      await openWishlist(q);
      await openWishlist(q, later);
      const player = await seedPlayer(q, { teamId: 1, memberId: RAIDER_T1_MEMBER });
      await tag(q, player, STAFF, 'bis');
      await tag(q, player, ROBE, 'bis', null, later);
      const rows = await rowsFor(asUser, player);
      expect(rows.map((r) => [r.season, r.wishlist_count])).toEqual([
        [LIVE, 1],
        [later, 1]
      ]);
      expect(rows[0].missing_bis_rows).not.toContain('Weapon');
      expect(rows[0].missing_bis_rows).toContain('Chest');
      expect(rows[1].missing_bis_rows).toContain('Weapon');
      expect(rows[1].missing_bis_rows).not.toContain('Chest');
    });
  });
});

afterAll(() => pool.end());
