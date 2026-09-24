// How the wishlist editor behaves, written once and checked against both sites
// (#1102, #868 part 3). tests/browser/wishlist-recorded.test.js records it from
// the current site's My Wishlist; tests/browser-app/wishlist.test.js runs the
// same checks against the new app's Wishlist tab.
//
// What carries over is which raid items a raider is offered for each slot,
// which of them are marked BiS or Pass, the ring and trinket rule (one item is
// BiS in one of its two slots), when editing is closed, and the row a new BiS
// pick saves. What does not (Kat, 2026-09-14): 2nd Choice, Sidegrade and
// Catalyst Only (#1032), notes, and adding M+ or crafted picks, which wait
// for real items (#1166).
//
// Each suite reads the editor into this shape, one entry per slot with items:
//
//   [{ slot, items: [name], bis: [name], pass: [name], taken: [{ item, by }], notFromRaid: name | null }]
//
// `taken` is an item already BiS in the slot's pair (Finger 1 and 2, Trinket 1
// and 2), `by` naming that slot; a Pass on a ring or trinket shows in both. `notFromRaid` is an M+ or crafted pick
// covering the slot.

import { SEASON, TORBJORN } from './profile.js';

export { SEASON, TORBJORN };

const item = (id, name, slot, extra = {}) => ({
  id,
  wow_item_id: 213000 + (id - 1000),
  name,
  slot,
  armor_type: '',
  is_placeholder: false,
  icon: null,
  wcl_zone_id: 53,
  secondary_stats: null,
  main_stats: null,
  weapon_subtype: null,
  is_ptr: false,
  is_boe: false,
  ...extra
});

// Torbjorn is a Frost Death Knight: plate, Strength, dual wields, no shield.
export const ITEMS = [
  item(1001, 'Venom-Etched Greathelm', 'Head', { armor_type: 'Plate' }),
  // Another armor type.
  item(1002, 'Hood of the Hollow Choir', 'Head', { armor_type: 'Cloth' }),
  // Last season's raid.
  item(1003, 'Helm of the Fallen Sun', 'Head', { armor_type: 'Plate', wcl_zone_id: 46 }),
  item(1004, 'Chain of Whispering Venom', 'Neck'),
  item(1005, 'Caustic Chain-Wrapped Sash', 'Waist', { armor_type: 'Plate' }),
  // A tier token, offered as the piece it becomes for a Death Knight, whose
  // own catalog row is not offered a second time.
  item(1006, 'Venomforged Idol', 'Hands'),
  item(1007, 'Baleful Grave-Knight’s Deathgrips', 'Hands', { armor_type: 'Plate' }),
  item(1008, 'Band of the Hollow Choir', 'Finger'),
  item(1009, 'Signet of Coiled Ash', 'Finger'),
  item(1010, 'Idol of Seething Strength', 'Trinket', { main_stats: ['STRENGTH'] }),
  // Intellect only.
  item(1011, 'Orb of Quiet Venom', 'Trinket', { main_stats: ['INTELLECT'] }),
  // Healers only, and tanks only.
  item(1012, 'Soulcoiler Ritual Vessel', 'Trinket'),
  item(1013, "First Mate's Shellward", 'Trinket'),
  // A one-hander a dual wielder can also want in the off hand.
  item(1014, 'Venomfang Cleaver', 'One-Hand', { main_stats: ['STRENGTH'], weapon_subtype: 'Axe' }),
  // A Death Knight cannot use a dagger, a staff or a shield.
  item(1015, 'Hexblade Dagger', 'One-Hand', { main_stats: ['STRENGTH'], weapon_subtype: 'Dagger' }),
  item(1016, 'Abyssal Greatsword', 'Two-Hand', { main_stats: ['STRENGTH'], weapon_subtype: 'Sword' }),
  item(1017, 'Coiled Hex Staff', 'Two-Hand', { main_stats: ['INTELLECT'], weapon_subtype: 'Staff' }),
  item(1018, 'Warded Venom Bulwark', 'Off Hand', { main_stats: ['STRENGTH'], weapon_subtype: 'Shield' }),
  item(1019, 'M+', 'Placeholder', { wcl_zone_id: null, is_placeholder: true }),
  item(1020, 'Crafted', 'Placeholder', { wcl_zone_id: null, is_placeholder: true })
];

export const RAID_ZONES = [
  { wcl_zone_id: 53, season: 'MID2', name: 'The Venomous Abyss', sort_index: 0 },
  { wcl_zone_id: 46, season: 'MID1', name: 'March on Quel’Danas', sort_index: 1 }
];

export const TIER_TOKEN_MAP = [
  {
    season: 'MID2',
    class: 'Death Knight',
    token_item_id: 1006,
    resolved_item_id: 1007,
    token: { name: 'Venomforged Idol' },
    resolved: { name: 'Baleful Grave-Knight’s Deathgrips' }
  }
];

const pref = (id, itemId, status, slot, extra = {}) => ({
  id,
  team_id: 1,
  player_id: TORBJORN.id,
  item_id: itemId,
  status,
  note: null,
  slot,
  // The code the column holds since #936, which is SEASON.code.
  season: 'MID2',
  synced_bis: false,
  ...extra
});

export const WISHLIST = [
  pref(1, 1001, 'bis', null),
  // A 2nd Choice mark reads as unmarked in the new app. The current site's
  // own label for it is not part of the shape.
  pref(2, 1005, 'good', null),
  // The ring is Finger 1's pick. The current site copies it into Finger 2,
  // where it cannot be marked again.
  pref(3, 1008, 'bis', 'Finger 1'),
  pref(4, 1008, 'bis', 'Finger 2', { synced_bis: true }),
  pref(5, 1009, 'pass', 'Finger 2'),
  pref(6, 1010, 'bis', 'Trinket 1'),
  pref(7, 1010, 'bis', 'Trinket 2', { synced_bis: true }),
  // The same axe in both hands is two picks.
  pref(8, 1014, 'bis', 'Weapon'),
  pref(9, 1014, 'bis', 'Off Hand'),
  pref(10, 1016, 'pass', 'Weapon'),
  // The neck comes from M+.
  pref(11, 1019, 'bis', 'Neck')
];

const slot = (name, items, marks = {}) => ({
  slot: name,
  items,
  bis: marks.bis ?? [],
  pass: marks.pass ?? [],
  taken: marks.taken ?? [],
  notFromRaid: marks.notFromRaid ?? null
});

// In gear-panel order, items by name. Slots with nothing to offer are left out.
export const EXPECTED_EDITOR = [
  slot('Head', ['Venom-Etched Greathelm'], { bis: ['Venom-Etched Greathelm'] }),
  slot('Neck', ['Chain of Whispering Venom'], { notFromRaid: 'M+' }),
  slot('Hands', ['Baleful Grave-Knight’s Deathgrips']),
  slot('Waist', ['Caustic Chain-Wrapped Sash']),
  // A ring passed on in one slot is passed on in both.
  slot('Finger 1', ['Band of the Hollow Choir', 'Signet of Coiled Ash'], {
    bis: ['Band of the Hollow Choir'],
    pass: ['Signet of Coiled Ash']
  }),
  slot('Finger 2', ['Band of the Hollow Choir', 'Signet of Coiled Ash'], {
    pass: ['Signet of Coiled Ash'],
    taken: [{ item: 'Band of the Hollow Choir', by: 'Finger 1' }]
  }),
  slot('Trinket 1', ['Idol of Seething Strength'], { bis: ['Idol of Seething Strength'] }),
  slot('Trinket 2', ['Idol of Seething Strength'], {
    taken: [{ item: 'Idol of Seething Strength', by: 'Trinket 1' }]
  }),
  slot('Weapon', ['Abyssal Greatsword', 'Venomfang Cleaver'], {
    bis: ['Venomfang Cleaver'],
    pass: ['Abyssal Greatsword']
  }),
  slot('Off Hand', ['Venomfang Cleaver'], { bis: ['Venomfang Cleaver'] })
];

// Marking Signet of Coiled Ash BiS for Finger 1 saves this row. The row it
// replaces is cleared differently by each site, which each suite checks on
// its own: the current site keeps the old ring as 2nd Choice, the new app
// unmarks it (#1032).
export const NEW_BIS_ROW = {
  team_id: 1,
  player_id: TORBJORN.id,
  item_id: 1009,
  slot: 'Finger 1',
  status: 'bis',
  season: 'MID2'
};
