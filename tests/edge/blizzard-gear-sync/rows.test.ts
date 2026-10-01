// The rows a gear sync writes (#944). player_equipped_gear carries team_id
// now, checked against the player's team by a trigger, so every row the
// function upserts has to name the team the roster was read for.
import { assertEquals } from 'jsr:@std/assert@1';
import { buildRows, deriveTrack } from '../../../supabase/functions/blizzard-gear-sync/rows.ts';
import { floorsFromRows } from '../../../supabase/functions/blizzard-gear-sync/floors.ts';

const PLAYER = 12;
const TEAM = 3;
const NO_THRESHOLDS = null;
const NO_BONUS_TRACKS = new Map<number, string>();

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
    item_id: 101,
    item_level: 300,
    track: null,
    bonus_list: []
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
    rows.map((r) => [r.equipment_slot, r.item_id]),
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
  assertEquals(deriveTrack(330, floors, [12841], new Map([[12841, 'Hero']])), 'Hero');
});
