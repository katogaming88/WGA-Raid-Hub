// generate_priority_order() tier-token bis_match ranking (#651 follow-up,
// see docs/database-decisions.md): a raider who has the dropping tier token
// tagged as their actual BiS now outranks anyone who only tagged it as a
// sidegrade (Good/OK/Catalyst Only), regardless of tier-piece count.
// tier_rank (piece count, 20260804140751_tier_pieces_priority_weighting.sql)
// only breaks ties among raiders who are equally "really keeping this."
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

const SEASON = 'tier-bis-match-test';
const TOKEN_ITEM_ID = 8801;
const RESOLVED_ITEM_ID = 8802;

async function seedTierToken(q) {
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 880100, 'Seed Tier Token', 'Chest')", [
    TOKEN_ITEM_ID
  ]);
  await q(
    "insert into public.items (id, wow_item_id, name, slot) values ($1, 880200, 'Seed Resolved Tier Piece', 'Chest')",
    [RESOLVED_ITEM_ID]
  );
  await q(
    'insert into public.tier_token_map (season, token_item_id, class, resolved_item_id) values ($1, $2, $3, $4)',
    [SEASON, TOKEN_ITEM_ID, 'TestClass', RESOLVED_ITEM_ID]
  );
}

function generate(asUser, itemId, track = 'Hero') {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

async function seedPlayer(q, { id, tierPiecesEquipped = null }) {
  const specId = await q(
    "insert into public.classes_specs (class, spec, role) values ('Seed', $1, 'Ranged') returning id",
    [`Spec${id}`]
  );
  await q(
    'insert into public.players (id, team_id, name_realm, class_spec_id, tier_pieces_equipped) values ($1, 1, $2, $3, $4)',
    [id, `Seedplayer${id}-Illidan`, specId.rows[0].id, tierPiecesEquipped]
  );
}

describe('generate_priority_order tier-token bis_match ranking', () => {
  it('a true-BiS tagger outranks a sidegrade tagger even with a worse tier_rank', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedTierToken(q);
      // Player 201: 0/5 pieces (tier_rank 2 -- becomes 1/5, no bonus) but
      // tagged this token as actual BiS.
      await seedPlayer(q, { id: 201, tierPiecesEquipped: 0 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 201, $1, 'bis')", [
        TOKEN_ITEM_ID
      ]);
      // Player 202: 1/5 pieces (tier_rank 1 -- becomes 2/5, the 2pc bonus,
      // objectively the best tier_rank) but only tagged this token Good.
      await seedPlayer(q, { id: 202, tierPiecesEquipped: 1 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 202, $1, 'good')", [
        TOKEN_ITEM_ID
      ]);

      const res = await generate(asUser, TOKEN_ITEM_ID);
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(201)).toBeGreaterThanOrEqual(0);
      expect(idx(202)).toBeGreaterThanOrEqual(0);
      expect(idx(201)).toBeLessThan(idx(202));
    });
  });

  it('among two true-BiS holders, tier_rank still breaks the tie (2pc completion beats 4pc completion)', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedTierToken(q);
      await seedPlayer(q, { id: 221, tierPiecesEquipped: 1 }); // -> 2/5, rank 1
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 221, $1, 'bis')", [
        TOKEN_ITEM_ID
      ]);
      await seedPlayer(q, { id: 222, tierPiecesEquipped: 3 }); // -> 4/5, rank 3
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 222, $1, 'bis')", [
        TOKEN_ITEM_ID
      ]);

      const res = await generate(asUser, TOKEN_ITEM_ID);
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(221)).toBeLessThan(idx(222));
    });
  });

  it('bis_match is a no-op on a non-tier item -- no tier_token_map row means the sidegrade tagger is unaffected', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Seed Test Robe (item 2) has no tier_token_map row.
      await seedPlayer(q, { id: 231 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 231, 2, 'good')");
      await seedPlayer(q, { id: 232 });
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 232, 2, 'bis')");

      const res = await generate(asUser, 2);
      // Both remain candidates; ordering here falls back to score (both
      // null/tied), not a bis_match-driven reordering -- just confirms
      // neither errors out and both are still present.
      const idx = (id) => res.rows.findIndex((r) => r.player_id === id);
      expect(idx(231)).toBeGreaterThanOrEqual(0);
      expect(idx(232)).toBeGreaterThanOrEqual(0);
    });
  });
});

afterAll(() => pool.end());
