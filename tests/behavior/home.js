// How the team Home page behaves, written once and checked against both sites
// (#1102 step 1). tests/browser/home-recorded.test.js runs it against the
// current site's landing view, where it was recorded; tests/browser-app/
// home.test.js runs the same checks against the new app's Home page.
//
// This file covers the two blocks built first: the stats row and the recent
// loot feed. Raid progression and the live stream widget are the second half
// of the Team home box on #1102 and get their own entries here when they land.
//
// Each suite answers the page's reads from SCENARIO and turns what the page
// rendered into the plain shapes below with its own reader, so the checks
// never depend on either site's markup:
//
//   stats: [{ label, value }]
//   loot:  [{ player, item, difficulty, date, offSpec }]

import { SCENARIO as ROSTER } from './roster.js';

// The fixture team's seasons. The loot table stores the code; the team's
// settings name the season the way a reader sees it.
export const SEASON = { name: 'Midnight Season 3', code: 'MID3' };
const LAST_SEASON = 'MID2';

const award = (id, nameRealm, nickname, item, track, awardedAt, response) => ({
  id,
  track,
  season: SEASON.code,
  awarded_at: awardedAt,
  response: response ?? 'Mainspec/Need',
  items: { name: item },
  players: { name_realm: nameRealm, nickname }
});

// Twelve awards this season, newest last in this list. Eleven main-spec ones
// plus an off-spec roll, which the feed shows (tagged) and the stat leaves out.
const THIS_SEASON = [
  award(1, 'Aurelith-Illidan', 'Aur', 'Ashwarden Greatshield', 'Myth', '2026-04-02T23:30:00+00:00'),
  award(2, 'Brightmoor-Illidan', '', 'Choirmaster’s Silent Bell', 'Hero', '2026-04-03T23:30:00+00:00'),
  award(3, 'Cinderfall-Illidan', 'Zed', 'Tidebound Vestments', 'Myth', '2026-04-09T23:30:00+00:00'),
  award(4, 'Dawnthistle-Illidan', '', 'Hollow Choir Signet', 'Champion', '2026-04-10T23:30:00+00:00'),
  award(5, 'Emberlyn-Illidan', 'Em', 'Ashen Choir Mantle', 'Hero', '2026-04-16T23:30:00+00:00'),
  award(6, 'Frostvale-Illidan', null, 'Cinderbound Greaves', 'Myth', '2026-04-17T23:30:00+00:00'),
  award(7, 'Aurelith-Illidan', 'Aur', 'Emberlight Band', 'Hero', '2026-04-23T23:30:00+00:00'),
  award(8, 'Brightmoor-Illidan', '', 'Choirbound Censer', 'Myth', '2026-04-24T23:30:00+00:00'),
  // An off-spec roll: in the feed with its tag, out of the stat. "OS" is the
  // response both sites match on -- "Offspec/Greed" does not match either
  // site's rule, which is its own open question (#1102 is not the place).
  award(9, 'Cinderfall-Illidan', 'Zed', 'Ashwarden Bulwark', 'Hero', '2026-04-30T23:30:00+00:00', 'OS'),
  award(10, 'Dawnthistle-Illidan', '', 'Gloomsong Drape', 'Myth', '2026-05-01T23:30:00+00:00'),
  award(11, 'Emberlyn-Illidan', 'Em', 'Silent Bell Clapper', 'Hero', '2026-05-07T23:30:00+00:00'),
  // Awarded at 10:10pm Eastern, which is the next day in UTC. Both sites show
  // the raid night's own date, not the reader's.
  award(12, 'Frostvale-Illidan', null, 'Warden’s Ashen Cord', 'Myth', '2026-05-09T02:10:00+00:00')
];

// Last season's award. Neither block counts or shows it.
const LAST_SEASON_AWARD = {
  ...award(13, 'Aurelith-Illidan', 'Aur', 'Old Tier Chestguard', 'Myth', '2026-01-08T23:30:00+00:00'),
  season: LAST_SEASON
};

export const SCENARIO = {
  season: SEASON,
  // Six raiders with a class and spec, plus one without: a row with no role is
  // not a roster entry, so "Raiders" counts six.
  players: ROSTER.players,
  loot: [...THIS_SEASON, LAST_SEASON_AWARD]
};

// The two numbers the stats row shows. The new page renames the second one:
// "tier" now means class tier-set gear, and raid content is a "season", so the
// label follows the words the rest of the app uses. An intentional difference,
// recorded here rather than left for someone to notice (#1102 step 3).
export const STATS = { raiders: 6, items: 11 };
export const CURRENT_STAT_LABELS = ['Raiders', 'Items This Tier'];
export const NEW_STAT_LABELS = ['Raiders', 'Items this season'];

export const expectedStats = (labels) => [
  { label: labels[0], value: STATS.raiders },
  { label: labels[1], value: STATS.items }
];

const row = (player, item, difficulty, date, offSpec = false) => ({ player, item, difficulty, date, offSpec });

// Newest first, ten of them before anyone searches. A nickname is the name
// shown when the raider has one; otherwise it is their character's first name.
export const EXPECTED_FEED = [
  row('Frostvale', 'Warden’s Ashen Cord', 'Mythic', 'May 8, 2026'),
  row('Em', 'Silent Bell Clapper', 'Heroic', 'May 7, 2026'),
  row('Dawnthistle', 'Gloomsong Drape', 'Mythic', 'May 1, 2026'),
  row('Zed', 'Ashwarden Bulwark', 'Heroic', 'Apr 30, 2026', true),
  row('Brightmoor', 'Choirbound Censer', 'Mythic', 'Apr 24, 2026'),
  row('Aur', 'Emberlight Band', 'Heroic', 'Apr 23, 2026'),
  row('Frostvale', 'Cinderbound Greaves', 'Mythic', 'Apr 17, 2026'),
  row('Em', 'Ashen Choir Mantle', 'Heroic', 'Apr 16, 2026'),
  row('Dawnthistle', 'Hollow Choir Signet', 'Normal', 'Apr 10, 2026'),
  row('Zed', 'Tidebound Vestments', 'Mythic', 'Apr 9, 2026')
];

// Searching by item name matches anywhere in the name, ignoring case, and is
// not capped at ten: "choir" reaches past the preview into the older awards.
export const SEARCH = { query: 'choir', matches: 4 };
export const EXPECTED_SEARCH = [
  row('Brightmoor', 'Choirbound Censer', 'Mythic', 'Apr 24, 2026'),
  row('Em', 'Ashen Choir Mantle', 'Heroic', 'Apr 16, 2026'),
  row('Dawnthistle', 'Hollow Choir Signet', 'Normal', 'Apr 10, 2026'),
  row('Brightmoor', 'Choirmaster’s Silent Bell', 'Heroic', 'Apr 3, 2026')
];

// A search nothing matches says so rather than showing an empty list.
export const NO_MATCH = { query: 'zzzz', message: 'No matching items.' };
