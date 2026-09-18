// generate_priority_order() equipped-item exclusion
// (20260913001744_generate_priority_order_exclude_equipped_item.sql,
// fixed by 20260913004747_generate_priority_order_equipped_item_wow_id_fix.sql):
// a player_equipped_gear row for the item being generated now feeds the same
// has_myth/has_hero exclusion as an rclc_loot award or an approved
// self_received_requests row -- catching a player who already has the item
// (most commonly a self-received drop nobody logged through the app) even
// with no loot-award or self-received record for it at all. Independent of
// the pre-existing equipped-slot-ilvl multiplier
// (priority-equipped-slot-track.test.js), which only ever compares
// ilvl-vs-threshold and never item_id.
//
// player_equipped_gear.item_id is Blizzard's real wow_item_id, NOT this
// app's items.id catalog key that p_item_id/rclc_loot/item_preferences/
// bis_items all use -- confirmed live (Gebbo's Bottomless Bag is items.id
// 322 / wow_item_id 270164) after the first version of this exclusion
// compared the wrong id space and silently matched nothing. Every item
// seeded below is given its own wow_item_id distinct from its items.id, and
// player_equipped_gear rows point at the wow_item_id, exactly like
// production -- using the same value for both (as an earlier draft of this
// file did) would let a join on the wrong id space pass by coincidence.
//
// Uses the shared withTxn from helpers.js, wrapped to stamp the season.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn as withSharedTxn, OFFICER_T1, seedSeason } from './helpers.js';

// The season this file stamps (#932): every season column is a foreign
// key to seasons, so the fixture row comes first in every transaction.
// Wraps the shared harness.
async function withTxn(fn) {
  return withSharedTxn(async (t) => {
    await seedSeason(t.q, SEASON);
    return fn(t);
  });
}

const SEASON = 'equipped-item-owned-test';
const RING_ITEM_ID = 89300;
const RING_WOW_ITEM_ID = 293000;
const TOKEN_ITEM_ID = 89301;
const TOKEN_WOW_ITEM_ID = 293010;
const RESOLVED_ITEM_ID = 89302;
const RESOLVED_WOW_ITEM_ID = 293020;

async function seedRingItem(q) {
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, $2, 'Seed Owned Ring', 'Finger')", [
    RING_ITEM_ID,
    RING_WOW_ITEM_ID
  ]);
}

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, team_id, season, performance_score, attendance_score) values ($1, 1, $2, $3, $4)',
    [playerId, SEASON, performance, attendance]
  );
}

async function seedBoth1And2Bis(q, itemId) {
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, $1, 'bis')", [
    itemId
  ]);
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, $1, 'bis')", [
    itemId
  ]);
}

function generate(asUser, itemId, track) {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

describe('generate_priority_order equipped-item exclusion', () => {
  it('excludes a candidate who has the exact item equipped on Myth, with no rclc_loot/self_received record at all', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRingItem(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, team_id, equipment_slot, item_id, item_level, track)
         values (1, 1, 'FINGER_1', $1, 700, 'Myth')`,
        [RING_WOW_ITEM_ID]
      );

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const ids = res.rows.map((r) => r.player_id);
      expect(ids).not.toContain(1);
      expect(ids).toContain(2);
    });
  });

  it('excludes a candidate on a Hero generation only, when their equipped copy is Hero track', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRingItem(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, team_id, equipment_slot, item_id, item_level, track)
         values (1, 1, 'FINGER_1', $1, 660, 'Hero')`,
        [RING_WOW_ITEM_ID]
      );

      const hero = await generate(asUser, RING_ITEM_ID, 'Hero');
      expect(hero.rows.map((r) => r.player_id)).not.toContain(1);

      const myth = await generate(asUser, RING_ITEM_ID, 'Myth');
      const mythIds = myth.rows.map((r) => r.player_id);
      expect(mythIds).toContain(1);
      expect(mythIds).toContain(2);
      // Has-Hero still applies the existing cross-track multiplier.
      const byId = Object.fromEntries(myth.rows.map((r) => [r.player_id, r]));
      expect(Number(byId[2].weighted_total)).toBeGreaterThan(Number(byId[1].weighted_total));
    });
  });

  it('does not exclude a candidate whose equipped item is a different wow_item_id', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRingItem(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, team_id, equipment_slot, item_id, item_level, track)
         values (1, 1, 'FINGER_1', 999999, 700, 'Myth')`
      );

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const ids = res.rows.map((r) => r.player_id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
    });
  });

  it('does not exclude a candidate whose equipped item_id happens to equal the target items.id but not its wow_item_id', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedRingItem(q);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      // Regression guard for the exact bug found live: a synced row whose
      // item_id numerically matches the internal items.id (not the real
      // wow_item_id) must NOT be treated as owning the item.
      await q(
        `insert into public.player_equipped_gear (player_id, team_id, equipment_slot, item_id, item_level, track)
         values (1, 1, 'FINGER_1', $1, 700, 'Myth')`,
        [RING_ITEM_ID]
      );

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const ids = res.rows.map((r) => r.player_id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
    });
  });

  it('resolves a tier token through tier_token_map to catch the equipped resolved class item', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.items (id, wow_item_id, name, slot) values ($1, $2, 'Seed Token', 'Chest')", [
        TOKEN_ITEM_ID,
        TOKEN_WOW_ITEM_ID
      ]);
      await q(
        "insert into public.items (id, wow_item_id, name, slot) values ($1, $2, 'Seed Resolved Chest', 'Chest')",
        [RESOLVED_ITEM_ID, RESOLVED_WOW_ITEM_ID]
      );
      await q(
        'insert into public.tier_token_map (season, token_item_id, class, resolved_item_id) values ($1, $2, $3, $4)',
        [SEASON, TOKEN_ITEM_ID, 'Seed', RESOLVED_ITEM_ID]
      );
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, TOKEN_ITEM_ID);
      // Player 1's character actually has the resolved class item equipped,
      // never the generic token -- wishlist/BiS stay keyed to the token, and
      // the synced row carries the resolved item's real wow_item_id.
      await q(
        `insert into public.player_equipped_gear (player_id, team_id, equipment_slot, item_id, item_level, track)
         values (1, 1, 'CHEST', $1, 700, 'Myth')`,
        [RESOLVED_WOW_ITEM_ID]
      );

      const res = await generate(asUser, TOKEN_ITEM_ID, 'Myth');
      const ids = res.rows.map((r) => r.player_id);
      expect(ids).not.toContain(1);
      expect(ids).toContain(2);
    });
  });
});

afterAll(async () => {
  await pool.end();
});
