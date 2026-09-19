// The rows a gear sync writes (#944). player_equipped_gear carries team_id
// now, checked against the player's team by a trigger, so every row the
// function upserts has to name the team the roster was read for.
import { assertEquals } from 'jsr:@std/assert@1';
import { buildRows } from '../../../supabase/functions/blizzard-gear-sync/rows.ts';

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
