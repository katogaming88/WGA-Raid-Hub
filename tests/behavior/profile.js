// How the player profile behaves, written once and checked against both sites
// (#1102 step 1, #868 part 1). tests/browser/profile-recorded.test.js records
// it from the current site's profile; tests/browser-app/profile.test.js runs
// the same checks against the new app's profile page.
//
// Part 1 is what a profile shows: who can open it, the header, attendance,
// items received, equipped gear and M+ exclusion status. The loot priority
// list, wishlist, Mark Received and the M+ request form come in later parts.
//
// Each suite reads the page into this shape:
//
//   { name, character, role, spec, tags, joined, links: { warcraftLogs, raiderIo, armory },
//     attendance: { pct, flagged: [{ date, status }] },
//     loot: { count, season, last: { date, items: [{ name, difficulty }] }, all: [{ name, difficulty, date }] },
//     gear: [{ slot, item, itemLevel, track }],
//     mplus: { status, note } | null }

export const SEASON = { name: 'Midnight Season 2', code: 'MID2', start: '2026-08-01', end: '2026-12-31' };

const cs = (klass, spec, role) => ({ class: klass, spec, role });

const player = (id, nameRealm, nickname, classSpec, flags = {}) => ({
  id,
  team_id: 1,
  name_realm: nameRealm,
  nickname,
  url_code: `code${id}`,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  is_backup_tank: false,
  is_backup_healer: false,
  bis_link: '',
  bis_allowed: false,
  wishlist_allowed: false,
  m_plus_excluded: false,
  m_plus_note: '',
  join_date: null,
  tier_pieces_equipped: null,
  bonus_roll_encounter_id: null,
  raid_encounters: null,
  team_member_id: null,
  classes_specs: classSpec,
  ...flags
});

// Torbjorn is the raider the checks read. Dodgey was refused an M+ exclusion.
// Kato is the officer.
export const TORBJORN = player(11, 'Torbjorn-Illidan', 'Raz', cs('Death Knight', 'Frost', 'Melee'), {
  is_backup_tank: true,
  join_date: '2026-08-10',
  m_plus_excluded: true,
  m_plus_note: 'Raid nights only',
  tier_pieces_equipped: 4,
  team_member_id: 501
});
export const DODGEY = player(12, 'Dodgey-Illidan', '', cs('Monk', 'Windwalker', 'Melee'), {
  is_trial: true,
  team_member_id: 502
});
export const KATO = player(13, 'Kato-Illidan', 'Kat', cs('Paladin', 'Holy', 'Heal'), { team_member_id: 503 });

export const PLAYERS = [TORBJORN, DODGEY, KATO];

export const VIEWERS = {
  torbjorn: {
    userId: 'user-torbjorn',
    discordId: 'discord-torbjorn',
    teamMember: 501,
    role: 'raider',
    player: TORBJORN
  },
  dodgey: { userId: 'user-dodgey', discordId: 'discord-dodgey', teamMember: 502, role: 'raider', player: DODGEY },
  officer: { userId: 'user-kato', discordId: 'discord-kato', teamMember: 503, role: 'officer', player: KATO }
};

const night = (id, playerId, date, status) => ({
  id,
  team_id: 1,
  player_id: playerId,
  raid_date: date,
  status,
  report_excluded: false,
  report_title: null,
  source: 'WCL'
});

// Before the season, before Torbjorn joined, and in the season. The percentage
// counts only nights from the join date; the flagged list counts the season.
export const ATTENDANCE = [
  night(1, 11, '2026-07-20', 'No Show'),
  night(2, 11, '2026-08-05', 'Excused'),
  night(3, 11, '2026-08-12', 'Present'),
  night(4, 11, '2026-08-14', 'Late (no notice)'),
  night(5, 11, '2026-08-19', 'No Show'),
  night(6, 11, '2026-08-21', 'Present'),
  night(7, 11, '2026-08-26', 'Not on Roster')
];

export const ITEMS = [
  { id: 901, wow_item_id: 212001, name: 'Venomforged Effigy', slot: 'Head', is_placeholder: false },
  { id: 902, wow_item_id: 212002, name: 'Soulcoiler Ritual Vessel', slot: 'Trinket', is_placeholder: false },
  { id: 903, wow_item_id: 212003, name: 'Caustic Chain-Wrapped Sash', slot: 'Waist', is_placeholder: false },
  { id: 904, wow_item_id: 212004, name: 'Coiled Hex Legguards', slot: 'Legs', is_placeholder: false },
  { id: 905, wow_item_id: 212005, name: 'Last Season Band', slot: 'Finger', is_placeholder: false }
];

const award = (id, item, track, season, at) => ({
  id,
  team_id: 1,
  player_id: 11,
  item_id: ITEMS.find((i) => i.name === item).id,
  track,
  season,
  awarded_at: at,
  items: { name: item },
  players: { name_realm: 'Torbjorn-Illidan' }
});

export const LOOT = [
  award(1, 'Last Season Band', 'Myth', 'MID1', '2026-05-01T18:00:00+00:00'),
  award(2, 'Venomforged Effigy', 'Hero', 'MID2', '2026-08-20T18:00:00+00:00'),
  award(3, 'Caustic Chain-Wrapped Sash', 'Myth', 'MID2', '2026-08-27T18:00:00+00:00'),
  award(4, 'Coiled Hex Legguards', 'Hero', 'MID2', '2026-08-27T18:30:00+00:00')
];

export const GEAR = [
  { player_id: 11, equipment_slot: 'TRINKET_1', item_id: 212002, item_level: 318, track: 'Hero' },
  { player_id: 11, equipment_slot: 'HEAD', item_id: 212001, item_level: 321, track: 'Myth' },
  { player_id: 11, equipment_slot: 'NECK', item_id: 999999, item_level: 300, track: null }
];

export const MPLUS_REJECTIONS = [
  {
    player_id: 12,
    team_id: 1,
    status: 'rejected',
    officer_notes: 'Sockets missing',
    submitted_at: '2026-08-30T12:00:00+00:00'
  }
];

export const EXPECTED_TORBJORN = {
  name: 'Raz',
  character: 'Torbjorn-Illidan',
  role: 'Melee',
  spec: 'Frost',
  tags: ['Backup Tank'],
  joined: 'Aug 10, 2026',
  links: {
    warcraftLogs: 'https://www.warcraftlogs.com/character/us/illidan/Torbjorn',
    raiderIo: 'https://raider.io/characters/us/illidan/Torbjorn',
    armory: 'https://worldofwarcraft.com/en-us/character/us/illidan/Torbjorn'
  },
  attendance: {
    // Present 1 + Late (no notice) 0.5 + No Show 0 + Present 1, over 4 nights.
    pct: '62.5%',
    flagged: [
      { date: '2026-08-19', status: 'No Show' },
      { date: '2026-08-14', status: 'Late (no notice)' },
      { date: '2026-08-05', status: 'Excused' }
    ]
  },
  loot: {
    count: 3,
    season: 'Midnight Season 2',
    last: {
      date: 'Aug 27, 2026',
      items: [
        { name: 'Caustic Chain-Wrapped Sash', difficulty: 'Mythic' },
        { name: 'Coiled Hex Legguards', difficulty: 'Heroic' }
      ]
    },
    // Compared without order: the new page lists newest first.
    all: [
      { name: 'Caustic Chain-Wrapped Sash', difficulty: 'Mythic', date: 'Aug 27, 2026' },
      { name: 'Coiled Hex Legguards', difficulty: 'Heroic', date: 'Aug 27, 2026' },
      { name: 'Venomforged Effigy', difficulty: 'Heroic', date: 'Aug 20, 2026' }
    ]
  },
  // In gear-panel order, whatever order the sync wrote them.
  gear: [
    { slot: 'Head', item: 'Venomforged Effigy', itemLevel: 321, track: 'Myth' },
    { slot: 'Neck', item: 'Item #999999', itemLevel: 300, track: null },
    { slot: 'Trinket 1', item: 'Soulcoiler Ritual Vessel', itemLevel: 318, track: 'Hero' }
  ],
  mplus: { status: 'Excluded', note: 'Raid nights only' }
};

// What an officer sees of Dodgey's M+ exclusion. A raider cannot read
// mplus_exclusion_requests at all (officers-only select), so Dodgey
// never sees it: recorded as the current behavior, not a rule to keep.
export const EXPECTED_DODGEY_MPLUS_FOR_OFFICER = { status: 'Rejected', note: 'Sockets missing' };

// Items compared without order: two items awarded the same day have no order
// either site promises, and the new page lists newest first.
export function sortedLoot(loot) {
  const key = (i) => `${i.name}|${i.difficulty}|${i.date ?? ''}`;
  const sort = (items) => [...items].sort((a, b) => key(a).localeCompare(key(b)));
  return { ...loot, last: loot.last && { ...loot.last, items: sort(loot.last.items) }, all: sort(loot.all) };
}
