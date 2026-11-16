// The audit page's reads (#1639), for the browser tests and the screenshots:
// six raiders on Phoenix, one week on the Tuesday 2026-11-10 reset, read on
// 2026-11-12 at noon. Katorri has a head with no enchant and an empty socket
// (so every state has something to fix), Fennick logged out in PvP gear
// (highest 719, worn lower), and Vexlin was last read three days ago.

export const CLOCK = '2026-11-12T16:00:00Z';
export const THIS_WEEK = '2026-11-10';
export const LAST_WEEK = '2026-11-03';
export const SEASON = { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null };

const RAIDERS = [
  ['Katorri', 'Warlock', 'Demonology', 'Ranged', 721, 2865],
  ['Torbjorn', 'Warrior', 'Protection', 'Tank', 724, 3120],
  ['Brightmend', 'Paladin', 'Holy', 'Heal', 718, 2740],
  ['Grihz', 'Shaman', 'Restoration', 'Heal', 716, 2310],
  ['Fennick', 'Hunter', 'Beast Mastery', 'Ranged', 719, 2875],
  ['Vexlin', 'Rogue', 'Assassination', 'Melee', 714, 1950]
];

export const PLAYERS = RAIDERS.map(([name, cls, spec, role], i) => ({
  id: i + 1,
  name_realm: `${name}-Stormrage`,
  name_realm_key: `${name.toLowerCase()}-stormrage`,
  url_code: `${name.toLowerCase()}01`,
  classes_specs: { class: cls, spec, role }
}));

// Fifteen worn slots and a two-hander, which the game counts in both hands.
const SLOTS = [
  'HEAD',
  'NECK',
  'SHOULDER',
  'BACK',
  'CHEST',
  'WRIST',
  'HANDS',
  'WAIST',
  'LEGS',
  'FEET',
  'FINGER_1',
  'FINGER_2',
  'TRINKET_1',
  'TRINKET_2',
  'MAIN_HAND'
];
const ENCHANTED_SLOTS = ['HEAD', 'SHOULDER', 'CHEST', 'LEGS', 'FEET', 'FINGER_1', 'FINGER_2'];
const gear = (player_id, slot, over = {}) => ({
  player_id,
  equipment_slot: slot,
  item_level: 720,
  wow_item_id: 9000 + player_id * 20 + SLOTS.indexOf(slot),
  track: 'Hero',
  enchantment_id: 7959,
  gem_wow_item_ids: [],
  embellished: false,
  crafted: false,
  upgrade_rank: 4,
  upgrade_max: 6,
  synced_at: '2026-11-12T14:00:00Z',
  ...over
});

const tierItem = (p, slot) => 7000 + p.id * 10 + (slot === 'HEAD' ? 1 : 2);
const isTier = (slot) => slot === 'HEAD' || slot === 'SHOULDER';

export const GEAR = PLAYERS.flatMap((p) =>
  SLOTS.map((slot) => {
    // Only the slots the season enchants carry one.
    const over = ENCHANTED_SLOTS.includes(slot) ? {} : { enchantment_id: null };
    if (p.id === 1 && slot === 'HEAD') Object.assign(over, { enchantment_id: null, gem_wow_item_ids: [null] });
    if (p.id === 1 && slot === 'FINGER_1') Object.assign(over, { gem_wow_item_ids: [1], embellished: true });
    if (p.id === 4 && slot === 'LEGS') Object.assign(over, { gem_wow_item_ids: [2] });
    if (p.id === 5) Object.assign(over, { item_level: 688 });
    if (slot === 'NECK') Object.assign(over, { gem_wow_item_ids: p.id === 3 ? [1, null] : [1] });
    if (slot === 'FINGER_2' && p.id === 2)
      Object.assign(over, { crafted: true, upgrade_rank: null, upgrade_max: null });
    if (p.id === 2) Object.assign(over, slot === 'HEAD' || slot === 'CHEST' ? { upgrade_rank: 6 } : {});
    if (p.id === 4 && slot === 'CHEST') Object.assign(over, { enchantment_id: 7958 });
    if (p.id === 6) Object.assign(over, { synced_at: '2026-11-09T14:00:00Z' });
    // Tier pieces in head and shoulders, on Myth for some and Hero for others.
    if (isTier(slot)) Object.assign(over, { wow_item_id: tierItem(p, slot), track: p.id % 2 ? 'Myth' : 'Hero' });
    return gear(p.id, slot, over);
  })
);

const filled = (needs, done, track, rank, item_level) => ({ needs, done, track, rank, item_level });
const left = (needs, done) => ({ needs, done, left: needs - done });
const VAULTS = {
  1: {
    raid: [filled(2, 8, 'Myth', 6, 334), filled(4, 8, 'Myth', 1, 318), filled(6, 8, 'Myth', 1, 318)],
    dungeon: [filled(1, 6, 'Myth', 1, 318), filled(4, 6, 'Myth', 1, 318), left(8, 6)],
    world: [filled(2, 4, 'Hero', 1, 305), filled(4, 4, 'Hero', 1, 305), left(8, 4)]
  },
  2: {
    raid: [filled(2, 8, 'Myth', 6, 334), filled(4, 8, 'Myth', 1, 318), filled(6, 8, 'Myth', 1, 318)],
    dungeon: [filled(1, 9, 'Myth', 1, 318), filled(4, 9, 'Myth', 1, 318), filled(8, 9, 'Hero', 1, 305)],
    world: [filled(2, 8, 'Hero', 1, 305), filled(4, 8, 'Hero', 1, 305), filled(8, 8, 'Champion', 1, 292)]
  },
  6: {
    raid: [filled(2, 6, 'Hero', 1, 305), filled(4, 6, 'Hero', 1, 305), filled(6, 6, 'Hero', 1, 305)],
    dungeon: [left(1, 0), left(4, 0), left(8, 0)],
    world: [filled(2, 2, 'Champion', 1, 292), left(4, 2), left(8, 2)]
  }
};
const RUNS = {
  1: [12, 12, 11, 10, 10, 9],
  2: [14, 13, 12, 12, 11, 11, 10, 10, 9],
  3: [11, 10, 10, 9],
  4: [9],
  5: [12, 12, 11, 10],
  6: []
};

// Season 2's Venomous Abyss bosses (journal ids, in the game's order) and the
// dungeons the team ran.
export const BOSSES = [
  [2888, "Nek'zali the Soulcoiler"],
  [2874, 'Entombed Sentinels'],
  [2894, 'The Lost Explorers'],
  [2882, 'Vashnik the Malignant'],
  [2871, 'Sszorak'],
  [2887, 'The Twin Fangs'],
  [2883, 'The Coiled Altar'],
  [2895, "Ula'tek"]
];
const BOSS_IDS = BOSSES.map(([id]) => id);
export const DUNGEONS = [
  [525, 'Operation: Floodgate'],
  [558, "Magisters' Terrace"],
  [559, 'Nexus-Point Xenas'],
  [560, 'Maisara Caverns'],
  [583, 'Seat of the Triumvirate'],
  [556, 'Pit of Saron']
];
const DUNGEON_IDS = DUNGEONS.map(([id]) => id);

const week = (p, week_of, over = {}) => ({
  name_realm_key: p.name_realm_key,
  week_of,
  // Heroic on every boss of the raid but the last, Mythic on the first few: the
  // better the raider's id, the more Mythic.
  raid_kills: [
    ...BOSS_IDS.slice(0, 7).map((encounter_id) => ({ encounter_id, difficulty: 'heroic' })),
    ...BOSS_IDS.slice(0, 2 + (p.id % 3)).map((encounter_id) => ({ encounter_id, difficulty: 'mythic' }))
  ],
  raids_at: '2026-11-12T14:00:00Z',
  mplus_runs: (RUNS[p.id] ?? []).map((level, i) => ({
    dungeon_id: DUNGEON_IDS[i % DUNGEON_IDS.length],
    level,
    timed: level > 9
  })),
  mplus_rating: RAIDERS[p.id - 1][5],
  mplus_at: '2026-11-12T14:00:00Z',
  crests: { Myth: 640, Hero: 1100, Champion: 564, Veteran: 912, Adventurer: 520 },
  crests_at: '2026-11-12T14:00:00Z',
  vault: VAULTS[p.id] ?? VAULTS[1],
  vault_at: '2026-11-12T14:00:00Z',
  item_level: p.id === 5 ? 688 : RAIDERS[p.id - 1][4],
  best_item_level: RAIDERS[p.id - 1][4],
  gear_at: null,
  ...over
});

export const WEEKS = PLAYERS.flatMap((p) => [
  week(
    p,
    THIS_WEEK,
    p.id === 6
      ? {
          raids_at: '2026-11-09T14:00:00Z',
          mplus_at: '2026-11-09T14:00:00Z',
          crests_at: '2026-11-09T14:00:00Z',
          vault_at: '2026-11-09T14:00:00Z'
        }
      : {}
  ),
  week(p, LAST_WEEK, {
    mplus_runs: (RUNS[p.id] ?? [])
      .slice(0, 3)
      .map((level, i) => ({ dungeon_id: DUNGEON_IDS[i % DUNGEON_IDS.length], level, timed: true }))
  })
]);

// What the page reads besides the people.
export const REFERENCE = {
  seasons: [SEASON],
  season_raid_bosses: BOSSES.map(([encounter_id, name], i) => ({
    instance_id: 1320,
    encounter_id,
    name,
    sort_order: i + 1
  })),
  mplus_dungeons: DUNGEONS.map(([dungeon_id, name]) => ({ dungeon_id, name })),
  season_enchant_slots: ENCHANTED_SLOTS.map((slot) => ({ slot, counts_from: null })),
  season_enchants: [
    { enchantment_id: 7959, name: 'Hex of Leeching', top_rank: true, tertiary: true },
    { enchantment_id: 7958, name: 'Empowered Hex of Leeching', top_rank: false, tertiary: true }
  ],
  season_gems: [
    { wow_item_id: 1, name: 'Eversong Diamond', top_rank: true, epic: true },
    { wow_item_id: 2, name: 'Flawless Garnet', top_rank: false, epic: false }
  ],
  tier_token_map: PLAYERS.flatMap((p) =>
    ['HEAD', 'SHOULDER'].map((slot) => ({ class: p.classes_specs.class, resolved_item_id: tierItem(p, slot) }))
  ),
  items: GEAR.map((g) => ({
    id: g.wow_item_id,
    wow_item_id: g.wow_item_id,
    slot: g.equipment_slot === 'HEAD' ? 'Head' : 'Other',
    name: g.equipment_slot === 'HEAD' ? 'Hood of the Hollow Choir' : `Item ${g.wow_item_id}`
  })),
  team_settings: [{ enchantCheck: 'lenient', vaultRule: null }]
};

export const CREST_CAPS = { team_season_start: '2026-08-11', season_crest_cap: 800 };
