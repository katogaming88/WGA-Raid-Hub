// generate_priority_order() wishlist integration (#515, final piece):
// item_preferences is the candidate pool and feeds weighted_total, per
// 20260720165552_priority_wishlist_ranking.sql.
// Uses the shared withTxn from helpers.js, wrapped to stamp the season, since
// these tests need both a direct (RLS-bypassing) seed insert and an
// officer-role RPC call inside one rolled-back transaction.
//
// The wishlist tier used to be baked into status_label as pre-formatted
// text ("Wishlist: Good") -- 20260811122020_priority_order_raw_wishlist_status.sql
// split it into its own raw `wishlist_status` column instead, so the client
// can build the display label from the team's own custom status label
// overrides. Assertions below check wishlist_status directly.
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

// Season kept distinct from seed.sql's 'seed-season' so the seed rclc_loot
// row (player 1 already has item 1 at Myth, in 'seed-season') doesn't bleed
// into these scenarios via the has_myth exclusion. Track is 'Hero' unless a
// test needs 'Myth' specifically, since the Hero item-ownership branch only
// applies a multiplier when the player already has Champion loot -- none of
// these fixtures do, so it stays a no-op and expected weighted_total math
// stays simple (raw_score * wishlist multiplier only).
const SEASON = 'wishlist-rank-test';

function generate(asUser, itemId, track = 'Hero') {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, team_id, season, performance_score, attendance_score) values ($1, 1, $2, $3, $4)',
    [playerId, SEASON, performance, attendance]
  );
}

describe('generate_priority_order wishlist integration', () => {
  it('a raider who tagged an item is a candidate', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'good')");

      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row).toBeTruthy();
      expect(row.weighted_total).toBe('90.0');
      expect(row.wishlist_status).toBe('good');
    });
  });

  it('a raider tagged BiS gets the 1.0 multiplier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'bis')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('100.0');
      expect(row.wishlist_status).toBe('bis');
    });
  });

  it('OK applies the 0.60 multiplier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'ok')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('60.0');
      expect(row.wishlist_status).toBe('ok');
    });
  });

  it('Catalyst Only applies the 0.75 multiplier', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'catalyst')");
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('75.0');
      expect(row.wishlist_status).toBe('catalyst');
    });
  });

  it('Pass excludes the raider from the suggested order entirely', async () => {
    await withTxn(async ({ q, asUser }) => {
      // seed.sql's self_received_requests row 2 approves player 1 for item 1
      // at Hero, which drops them from the list on its own; without this
      // delete the case passes whatever the rule under test does.
      await q('delete from public.self_received_requests where id = 2');
      await seedScoring(q, 1, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'pass')");
      const res = await generate(asUser, 1);
      expect(res.rows.find((r) => r.player_id === 1)).toBeFalsy();
    });
  });

  it('a raider who never tagged anything is not a candidate', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      const res = await generate(asUser, 2);
      expect(res.rows.find((r) => r.player_id === 2)).toBeFalsy();
    });
  });
});

// #623 (Finger/Trinket) and #673 (Weapon/Off Hand dual-wield) started
// writing an explicit disambiguating slot on real-item item_preferences
// rows -- generate_priority_order() previously only matched slot = null
// rows, silently ignoring every status tagged on one of these rows
// (including 'pass'). 20260810163045_priority_order_wishlist_slot_aware.sql
// fixes this by matching on item_id alone and collapsing to the single best
// status across all of a player's rows for that item_id.
describe('generate_priority_order slot-aware wishlist matching (#623/#673 follow-up)', () => {
  it('a status tagged on an explicit-slot row (e.g. Weapon) is no longer ignored', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'good', 'Weapon')"
      );
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row).toBeTruthy();
      expect(row.weighted_total).toBe('90.0');
      expect(row.wishlist_status).toBe('good');
    });
  });

  it("'pass' tagged on an explicit-slot row still excludes the raider", async () => {
    await withTxn(async ({ q, asUser }) => {
      // seed.sql's self_received_requests row 2 approves player 1 for item 1
      // at Hero, which drops them from the list on its own; without this
      // delete the case passes whatever the rule under test does.
      await q('delete from public.self_received_requests where id = 2');
      await seedScoring(q, 1, 100, 100);
      // Pass on an explicit-slot row excludes them, same as the legacy
      // slot=null case above.
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 1, 1, 'pass', 'Off Hand')"
      );
      const res = await generate(asUser, 1);
      expect(res.rows.find((r) => r.player_id === 1)).toBeFalsy();
    });
  });

  it('a dual-wielded one-hander tagged BiS in one hand and Pass in the other still counts the raider as BiS (best status wins)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'bis', 'Weapon')"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'pass', 'Off Hand')"
      );
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row).toBeTruthy();
      expect(row.weighted_total).toBe('100.0');
      expect(row.wishlist_status).toBe('bis');
    });
  });

  it('a raider who passed on every disambiguated row for an item is excluded', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'pass', 'Weapon')"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'pass', 'Off Hand')"
      );
      const res = await generate(asUser, 2);
      expect(res.rows.find((r) => r.player_id === 2)).toBeFalsy();
    });
  });

  it('the better of two differing non-pass statuses (Good in one hand, OK in the other) wins', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 2, 100, 100);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'ok', 'Weapon')"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, 2, 2, 'good', 'Off Hand')"
      );
      const res = await generate(asUser, 2);
      const row = res.rows.find((r) => r.player_id === 2);
      expect(row.weighted_total).toBe('90.0');
      expect(row.wishlist_status).toBe('good');
    });
  });
});

// Wishlist status used to only apply as a MULTIPLIER on raw_score, so a
// well-performing Good/OK/Catalyst raider could out-rank a lower-performing
// BiS raider on a regular (non-tier-token) item -- reported live as
// "Torbjorn (2nd Choice) ranked above Katorri (BiS) on Gebbo's Bottomless
// Bag." 20260811122020_priority_order_raw_wishlist_status.sql generalized
// tier tokens' existing bis_match_rank into a `wishlist_rank` hard sort
// tier applied to every item: BiS > Good > OK/Catalyst (tied), checked
// ahead of weighted_total, so score only breaks ties within a tier.
describe('generate_priority_order wishlist status is a hard tier, not just a score multiplier', () => {
  it('a lower-scored BiS raider still outranks a higher-scored Good raider', async () => {
    await withTxn(async ({ q, asUser }) => {
      // seed.sql's self_received_requests row 2 approves player 1 for item 1
      // at Hero, which drops them from the list on its own; without this
      // delete the case passes whatever the rule under test does.
      await q('delete from public.self_received_requests where id = 2');
      await seedScoring(q, 1, 20, 20); // player 1: BiS, low score
      await seedScoring(q, 2, 100, 100); // player 2: Good, high score
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 1, 'bis'), (1, 2, 1, 'good')"
      );

      const res = await generate(asUser, 1);
      const order = res.rows.map((r) => r.player_id);
      expect(order).toContain(1);
      expect(order).toContain(2);
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
    });
  });

  it('OK and Catalyst tie for wishlist_rank -- a higher score wins between them', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 50, 50);
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 2, 'ok')");
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'catalyst')");

      const res = await generate(asUser, 2);
      const order = res.rows.map((r) => r.player_id);
      expect(order.indexOf(2)).toBeLessThan(order.indexOf(1));
    });
  });

  it('a Good raider outranks an OK raider regardless of score', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedScoring(q, 1, 10, 10);
      await seedScoring(q, 2, 100, 100);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 2, 'good')");
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 2, 'ok')");

      const res = await generate(asUser, 2);
      const order = res.rows.map((r) => r.player_id);
      expect(order.indexOf(1)).toBeLessThan(order.indexOf(2));
    });
  });
});

afterAll(() => pool.end());
