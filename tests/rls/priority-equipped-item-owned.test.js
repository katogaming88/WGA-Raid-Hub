// generate_priority_order() equipped-item exclusion
// (20260913001744_generate_priority_order_exclude_equipped_item.sql): a
// player_equipped_gear row for the EXACT item_id being generated now feeds
// the same has_myth/has_hero exclusion as an rclc_loot award or an approved
// self_received_requests row -- catching a player who already has the item
// (most commonly a self-received drop nobody logged through the app) even
// with no loot-award or self-received record for it at all. This is an
// item_id match, independent of the pre-existing equipped-slot-ilvl
// multiplier (priority-equipped-slot-track.test.js), which only ever
// compares ilvl-vs-threshold and never item_id.
//
// Same withTxn/savepoint harness as priority-equipped-slot-track.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint peio_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint peio_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    return await fn({ q, asUser });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const SEASON = 'equipped-item-owned-test';
const RING_ITEM_ID = 89300;
const TOKEN_ITEM_ID = 89301;
const RESOLVED_ITEM_ID = 89302;

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, season, performance_score, attendance_score) values ($1, $2, $3, $4)',
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
      await q(
        "insert into public.items (id, wow_item_id, name, slot) values ($1, 893000, 'Seed Owned Ring', 'Finger')",
        [RING_ITEM_ID]
      );
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'FINGER_1', $1, 700, 'Myth')`,
        [RING_ITEM_ID]
      );

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const ids = res.rows.map((r) => r.player_id);
      expect(ids).not.toContain(1);
      expect(ids).toContain(2);
    });
  });

  it('excludes a candidate on a Hero generation only, when their equipped copy is Hero track', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        "insert into public.items (id, wow_item_id, name, slot) values ($1, 893000, 'Seed Owned Ring', 'Finger')",
        [RING_ITEM_ID]
      );
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'FINGER_1', $1, 660, 'Hero')`,
        [RING_ITEM_ID]
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

  it('does not exclude a candidate whose equipped item is a different item_id', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q(
        "insert into public.items (id, wow_item_id, name, slot) values ($1, 893000, 'Seed Owned Ring', 'Finger')",
        [RING_ITEM_ID]
      );
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, RING_ITEM_ID);
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'FINGER_1', 999999, 700, 'Myth')`
      );

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const ids = res.rows.map((r) => r.player_id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
    });
  });

  it('resolves a tier token through tier_token_map to catch the equipped resolved class item', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 893010, 'Seed Token', 'Chest')", [
        TOKEN_ITEM_ID
      ]);
      await q(
        "insert into public.items (id, wow_item_id, name, slot) values ($1, 893020, 'Seed Resolved Chest', 'Chest')",
        [RESOLVED_ITEM_ID]
      );
      await q('insert into public.tier_token_map (token_item_id, class, resolved_item_id) values ($1, $2, $3)', [
        TOKEN_ITEM_ID,
        'Seed',
        RESOLVED_ITEM_ID
      ]);
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 100, 100);
      await seedBoth1And2Bis(q, TOKEN_ITEM_ID);
      // Player 1's character actually has the resolved class item equipped,
      // never the generic token -- wishlist/BiS stay keyed to the token.
      await q(
        `insert into public.player_equipped_gear (player_id, equipment_slot, item_id, item_level, track)
         values (1, 'CHEST', $1, 700, 'Myth')`,
        [RESOLVED_ITEM_ID]
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
