// generate_priority_order() equipped-slot track factor
// (20260913013951_generate_priority_order_slot_track_grading.sql, replacing
// the item-level version from 20260831173500).
//
// "This raider already has a good item in this slot, just a different one"
// -- a Hero belt from an earlier boss shouldn't leave someone top priority
// on a different Hero belt drop. The signal is public.player_equipped_gear,
// joined on the target item's items.slot mapped to Blizzard's positional
// equipment_slot key(s).
//
// The factor now grades on the gear's real upgrade TRACK, in three steps
// (Myth 0.92 / Hero 0.96 / Champion-or-lower and empty 1.00), not on item
// level against team_settings.config.trackIlvlThresholds. Item level cannot
// answer the question: the tracks overlap by design (Hero 6/6 and Myth 2/6
// are both ilvl 321), so an ilvl threshold reads every fully-upgraded Hero
// item as Myth -- measured at 286 such items across this guild's roster.
// track comes from the item's bonus IDs via track_bonus_ids; see
// 20260913013949. Several cases below deliberately pair a HIGH item_level
// with a LOW track (and vice versa) to prove item level no longer has any
// say.
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

const SEASON = 'equipped-slot-track-test';
const BELT_ITEM_ID = 8910;
const RING_ITEM_ID = 8911;
const OFFHAND_ITEM_ID = 8912;

// A Myth-track generation for a candidate with no prior copy of the item
// scores 100 * 1.15 ("No Version"); a Hero-track one scores 100 * 1.0.
// The slot steps multiply on top of those.
const MYTH_GEN_NO_PENALTY = '115.0';
const MYTH_GEN_MYTH_SLOT = '105.8'; // 115 * 0.92
const MYTH_GEN_HERO_SLOT = '110.4'; // 115 * 0.96
const HERO_GEN_NO_PENALTY = '100.0';
const HERO_GEN_MYTH_SLOT = '92.0'; // 100 * 0.92

async function seedItems(q) {
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 891000, 'Seed Slot Belt', 'Waist')", [
    BELT_ITEM_ID
  ]);
  await q("insert into public.items (id, wow_item_id, name, slot) values ($1, 891100, 'Seed Slot Ring', 'Finger')", [
    RING_ITEM_ID
  ]);
  await q(
    "insert into public.items (id, wow_item_id, name, slot) values ($1, 891200, 'Seed Slot Off Hand', 'Off Hand')",
    [OFFHAND_ITEM_ID]
  );
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

// item_id 999900+ throughout: a DIFFERENT item than the one being generated,
// so only the slot factor is in play and never the same-item exclusion.
async function equip(q, playerId, slot, { track, ilvl = 300, itemId = 999901 }) {
  await q(
    `insert into public.player_equipped_gear (player_id, team_id, equipment_slot, item_id, item_level, track)
     values ($1, 1, $2, $3, $4, $5)`,
    [playerId, slot, itemId, ilvl, track]
  );
}

function generate(asUser, itemId, track) {
  return asUser(OFFICER_T1, 'select * from public.generate_priority_order($1, $2, $3, $4)', [1, SEASON, itemId, track]);
}

// Only players 1 and 2 are seeded on team 1, so a three-way comparison needs
// one more. Same explicit-id shape as tests/rls/priority-tier-bench-trial.js.
const THIRD_PLAYER_ID = 8913;

async function seedThirdCandidate(q, itemId) {
  const spec = await q(
    "insert into public.classes_specs (class, spec, role) values ('Seed', 'SlotTrackSpec', 'Ranged') returning id"
  );
  await q('insert into public.players (id, team_id, name_realm, class_spec_id) values ($1, 1, $2, $3)', [
    THIRD_PLAYER_ID,
    'Seedslottrack-Illidan',
    spec.rows[0].id
  ]);
  await seedScoring(q, THIRD_PLAYER_ID, 100, 100);
  await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, $2, 'bis')", [
    THIRD_PLAYER_ID,
    itemId
  ]);
}

async function twoCandidates(q, itemId) {
  await seedItems(q);
  await seedScoring(q, 1, 100, 100);
  await seedScoring(q, 2, 100, 100);
  await seedBoth1And2Bis(q, itemId);
}

describe('generate_priority_order equipped-slot track factor', () => {
  it('grades Myth, Hero and Champion in the slot as three distinct steps', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, BELT_ITEM_ID);
      await seedThirdCandidate(q, BELT_ITEM_ID);
      await equip(q, 1, 'WAIST', { track: 'Myth' });
      await equip(q, 2, 'WAIST', { track: 'Hero' });
      await equip(q, THIRD_PLAYER_ID, 'WAIST', { track: 'Champion' });

      const res = await generate(asUser, BELT_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(MYTH_GEN_MYTH_SLOT);
      expect(byId[2].weighted_total).toBe(MYTH_GEN_HERO_SLOT);
      expect(byId[THIRD_PLAYER_ID].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
      expect(byId[1].status_label).toContain('Myth Equipped (Slot)');
      expect(byId[2].status_label).toContain('Hero Equipped (Slot)');
      expect(byId[THIRD_PLAYER_ID].status_label || '').not.toContain('Equipped (Slot)');
    });
  });

  it('follows the track, not the item level: a high-ilvl Hero item is not treated as Myth', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, BELT_ITEM_ID);
      // The exact live failure this migration fixes: Hero 6/6 is ilvl 321 and
      // clears the guild's configured Myth floor of 318, while a genuine
      // Myth 1/6 sits BELOW it at 318. The Hero player must still grade as
      // Hero and out-rank the Myth player.
      await equip(q, 1, 'WAIST', { track: 'Hero', ilvl: 321 });
      await equip(q, 2, 'WAIST', { track: 'Myth', ilvl: 318 });

      const res = await generate(asUser, BELT_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(MYTH_GEN_HERO_SLOT);
      expect(byId[2].weighted_total).toBe(MYTH_GEN_MYTH_SLOT);
      expect(Number(byId[1].weighted_total)).toBeGreaterThan(Number(byId[2].weighted_total));
    });
  });

  it('ignores trackIlvlThresholds entirely, including when the team has none configured', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, BELT_ITEM_ID);
      await q("update public.team_settings set config = config - 'trackIlvlThresholds' where team_id = 1");
      await equip(q, 1, 'WAIST', { track: 'Myth', ilvl: 1 });

      const res = await generate(asUser, BELT_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      // Absurd item_level, no thresholds at all -- the track alone decides.
      expect(byId[1].weighted_total).toBe(MYTH_GEN_MYTH_SLOT);
      expect(byId[2].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
    });
  });

  it('applies the same steps to a Hero-track generation', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, BELT_ITEM_ID);
      await equip(q, 1, 'WAIST', { track: 'Myth' });

      const res = await generate(asUser, BELT_ITEM_ID, 'Hero');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(HERO_GEN_MYTH_SLOT);
      expect(byId[2].weighted_total).toBe(HERO_GEN_NO_PENALTY);
    });
  });

  it('grades a ring off the LOWER of the two finger slots', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, RING_ITEM_ID);
      // One Myth ring and one Champion ring: the drop would replace the
      // Champion one, so this player still genuinely wants a ring and must
      // not be graded as fully Myth-itemized.
      await equip(q, 1, 'FINGER_1', { track: 'Myth', itemId: 999901 });
      await equip(q, 1, 'FINGER_2', { track: 'Champion', itemId: 999902 });
      // Both slots Myth: nothing left to gain, full penalty.
      await equip(q, 2, 'FINGER_1', { track: 'Myth', itemId: 999903 });
      await equip(q, 2, 'FINGER_2', { track: 'Myth', itemId: 999904 });

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
      expect(byId[2].weighted_total).toBe(MYTH_GEN_MYTH_SLOT);
    });
  });

  it('treats an unfilled second finger slot as the lowest step', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, RING_ITEM_ID);
      // Only one ring equipped at all -- the empty slot is exactly the gap
      // this drop fills, so no penalty.
      await equip(q, 1, 'FINGER_2', { track: 'Myth' });

      const res = await generate(asUser, RING_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
      expect(byId[2].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
    });
  });

  it('does not pair MAIN_HAND with OFF_HAND: weapons stay single-slot', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, OFFHAND_ITEM_ID);
      // A Myth main-hand has no bearing on an Off Hand drop (the wielder may
      // not dual-wield at all), and the off-hand's own track is what counts.
      await equip(q, 1, 'MAIN_HAND', { track: 'Myth', itemId: 999905 });
      await equip(q, 2, 'OFF_HAND', { track: 'Myth', itemId: 999906 });

      const res = await generate(asUser, OFFHAND_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
      expect(byId[2].weighted_total).toBe(MYTH_GEN_MYTH_SLOT);
    });
  });

  it('treats an unknown or missing track as the lowest step rather than guessing', async () => {
    await withTxn(async ({ q, asUser }) => {
      await twoCandidates(q, BELT_ITEM_ID);
      // Crafted/Timewarped gear carries no track bonus ID, so track can come
      // back null even at a high item level. Never inferred from ilvl.
      await equip(q, 1, 'WAIST', { track: null, ilvl: 999 });

      const res = await generate(asUser, BELT_ITEM_ID, 'Myth');
      const byId = Object.fromEntries(res.rows.map((r) => [r.player_id, r]));
      expect(byId[1].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
      expect(byId[2].weighted_total).toBe(MYTH_GEN_NO_PENALTY);
    });
  });
});

// The seeded bonus-ID mapping is what makes every test above meaningful in
// production: a typo here would silently mis-track real gear, and nothing
// else in the suite would notice. Spot-checks the block boundaries and the
// one value confirmed against live armory data.
describe('track_bonus_ids seed', () => {
  it('maps the Midnight Season 2 blocks to the right track and rank', async () => {
    await withTxn(async ({ q }) => {
      const res = await q('select bonus_id, track, rank from public.track_bonus_ids order by bonus_id');
      const byId = Object.fromEntries(res.rows.map((r) => [r.bonus_id, `${r.track} ${r.rank}`]));
      // Champion 1/6-6/6, Hero 1/6-6/6, Myth 1/6-6/6, plus the last two
      // Mythic bosses' above-ceiling drop.
      expect(byId[12833]).toBe('Champion 1');
      expect(byId[12838]).toBe('Champion 6');
      expect(byId[12841]).toBe('Hero 1');
      expect(byId[12846]).toBe('Hero 6');
      expect(byId[12849]).toBe('Myth 1');
      // Confirmed live: Soulcialist's Gebbo's Bottomless Bag, ilvl 331.
      expect(byId[12853]).toBe('Myth 5');
      expect(byId[12854]).toBe('Myth 6');
      expect(byId[13848]).toBe('Myth 9');
      // The gaps between blocks must stay empty -- 12839/12840 and
      // 12847/12848 are unallocated, and claiming them would shift a rank.
      for (const gap of [12839, 12840, 12847, 12848]) expect(byId[gap]).toBeUndefined();
    });
  });
});

afterAll(async () => {
  await pool.end();
});
