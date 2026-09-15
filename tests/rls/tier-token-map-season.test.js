// #1108: tier_token_map carries a season, and generate_priority_order() only
// treats a drop as a tier token for the season being generated.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, seedSeason } from './helpers.js';

afterAll(() => pool.end());

const CURRENT = 'tier-season-test-now';
const OTHER = 'tier-season-test-old';
const TOKEN = 8811;
const RESOLVED = 8812;

async function seedItems(q) {
  // The two seasons this file maps tokens under (#932): tier_token_map.season
  // is a foreign key to seasons.
  await seedSeason(q, CURRENT);
  await seedSeason(q, OTHER);
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 881100, 'Season Test Token', 'Chest')", [
    TOKEN
  ]);
  await q(
    "insert into public.items (id, wow_item_id, name, slot) values ($1, 881200, 'Season Test Resolved Piece', 'Chest')",
    [RESOLVED]
  );
}

const mapRow = (q, season, cls = 'TestClass', resolved = RESOLVED) =>
  q('insert into public.tier_token_map (season, token_item_id, class, resolved_item_id) values ($1, $2, $3, $4)', [
    season,
    TOKEN,
    cls,
    resolved
  ]);

// One candidate wishlisting the token, so the function returns a row whose
// status label says whether it counted the drop as a tier token.
async function seedCandidate(q) {
  const spec = await q(
    "insert into public.classes_specs (class, spec, role) values ('Seed', 'SeasonSpec', 'Ranged') returning id"
  );
  await q(
    "insert into public.players (id, team_id, name_realm, class_spec_id, tier_pieces_equipped) values (881, 1, 'Seasontest-Illidan', $1, 2)",
    [spec.rows[0].id]
  );
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, 881, $1, 'bis')", [
    TOKEN
  ]);
}

const generateFor = (asUser, season) =>
  asUser(OFFICER_T1, 'select * from public.generate_priority_order(1, $1, $2, $3)', [season, TOKEN, 'Hero']);

describe('tier_token_map.season', () => {
  it('is required, so a seed that forgets the season fails instead of filing it under no season', async () => {
    await withTxn(async ({ q }) => {
      await seedItems(q);
      await expect(
        q('insert into public.tier_token_map (token_item_id, class, resolved_item_id) values ($1, $2, $3)', [
          TOKEN,
          'TestClass',
          RESOLVED
        ])
      ).rejects.toThrow(/season/);
    });
  });

  it('keys token and class per season, so the same token can be mapped in two seasons', async () => {
    await withTxn(async ({ q }) => {
      await seedItems(q);
      await q(
        "insert into public.items (id, wow_item_id, name, slot) values (8813, 881300, 'Season Test Old Piece', 'Chest')"
      );
      await q(
        "insert into public.items (id, wow_item_id, name, slot) values (8814, 881400, 'Season Test Spare Piece', 'Chest')"
      );
      await mapRow(q, CURRENT);
      await mapRow(q, OTHER, 'TestClass', 8813);
      // A different resolved item, so only the per-season token/class key can refuse it.
      const dup = mapRow(q, CURRENT, 'TestClass', 8814);
      await expect(dup).rejects.toMatchObject({ constraint: 'tier_token_map_season_token_class_key' });
    });
  });
});

describe('generate_priority_order() reads the season it is generating', () => {
  it('counts the drop as a tier token for its own season', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await mapRow(q, CURRENT);
      await seedCandidate(q);
      const res = await generateFor(asUser, CURRENT);
      expect(res.rows.find((r) => r.player_id === 881)?.status_label).toContain('Tier: 2/5');
    });
  });

  it('does not count a token mapped only under another season', async () => {
    await withTxn(async ({ q, asUser }) => {
      await seedItems(q);
      await mapRow(q, OTHER);
      await seedCandidate(q);
      const res = await generateFor(asUser, CURRENT);
      const row = res.rows.find((r) => r.player_id === 881);
      expect(row).toBeDefined();
      expect(row?.status_label ?? '').not.toContain('Tier:');
    });
  });
});
