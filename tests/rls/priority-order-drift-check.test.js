// check_priority_order_drift() (20260731023544_priority_order_drift_check.sql):
// flags a saved priority_order top-3 that no longer matches what
// generate_priority_order() would compute live, e.g. after a scoring
// commit. Uses the shared withTxn from helpers.js, wrapped to stamp the
// season, since these tests need both a direct (RLS-bypassing) seed insert
// and an officer-role RPC call inside one rolled-back transaction.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn as withSharedTxn, OFFICER_T1, RAIDER_T1, seedSeason } from './helpers.js';

// The season this file stamps (#932): every season column is a foreign
// key to seasons, so the fixture row comes first in every transaction.
// Wraps the shared harness.
async function withTxn(fn) {
  return withSharedTxn(async (t) => {
    await seedSeason(t.q, SEASON);
    return fn(t);
  });
}

// Distinct from seed.sql's 'seed-season' so the seed rclc_loot row (player 1
// already has item 1 at Myth, in 'seed-season') doesn't bleed into these
// scenarios via generate_priority_order()'s has_myth exclusion.
const SEASON = 'drift-check-test';

function drift(asUser) {
  return asUser(OFFICER_T1, 'select * from public.check_priority_order_drift($1, $2)', [1, SEASON]);
}

async function seedScoring(q, playerId, performance, attendance) {
  await q(
    'insert into public.scoring (player_id, season, performance_score, attendance_score) values ($1, $2, $3, $4)',
    [playerId, SEASON, performance, attendance]
  );
}

describe('check_priority_order_drift', () => {
  it('no drift when the saved top 3 still matches the live computation', async () => {
    await withTxn(async ({ q, asUser }) => {
      // seed.sql's self_received_requests row 2 approves player 1 for item 1
      // at Hero -- generate_priority_order() now excludes an approved
      // self-receive the same as an rclc_loot award (20260831131137), which
      // would otherwise drop player 1 as a live candidate here and desync
      // from the saved top 3 this test relies on matching.
      await q('delete from public.self_received_requests where id = 2');
      // Player 1 has a bis_items row for item 1 from seed.sql; player 2
      // needs an explicit wishlist tag to be a candidate too.
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 1, 'bis')");
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 50, 50);
      // Matches live order: player 1 (100) ranks above player 2 (50).
      await q(
        'insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, 1, $2, 1, 1), (1, $1, 1, $2, 2, 2)',
        [SEASON, 'Hero']
      );

      const res = await drift(asUser);
      expect(res.rows.find((r) => r.item_id === 1)).toBeFalsy();
    });
  });

  it('flags a swap within the top 3 after a scoring change', async () => {
    await withTxn(async ({ q, asUser }) => {
      // See the previous test's comment -- same seed row 2 collision.
      await q('delete from public.self_received_requests where id = 2');
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 2, 1, 'bis')");
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 50, 50);
      // Saved order has player 1 first -- but scoring above now ranks
      // player 2 higher (only the save is stale, not the scoring insert).
      await q(
        'insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, 1, $2, 1, 2), (1, $1, 1, $2, 2, 1)',
        [SEASON, 'Hero']
      );

      const res = await drift(asUser);
      const row = res.rows.find((r) => r.item_id === 1 && r.track === 'Hero');
      expect(row).toBeTruthy();
      expect(row.saved_top3).toEqual(['Seedplayertwo-Illidan', 'Seedraider-Illidan']);
      expect(row.current_top3).toEqual(['Seedraider-Illidan', 'Seedplayertwo-Illidan']);
    });
  });

  it('flags a player newly entering the top 3 from further down the list, not just an in-place swap', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Give item 2 three bis_items candidates: 1 and 2 direct, plus a
      // third player added purely for this test's roster.
      await q(
        "insert into public.players (id, team_id, name_realm, class_spec_id) values (101, 1, 'Thirdrunner-Illidan', 1)"
      );
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 1, 2, 'bis'), (1, 2, 2, 'bis'), (1, 101, 2, 'bis')"
      );
      await seedScoring(q, 1, 100, 100);
      await seedScoring(q, 2, 90, 90);
      await seedScoring(q, 101, 10, 10);
      // Saved order reflects the original ranking (1, 2, 101).
      await q(
        'insert into public.priority_order (team_id, season, item_id, track, rank, player_id) values (1, $1, 2, $2, 1, 1), (1, $1, 2, $2, 2, 2), (1, $1, 2, $2, 3, 101)',
        [SEASON, 'Hero']
      );
      // Player 101 spikes past player 2 (but still below player 1).
      await q(
        'update public.scoring set performance_score = 95, attendance_score = 95 where player_id = 101 and season = $1',
        [SEASON]
      );

      const res = await drift(asUser);
      const row = res.rows.find((r) => r.item_id === 2 && r.track === 'Hero');
      expect(row).toBeTruthy();
      expect(row.saved_top3).toEqual(['Seedraider-Illidan', 'Seedplayertwo-Illidan', 'Thirdrunner-Illidan']);
      expect(row.current_top3).toEqual(['Seedraider-Illidan', 'Thirdrunner-Illidan', 'Seedplayertwo-Illidan']);
    });
  });

  it('a raider (non-officer) is not authorized', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(RAIDER_T1, 'select * from public.check_priority_order_drift($1, $2)', [1, SEASON])
      ).rejects.toThrow('Not authorized');
    });
  });
});

afterAll(() => pool.end());
