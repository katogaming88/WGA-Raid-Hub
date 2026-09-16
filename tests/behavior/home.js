// How the team Home page behaves, written once and checked against both sites
// (#1102 step 1). tests/browser/home-recorded.test.js runs it against the
// current site's landing view, where it was recorded; tests/browser-app/
// home.test.js runs the same checks against the new app's Home page.
//
// Five blocks: the stats row and the recent loot feed (built first), then raid
// progression, the calendar widget and the live stream widget.
//
// Each suite answers the page's reads from SCENARIO (and PROGRESSION,
// CALENDAR and STREAMS further down) and turns what the page rendered into
// the plain shapes described next to each block with its own reader, so the
// checks never depend on either site's markup:
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

// ---------------------------------------------------------------------------
// Raid progression.
//
// Officers list the season's raids and bosses in Season Settings
// (team_settings.config.raidProgression); the WCL sync keeps kills, pulls and
// best pulls per boss in team_raid_progress. A boss is matched to its synced
// row by WCL encounter id when Season Settings has one, otherwise by name.
//
//   [{ name,
//      score: { heroic: killed|null, mythic: killed|null, total },
//      bar: { pct, difficulty: 'heroic'|'mythic' } | null,
//      bosses: [{ number, name,
//                 mythic: { date, pulls, best, link } | null,
//                 heroic: { date, pulls, best, link } | null }],
//      aotc: date|null }]
//
// Dates are the stored YYYY-MM-DD here; each suite's reader turns what its
// page shows back into that. `pulls` is the pull count, `best` the best
// pull's percentage (only while the boss is still up), `link` the Warcraft
// Logs report address or null.

const ZONE = 42;

const progress = (encounter, fields) => ({
  mythic_date: null,
  mythic_pulls: null,
  mythic_best_pct: null,
  mythic_report_code: null,
  mythic_fight_id: null,
  heroic_date: null,
  heroic_pulls: null,
  heroic_best_pct: null,
  heroic_report_code: null,
  heroic_fight_id: null,
  ...fields,
  raid_encounters: {
    name: encounter.name,
    wcl_encounter_id: encounter.id,
    raid_zones: { wcl_zone_id: encounter.zone ?? ZONE }
  }
});

export const PROGRESSION = {
  raids: [
    // Heroic is cleared (the sync saw the last boss die), so the card is
    // Mythic-only and shows AOTC from the sync, not the empty typed date.
    {
      name: 'Halls of the Fallen Choir',
      aotcDate: '',
      isMiniRaid: false,
      wclZoneId: ZONE,
      bosses: [
        // A Mythic kill typed by an officer, with no synced Mythic date.
        { name: 'Warden of Ash', mythicDate: '2026-04-02', wclEncounterId: 3001 },
        // Renamed in Season Settings: still found by its encounter id.
        { name: 'The Choir, Hollowed', mythicDate: '', wclEncounterId: 3002 },
        // No encounter id: found by name, ignoring case.
        { name: 'grimwrack the tidebound', mythicDate: '' },
        { name: 'Aetherius Prime', mythicDate: '', wclEncounterId: 3004 }
      ]
    },
    // Still on Heroic, with one boss already down on Mythic: both scores show.
    {
      name: 'Sundered Spire',
      aotcDate: '',
      isMiniRaid: false,
      wclZoneId: 43,
      bosses: [
        { name: 'Vesh the Stormcaller', mythicDate: '', wclEncounterId: 4001 },
        { name: 'The Riven Herald', mythicDate: '', wclEncounterId: 4002 },
        { name: 'Sablewing', mythicDate: '', wclEncounterId: 4003 }
      ]
    },
    // A mini-raid never has AOTC, so it is Mythic-only from the start.
    {
      name: 'Echo of Sablewing',
      aotcDate: '',
      isMiniRaid: true,
      wclZoneId: 44,
      bosses: [{ name: 'Sablewing Reborn', mythicDate: '', wclEncounterId: 5001 }]
    },
    // No bosses listed yet: a 0/0 score and no bar.
    { name: 'Unnamed Vault', aotcDate: '', isMiniRaid: false, bosses: [] }
  ],
  rows: [
    progress(
      { name: 'Warden of Ash', id: 3001 },
      {
        mythic_pulls: 12,
        heroic_date: '2026-03-18',
        heroic_pulls: 6,
        heroic_report_code: 'aBcD1234',
        heroic_fight_id: 11
      }
    ),
    progress(
      { name: 'The Hollow Choir', id: 3002 },
      {
        mythic_date: '2026-04-16',
        mythic_pulls: 1,
        mythic_report_code: 'eFgH5678',
        heroic_date: '2026-03-18',
        heroic_pulls: 3
      }
    ),
    progress(
      { name: 'Grimwrack the Tidebound', id: 9999 },
      {
        mythic_pulls: 34,
        mythic_best_pct: 12.4,
        mythic_report_code: 'aBcD1234',
        mythic_fight_id: 22,
        heroic_date: '2026-03-25',
        heroic_pulls: 9
      }
    ),
    // No Mythic pulls yet: the Mythic line says nothing rather than "0 pulls".
    progress({ name: 'Aetherius Prime', id: 3004 }, { mythic_pulls: 0, heroic_date: '2026-04-01', heroic_pulls: 1 }),
    progress(
      { name: 'Vesh the Stormcaller', id: 4001, zone: 43 },
      { mythic_date: '2026-05-06', mythic_pulls: 20, heroic_date: '2026-04-29', heroic_pulls: 4 }
    ),
    progress({ name: 'The Riven Herald', id: 4002, zone: 43 }, { heroic_pulls: 17, heroic_best_pct: 3.2 }),
    // The same encounter id as a boss above, in another raid: not a match.
    progress({ name: 'Other Zone Twin', id: 3004, zone: 99 }, { mythic_date: '2026-01-01', mythic_pulls: 1 })
  ]
};

const report = (code, fight) =>
  code ? `https://www.warcraftlogs.com/reports/${code}${fight ? `#fight=${fight}` : ''}` : null;
const line = (date, pulls, best = null, link = null) => ({ date, pulls, best, link });

export const EXPECTED_PROGRESSION = [
  {
    name: 'Halls of the Fallen Choir',
    score: { heroic: null, mythic: 2, total: 4 },
    bar: { pct: 50, difficulty: 'mythic' },
    bosses: [
      {
        number: 1,
        name: 'Warden of Ash',
        mythic: line('2026-04-02', 12),
        heroic: line('2026-03-18', 6, null, report('aBcD1234', 11))
      },
      {
        number: 2,
        name: 'The Choir, Hollowed',
        mythic: line('2026-04-16', 1, null, report('eFgH5678')),
        heroic: line('2026-03-18', 3)
      },
      {
        number: 3,
        name: 'grimwrack the tidebound',
        mythic: line(null, 34, 12.4, report('aBcD1234', 22)),
        heroic: line('2026-03-25', 9)
      },
      { number: 4, name: 'Aetherius Prime', mythic: null, heroic: line('2026-04-01', 1) }
    ],
    aotc: '2026-04-01'
  },
  {
    name: 'Sundered Spire',
    score: { heroic: 1, mythic: 1, total: 3 },
    bar: { pct: 33, difficulty: 'heroic' },
    bosses: [
      { number: 1, name: 'Vesh the Stormcaller', mythic: line('2026-05-06', 20), heroic: line('2026-04-29', 4) },
      { number: 2, name: 'The Riven Herald', mythic: null, heroic: line(null, 17, 3.2) },
      { number: 3, name: 'Sablewing', mythic: null, heroic: null }
    ],
    aotc: null
  },
  {
    name: 'Echo of Sablewing',
    score: { heroic: null, mythic: 0, total: 1 },
    bar: { pct: 0, difficulty: 'mythic' },
    bosses: [{ number: 1, name: 'Sablewing Reborn', mythic: null, heroic: null }],
    aotc: null
  },
  {
    name: 'Unnamed Vault',
    score: { heroic: 0, mythic: null, total: 0 },
    bar: null,
    bosses: [],
    aotc: null
  }
];

// ---------------------------------------------------------------------------
// The calendar widget: this month's raid nights, each a link to that day.
//
// The recurring schedule (raid_schedule) plus this month's one-off changes
// (raid_schedule_exceptions). Both sites take "today" from the reader's
// clock, so the suites fix it to TODAY.
//
//   { month, today, days: [{ date, status, count }], legend: [text] }
//
// `days` lists raid days only, in order; `date` is the day its link opens.
// `status` is the word on the day's marker, `count` is "attending/roster" or
// null. Signed out, a normal night is Present with the count and an optional
// night is No Response without one. Bench raiders are left out of the
// attending number, and the legend says how many.

export const TODAY = '2026-05-13T16:00:00Z';

export const CALENDAR = {
  schedule: [
    { weekday: 2, start_time: '20:00:00', duration_minutes: 180, active: true, is_optional: false },
    { weekday: 4, start_time: '20:00:00', duration_minutes: 180, active: true, is_optional: false },
    { weekday: 0, start_time: '19:00:00', duration_minutes: 120, active: true, is_optional: true }
  ],
  // A cancelled Tuesday, and an extra Saturday night.
  exceptions: [
    {
      raid_date: '2026-05-19',
      exception_type: 'cancelled',
      start_time: null,
      duration_minutes: null,
      is_optional: false,
      note: ''
    },
    {
      raid_date: '2026-05-23',
      exception_type: 'added',
      start_time: '20:00:00',
      duration_minutes: 180,
      is_optional: false,
      note: 'Catch-up night'
    }
  ]
};

const night = (date, optional = false) => ({
  date,
  status: optional ? 'No Response' : 'Present',
  count: optional ? null : '5/6'
});

export const EXPECTED_CALENDAR = {
  month: 'May 2026',
  today: 13,
  days: [
    night('2026-05-03', true),
    night('2026-05-05'),
    night('2026-05-07'),
    night('2026-05-10', true),
    night('2026-05-12'),
    night('2026-05-14'),
    night('2026-05-17', true),
    night('2026-05-21'),
    night('2026-05-23'),
    night('2026-05-24', true),
    night('2026-05-26'),
    night('2026-05-28'),
    night('2026-05-31', true)
  ],
  legend: ['No Response', 'Present', '1 on Bench (excluded from the count above)']
};

// ---------------------------------------------------------------------------
// The live stream widget: a floating panel of whoever is live.
//
// Streams are guild-wide: this team's streamers, then other teams' who have
// not opted out of being shown elsewhere. Only the live ones are in the panel.
//
//   { live: [{ name, channel, note }], empty: message|null }

const streamer = (id, teamId, channel, nameRealm, nickname, fields = {}) => ({
  id,
  team_id: teamId,
  player_id: id,
  twitch_channel: channel,
  schedule_note: '',
  guild_wide_opt_out: false,
  is_live: false,
  players: { name_realm: nameRealm, nickname },
  ...fields
});

export const STREAMS = [
  streamer(1, 1, 'aurelithplays', 'Aurelith-Illidan', 'Aur', { is_live: true, schedule_note: 'Tue and Thu, 8pm ET' }),
  streamer(2, 1, 'cinderfallvods', 'Cinderfall-Illidan', 'Zed', { schedule_note: 'Weekend mornings' }),
  // Another team's: one shown, one who opted out of other teams' pages, one offline.
  streamer(3, 2, 'kestrelcasts', 'Kestrel-Illidan', null, { is_live: true }),
  streamer(4, 2, 'quietone', 'Quietone-Illidan', '', { is_live: true, guild_wide_opt_out: true }),
  streamer(5, 2, 'sleepyhealer', 'Sleepy-Illidan', '')
];

export const EXPECTED_STREAMS = {
  live: [
    { name: 'Aur', channel: 'aurelithplays', note: 'Tue and Thu, 8pm ET' },
    { name: 'Kestrel', channel: 'kestrelcasts', note: '' }
  ],
  empty: null
};

// Who is live, in words: today's top banner, and the new widget's button.
export const LIVE_TEXT = 'Aur and Kestrel are live!';

export const NOBODY_LIVE = { live: [], empty: 'No one is live right now.' };
