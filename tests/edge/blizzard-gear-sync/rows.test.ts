// The rows a gear sync writes (#944). player_equipped_gear carries team_id
// now, checked against the player's team by a trigger, so every row the
// function upserts has to name the team the roster was read for.
import { assertEquals } from 'jsr:@std/assert@1';
import {
  bonusStepsFromRows,
  buildRows,
  deriveTrack,
  type BonusStep
} from '../../../supabase/functions/blizzard-gear-sync/rows.ts';
import { floorsFromRows } from '../../../supabase/functions/blizzard-gear-sync/floors.ts';

const PLAYER = 12;
const TEAM = 3;
const NO_THRESHOLDS = null;
const NO_BONUS_TRACKS = new Map<number, BonusStep>();

// One equipped item in the shape the Character Equipment Summary endpoint
// answers with; an item id of null is a slot the answer names but holds
// nothing for.
function equipped(slot: string, itemId: number | null, itemLevel = 300) {
  return {
    slot: { type: slot },
    item: itemId == null ? {} : { id: itemId },
    level: { value: itemLevel },
    bonus_list: []
  };
}

Deno.test('every row carries the team id given', () => {
  const rows = buildRows(PLAYER, TEAM, [equipped('HEAD', 101), equipped('CHEST', 102)], NO_THRESHOLDS, NO_BONUS_TRACKS);
  assertEquals(
    rows.map((r) => r.team_id),
    [TEAM, TEAM]
  );
  assertEquals(rows[0], {
    player_id: PLAYER,
    team_id: TEAM,
    equipment_slot: 'HEAD',
    wow_item_id: 101,
    item_level: 300,
    track: null,
    bonus_list: [],
    enchantment_id: null,
    gem_wow_item_ids: [],
    embellished: false,
    crafted: false,
    upgrade_rank: null,
    upgrade_max: null
  });
});

Deno.test('a row per equipped slot with an item id', () => {
  const rows = buildRows(
    PLAYER,
    TEAM,
    [equipped('HEAD', 101), equipped('CHEST', 102), equipped('LEGS', 103)],
    NO_THRESHOLDS,
    NO_BONUS_TRACKS
  );
  assertEquals(
    rows.map((r) => [r.equipment_slot, r.wow_item_id]),
    [
      ['HEAD', 101],
      ['CHEST', 102],
      ['LEGS', 103]
    ]
  );
});

Deno.test('a slot with no item id is skipped', () => {
  const rows = buildRows(
    PLAYER,
    TEAM,
    [equipped('HEAD', 101), equipped('CHEST', null)],
    NO_THRESHOLDS,
    NO_BONUS_TRACKS
  );
  assertEquals(
    rows.map((r) => r.equipment_slot),
    ['HEAD']
  );
});

// The tier's floors (#1267): season_track_floors rows as the sync reads them
// for the current tier, here Midnight Season 2's.
const MID2_FLOORS = [
  { track: 'Myth', item_level: 318 },
  { track: 'Hero', item_level: 305 },
  { track: 'Champion', item_level: 292 },
  { track: 'Veteran', item_level: 279 },
  { track: 'Adventurer', item_level: 266 },
  { track: 'Explorer', item_level: 207 }
];

Deno.test("gear with no track bonus id is graded by the tier's floors", () => {
  const floors = floorsFromRows(MID2_FLOORS);
  assertEquals(deriveTrack(310, floors, [], NO_BONUS_TRACKS), 'Hero');
  assertEquals(deriveTrack(200, floors, [], NO_BONUS_TRACKS), null);
});

Deno.test("a track bonus id outranks the tier's floors", () => {
  const floors = floorsFromRows(MID2_FLOORS);
  assertEquals(deriveTrack(330, floors, [12841], new Map([[12841, { track: 'Hero', rank: 1, max: 6 }]])), 'Hero');
});

// #1634: what the audit reads off each slot. Shapes copied from a live
// Character Equipment Summary reply (Katorri-Stormrage, 2026-11-15).
const MID2_STEPS = bonusStepsFromRows([
  ...[12841, 12842, 12843, 12844, 12845, 12846].map((bonus_id, i) => ({
    bonus_id,
    track: 'Hero',
    rank: i + 1,
    season: 'MID2'
  }))
]);

function oneRow(item: Record<string, unknown>) {
  const rows = buildRows(PLAYER, TEAM, [{ ...equipped('NECK', 201, 321), ...item }], NO_THRESHOLDS, MID2_STEPS);
  return rows[0];
}

const gem = (id: number) => ({ socket_type: { type: 'PRISMATIC' }, item: { id } });
const emptySocket = { socket_type: { type: 'PRISMATIC' } };

Deno.test('a two-socket neck keeps both gems, in socket order', () => {
  assertEquals(oneRow({ sockets: [gem(240983), gem(240890)] }).gem_wow_item_ids, [240983, 240890]);
});

Deno.test('an empty socket is kept as null, so it counts as a socket with no gem', () => {
  assertEquals(oneRow({ sockets: [gem(240890), emptySocket] }).gem_wow_item_ids, [240890, null]);
});

Deno.test('an item with no sockets has none, never an assumed one', () => {
  assertEquals(oneRow({}).gem_wow_item_ids, []);
});

Deno.test('only the permanent enchant is kept; an oil is not an enchant', () => {
  const oilOnly = { enchantments: [{ enchantment_id: 7500, enchantment_slot: { id: 2, type: 'TEMPORARY' } }] };
  assertEquals(oneRow(oilOnly).enchantment_id, null);
  const both = {
    enchantments: [
      { enchantment_id: 7500, enchantment_slot: { id: 2, type: 'TEMPORARY' } },
      { enchantment_id: 8689, enchantment_slot: { id: 0, type: 'PERMANENT' } }
    ]
  };
  assertEquals(oneRow(both).enchantment_id, 8689);
});

Deno.test('an embellished crafted piece reads as both', () => {
  const row = oneRow({
    limit_category: 'Unique-Equipped: Embellished (2)',
    name_description: { display_string: 'Tidal Crafted' },
    modified_crafting_stat: [{ id: 49, type: 'MASTERY_RATING' }]
  });
  assertEquals([row.embellished, row.crafted], [true, true]);
});

Deno.test('a raid drop is neither embellished nor crafted', () => {
  const row = oneRow({ name_description: { display_string: 'Heroic' } });
  assertEquals([row.embellished, row.crafted], [false, false]);
});

Deno.test('a 4/6 Hero item has upgrade step 4 of 6', () => {
  const row = oneRow({ bonus_list: [6652, 13334, 12844] });
  assertEquals([row.track, row.upgrade_rank, row.upgrade_max], ['Hero', 4, 6]);
});

Deno.test('gear with no track bonus id has no upgrade step', () => {
  const row = oneRow({ bonus_list: [12214, 13695] });
  assertEquals([row.upgrade_rank, row.upgrade_max], [null, null]);
});

// Every Myth step from 1, as the table has them, plus the special drop.
const MYTH_STEPS = bonusStepsFromRows([
  ...[12849, 12850, 12851, 12852, 12853, 12854].map((bonus_id, i) => ({
    bonus_id,
    track: 'Myth',
    rank: i + 1,
    season: 'MID2'
  })),
  { bonus_id: 13848, track: 'Myth', rank: 9, season: 'MID2' }
]);

Deno.test("a fully upgraded Myth item is 6 of 6: the bosses' special drop doesn't raise the top step", () => {
  const rows = buildRows(PLAYER, TEAM, [{ ...equipped('HEAD', 1, 334), bonus_list: [12854] }], null, MYTH_STEPS);
  assertEquals([rows[0].upgrade_rank, rows[0].upgrade_max], [6, 6]);
});

Deno.test('the special drop reads 9 of 6, as in game', () => {
  const rows = buildRows(PLAYER, TEAM, [{ ...equipped('HEAD', 1, 343), bonus_list: [13848] }], null, MYTH_STEPS);
  assertEquals([rows[0].track, rows[0].upgrade_rank, rows[0].upgrade_max], ['Myth', 9, 6]);
});

Deno.test("a track's top step is counted per season", () => {
  const steps = bonusStepsFromRows([
    { bonus_id: 1, track: 'Hero', rank: 1, season: 'OLD' },
    { bonus_id: 2, track: 'Hero', rank: 2, season: 'OLD' },
    { bonus_id: 3, track: 'Hero', rank: 1, season: 'NEW' }
  ]);
  assertEquals(steps.get(3), { track: 'Hero', rank: 1, max: 1 });
  assertEquals(steps.get(1), { track: 'Hero', rank: 1, max: 2 });
});

Deno.test('a track seeded without a step 1 tops out at its highest step, never 0', () => {
  const steps = bonusStepsFromRows([
    { bonus_id: 1, track: 'Hero', rank: 2, season: 'NEXT' },
    { bonus_id: 2, track: 'Hero', rank: 3, season: 'NEXT' }
  ]);
  assertEquals(steps.get(1), { track: 'Hero', rank: 2, max: 3 });
});
