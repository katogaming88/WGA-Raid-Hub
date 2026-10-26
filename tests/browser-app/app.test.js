import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { GUIDES } from '../../app/src/help/guide.ts';
import { DIST, launchBrowser, openApp, startApp, storedSession, NARROW, PEOPLE } from './harness.js';
import { GUILD_TABLES, GUILD_TEAMS, WAITING } from './guild-fixtures.js';
import { OFFICER_BIOS } from '../behavior/guild.js';
import { ENTRIES as NEWS_ENTRIES } from '../behavior/news.js';
import { SCENARIO, SIGNUP_SEASON_APP_ROW } from '../behavior/roster.js';
import {
  ATTENDANCE,
  GEAR,
  LOOT,
  MPLUS_REJECTIONS,
  PRIORITY_ITEMS,
  PRIORITY_ORDER,
  RAID_ZONES,
  SEASON,
  SELF_RECEIVED,
  TIER_TOKEN_MAP,
  VIEWERS,
  WISHLIST
} from '../behavior/profile.js';
import * as WISHLIST_EDITOR from '../behavior/wishlist.js';
import {
  PLAYERS as CAL_PLAYERS,
  SCHEDULE as CAL_SCHEDULE,
  RSVPS as CAL_RSVPS,
  NIGHT as CAL_NIGHT,
  TODAY as CAL_TODAY
} from '../behavior/calendar.js';
import { SCENARIO as HOME, SEASON as HOME_SEASON, PROGRESSION, CALENDAR, STREAMS, TODAY } from '../behavior/home.js';
import { TEAMS as STREAM_TEAMS, STREAMS as DIRECTORY, NOBODY_LIVE as DIRECTORY_OFFLINE } from '../behavior/streams.js';

// The new app in a real browser (#1101 part 4): the shell's accessibility
// checklist, measured rather than trusted. Unlike tests/browser/, there is no
// baseline. The app starts clean and a violation is a failure, full stop.

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

// The Roster page's reads: the recorded scenario plus synced gear, so item
// level, tier pips and tags are all on the page axe measures.
const GEAR_SLOTS = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST', 'HANDS', 'WAIST'];
const ROSTER = {
  players: SCENARIO.players.map((p, i) => ({ ...p, tier_pieces_equipped: i % 6 })),
  player_equipped_gear: SCENARIO.players.flatMap((p) =>
    GEAR_SLOTS.map((equipment_slot) => ({ player_id: p.id, equipment_slot, item_level: 318 + p.id }))
  ),
  incoming_roster: SCENARIO.incoming,
  team_seasons: [SIGNUP_SEASON_APP_ROW]
};

// A profile's reads (tests/behavior/profile.js), seen by a viewer.
function profileState(label, viewerKey, profileKey, extra = {}) {
  const viewer = VIEWERS[viewerKey];
  const shown = VIEWERS[profileKey].player;
  return {
    label,
    path: viewerKey === profileKey ? '/g/wga/t/phoenix/me' : `/g/wga/t/phoenix/p/${shown.url_code}`,
    sentinel: 'main .profile-name',
    session: storedSession({ battlenet: `${viewer.player.name_realm}#1`, discord: viewer.player.name_realm }),
    person: {
      discordId: viewer.discordId,
      person: {
        site_admin: false,
        guild_officer: false,
        boe_manager: false,
        teams: [
          {
            team_id: 1,
            team_member_id: viewer.teamMember,
            role: viewer.role,
            characters: [
              {
                player_id: viewer.player.id,
                name_realm: viewer.player.name_realm,
                url_code: viewer.player.url_code,
                archived_at: null
              }
            ]
          }
        ]
      }
    },
    tables: {
      players: [shown],
      seasons: [
        { code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null }
      ],
      team_settings: [{}],
      attendance: ATTENDANCE.filter((r) => r.player_id === shown.id),
      rclc_loot: LOOT.filter((r) => r.player_id === shown.id),
      player_equipped_gear: GEAR.filter((r) => r.player_id === shown.id),
      items: PRIORITY_ITEMS,
      raid_zones: RAID_ZONES,
      item_preferences: WISHLIST.filter((r) => r.player_id === shown.id),
      priority_order: PRIORITY_ORDER.filter((r) => r.season === SEASON.code),
      tier_token_map: TIER_TOKEN_MAP.filter((r) => r.class === shown.classes_specs.class),
      self_received_requests: SELF_RECEIVED.filter((r) => r.player_id === shown.id),
      mplus_exclusion_requests:
        viewer.role === 'officer' ? MPLUS_REJECTIONS.filter((r) => r.player_id === shown.id) : []
    },
    ...extra
  };
}

// The wishlist editor's reads (tests/behavior/wishlist.js), with one slot
// chosen so its items and marks are on the page axe measures.
const wishlistEditorState = (label, extra = {}) =>
  profileState(label, 'torbjorn', 'torbjorn', {
    path: '/g/wga/t/phoenix/me/wishlist',
    sentinel: 'main .wishlist-slot-tab',
    click: 'main .wishlist-slot-tab[data-slot="Finger 2"]',
    ...extra,
    tables: {
      ...profileState('', 'torbjorn', 'torbjorn').tables,
      seasons: [
        { code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null }
      ],
      team_settings: [{ open: 'true', view: null }],
      items: WISHLIST_EDITOR.ITEMS,
      raid_zones: WISHLIST_EDITOR.RAID_ZONES,
      item_preferences: WISHLIST_EDITOR.WISHLIST,
      tier_token_map: WISHLIST_EDITOR.TIER_TOKEN_MAP,
      ...extra.tables
    }
  });

const TWO_SEASONS_OPEN = {
  sentinel: 'main select#wishlist-season',
  tables: {
    seasons: [
      { code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null },
      {
        code: WISHLIST_EDITOR.NEXT_SEASON.code,
        display_name: WISHLIST_EDITOR.NEXT_SEASON.name,
        starts_at: WISHLIST_EDITOR.NEXT_SEASON.start,
        ends_at: WISHLIST_EDITOR.NEXT_SEASON.end
      }
    ],
    team_seasons: [SEASON.code, WISHLIST_EDITOR.NEXT_SEASON.code].map((code) => ({
      season_code: code,
      wishlist_open: true
    }))
  }
};

const OFFICER = storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Officer' });

const SETTINGS_OPEN = {
  path: '/g/wga/t/phoenix/roster',
  sentinel: 'table.roster-table',
  session: OFFICER,
  who: 'officer',
  tables: ROSTER,
  click: 'role=button[name=/^Player settings for/] >> nth=0',
  afterClick: '.settings-panel [role="switch"]'
};

// Alts (#942 step 5b): saved characters, the memberships they hang off, and
// what the battlenet-characters function answers the picker with.
const ALT_CHARACTERS = [
  {
    id: 1,
    person_id: 70,
    name: 'Grihzy',
    realm: 'Illidan',
    class_name: 'Evoker',
    spec_name: 'Preservation',
    item_level: 701
  },
  {
    id: 2,
    person_id: 70,
    name: 'Grihzbear',
    realm: 'Area 52',
    class_name: 'Druid',
    spec_name: 'Guardian',
    item_level: 689
  }
];

const rosterWithAlts = () => {
  const first = SCENARIO.players[0];
  return {
    ...ROSTER,
    players: ROSTER.players.map((p) => ({ ...p, team_member_id: p.id })),
    team_members: ROSTER.players.map((p) => ({ id: p.id, person_id: p.id === first.id ? 70 : 100 + p.id })),
    characters: ALT_CHARACTERS,
    seasons: [{ code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null }],
    team_settings: [{}],
    attendance: [],
    rclc_loot: []
  };
};

// Names (#1355): one claimed on a character, a bare one with a role guess, a
// bare one with none, and a claimed one whose member has no character yet.
// Every membership states archived_at, since a row that leaves it out reads as
// current.
const rosterWithNames = () => ({
  ...ROSTER,
  players: ROSTER.players.map((p) => ({ ...p, team_member_id: p.id })),
  team_members: [
    ...ROSTER.players.map((p) => ({ id: p.id, person_id: 100 + p.id, archived_at: null })),
    { id: 40, person_id: 140, archived_at: null }
  ],
  names: [
    { id: 1, label: 'Bryn', team_member_id: 2, role: null },
    { id: 2, label: 'Thalindra', team_member_id: null, role: 'Heal' },
    { id: 3, label: 'Corvin', team_member_id: null, role: null },
    { id: 4, label: 'Mirelle', team_member_id: 40, role: null }
  ]
});

// A main swap waiting for an officer (#631), and the specs the ask offers.
const SPECS = [
  { id: 1, class: 'Evoker', spec: 'Preservation', role: 'Heal' },
  { id: 2, class: 'Evoker', spec: 'Devastation', role: 'Ranged' },
  { id: 3, class: 'Druid', spec: 'Guardian', role: 'Tank' }
];

const waitingSwap = (fromNameRealm) => [
  {
    id: 1,
    team_id: 1,
    person_id: 70,
    from_player_id: 1,
    character_id: 1,
    name_realm: 'Grihzy-Illidan',
    class_spec_id: 1,
    note: 'Geared it over the break and it is ahead of my Death Knight.',
    status: 'pending',
    requested_at: '2026-09-14T18:00:00Z',
    officer_note: null,
    from_player: { name_realm: fromNameRealm },
    classes_specs: { class: 'Evoker', spec: 'Preservation', role: 'Heal' }
  }
];

// The Needs a look box (#1360): a trial past the thresholds, a main swap
// waiting, and a raider who joined nine days ago with no wishlist.
const needsALook = () => {
  const base = rosterWithAlts();
  const joined = { 4: '2026-08-10', 6: '2026-10-01' };
  return {
    ...base,
    players: base.players.map((p) => ({ ...p, join_date: joined[p.id] ?? '2026-01-05' })),
    seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-01', ends_at: null }],
    attendance: [{ player_id: 4, raid_date: '2026-08-12', status: 'Present', report_excluded: false }],
    item_preferences: [],
    main_swap_requests: waitingSwap(SCENARIO.players[0].name_realm)
  };
};

// The accounts line and quick Claim (#1360 part 4): every member but one has
// Battle.net, every other one Discord, and two bare Names offer Claim.
const ACCOUNTS = {
  path: '/g/wga/t/phoenix/roster',
  sentinel: 'table.roster-table .accounts-line',
  session: OFFICER,
  who: 'officer',
  tables: {
    ...rosterWithNames(),
    team_members: rosterWithNames().team_members.map((m, i) => ({
      ...m,
      discord_id: i % 2 ? null : `10000000${m.id}`
    }))
  },
  rpc: {
    team_battlenet_connections: rosterWithNames()
      .team_members.slice(1)
      .map((m) => ({ team_member_id: m.id }))
  }
};

// The Archived tab (#1360 part 3): one character archived with a reason and
// the officer's words, one with no reason on record.
const ARCHIVED_TAB = {
  path: '/g/wga/t/phoenix/roster',
  sentinel: 'table.roster-table',
  session: OFFICER,
  who: 'officer',
  tables: {
    ...rosterWithAlts(),
    players: [
      ...rosterWithAlts().players,
      {
        ...SCENARIO.players[0],
        id: 90,
        name_realm: 'Oldmain-Illidan',
        nickname: 'Oldie',
        archived_at: '2026-09-20T23:30:00Z',
        player_officer_notes: { archived_reason: 'schedule_conflict', archived_reason_detail: 'New job, works nights' }
      },
      { ...SCENARIO.players[1], id: 91, name_realm: 'Quietone-Illidan', archived_at: '2026-08-02T01:00:00Z' }
    ]
  },
  click: 'role=tab[name="Archived (2)"]',
  afterClick: 'table.archived-table'
};

// The same swap, declined (#1430): the alt says so, with the officer's note.
const declinedSwap = (fromNameRealm, officerNote = 'We need your Death Knight for battle res this tier.') => [
  { ...waitingSwap(fromNameRealm)[0], status: 'declined', officer_note: officerNote }
];

const pickerCharacter = (blizzard_id, name, className, spec, item_level, roster = null) => ({
  blizzard_id,
  name,
  realm: 'Illidan',
  realm_slug: 'illidan',
  class_name: className,
  spec_name: spec,
  level: 90,
  item_level,
  saved: blizzard_id === 102,
  roster
});

const PICKER_ANSWER = {
  success: true,
  characters: [
    pickerCharacter(101, 'Torbjorn', 'Death Knight', 'Frost', 708, {
      player_id: VIEWERS.torbjorn.player.id,
      team_id: 1,
      name_realm: VIEWERS.torbjorn.player.name_realm,
      outcome: 'already_yours'
    }),
    pickerCharacter(102, 'Grihzy', 'Evoker', 'Preservation', 701),
    pickerCharacter(103, 'Grihzbear', 'Druid', 'Guardian', 689),
    pickerCharacter(104, 'Holygrihz', 'Paladin', 'Holy', 694, {
      player_id: 99,
      team_id: 2,
      name_realm: 'Holygrihz-Illidan',
      outcome: 'claimed_by_someone_else'
    })
  ],
  roster: []
};

// Back from Battle.net with a token, which is when the picker opens on its own.
const pickerState = (label, extra = {}) =>
  profileState(label, 'torbjorn', 'torbjorn', {
    sentinel: '.picker-table',
    session: storedSession({
      battlenet: `${VIEWERS.torbjorn.player.name_realm}#1`,
      discord: VIEWERS.torbjorn.player.name_realm,
      providerToken: 'battlenet-token'
    }),
    sessionStorage: { 'wga-auth-intent': 'choose-alts', 'wga-auth-provider': 'custom:battlenet' },
    functionAnswers: { 'battlenet-characters': PICKER_ANSWER },
    ...extra
  });
// BoE Sales (#1102): finds at every stage of the lifecycle, listings on the
// open ones, and the audiences the page renders differently for.
const boeItem = (id, status, extra = {}) => ({
  id,
  team_id: 1,
  finder_name: 'Torbjorn-Illidan',
  item_name: `Test BoE ${id}`,
  track: 'Hero',
  upgrade_rank: '2/6',
  note: null,
  status,
  found_at: '2026-09-01T18:00:00Z',
  sold_at: null,
  payout_paid_at: null,
  retired_at: null,
  sale_price: null,
  finder_payout: null,
  guild_cut: null,
  ah_fee: null,
  payout_donated: false,
  ...extra
});
const BOE_SOLD = {
  sold_at: '2026-09-05T20:00:00Z',
  sale_price: 250000,
  ah_fee: 12500,
  finder_payout: 118750,
  guild_cut: 118750
};
const BOE_TABLES = {
  boe_items: [
    boeItem(1, 'found'),
    boeItem(2, 'listed'),
    boeItem(3, 'sold', BOE_SOLD),
    boeItem(4, 'sold', { ...BOE_SOLD, payout_donated: true }),
    boeItem(5, 'paid', { ...BOE_SOLD, payout_paid_at: '2026-09-07T20:00:00Z' }),
    boeItem(6, 'retired', { retired_at: '2026-09-08T20:00:00Z' })
  ],
  boe_listings: [{ id: 1, boe_item_id: 2, listed_at: '2026-09-02T18:00:00Z', price: 300000, note: null }],
  items: [],
  raid_zones: [],
  team_settings: [{}]
};
const boeState = (label, role, boeManager, extra = {}) => ({
  label,
  path: '/g/wga/boe',
  sentinel: '.boe-lifecycle .boe-section-heading',
  session: OFFICER,
  person: {
    discordId: 'discord-boe-1',
    person: {
      site_admin: false,
      guild_officer: false,
      boe_manager: boeManager,
      teams: [
        {
          team_id: 1,
          team_member_id: 1,
          role,
          characters: [{ player_id: 1, name_realm: 'Torbjorn-Illidan', url_code: 'abcd1234', archived_at: null }]
        }
      ]
    }
  },
  tables: BOE_TABLES,
  ...extra
});
const BATTLENET_ONLY = storedSession({ battlenet: 'Aeglos#1234' });

// Every screen the shell has today, in both themes where color matters.
// Home's reads (tests/behavior/home.js): a roster, a season of loot, raids,
// a schedule and live streamers, so every block is on the page axe measures.
// The calendar reads today's date, so Home states fix the clock.
const HOME_TABLES = {
  players: HOME.players,
  rclc_loot: HOME.loot,
  seasons: [
    {
      code: HOME_SEASON.code,
      display_name: HOME_SEASON.name,
      starts_at: HOME_SEASON.start || '2026-01-01',
      ends_at: null
    }
  ],
  team_settings: [{ raids: PROGRESSION.raids }],
  team_raid_progress: PROGRESSION.rows,
  raid_schedule: CALENDAR.schedule,
  raid_schedule_exceptions: CALENDAR.exceptions,
  streamers: STREAMS
};
// Every block has landed, not just the first.
const HOME_SENTINEL =
  'main:has(.home-loot-table):has(.home-progression .raid):has(.home-calendar a):has(.stream-widget)';

// The Calendar (tests/behavior/calendar.js): a month with answers, and a
// night with someone out and someone late, seen by an officer.
const CAL_TABLES = {
  players: CAL_PLAYERS,
  raid_schedule: CAL_SCHEDULE,
  raid_schedule_exceptions: [],
  raid_rsvps: CAL_RSVPS
};
const CAL_OFFICER = { session: OFFICER, who: 'officer', clock: CAL_TODAY, tables: CAL_TABLES };
const CAL_MONTH = { ...CAL_OFFICER, path: '/g/wga/t/phoenix/calendar', sentinel: 'main:has(.night-chip[data-date])' };
const CAL_NIGHT_PAGE = {
  ...CAL_OFFICER,
  path: `/g/wga/t/phoenix/calendar?date=${CAL_NIGHT}`,
  sentinel: 'main:has(.heads-up-item)'
};

// The officer's raid schedule (#1361): the Edit schedule panel, which reads
// every column of the weekly nights; an empty day with the add form; and a
// cancelled night with its reason and the way back.
const CAL_SCHEDULE_TABLES = {
  ...CAL_TABLES,
  raid_schedule: CAL_SCHEDULE.map((r, i) => ({
    id: i + 1,
    team_id: 1,
    timezone: 'America/New_York',
    difficulty: i === 1 ? 'heroic' : null,
    ...r
  })),
  team_schedule_settings: [{ team_id: 1, default_difficulty: 'mythic' }],
  raid_schedule_exceptions: [
    {
      id: 1,
      team_id: 1,
      raid_date: '2026-05-19',
      exception_type: 'cancelled',
      start_time: null,
      duration_minutes: null,
      is_optional: false,
      note: 'Patch day',
      difficulty: null
    }
  ]
};
const CAL_EDITING = {
  ...CAL_MONTH,
  tables: CAL_SCHEDULE_TABLES,
  click: 'role=button[name="Edit schedule"]',
  afterClick: '.schedule-table'
};
const CAL_ADD_NIGHT = {
  ...CAL_OFFICER,
  tables: CAL_SCHEDULE_TABLES,
  path: '/g/wga/t/phoenix/calendar?date=2026-05-15',
  sentinel: 'main .add-night'
};
const CAL_CANCELLED = {
  ...CAL_OFFICER,
  tables: CAL_SCHEDULE_TABLES,
  path: '/g/wga/t/phoenix/calendar?date=2026-05-19',
  sentinel: 'main .officer-bar'
};

// The boss lineup (#1216): two raids, a planned night with a change from the
// group, a raider in who said they are out, and the bench, so every cell state
// and count tone is on the page.
const LINEUP_ZONE = { id: 10, name: 'The Venomous Abyss', season: 'S1', is_mini_raid: false, sort_index: 0 };
const LINEUP_MINI = { id: 11, name: 'Tidebound Grotto', season: 'S1', is_mini_raid: true, sort_index: 1 };
const lineupBoss = (encounter_id, position) => ({
  raid_date: CAL_NIGHT,
  encounter_id,
  position,
  skipped: false,
  confirmed_at: null
});
const placed = (encounter_id, ids) => ids.map((player_id) => ({ encounter_id, player_id }));
const CAL_LINEUP = {
  ...CAL_OFFICER,
  path: `/g/wga/t/phoenix/calendar?date=${CAL_NIGHT}&view=lineup`,
  sentinel: 'main:has(.lineup-toggle)',
  tables: {
    ...CAL_TABLES,
    seasons: [{ code: 'S1', display_name: 'Season One', starts_at: '2026-01-01', ends_at: null }],
    raid_encounters: [
      { id: 101, name: "Nek'zali the Soulcoiler", sort_index: 1, zone: LINEUP_ZONE },
      { id: 102, name: 'Sszorak', sort_index: 2, zone: LINEUP_ZONE },
      { id: 103, name: 'Nymrissa Wavecaller', sort_index: 1, zone: LINEUP_MINI }
    ],
    raid_night_bosses: [lineupBoss(101, 1), lineupBoss(102, 2), lineupBoss(103, 3)],
    raid_night_lineups: [...placed(101, [1, 2, 3, 4, 6]), ...placed(102, [2, 3, 4]), ...placed(103, [1, 2, 3, 4])],
    boss_groups: [...placed(101, [1, 2, 3, 4, 6]), ...placed(102, [1, 2, 3, 4]), ...placed(103, [1, 2, 3, 4])]
  }
};

// A raider's own bosses on the night page (#1216, boards C and D): the same
// planned night, on the Who's coming tab.
const CAL_OWN_BOSSES = {
  ...CAL_LINEUP,
  path: `/g/wga/t/phoenix/calendar?date=${CAL_NIGHT}`,
  sentinel: 'main:has(.your-boss)'
};

// The Boss groups page (#1216): the same raids and groups, with one cell
// changed and not saved yet in the clicked state.
const BOSS_GROUPS = {
  ...CAL_LINEUP,
  path: '/g/wga/t/phoenix/officer/groups',
  sentinel: 'main:has(.lineup-toggle)'
};

// A guild officer, for the Boss groups page's guild-wide "Edit cap" control
// (#1244): raid_encounters has no team of its own, so this is not a plain
// team officer ability.
const GUILD_OFFICER_PERSON = {
  discordId: 'discord-officer-1',
  person: {
    site_admin: false,
    guild_officer: true,
    boe_manager: false,
    teams: [{ team_id: 1, team_member_id: 1, role: 'officer', characters: [] }]
  }
};
const BOSS_GROUPS_GUILD_OFFICER = { ...BOSS_GROUPS, person: GUILD_OFFICER_PERSON };

// Attendance Manage (#1354, #1103 row 1): two raid nights, a WCL late flag
// with no status yet, so every grid state is on the page axe measures.
const ATTENDANCE_TABLES = {
  players: SCENARIO.players,
  seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-01-01', ends_at: null }],
  attendance: [
    {
      id: 1,
      player_id: 1,
      raid_date: '2026-05-07',
      status: 'Present',
      report_excluded: false,
      report_title: 'Raid - May 7',
      source: 'WCL'
    },
    {
      id: 2,
      player_id: 2,
      raid_date: '2026-05-07',
      status: 'Late (no notice)',
      report_excluded: false,
      report_title: 'Raid - May 7',
      source: 'Officer'
    },
    {
      id: 3,
      player_id: 3,
      raid_date: '2026-05-07',
      status: 'No Show',
      report_excluded: false,
      report_title: 'Raid - May 7',
      source: 'WCL'
    },
    {
      id: 4,
      player_id: 1,
      raid_date: '2026-05-14',
      status: 'Present',
      report_excluded: false,
      report_title: 'Raid - May 14',
      source: 'WCL'
    },
    {
      id: 5,
      player_id: 2,
      raid_date: '2026-05-14',
      status: null,
      report_excluded: false,
      report_title: 'Raid - May 14',
      source: 'WCL (Late?)'
    },
    {
      id: 6,
      player_id: 3,
      raid_date: '2026-05-14',
      status: 'Present',
      report_excluded: false,
      report_title: 'Raid - May 14',
      source: 'WCL'
    }
  ]
};
const ATTENDANCE_MANAGE = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/attendance',
  sentinel: 'main:has(.attend-grid-rows)',
  tables: ATTENDANCE_TABLES
};

// Loot fairness and Bench fairness (#1359): the roster's raiders with a
// season of loot and some benched nights, so every bar, rate and the average
// line are on the page axe measures.
const REPORT_TABLES = {
  ...ROSTER,
  seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-01', ends_at: null }],
  rclc_loot: SCENARIO.players.flatMap((p, i) =>
    Array.from({ length: i % 4 }, (_, k) => ({
      id: p.id * 10 + k,
      player_id: p.id,
      track: k % 2 ? 'Myth' : 'Hero',
      season: 'MID2',
      awarded_at: '2026-08-20T18:00:00Z',
      items: { name: 'X' }
    }))
  ),
  attendance: SCENARIO.players.flatMap((p, i) =>
    ['2026-08-05', '2026-08-07', '2026-08-12'].map((raid_date, k) => ({
      player_id: p.id,
      raid_date,
      status: k < i % 3 ? 'Bench' : 'Present',
      report_excluded: false
    }))
  ),
  names: [],
  // Raid nights since last item and Tier sets (#1359 part 2).
  rnlsi: SCENARIO.players.map((p, i) => ({
    player_id: p.id,
    last_award_at: i % 3 ? '2026-08-20T18:00:00Z' : null,
    raid_nights_since_last_item: (i * 3) % 10
  })),
  // BiS demand, Loot pace and Priority order health (#1359 part 3).
  bis_demand_vs_awards: [
    { item_id: 1, item_name: 'Void Cleaver', slot: 'Two-Hand', demand_count: 5, awarded_count: 0 },
    { item_id: 2, item_name: 'Ring of Ash', slot: 'Finger', demand_count: 3, awarded_count: 2 }
  ],
  season_loot_pace: [1, 2, 3].flatMap((week) => [
    { season: 'MID2', season_week: week, track: 'Hero', slot: 'Head', items_awarded: 4 + week },
    { season: 'MID2', season_week: week, track: 'Myth', slot: 'Hands', items_awarded: week }
  ]),
  priority_order_stale_entries: [
    { priority_order_id: 1, item_name: 'Ring of Ash', track: 'Myth', rank: 2, name_realm: 'Gone-Illidan' }
  ],
  priority_order_gaps: [{ player_id: SCENARIO.players[0].id, name_realm: SCENARIO.players[0].name_realm }],
  priority_order_stale_after_heroic: [],
  // Boss lineups (#1247): four nights over two bosses, the last without its log
  // yet, with a kill, a swap-in, a miss and a late arrival on the page.
  raid_encounters: [
    { id: 101, name: "Nek'zali the Soulcoiler", sort_index: 1, cap: null, zone: { ...LINEUP_ZONE, season: 'MID2' } },
    { id: 102, name: 'Sszorak', sort_index: 2, cap: null, zone: { ...LINEUP_ZONE, season: 'MID2' } }
  ],
  ...(() => {
    const ids = SCENARIO.players.map((p) => p.id);
    const dates = ['2026-08-05', '2026-08-07', '2026-08-12', '2026-08-14'];
    const seat = (raid_date, encounter_id, list) => list.map((player_id) => ({ raid_date, encounter_id, player_id }));
    const out = (i) => ids.filter((_, k) => k % dates.length !== i);
    return {
      raid_night_bosses: dates.flatMap((raid_date) =>
        [101, 102].map((encounter_id, k) => ({ raid_date, encounter_id, position: k + 1, skipped: false }))
      ),
      raid_night_lineups: dates.flatMap((d, i) => [...seat(d, 101, out(i)), ...seat(d, 102, out((i + 1) % 4))]),
      raid_night_participation: dates
        .slice(0, 3)
        .flatMap((d, i) => [...seat(d, 101, out(i).slice(1)), ...seat(d, 102, [...out((i + 1) % 4), ids[i]])]),
      team_raid_kills: [{ raid_date: '2026-08-07', encounter_id: 101 }]
    };
  })()
};
const REPORT = {
  session: OFFICER,
  who: 'officer',
  sentinel: 'main .fairness-row',
  tables: REPORT_TABLES
};
const TABLE_REPORT = {
  ...REPORT,
  sentinel: 'main table.report-table tbody tr',
  tables: {
    ...REPORT_TABLES,
    players: REPORT_TABLES.players.map((p, i) => ({
      ...p,
      tier_pieces_synced_at: i % 4 ? '2026-10-10T12:00:00Z' : null
    }))
  }
};

// Loot priority (#1362 part 1): two Back pieces and a ring saved with nobody
// on it, one opened, so the list, the ranked rows and their flags, and the
// gear status line are on the page axe measures.
const PRIORITY_IDS = REPORT_TABLES.players.map((p) => p.id);
const priorityItem = (id, name, slot) => ({
  id,
  name,
  slot,
  wcl_zone_id: 100,
  is_placeholder: false,
  source: 'raid',
  item_seasons: []
});
const PRIORITY = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/priority?item=1',
  sentinel: 'main .priority-rank-num',
  rpc: {
    build_rclc_export: { players: {}, priority: {} },
    generate_priority_order: PRIORITY_IDS.slice(0, 4)
      .reverse()
      .map((player_id, i) => ({ player_id, weighted_total: 8 - i / 2, status_label: i ? '' : 'Has Champion' }))
  },
  tables: {
    players: REPORT_TABLES.players,
    seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-07-18', ends_at: null }],
    team_settings: [{ team_id: 1, view: null, raidProgression: [] }],
    team_seasons: [],
    raid_zones: [{ wcl_zone_id: 100, season: 'MID2' }],
    items: [
      priorityItem(1, 'Silken Voodoo Drape', 'Back'),
      priorityItem(2, 'Drape of the Dreadful Rite', 'Back'),
      priorityItem(3, "Vile Alchemist's Band", 'Finger')
    ],
    priority_order: PRIORITY_IDS.slice(0, 5).map((player_id, i) => ({
      item_id: 1,
      track: 'Hero',
      rank: i + 1,
      player_id,
      players: { name_realm: 'x' }
    })),
    priority_order_confirmed_empty: [{ item_id: 3, track: 'Hero' }],
    item_preferences: [
      { player_id: PRIORITY_IDS[0], item_id: 1, status: 'bis' },
      { player_id: PRIORITY_IDS[1], item_id: 1, status: 'ok' }
    ],
    rclc_loot: [
      { player_id: PRIORITY_IDS[0], item_id: 1, track: 'Hero', response: 'BiS' },
      { player_id: PRIORITY_IDS[1], item_id: 2, track: 'Hero', response: 'BiS' }
    ],
    item_bosses: [{ item_id: 1, boss: 'The Coiled Altar' }],
    tier_token_map: [],
    self_received_requests: [],
    site_settings: [{ id: 1, gear_sync_last_cron_run: { finished_at: '2026-10-18T06:00:00Z', synced: 76, skipped: 1 } }]
  }
};

// Part 3: the first raider #1 on two items from one boss, so Needs a look and
// the row flag show; and six raiders marking item 1 BiS, so Contested lists it.
const PRIORITY_FLAGGED = {
  ...PRIORITY,
  tables: {
    ...PRIORITY.tables,
    item_bosses: [
      { item_id: 1, boss: 'The Coiled Altar' },
      { item_id: 2, boss: 'The Coiled Altar' }
    ],
    priority_order: [
      ...PRIORITY.tables.priority_order,
      { item_id: 2, track: 'Hero', rank: 1, player_id: PRIORITY_IDS[0], players: { name_realm: 'x' } }
    ],
    item_preferences: [
      ...PRIORITY_IDS.slice(0, 6).map((player_id, i) => ({
        id: i + 1,
        player_id,
        item_id: 1,
        status: 'bis',
        note: i === 0 ? 'Big upgrade for my Mythic+ set too' : null
      })),
      { id: 7, player_id: PRIORITY_IDS[6], item_id: 2, status: 'ok', note: 'BiS for my other spec' }
    ]
  }
};

// Part 5: saved scores for a few raiders, one with none, so the Scoring
// table's every kind of row is on the page axe measures.
const PRIORITY_SCORING = {
  ...PRIORITY,
  path: '/g/wga/t/phoenix/officer/priority?tab=scoring',
  sentinel: 'main .priority-scoring-table',
  tables: {
    ...PRIORITY.tables,
    scoring: PRIORITY_IDS.slice(0, 4).map((player_id, i) => ({
      player_id,
      recent_score: 8.6 - i * 1.5,
      trend_score: 8 - i,
      best_score: 9.4 - i,
      performance_score: 8.6 - i * 1.5
    }))
  }
};

// Officer Settings (#1357, #1103 row 1): General, Season, Raid progression and
// Danger zone, so every card state (a saved value, a closed tier's WCL
// Performance Baseline row, a raid/boss row, and the Archive season control)
// is on the page axe measures.
const SETTINGS_GENERAL_TABLES = {
  team_settings: [
    {
      team_id: 1,
      seasonView: null,
      trialWeeks: 6,
      trialAttend: 80,
      targetTankCount: 2,
      targetHealCount: 5,
      warcraftLogsUrl: 'https://www.warcraftlogs.com/guild/id/12345',
      discordSignupChannelId: '999',
      signupSheetLeadHours: 48
    }
  ],
  raid_zones: [{ season: 'MID1' }, { season: 'MID2' }]
};
const SETTINGS_GENERAL = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/settings',
  sentinel: 'main:has(.settings-cards)',
  tables: SETTINGS_GENERAL_TABLES
};

const SETTINGS_HISTORY = [
  {
    code: 'MID1',
    name: 'Midnight Season 1',
    start: '2026-01-01',
    end: '2026-03-31',
    raids: [{ name: 'Old Raid', wclZoneId: 40, isMiniRaid: false, bosses: [{ name: 'A', mythicDate: '2026-03-01' }] }],
    roster: [
      {
        nameRealm: 'Aurelith-Illidan',
        role: 'Tank',
        isTrial: false,
        isBench: false,
        joinDate: '2025-01-01',
        attendance: '90.0%'
      }
    ]
  }
];
const SETTINGS_SEASON = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/settings/season',
  sentinel: 'main:has(.settings-history-list)',
  tables: { team_settings: [{ team_id: 1, history: SETTINGS_HISTORY }], player_wcl_season_perf: [] }
};

const SETTINGS_PROGRESSION = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/settings/progression',
  sentinel: 'main:has(.settings-raid-list)',
  tables: {
    team_settings: [
      {
        team_id: 1,
        raidProgression: [
          {
            name: 'Test Raid',
            isMiniRaid: false,
            aotcDate: '2026-05-01',
            bosses: [{ name: 'First Boss', mythicDate: '2026-04-20' }]
          }
        ]
      }
    ]
  }
};

// Settings > Loot (#1560): an officer sees it read-only; the team leader
// gets working choices and Save.
const SETTINGS_LOOT = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/settings/loot',
  sentinel: 'main:has(.loot-systems)',
  tables: {
    team_settings: [
      {
        team_id: 1,
        lootSystem: 'priority',
        // What gets counted as loot received (#1561): a saved list with a
        // button group, and one used response it leaves out.
        lootResponses: {
          buttons: [
            { text: 'Upgrade', countsAs: 'main' },
            { text: 'OS/M+', countsAs: 'off' },
            { text: 'Xmog', countsAs: 'hidden' }
          ],
          groups: [
            {
              name: 'Armor Token',
              buttons: [
                { text: '2/4 Set', countsAs: 'main' },
                { text: 'OS', countsAs: 'off' }
              ]
            }
          ]
        }
      }
    ],
    rclc_loot: [
      'Upgrade',
      'Upgrade',
      'OS/M+',
      '2/4 Set',
      'Mythic+',
      'Candidate is not in the instance',
      'Disenchant'
    ].map((response, id) => ({
      id,
      response
    }))
  }
};
const SETTINGS_LOOT_LEADER = {
  ...SETTINGS_LOOT,
  sentinel: 'main:has(.loot-systems) button:text("Save")',
  person: {
    discordId: PEOPLE.officer.discordId,
    person: { ...PEOPLE.officer.person, teams: [{ ...PEOPLE.officer.person.teams[0], role: 'team_leader' }] }
  }
};

// Settings > Signups (#1342): the team leader with signups open for a season
// starting in five days, so Close is live; the close confirm open over it.
const dayFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const SETTINGS_SIGNUPS = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/settings/signups',
  sentinel: 'main:has(.signup-settings-row) button:text("Close signups")',
  person: SETTINGS_LOOT_LEADER.person,
  tables: {
    seasons: [
      { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-04-01', ends_at: dayFromNow(4) },
      { code: 'MID3', display_name: 'Midnight Season 3', starts_at: dayFromNow(5), ends_at: null }
    ],
    team_seasons: [{ team_id: 1, season_code: 'MID3', signups_open: true }]
  },
  rpc: {
    preview_signup_promotion: {
      expected: 'abc123',
      stays: [{ signup_id: 1, player_id: 1, name_realm: 'Katorrí-Stormrage' }],
      joins: [{ signup_id: 2, name_realm: 'Brellik-Illidan' }],
      swaps: [
        { signup_id: 3, name_realm: 'Sorrelwind-Illidan', from_player_id: 7, from_name_realm: 'Sorrelmoon-Illidan' }
      ],
      first_mains: [{ signup_id: 5, name_realm: 'Yzuri-Illidan' }],
      archives: [
        { player_id: 8, name_realm: 'Quietone-Illidan' },
        { player_id: 9, name_realm: 'Gonefishing-Illidan' }
      ],
      skipped: [{ signup_id: 4, name_realm: 'Twomains-Illidan', reason: 'several_characters' }]
    }
  }
};
const SETTINGS_SIGNUPS_CLOSE = {
  ...SETTINGS_SIGNUPS,
  click: 'button:text("Close signups")',
  afterClick: 'role=dialog >> .close-signups-archive'
};

const SETTINGS_DANGER = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/settings/danger',
  sentinel: 'main:has(.settings-danger-card)',
  tables: {
    seasons: [
      { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-01-01', ends_at: '2026-03-31' },
      { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-04-01', ends_at: null }
    ],
    team_settings: [{ team_id: 1 }],
    players: [
      {
        id: 1,
        name_realm: 'Aurelith-Illidan',
        nickname: null,
        is_trial: false,
        is_bench: false,
        is_rotator: false,
        tier_pieces_equipped: null,
        join_date: '2025-01-01',
        classes_specs: { class: 'Warrior', spec: 'Protection', role: 'Tank' }
      }
    ],
    attendance: [
      {
        id: 1,
        player_id: 1,
        raid_date: '2026-01-05',
        status: 'Present',
        report_excluded: false,
        report_title: null,
        source: null
      }
    ]
  }
};

// Import loot (#1363): the paste form under the current season, and one past
// import of two awards to one raider.
const IMPORT_LOOT = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/import',
  sentinel: 'main:has(.loot-import-list)',
  rpc: { resolve_actor_name: 'Aurelith' },
  tables: {
    seasons: [{ code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-01-01', ends_at: null }],
    audit_log: [1, 2].map((id) => ({
      id,
      actor_id: 'actor-1',
      action: 'Loot Imported (RCLC)',
      target_type: 'players',
      target_id: 5,
      detail: { summary: `Hero - Item ${id}`, season: 'MID1' },
      created_at: '2026-09-02T02:00:00Z'
    })),
    players: [{ id: 5, name_realm: 'Torbjorn-Illidan' }]
  }
};

// Reviews (#1363): one item waiting, one approved and one rejected with a
// reason, so both decision colors are measured in each theme.
const LOOT_REVIEWS = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/reviews',
  sentinel: 'main:has(.loot-review-rejected)',
  tables: {
    self_received_requests: [
      ['pending', null],
      ['approved', null],
      ['rejected', 'Not on your wishlist']
    ].map(([status, officer_notes], i) => ({
      id: i + 1,
      status,
      track: 'Hero',
      source: 'Great Vault',
      note: i === 0 ? 'From the vault this week' : null,
      officer_notes,
      slot: null,
      submitted_at: '2026-10-20T02:00:00Z',
      player_id: 5,
      players: { name_realm: 'Torbjorn-Illidan', team_id: 1, archived_at: null, classes_specs: { class: 'Warrior' } },
      items: { name: `Item ${i + 1}`, slot: 'Waist', wow_item_id: null, is_ptr: null, icon: null }
    }))
  }
};

// Reassign (#1363): the search, a raider button in class color, and two past
// reassignments. A raider's loot needs a click, which reassign.test.tsx covers.
const LOOT_REASSIGN = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/reassign',
  sentinel: 'main .loot-reassign-move',
  tables: {
    players: [
      {
        id: 5,
        name_realm: 'Torbjorn-Illidan',
        nickname: null,
        classes_specs: { class: 'Warrior', spec: 'Arms', role: 'Melee' }
      }
    ],
    rclc_loot: [],
    audit_log: [1, 2].map((id) => ({
      id,
      actor_id: 'actor-1',
      action: 'Loot Reassigned',
      target_type: 'players',
      target_id: 5,
      detail: 'Item ' + id + ': Brakkus -> Torbjorn',
      created_at: '2026-10-02T02:00:00Z'
    })),
    items: [{ name: 'Item 1', wow_item_id: null, is_ptr: false, icon: null }]
  },
  rpc: { resolve_actor_name: 'Aurelith' }
};

// Audit log (#1358, #1103 row 1): one entry with no target (Trial Thresholds
// Set) and one naming a player (Roster Targets Set), so both the actor-name
// and target-name resolution are on the page axe measures.
const SETTINGS_AUDIT_LOG = {
  session: OFFICER,
  who: 'officer',
  path: '/g/wga/t/phoenix/officer/settings/audit-log',
  sentinel: 'main:has(.settings-audit-time)',
  rpc: { resolve_actor_name: 'Aurelith' },
  tables: {
    audit_log: [
      {
        id: 1,
        actor_id: 'actor-1',
        action: 'Trial Thresholds Set',
        target_type: null,
        target_id: null,
        detail: '6 wk / 80%',
        created_at: '2026-09-01T12:00:00Z'
      },
      {
        id: 2,
        actor_id: 'actor-1',
        action: 'Roster Targets Set',
        target_type: 'players',
        target_id: 5,
        detail: { targetTankCount: 2, targetHealCount: 5 },
        created_at: '2026-09-02T12:00:00Z'
      }
    ],
    players: [{ id: 5, name_realm: 'Torbjorn-Illidan' }]
  }
};

const GUILD = { path: '/g/wga', sentinel: 'main:has(.guild-officer)', teams: GUILD_TEAMS, tables: GUILD_TABLES };
const GUILD_OFFICER = {
  ...GUILD,
  session: OFFICER,
  who: 'officer',
  sentinel: 'main:has(.guild-attention-item)',
  tables: { ...GUILD_TABLES, ...WAITING }
};

const CRASH = {
  path: '/g/wga/t/phoenix/roster',
  sentinel: 'text=Something went wrong on this page',
  tables: { players: [null] }
};
const NEWS = { path: '/news', sentinel: 'main:has(.news-entry)', news: NEWS_ENTRIES };

// The Streams page (#1102): the live players and the offline directory, which
// between them carry every stream card state axe should measure (#796).
const STREAMS_PAGE = {
  path: '/g/wga/streams',
  sentinel: 'main:has(.stream-card)',
  teams: STREAM_TEAMS,
  tables: { streamers: DIRECTORY }
};

const HELP = { path: '/help', sentinel: 'main:has(.help-topic)' };
const HELP_GUIDE = { path: '/help/wishlist', sentinel: '.dialog-side img' };
const ABOUT = { path: '/about', sentinel: 'main:has(.about-card)' };

// The site front page and the create-your-guild page (#1226). The form only
// shows once guild creation is open, so that state turns the switch on.
const FRONT = { path: '/', sentinel: 'main:has(.front-hero)' };
const NEW_GUILD = {
  path: '/new-guild',
  sentinel: 'main:has(.front-form)',
  session: OFFICER,
  who: 'officer',
  rpc: { guild_creation_open: true }
};

// Guild officers and Team officers (#1102): the same OFFICER_BIOS fixture
// Guild home's compact list uses, which carries both a full card (photo,
// pronouns, class badge, bio text) and a bare one (initials only, no extras).
const GUILD_OFFICERS = {
  path: '/g/wga/officers',
  sentinel: 'main:has(.bio-card)',
  tables: { site_settings: [{ guild_officer_bios: OFFICER_BIOS }] }
};
const TEAM_OFFICERS = {
  path: '/g/wga/t/phoenix/officers',
  sentinel: 'main:has(.bio-card)',
  tables: { team_settings: [{ team_id: 1, bios: OFFICER_BIOS }] }
};

// Editing the bios in place (#1361): a team officer on Team officers, and a
// guild officer on Guild officers, each with Edit officers clicked.
const TEAM_OFFICERS_EDITING = {
  ...TEAM_OFFICERS,
  session: OFFICER,
  who: 'officer',
  click: 'role=button[name="Edit officers"]',
  afterClick: '.bios-save-bar'
};
const GUILD_OFFICERS_EDITING = {
  ...GUILD_OFFICERS,
  session: OFFICER,
  person: {
    discordId: 'discord-officer-1',
    person: { site_admin: false, guild_officer: true, boe_manager: false, teams: [] }
  },
  click: 'role=button[name="Edit officers"]',
  afterClick: '.bios-save-bar'
};

// Guild settings (#1644): the Teams tab, for a guild officer, with an unlisted
// team and an archived one.
const GUILD_SETTINGS = {
  path: '/g/wga/settings/teams',
  sentinel: 'main .guildsettings-row',
  session: OFFICER,
  person: {
    discordId: 'discord-officer-1',
    person: { site_admin: false, guild_officer: true, boe_manager: false, teams: [] }
  },
  teams: [
    { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null, unlisted: false },
    { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', archived_at: null, unlisted: false },
    { id: 3, name: 'Sandbox', slug: 'sandbox', archived_at: null, unlisted: true },
    { id: 9, name: 'Old Team', slug: 'old-team', archived_at: '2026-01-01T00:00:00Z', unlisted: false }
  ]
};

// History (#1102): a season with a roster to show behind the toggle.
const HISTORY_ENTRY = {
  name: 'Season One',
  raids: [{ bosses: [{ name: 'Warden of Ash', mythicDate: '2026-08-01', mythicPulls: 5 }] }],
  roster: [
    {
      nameRealm: 'Aurelith-Illidan',
      role: 'Tank',
      isTrial: false,
      isBench: false,
      joinDate: '2026-01-01',
      attendance: '90%'
    }
  ]
};
const HISTORY = {
  path: '/g/wga/t/phoenix/history',
  sentinel: 'main:has(.history-season)',
  tables: { team_settings: [{ team_id: 1, history: [HISTORY_ENTRY] }] }
};

// Sign Up (#1102): signed in, one season open, no existing signup -- the
// fresh wizard's step 1. A separate state for the "Your signup" summary,
// which is the page's other real shape.
const SIGNUP_PERSON = {
  discordId: 'discord-signup-1',
  person: {
    site_admin: false,
    guild_officer: false,
    boe_manager: false,
    teams: [{ team_id: 1, team_member_id: 1, role: 'raider', characters: [] }]
  }
};
const SIGNUP_BASE = {
  path: '/g/wga/t/phoenix/signup',
  session: storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Raider' }),
  person: SIGNUP_PERSON,
  tables: {
    team_seasons: [
      {
        season_code: 'MID3',
        signups_open: true,
        seasons: { starts_at: '2099-01-01', display_name: 'Midnight Season 3' }
      }
    ],
    // The import's saved characters (#1466), one leveling without a spec.
    characters: [
      {
        id: 11,
        person_id: 42,
        name: 'Katorrí',
        realm: 'Stormrage',
        class_name: 'Warlock',
        spec_name: 'Demonology',
        item_level: 640
      },
      {
        id: 12,
        person_id: 42,
        name: 'Grihz',
        realm: 'Illidan',
        class_name: 'Shaman',
        spec_name: null,
        item_level: null
      }
    ],
    classes_specs: [{ id: 32, class: 'Warlock', spec: 'Demonology', role: 'Ranged' }]
  }
};
const SIGNUP = {
  ...SIGNUP_BASE,
  sentinel: 'main:has(.signup-bnet-list)',
  rpc: { get_own_signup: [], my_person_id: 42 }
};
// No characters imported yet: the form offers the import instead (#1466).
const SIGNUP_NO_CHARACTERS = {
  ...SIGNUP_BASE,
  tables: { ...SIGNUP_BASE.tables, characters: [] },
  sentinel: 'main:has(.signup-bnet-picker)',
  rpc: { get_own_signup: [], my_person_id: 42 }
};
const SIGNUP_SUMMARY = {
  ...SIGNUP_BASE,
  sentinel: 'main:has(.signup-summary)',
  rpc: {
    get_own_signup: [
      {
        id: 1,
        signup_name_realm: 'Katorri-Stormrage',
        class: 'Priest',
        spec: 'Holy',
        off_specs: null,
        main_swap: false,
        swap_class: null,
        swap_spec: null,
        swap_from_name_realm: null,
        player_note: null,
        status: 'pending',
        season: 'MID3',
        submitted_at: '2026-09-01T00:00:00Z',
        is_backup_tank: false,
        is_backup_healer: false
      }
    ],
    my_person_id: 42
  }
};

// Site admin (#1364): Staff only, with two admins listed and the switches off.
const SITE_ADMIN = {
  path: '/site-admin',
  sentinel: 'main .siteadmin-list li',
  session: OFFICER,
  person: {
    discordId: 'discord-staff-1',
    person: { site_admin: true, guild_officer: false, boe_manager: false, teams: [] }
  },
  rpc: {
    admin_list_site_admins: [
      { id: 1, discord_id: '111111111111111111', auth_user_id: null, display_name: 'Kat' },
      { id: 2, discord_id: '222222222222222222', auth_user_id: null, display_name: 'Rex' }
    ]
  },
  tables: { site_settings: [{ maintenance_mode: false, maintenance_message: null, guild_creation_open: false }] }
};

const STATES = [
  { label: 'help', ...HELP },
  { label: 'help, light', ...HELP, colorScheme: 'light' },
  { label: 'help, a guide open', ...HELP_GUIDE },
  { label: 'help, a guide open, light', ...HELP_GUIDE, colorScheme: 'light' },
  { label: 'help, a guide open, on a phone', ...HELP_GUIDE, viewport: NARROW },
  {
    label: 'help, a guide in full view',
    ...HELP_GUIDE,
    click: 'role=button[name="Full view"]',
    afterClick: '.help-guide-page'
  },
  { label: 'about', ...ABOUT },
  { label: 'about, light', ...ABOUT, colorScheme: 'light' },
  { label: 'front page', ...FRONT },
  { label: 'front page, light', ...FRONT, colorScheme: 'light' },
  { label: 'create your guild', ...NEW_GUILD },
  { label: 'create your guild, light', ...NEW_GUILD, colorScheme: 'light' },
  { label: 'guild officers', ...GUILD_OFFICERS },
  { label: 'guild officers, light', ...GUILD_OFFICERS, colorScheme: 'light' },
  { label: 'team officers', ...TEAM_OFFICERS },
  { label: 'team officers, officer editing', ...TEAM_OFFICERS_EDITING },
  { label: 'team officers, officer editing, light', ...TEAM_OFFICERS_EDITING, colorScheme: 'light' },
  { label: 'guild officers, guild officer editing', ...GUILD_OFFICERS_EDITING },
  { label: 'guild settings, teams', ...GUILD_SETTINGS },
  { label: 'guild settings, teams, light', ...GUILD_SETTINGS, colorScheme: 'light' },
  { label: 'guild settings, teams, on a phone', ...GUILD_SETTINGS, viewport: NARROW },
  {
    label: 'guild settings, archive dialog',
    ...GUILD_SETTINGS,
    click: 'role=button[name="Archive Phoenix"]',
    afterClick: '[role=dialog]'
  },
  {
    label: 'guild settings, new team dialog',
    ...GUILD_SETTINGS,
    click: 'role=button[name="New team"]',
    afterClick: '[role=dialog]'
  },
  { label: 'history', ...HISTORY },
  { label: 'history, light', ...HISTORY, colorScheme: 'light' },
  { label: 'signup', ...SIGNUP },
  { label: 'signup, light', ...SIGNUP, colorScheme: 'light' },
  { label: 'signup summary', ...SIGNUP_SUMMARY },
  { label: 'signup, no characters imported', ...SIGNUP_NO_CHARACTERS },
  { label: 'news', ...NEWS },
  { label: 'news, light', ...NEWS, colorScheme: 'light' },
  { label: 'streams', ...STREAMS_PAGE },
  { label: 'streams, light', ...STREAMS_PAGE, colorScheme: 'light' },
  {
    label: 'streams, nobody live',
    ...STREAMS_PAGE,
    sentinel: 'main:has(.stream-directory)',
    tables: { streamers: DIRECTORY_OFFLINE }
  },
  { label: 'guild home, signed out', ...GUILD },
  { label: 'guild home, signed out, light', ...GUILD, colorScheme: 'light' },
  { label: 'guild home, officer', ...GUILD_OFFICER },
  { label: 'guild home, officer, light', ...GUILD_OFFICER, colorScheme: 'light' },
  { label: 'calendar month, officer', ...CAL_MONTH },
  { label: 'calendar month, officer, light', ...CAL_MONTH, colorScheme: 'light' },
  {
    label: 'calendar month, signed out',
    path: '/g/wga/t/phoenix/calendar',
    sentinel: 'main:has(.night-chip[data-date])',
    clock: CAL_TODAY,
    tables: CAL_TABLES
  },
  { label: 'calendar night, officer', ...CAL_NIGHT_PAGE },
  { label: 'calendar night, officer, light', ...CAL_NIGHT_PAGE, colorScheme: 'light' },
  { label: 'calendar boss lineup, officer', ...CAL_LINEUP },
  { label: 'calendar boss lineup, officer, light', ...CAL_LINEUP, colorScheme: 'light' },
  { label: 'calendar night, your bosses', ...CAL_OWN_BOSSES },
  { label: 'calendar night, your bosses, light', ...CAL_OWN_BOSSES, colorScheme: 'light' },
  { label: 'boss groups, officer', ...BOSS_GROUPS },
  { label: 'boss groups, officer, light', ...BOSS_GROUPS, colorScheme: 'light' },
  { label: 'boss groups, officer, a change not saved yet', ...BOSS_GROUPS, click: '.lineup-toggle:not(.is-in)' },
  {
    label: 'boss groups, officer, none set yet',
    ...BOSS_GROUPS,
    sentinel: 'main:has(.lineup-empty)',
    tables: { ...BOSS_GROUPS.tables, boss_groups: [] }
  },
  {
    label: 'boss groups, officer, editing role targets',
    ...BOSS_GROUPS,
    click: 'role=button[name="Edit"]'
  },
  {
    label: 'boss groups, guild officer, editing a boss cap',
    ...BOSS_GROUPS_GUILD_OFFICER,
    click: 'role=button[name="Edit cap"]'
  },
  { label: 'loot priority, an item open', ...PRIORITY },
  { label: 'loot priority, an item open, light', ...PRIORITY, colorScheme: 'light' },
  {
    label: 'loot priority, the RCLootCouncil string',
    ...PRIORITY,
    click: 'role=button[name="Generate Heroic string"]',
    afterClick: 'main .priority-string'
  },
  { label: 'loot priority, on a phone', ...PRIORITY, viewport: NARROW },
  // A Loot council team has no priority list (#1563).
  {
    label: 'loot priority, a Loot council team',
    ...PRIORITY,
    tables: { ...PRIORITY.tables, team_settings: [{ lootSystem: 'council' }] },
    path: '/g/wga/t/phoenix/officer/priority',
    sentinel: 'main .priority-page .placeholder'
  },
  {
    label: 'loot priority, after Suggest order',
    ...PRIORITY,
    click: 'role=button[name="Suggest order"]',
    afterClick: 'main .priority-was'
  },
  {
    label: 'loot priority, after Suggest order, light',
    ...PRIORITY,
    colorScheme: 'light',
    click: 'role=button[name="Suggest order"]',
    afterClick: 'main .priority-was'
  },
  {
    label: 'loot priority, Unmanaged',
    ...PRIORITY,
    path: '/g/wga/t/phoenix/officer/priority?tab=unmanaged',
    sentinel: 'main .priority-unmanaged-row'
  },
  {
    label: 'loot priority, Needs a look',
    ...PRIORITY_FLAGGED,
    path: '/g/wga/t/phoenix/officer/priority',
    sentinel: 'main .priority-look'
  },
  {
    label: 'loot priority, a flagged #1',
    ...PRIORITY_FLAGGED,
    sentinel: 'main .priority-flag-warn'
  },
  {
    label: 'loot priority, Contested',
    ...PRIORITY_FLAGGED,
    path: '/g/wga/t/phoenix/officer/priority?tab=contested',
    sentinel: 'main .priority-contested-item',
    click: 'main .priority-contested-item summary',
    afterClick: 'main .priority-contested-who'
  },
  {
    label: 'loot priority, Notes',
    ...PRIORITY_FLAGGED,
    path: '/g/wga/t/phoenix/officer/priority?tab=notes',
    sentinel: 'main .priority-note'
  },
  {
    label: 'loot priority, Notes, light, clearing one',
    ...PRIORITY_FLAGGED,
    colorScheme: 'light',
    path: '/g/wga/t/phoenix/officer/priority?tab=notes',
    sentinel: 'main .priority-note',
    click: 'main .priority-note-clear >> nth=0',
    afterClick: '[role=dialog]'
  },
  { label: 'loot priority, Scoring', ...PRIORITY_SCORING },
  {
    label: 'loot priority, Scoring, light, typing a score',
    ...PRIORITY_SCORING,
    colorScheme: 'light',
    click: 'main .priority-scoring-small >> nth=0',
    afterClick: 'main .priority-score-input'
  },
  { label: 'loot priority, Scoring, on a phone', ...PRIORITY_SCORING, viewport: NARROW },
  { label: 'loot fairness', ...REPORT, path: '/g/wga/t/phoenix/officer/reports/loot-fairness' },
  {
    label: 'loot fairness, light',
    ...REPORT,
    path: '/g/wga/t/phoenix/officer/reports/loot-fairness',
    colorScheme: 'light'
  },
  { label: 'bench fairness', ...REPORT, path: '/g/wga/t/phoenix/officer/reports/bench-fairness' },
  { label: 'boss lineups, raiders', ...TABLE_REPORT, path: '/g/wga/t/phoenix/officer/reports/boss-lineups' },
  {
    label: 'boss lineups, raiders, light',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/boss-lineups',
    colorScheme: 'light'
  },
  {
    label: 'boss lineups, bosses',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/boss-lineups',
    click: 'role=button[name="Bosses"]'
  },
  {
    label: 'boss lineups, nights',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/boss-lineups',
    click: 'role=button[name="Nights"]'
  },
  {
    label: 'boss lineups, nights, light',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/boss-lineups',
    click: 'role=button[name="Nights"]',
    colorScheme: 'light'
  },
  { label: 'raid nights since last item', ...TABLE_REPORT, path: '/g/wga/t/phoenix/officer/reports/raid-nights' },
  {
    label: 'raid nights since last item, light',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/raid-nights',
    colorScheme: 'light'
  },
  { label: 'tier sets', ...TABLE_REPORT, path: '/g/wga/t/phoenix/officer/reports/tier-sets' },
  { label: 'BiS demand', ...TABLE_REPORT, path: '/g/wga/t/phoenix/officer/reports/bis-demand' },
  {
    label: 'BiS demand, light',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/bis-demand',
    colorScheme: 'light'
  },
  { label: 'loot pace', ...TABLE_REPORT, path: '/g/wga/t/phoenix/officer/reports/loot-pace' },
  {
    label: 'loot pace, light',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/loot-pace',
    colorScheme: 'light'
  },
  {
    label: 'priority order health',
    ...TABLE_REPORT,
    sentinel: 'main .report-section',
    path: '/g/wga/t/phoenix/officer/reports/priority-health'
  },
  {
    label: 'priority order health, light',
    ...TABLE_REPORT,
    sentinel: 'main .report-section',
    path: '/g/wga/t/phoenix/officer/reports/priority-health',
    colorScheme: 'light'
  },
  {
    label: 'tier sets, light',
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/tier-sets',
    colorScheme: 'light'
  },
  {
    label: 'bench fairness, light',
    ...REPORT,
    path: '/g/wga/t/phoenix/officer/reports/bench-fairness',
    colorScheme: 'light'
  },
  { label: 'attendance manage, officer', ...ATTENDANCE_MANAGE },
  { label: 'attendance manage, officer, light', ...ATTENDANCE_MANAGE, colorScheme: 'light' },
  {
    label: 'attendance manage, officer, no nights recorded yet',
    ...ATTENDANCE_MANAGE,
    sentinel: 'text=No raid nights recorded yet',
    tables: { ...ATTENDANCE_TABLES, attendance: [] }
  },
  {
    label: 'attendance manage, officer, committing scores',
    ...ATTENDANCE_MANAGE,
    click: 'role=button[name="Commit Attendance Scores"]'
  },
  { label: 'settings general, officer', ...SETTINGS_GENERAL },
  { label: 'settings general, officer, light', ...SETTINGS_GENERAL, colorScheme: 'light' },
  { label: 'settings season, officer', ...SETTINGS_SEASON },
  { label: 'settings season, officer, light', ...SETTINGS_SEASON, colorScheme: 'light' },
  {
    label: 'settings season, officer, roster shown',
    ...SETTINGS_SEASON,
    click: 'role=button[name="View Roster"]'
  },
  { label: 'settings progression, officer', ...SETTINGS_PROGRESSION },
  { label: 'settings progression, officer, light', ...SETTINGS_PROGRESSION, colorScheme: 'light' },
  { label: 'settings loot, officer', ...SETTINGS_LOOT },
  { label: 'settings loot, officer, light', ...SETTINGS_LOOT, colorScheme: 'light' },
  { label: 'settings loot, team leader', ...SETTINGS_LOOT_LEADER },
  { label: 'settings loot, team leader, light', ...SETTINGS_LOOT_LEADER, colorScheme: 'light' },
  { label: 'settings signups, team leader', ...SETTINGS_SIGNUPS },
  { label: 'settings signups, close confirm', ...SETTINGS_SIGNUPS_CLOSE },
  { label: 'settings signups, close confirm, light', ...SETTINGS_SIGNUPS_CLOSE, colorScheme: 'light' },
  { label: 'settings danger zone, officer', ...SETTINGS_DANGER },
  { label: 'settings danger zone, officer, light', ...SETTINGS_DANGER, colorScheme: 'light' },
  { label: 'site admin, staff', ...SITE_ADMIN },
  { label: 'site admin, staff, light', ...SITE_ADMIN, colorScheme: 'light' },
  { label: 'import loot, officer', ...IMPORT_LOOT },
  { label: 'import loot, officer, light', ...IMPORT_LOOT, colorScheme: 'light' },
  { label: 'loot reviews, officer', ...LOOT_REVIEWS },
  { label: 'loot reviews, officer, light', ...LOOT_REVIEWS, colorScheme: 'light' },
  { label: 'loot reassign, officer', ...LOOT_REASSIGN },
  { label: 'loot reassign, officer, light', ...LOOT_REASSIGN, colorScheme: 'light' },
  { label: 'settings audit log, officer', ...SETTINGS_AUDIT_LOG },
  { label: 'settings audit log, officer, light', ...SETTINGS_AUDIT_LOG, colorScheme: 'light' },
  {
    label: 'settings danger zone, officer, confirming archive',
    ...SETTINGS_DANGER,
    click: 'role=button[name="Archive season"]'
  },
  {
    label: 'calendar night, officer changing an answer',
    ...CAL_NIGHT_PAGE,
    click: '.night-row .edit-button'
  },
  { label: 'calendar month, officer editing the schedule', ...CAL_EDITING },
  { label: 'calendar month, officer editing the schedule, light', ...CAL_EDITING, colorScheme: 'light' },
  { label: 'calendar empty day, officer adding a night', ...CAL_ADD_NIGHT },
  { label: 'calendar empty day, officer adding a night, light', ...CAL_ADD_NIGHT, colorScheme: 'light' },
  { label: 'calendar cancelled night, officer', ...CAL_CANCELLED },
  { label: 'calendar cancelled night, officer, light', ...CAL_CANCELLED, colorScheme: 'light' },
  {
    label: 'calendar night, officer cancelling it',
    ...CAL_NIGHT_PAGE,
    click: 'role=button[name="Cancel this night"]',
    afterClick: '[role="dialog"]'
  },
  {
    label: 'home, signed out',
    path: '/g/wga/t/phoenix',
    sentinel: HOME_SENTINEL,
    tables: HOME_TABLES,
    clock: TODAY
  },
  {
    label: 'home, signed out, light',
    path: '/g/wga/t/phoenix',
    sentinel: HOME_SENTINEL,
    tables: HOME_TABLES,
    clock: TODAY,
    colorScheme: 'light'
  },
  {
    label: 'officer page, signed out',
    path: '/g/wga/t/phoenix/officer/priority',
    sentinel: 'text=Sign in to see this page'
  },
  {
    label: 'officer page, officer',
    path: '/g/wga/t/phoenix/officer/reports/performance',
    session: OFFICER,
    who: 'officer',
    sentinel: 'text=Not built yet'
  },
  {
    label: 'officer page, officer, light',
    path: '/g/wga/t/phoenix/officer/reports/performance',
    session: OFFICER,
    who: 'officer',
    sentinel: 'text=Not built yet',
    colorScheme: 'light'
  },
  {
    label: 'Battle.net only, connect Discord',
    path: '/g/wga/t/phoenix',
    session: BATTLENET_ONLY,
    who: 'battlenetOnly',
    sentinel: 'text=Connect your Discord'
  },
  { label: 'page not found', path: '/g/wga/t/phoenix/nope', sentinel: 'text=Page not found' },
  {
    label: 'page not found, light',
    path: '/g/wga/t/phoenix/nope',
    sentinel: 'text=Page not found',
    colorScheme: 'light'
  },
  { label: 'page not found, outside the frame', path: '/nope', sentinel: 'text=Page not found' },
  // A page that crashes (#1477): a roster row that is not there trips the page,
  // and the crash screen shows inside the frame.
  { label: 'page crash', ...CRASH },
  { label: 'page crash, light', ...CRASH, colorScheme: 'light' },
  { label: 'page crash, details open', ...CRASH, click: 'text=Show error details' },
  {
    label: 'roster, officer, alts showing',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table .alt-count',
    session: OFFICER,
    who: 'officer',
    tables: rosterWithAlts(),
    click: 'role=button[name="Show alts"]'
  },
  {
    label: 'BoE sales, signed out',
    path: '/g/wga/boe',
    sentinel: 'text=Report a BoE',
    tables: { items: [], raid_zones: [] }
  },
  boeState('BoE sales, raider', 'raider', false),
  boeState('BoE sales, BoE manager', 'officer', true),
  boeState('BoE sales, BoE manager, light', 'officer', true, { colorScheme: 'light' }),
  pickerState('alts picker'),
  pickerState('alts picker, light', { colorScheme: 'light' }),
  { label: 'roster', path: '/g/wga/t/phoenix/roster', sentinel: 'table.roster-table', tables: ROSTER },
  // Player settings (#1360): the panel open from a row's gear. The 480px check
  // every state gets covers it as a phone's full-screen sheet.
  { label: 'roster, officer, player settings', ...SETTINGS_OPEN },
  { label: 'roster, officer, player settings, light', ...SETTINGS_OPEN, colorScheme: 'light' },
  {
    label: 'roster, light',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table',
    tables: ROSTER,
    colorScheme: 'light'
  },
  {
    label: 'roster, officer, with attendance and items',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table .roster-attendance',
    session: OFFICER,
    who: 'officer',
    tables: {
      ...ROSTER,
      seasons: [
        { code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null }
      ],
      team_settings: [{}],
      attendance: [],
      rclc_loot: []
    }
  },
  {
    label: 'roster, next season tab',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table',
    tables: ROSTER,
    click: 'role=tab[name="Midnight Season 4 Projected Roster"]'
  },
  {
    label: 'roster, officer, next season tab with Trial and backup ticks',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table',
    session: OFFICER,
    who: 'officer',
    tables: {
      ...ROSTER,
      season_signups: SCENARIO.incoming.map((r) => ({
        id: r.signup_id,
        is_trial: null,
        is_backup_tank: false,
        is_backup_healer: false
      }))
    },
    click: 'role=tab[name="Midnight Season 4 Projected Roster"]'
  },
  {
    label: 'roster, officer, Names',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table .name-only-row',
    session: OFFICER,
    who: 'officer',
    tables: rosterWithNames()
  },
  { label: 'roster, officer, accounts and Claim', ...ACCOUNTS },
  { label: 'roster, officer, accounts and Claim, light', ...ACCOUNTS, colorScheme: 'light' },
  {
    label: 'roster, officer, Archived tab',
    ...ARCHIVED_TAB
  },
  { label: 'roster, officer, Archived tab, light', ...ARCHIVED_TAB, colorScheme: 'light' },
  {
    label: 'roster, officer, Needs a look',
    path: '/g/wga/t/phoenix/roster',
    sentinel: '.needs-a-look',
    session: OFFICER,
    who: 'officer',
    clock: '2026-10-10T16:00:00Z',
    tables: needsALook()
  },
  profileState('my profile, ask to raid on an alt', 'torbjorn', 'torbjorn', {
    sentinel: 'main .character-ask',
    click: 'main .character-ask',
    tables: {
      ...profileState('', 'torbjorn', 'torbjorn').tables,
      players: [{ ...VIEWERS.torbjorn.player, team_members: { person_id: 70 } }],
      characters: ALT_CHARACTERS,
      classes_specs: SPECS
    }
  }),
  profileState('my profile, a main swap waiting for an officer', 'torbjorn', 'torbjorn', {
    sentinel: 'main .character-tag-waiting',
    tables: {
      ...profileState('', 'torbjorn', 'torbjorn').tables,
      players: [{ ...VIEWERS.torbjorn.player, team_members: { person_id: 70 } }],
      characters: ALT_CHARACTERS,
      main_swap_requests: waitingSwap(VIEWERS.torbjorn.player.name_realm)
    }
  }),
  profileState('my profile, a main swap declined', 'torbjorn', 'torbjorn', {
    sentinel: 'main .character-tag-declined',
    tables: {
      ...profileState('', 'torbjorn', 'torbjorn').tables,
      players: [{ ...VIEWERS.torbjorn.player, team_members: { person_id: 70 } }],
      characters: ALT_CHARACTERS,
      main_swap_requests: declinedSwap(VIEWERS.torbjorn.player.name_realm)
    }
  }),
  // A note with a link in it, so the 480px check sees the row wrap it.
  profileState('my profile, a main swap declined, light', 'torbjorn', 'torbjorn', {
    sentinel: 'main .character-tag-declined',
    colorScheme: 'light',
    tables: {
      ...profileState('', 'torbjorn', 'torbjorn').tables,
      players: [{ ...VIEWERS.torbjorn.player, team_members: { person_id: 70 } }],
      characters: ALT_CHARACTERS,
      main_swap_requests: declinedSwap(
        VIEWERS.torbjorn.player.name_realm,
        'Read this first: https://www.wowhead.com/guide/classes/evoker/preservation/overview-pve-healer'
      )
    }
  }),
  profileState('my profile', 'torbjorn', 'torbjorn'),
  profileState('my profile, characters and alts', 'torbjorn', 'torbjorn', {
    sentinel: 'main .characters-card .character-row + .character-row',
    tables: {
      ...profileState('', 'torbjorn', 'torbjorn').tables,
      players: [{ ...VIEWERS.torbjorn.player, team_members: { person_id: 70 } }],
      characters: ALT_CHARACTERS
    }
  }),
  profileState('my profile, light', 'torbjorn', 'torbjorn', { colorScheme: 'light' }),
  // A Loot council team: no Wishlist tab or wishlist cards (#1563).
  profileState('my profile, a Loot council team', 'torbjorn', 'torbjorn', {
    sentinel: 'main [aria-labelledby="council-title"]',
    tables: { ...profileState('', 'torbjorn', 'torbjorn').tables, team_settings: [{ lootSystem: 'council' }] }
  }),
  profileState('my profile, loot tab', 'torbjorn', 'torbjorn', {
    path: '/g/wga/t/phoenix/me/loot',
    sentinel: 'main .loot-table'
  }),
  profileState('my profile, wishlist tab, light', 'torbjorn', 'torbjorn', {
    path: '/g/wga/t/phoenix/me/wishlist',
    sentinel: 'main .wishlist-summary',
    colorScheme: 'light'
  }),
  wishlistEditorState('my profile, wishlist editor, a slot open'),
  wishlistEditorState('my profile, wishlist editor, a slot open, light', { colorScheme: 'light' }),
  wishlistEditorState('my profile, wishlist editor, on a phone', { touch: true, viewport: NARROW }),
  wishlistEditorState('my profile, wishlist editor, closed', {
    tables: { team_settings: [{ open: 'false', view: null }] }
  }),
  // The season picker (#936), there once two seasons are open.
  wishlistEditorState('my profile, wishlist editor, two seasons open', TWO_SEASONS_OPEN),
  wishlistEditorState('my profile, wishlist editor, two seasons open, light', {
    ...TWO_SEASONS_OPEN,
    colorScheme: 'light'
  }),
  // The profile's two forms, open (#868 part 4).
  profileState('my profile, Mark received dialog', 'torbjorn', 'torbjorn', {
    sentinel: 'main .priority-table .mark-received',
    click: 'main .priority-table .mark-received >> nth=0'
  }),
  profileState('my profile, M+ exclusion request dialog, light', 'dodgey', 'dodgey', {
    sentinel: 'main .mplus-request',
    click: 'main .mplus-request',
    colorScheme: 'light',
    tables: {
      ...profileState('', 'dodgey', 'dodgey').tables,
      seasons: [
        { code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start || '2026-01-01', ends_at: null }
      ],
      team_settings: [{ mplusOpen: 'true' }]
    }
  }),
  profileState('officer opening a profile with a refused M+ request', 'officer', 'dodgey', {
    sentinel: 'main .mplus-status'
  }),
  { label: 'my profile, signed out', path: '/g/wga/t/phoenix/me', sentinel: 'text=Sign in to see your profile' }
];

let server;
let browser;

beforeAll(async () => {
  server = await startApp();
  browser = await launchBrowser();
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

// Measured after any entrance animation has finished: mid-fade, a button's
// colors are partly transparent and read as a contrast failure that no one
// ever sees at rest.
async function axe(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe.each(STATES)('$label', (state) => {
  it('has no WCAG 2.1 AA violations, makes no unexpected requests, and throws nothing', async () => {
    const { context, page, unexpected, pageErrors } = await openApp(browser, server.port, state);
    try {
      expect(await axe(page)).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('does not scroll sideways at 480px', async () => {
    const { context, page } = await openApp(browser, server.port, { ...state, viewport: NARROW });
    try {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});

describe('narrow-screen drawer', () => {
  it('opens as a dialog-like panel with no violations and returns focus on Escape', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      sentinel: HOME_SENTINEL,
      tables: HOME_TABLES,
      clock: TODAY,
      viewport: NARROW
    });
    try {
      const menu = page.getByRole('button', { name: 'Open menu' });
      await menu.click();
      expect(await page.evaluate(() => document.getElementById('sidebar')?.contains(document.activeElement))).toBe(
        true
      );
      expect(await axe(page)).toEqual([]);
      await page.keyboard.press('Escape');
      await expect.poll(() => menu.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await context.close();
    }
  });
});

// The sidebar never shows a scrollbar (Kat, 2026-10-18), folding one section
// at a time from the top, never the open one (Kat, 2026-10-19), so Site at
// the bottom folds last. Clicking through a folded sidebar once looped forever.
describe('sidebar folding', () => {
  const at = (height) => ({
    ...TABLE_REPORT,
    path: '/g/wga/t/phoenix/officer/reports/bis-demand',
    viewport: { width: 1280, height }
  });
  const sidebarState = (page) =>
    page.evaluate(() => {
      const el = document.getElementById('sidebar');
      return {
        overflow: el.scrollHeight - el.clientHeight,
        folds: document.querySelectorAll('.nav-section-toggle').length,
        open: [...document.querySelectorAll('[id^="section-"]:not([hidden])')].map((ul) => ul.id.slice(8))
      };
    });

  it('keeps every section open when they fit, with Loot current on any of its report tabs', async () => {
    const { context, page } = await openApp(browser, server.port, at(1400));
    try {
      expect(await sidebarState(page)).toEqual({
        overflow: 0,
        folds: 0,
        open: ['Guild', 'You', 'Team', 'Officer', 'Site']
      });
      const nav = page.locator('#sidebar nav');
      expect(await nav.getByRole('link', { name: 'Loot', exact: true }).getAttribute('aria-current')).toBe('page');
      const tabs = page.getByRole('navigation', { name: 'Reports on this page' });
      expect(await tabs.getByRole('link', { name: 'BiS demand' }).getAttribute('aria-current')).toBe('page');
    } finally {
      await context.close();
    }
  });

  it('folds only the top section when that is enough', async () => {
    const { context, page, pageErrors } = await openApp(browser, server.port, at(1000));
    try {
      await expect
        .poll(() => sidebarState(page))
        .toEqual({ overflow: 0, folds: 1, open: ['You', 'Team', 'Officer', 'Site'] });
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('folds more sections from the top as needed, and clicks through without looping', async () => {
    const { context, page, pageErrors } = await openApp(browser, server.port, at(940));
    try {
      const nav = page.locator('#sidebar nav');
      await expect.poll(() => sidebarState(page)).toEqual({ overflow: 0, folds: 3, open: ['Officer', 'Site'] });
      await nav.getByRole('button', { name: 'Team', exact: true }).click();
      await nav.getByRole('link', { name: 'Roster', exact: true }).click();
      // Roster closes the officer menus, so the sidebar is short enough to
      // fold only Guild again.
      await expect
        .poll(() => sidebarState(page))
        .toEqual({ overflow: 0, folds: 1, open: ['You', 'Team', 'Officer', 'Site'] });
      await nav.getByRole('button', { name: 'Settings', exact: true }).click();
      await nav.getByRole('link', { name: 'General', exact: true }).click();
      await expect.poll(() => sidebarState(page)).toEqual({ overflow: 0, folds: 3, open: ['Officer', 'Site'] });
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('folds Site too only when the window is too short for it', async () => {
    const { context, page, pageErrors } = await openApp(browser, server.port, at(720));
    try {
      await expect.poll(() => sidebarState(page)).toEqual({ overflow: 0, folds: 5, open: ['Officer'] });
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

describe('keyboard', () => {
  it('shows the skip link on the first Tab and a visible focus ring on every control after it', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      session: OFFICER,
      who: 'officer',
      sentinel: 'text=Officer · Seedofficer'
    });
    try {
      await page.keyboard.press('Tab');
      const skip = await page.evaluate(() => {
        const el = document.activeElement;
        const box = el?.getBoundingClientRect();
        return { text: el?.textContent, visible: !!box && box.top >= 0 && box.height > 0 };
      });
      expect(skip).toEqual({ text: 'Skip to content', visible: true });

      // Every stop until focus has been through the sidebar and top bar.
      const missing = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('Tab');
        const ring = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const style = getComputedStyle(el);
          const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30) || el.tagName;
          return { label, ok: style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2 };
        });
        if (ring && !ring.ok) missing.push(ring.label);
      }
      expect(missing).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it('keeps Tab inside the switch dialog and returns focus when Escape closes it', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      session: BATTLENET_ONLY,
      who: 'battlenetOnly',
      sentinel: 'text=Connect your Discord'
    });
    try {
      const trigger = page.getByRole('button', { name: 'Already use WGA Raid Hub with Discord?' });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Use your Discord account' });
      await dialog.waitFor();
      expect(await axe(page)).toEqual([]);
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await context.close();
    }
  });
});

describe('roster row menu', () => {
  it('has no violations while open, and focus returns to its button when a dialog it opened closes', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix/roster',
      sentinel: 'table.roster-table .name-only-row',
      session: OFFICER,
      who: 'officer',
      tables: rosterWithNames()
    });
    try {
      const trigger = page.getByRole('button', { name: 'More actions for Bryn' });
      await trigger.click();
      const menu = page.getByRole('menu', { name: 'More actions for Bryn' });
      await menu.waitFor();
      expect(await axe(page)).toEqual([]);
      await menu.getByRole('menuitem', { name: 'Edit' }).click();
      const dialog = page.getByRole('dialog', { name: 'Edit Member' });
      await dialog.waitFor();
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      expect(await trigger.evaluate((el) => el === document.activeElement)).toBe(true);
    } finally {
      await context.close();
    }
  });

  it('opens on screen from a row at the bottom of the window, with its first item focused', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix/roster',
      sentinel: 'table.roster-table .name-only-row',
      session: OFFICER,
      who: 'officer',
      tables: rosterWithNames()
    });
    try {
      const trigger = page.getByRole('button', { name: 'More actions for Mirelle' });
      // The row's button just above the bottom edge, its scroll settled, then
      // opened from the keyboard: Playwright's own click nudges the page and
      // its late scroll event would close the menu whatever the page does.
      await trigger.evaluate((el) => {
        const box = el.getBoundingClientRect();
        window.scrollBy(0, box.bottom - window.innerHeight + 8);
      });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await trigger.focus();
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu', { name: 'More actions for Mirelle' });
      // Still open once the click has settled, not opened and closed again.
      await page.waitForTimeout(300);
      expect(await menu.count()).toBe(1);
      const box = await menu.boundingBox();
      const height = page.viewportSize().height;
      expect(box.y >= 0 && box.y + box.height <= height).toBe(true);
      expect(await menu.getByRole('menuitem', { name: 'Edit' }).evaluate((el) => el === document.activeElement)).toBe(
        true
      );
    } finally {
      await context.close();
    }
  });
});

describe('reduced motion', () => {
  // A pair, like tests/browser/reduced-motion.test.js: "nothing moves" is as
  // true of a page with no motion at all as of a working media query, so the
  // default setting has to show motion for the reduced one to mean anything.
  async function movingElements(reducedMotion) {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/t/phoenix',
      session: BATTLENET_ONLY,
      who: 'battlenetOnly',
      sentinel: 'text=Connect your Discord',
      reducedMotion
    });
    try {
      await page.getByRole('button', { name: 'Already use WGA Raid Hub with Discord?' }).click();
      await page.getByRole('dialog').waitFor();
      return await page.evaluate(() => {
        const seconds = (value) =>
          Math.max(
            ...value.split(',').map((part) => (part.trim().endsWith('ms') ? parseFloat(part) / 1000 : parseFloat(part)))
          );
        return Array.from(document.querySelectorAll('*'))
          .map((el) => {
            const style = getComputedStyle(el);
            return {
              el: String(el.className || el.tagName),
              t: seconds(style.transitionDuration),
              a: seconds(style.animationDuration)
            };
          })
          .filter(({ t, a }) => t > 0.02 || a > 0.02)
          .map(({ el }) => el);
      });
    } finally {
      await context.close();
    }
  }

  it('animates the dialog and nav by default', async () => {
    const moving = await movingElements('no-preference');
    expect(moving).toContain('dialog');
    expect(moving.some((el) => el.includes('nav-item'))).toBe(true);
  });

  it('runs no transition or animation longer than a frame when the system asks for less motion', async () => {
    expect(await movingElements('reduce')).toEqual([]);
  });
});

// Help's guide pictures (#1526): each guide with a picture is one of the
// states above, with a numbered marker on what each step points at (null: a
// step with nothing on that screen). `npm run help:shots` retakes them all
// after a page changes; a normal run skips this block.
// The raider every picture shows is Kat (her ask, 2026-10-15: "always"), on
// the same made-up season of loot and attendance.
// Any picture state signed in as a raider, made into Kat: her character on the
// page, in the sidebar's account box and in the session. The class's tier
// tokens follow only on a plain profile (the wishlist keeps its own items).
const asKat = (state, { tierTokens = true } = {}) => {
  const kat = {
    ...state.tables.players[0],
    name_realm: 'Katorrí-Stormrage',
    nickname: '',
    classes_specs: { class: 'Warlock', spec: 'Demonology', role: 'Ranged' }
  };
  // The sidebar's account box names her too, not the fixture's raider.
  const team = state.person.person.teams[0];
  const person = {
    ...state.person,
    person: {
      ...state.person.person,
      teams: [{ ...team, characters: [{ ...team.characters[0], name_realm: kat.name_realm }] }]
    }
  };
  return {
    ...state,
    person,
    session: storedSession({ battlenet: 'Katorrí#1', discord: 'Katorrí' }),
    tables: {
      ...state.tables,
      players: [kat],
      ...(tierTokens ? { tier_token_map: TIER_TOKEN_MAP.filter((r) => r.class === 'Warlock') } : {})
    }
  };
};
const katProfile = () => asKat(profileState('', 'torbjorn', 'torbjorn'));

const HELP_SHOT_STATES = {
  'team-setup': {
    state: SETTINGS_GENERAL,
    markers: [null, '#wcl-url-input'],
    frame: '.settings-cards > :has(#wcl-url-input)'
  },
  'what-you-got': {
    state: asKat(
      profileState('', 'torbjorn', 'torbjorn', { path: '/g/wga/t/phoenix/me/loot', sentinel: 'main .loot-table' })
    ),
    markers: [null, '#profile-tab-loot', '.loot-table'],
    viewport: { width: 700, height: 900 }
  },
  rsvp: {
    state: { ...CAL_NIGHT_PAGE, sentinel: 'main .own-answer:visible' },
    markers: [null, '.own-answer:visible fieldset', '.own-answer:visible button[type="submit"]'],
    frame: '.own-answer:visible'
  },
  bench: { state: CAL_OWN_BOSSES, markers: [null, '.your-bosses:visible h2', null], frame: '.your-bosses:visible' },
  'boss-groups': {
    state: BOSS_GROUPS,
    markers: [null, '.lineup-toggle', 'role=button[name="Save groups"]'],
    frame: 'table:has(.lineup-toggle)',
    viewport: { width: 700, height: 900 }
  },
  lineup: {
    state: CAL_LINEUP,
    markers: [null, 'role=link[name="Boss lineup"]', null, '.lineup-toggle', 'role=button[name="Save tonight"]'],
    frame: 'main .night-tabs',
    viewport: { width: 700, height: 900 }
  },
  'create-guild': {
    state: NEW_GUILD,
    markers: [null, '.front-form input >> nth=0', 'role=button[name="Create guild"]']
  },
  wishlist: {
    // Editing open, so the marks are buttons rather than read-only.
    state: asKat(
      wishlistEditorState('', {
        tables: { team_seasons: [{ season_code: SEASON.code, wishlist_open: true }] }
      }),
      { tierTokens: false }
    ),
    markers: [null, '.wishlist-slot-tab[data-slot="Finger 2"]', '.mark-bis'],
    frame: 'main .card:has(.wishlist-slot-tabs)'
  },
  priority: {
    state: katProfile(),
    markers: [null, '#priority-title', '#attendance-title'],
    viewport: { width: 700, height: 900 }
  },
  received: {
    state: katProfile(),
    markers: ['.priority-table tbody tr:nth-child(2) button', null, null],
    // The table's own box, not the wider table it scrolls, and a window wide
    // enough that the table doesn't scroll at all.
    frame: '.card:has(.priority-table)',
    viewport: { width: 700, height: 900 }
  },
  'add-team': {
    state: { ...GUILD_SETTINGS, session: storedSession({ battlenet: 'Katorrí#1', discord: 'Katorrí' }) },
    markers: [
      null,
      null,
      'role=button[name="Rename Phoenix"]',
      '.guildsettings-row:has-text("Sandbox") .guildsettings-team'
    ],
    frame: 'main .guildsettings-list'
  },
  attendance: {
    state: ATTENDANCE_MANAGE,
    markers: [
      null,
      'role=button[name="Refresh from WCL"]',
      '#attend-night-select',
      'role=button[name="Commit Attendance Scores"]'
    ]
  }
};

// A guide whose step 1 opens a page from the sidebar also gets a small picture
// of that part of the sidebar, with an orange 1 on the item (Kat, 2026-10-15),
// one per item (guide.ts MENUS), shared by every guide that starts there:
// menu-<item>.png. The state opens the page itself, so its Officer group is
// already open.
const katOnPage = (path, sentinel = 'main h1') => ({ ...katProfile(), path, sentinel });
const HELP_MENU_SHOTS = {
  // Signed out: the button at the bottom of the sidebar. Nobody live, so the
  // sidebar's live count isn't mistaken for a marker.
  'sign-in': {
    state: {
      path: '/g/wga/t/phoenix',
      sentinel: 'main:has(.home-loot-table)',
      tables: { ...HOME_TABLES, streamers: [] },
      clock: TODAY
    },
    item: '.sidebar >> role=button[name="Sign in with Battle.net"]'
  },
  'officer-settings': { state: SETTINGS_GENERAL, item: '.sidebar >> text="Settings"' },
  'officer-invite': {
    state: { session: OFFICER, who: 'officer', path: '/g/wga/t/phoenix/officer/invite', sentinel: '.sidebar' },
    item: '.sidebar >> role=link[name="Invite link"]'
  },
  roster: { state: katOnPage('/g/wga/t/phoenix/roster', '.sidebar'), item: '.sidebar >> role=link[name="Roster"]' },
  'my-profile': { state: katProfile(), item: '.sidebar >> role=link[name="My profile"]' },
  calendar: { state: CAL_MONTH, item: '.sidebar >> role=link[name="Calendar"]' },
  'officer-boss-groups': { state: BOSS_GROUPS, item: '.sidebar >> role=link[name="Boss groups"]' },
  'officer-manage': { state: ATTENDANCE_MANAGE, item: '.sidebar >> role=link[name="Manage"]' },
  // The team picker open, as a guild officer sees it (#1644).
  'new-team': {
    state: {
      ...GUILD_SETTINGS,
      click: '.sidebar >> role=button[name=/switch team/]',
      afterClick: '.team-list:not([hidden])'
    },
    item: '.sidebar >> role=button[name="New team"]'
  }
};

// A guide whose step happens in a pop-up also gets a picture of the pop-up,
// open over the page (Kat, 2026-10-15), saved as <id>-popup.png. Same shape
// as HELP_SHOT_STATES; its markers number the guide's steps the same way.
const HELP_POPUP_SHOTS = {
  'add-team': {
    state: { ...GUILD_SETTINGS, click: 'main >> role=button[name="New team"]', afterClick: '[role="dialog"]' },
    markers: [null, '[role="dialog"] input', null, null],
    frame: '.dialog',
    viewport: { width: 1000, height: 900 }
  },
  received: {
    state: {
      ...katProfile(),
      click: '.priority-table tbody tr:nth-child(2) button',
      afterClick: '[role="dialog"]'
    },
    markers: [null, '[role="dialog"] select >> nth=0', null],
    frame: '.dialog',
    viewport: { width: 1000, height: 900 }
  }
};

// The step list's orange numbers (guide.ts `marked`) are the steps the picture
// marks, so a raider can match them up. Runs every time, unlike the pictures.
describe('help guide picture markers', () => {
  it('numbers the same steps orange in the text as on each picture', () => {
    for (const [id, { markers }] of Object.entries(HELP_SHOT_STATES)) {
      const guide = GUIDES.find((g) => g.id === id);
      const popup = HELP_POPUP_SHOTS[id]?.markers ?? [];
      const marked = markers.flatMap((m, i) => (m || popup[i] || (i === 0 && guide?.menu) ? [i + 1] : []));
      expect(guide?.marked, id).toEqual(marked);
      expect(guide.steps, id).toHaveLength(markers.length);
      // Step 1 is on the sidebar picture, so the page picture never has a 1 too.
      if (guide.menu) expect(markers[0], `${id}: a second 1`).toBeNull();
    }
    for (const guide of GUIDES.filter((g) => g.picture)) expect(HELP_SHOT_STATES[guide.id], guide.id).toBeDefined();
    // Every sidebar item has its picture, and every picture is used.
    const menus = new Set(GUIDES.flatMap((g) => (g.menu ? [g.menu] : [])));
    expect([...menus].sort()).toEqual(Object.keys(HELP_MENU_SHOTS).sort());
    for (const guide of GUIDES.filter((g) => g.menu && !HELP_SHOT_STATES[g.id] && !HELP_POPUP_SHOTS[g.id])) {
      expect(guide.marked, guide.id).toEqual([1]);
    }
    for (const guide of GUIDES.filter((g) => g.popup)) expect(HELP_POPUP_SHOTS[guide.id], guide.id).toBeDefined();
    for (const id of Object.keys(HELP_POPUP_SHOTS)) expect(GUIDES.find((g) => g.id === id)?.popup, id).toBeTruthy();
  });
});

describe.runIf(process.env.HELP_SHOTS)('help guide pictures', () => {
  const pictures = [
    ...Object.entries(HELP_SHOT_STATES),
    ...Object.entries(HELP_POPUP_SHOTS).map(([id, shot]) => [`${id}-popup`, shot])
  ];
  for (const [id, { state, markers, frame, minWidth = 0, pad = 40, viewport }] of pictures) {
    it(`takes ${id}`, async () => {
      const { context, page } = await openApp(browser, server.port, {
        ...state,
        // Twice the pixels, on a window just wide enough to keep the sidebar,
        // so a picture is close to the size the guide panel shows it at.
        scale: 2,
        viewport: viewport ?? { width: 1000, height: 800 }
      });
      try {
        // The floating streams box would sit over the page.
        await page.addStyleTag({ content: '.stream-widget { display: none !important; }' });
        const boxes = [];
        for (const [i, selector] of markers.entries()) {
          if (!selector) continue;
          const target = page.locator(selector).first();
          await target.scrollIntoViewIfNeeded();
          const box = await target.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
          });
          boxes.push({ n: i + 1, ...box });
        }
        // The frame, when given, is in the picture too, so it shows the whole
        // panel or table rather than just around the markers.
        const frameBox = frame
          ? await page
              .locator(frame)
              .first()
              .evaluate((el) => {
                const r = el.getBoundingClientRect();
                return { x: r.x + window.scrollX, y: r.y + window.scrollY, w: r.width, h: r.height };
              })
          : null;
        const area = frameBox ? [...boxes, frameBox] : boxes;
        await page.evaluate((list) => {
          // A wide target (a heading, a field) gets its marker just left of
          // it; a small one (a button, a tab) on its top-right corner. Either
          // way the marker never covers the words.
          for (const { n, x, y, w, h } of list) {
            const wide = w > 240 && x >= 36;
            const dot = document.createElement('div');
            dot.textContent = String(n);
            Object.assign(dot.style, {
              position: 'absolute',
              left: `${wide ? x - 34 : x + w - 13}px`,
              top: `${wide ? y + h / 2 - 13 : y - 13}px`,
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#f2703f',
              color: '#10141a',
              font: '700 14px/26px system-ui, sans-serif',
              textAlign: 'center',
              boxShadow: '0 0 0 3px #0b0e13',
              zIndex: '9999'
            });
            document.body.append(dot);
          }
        }, boxes);
        // Just the part of the page the steps point at, so it reads at the
        // guide panel's size.
        const page_ = await page.evaluate(() => ({
          w: document.documentElement.scrollWidth,
          h: document.documentElement.scrollHeight
        }));
        let x0 = Math.min(...area.map((b) => b.x)) - pad;
        let x1 = Math.max(...area.map((b) => b.x + b.w)) + pad;
        const y0 = Math.max(0, Math.min(...area.map((b) => b.y)) - pad);
        const y1 = Math.min(page_.h, Math.max(...area.map((b) => b.y + b.h)) + pad);
        if (x1 - x0 < minWidth) {
          const grow = (minWidth - (x1 - x0)) / 2;
          x0 -= grow;
          x1 += grow;
        }
        x0 = Math.max(0, x0);
        x1 = Math.min(page_.w, x1);
        await page.screenshot({
          path: `${DIST}/../public/help-shots/${id}.png`,
          fullPage: true,
          clip: { x: x0, y: y0, width: x1 - x0, height: Math.max(y1 - y0, 240) }
        });
      } finally {
        await context.close();
      }
    });
  }
  for (const [id, { state, item }] of Object.entries(HELP_MENU_SHOTS)) {
    it(`takes ${id}'s sidebar`, async () => {
      const { context, page } = await openApp(browser, server.port, {
        ...state,
        scale: 2,
        viewport: { width: 1000, height: 900 }
      });
      try {
        await page.addStyleTag({ content: '.stream-widget { display: none !important; }' });
        const target = page.locator(item).first();
        await target.scrollIntoViewIfNeeded();
        const box = await target.boundingBox();
        const side = await page.locator('.sidebar').boundingBox();
        const button = await target.evaluate((el) => el.tagName === 'BUTTON');
        await page.evaluate(
          ({ x, y, w, button }) => {
            const dot = document.createElement('div');
            dot.textContent = '1';
            Object.assign(dot.style, {
              position: 'fixed',
              // Just past the item's name, so it never covers the word.
              // A link: just past its name. A button: on its top-right corner.
              // Either way it never covers the words.
              left: `${button ? x + w - 20 : x + w + 6}px`,
              top: `${button ? y - 13 : y + 5}px`,
              width: '26px',
              height: '26px',
              borderRadius: '50%',
              background: '#f2703f',
              color: '#10141a',
              font: '700 14px/26px system-ui, sans-serif',
              textAlign: 'center',
              boxShadow: '0 0 0 3px #0b0e13',
              zIndex: '9999'
            });
            document.body.append(dot);
          },
          { x: box.x, y: box.y, w: button ? box.width : Math.min(box.width, 150), button }
        );
        // The sidebar around the item: its group above it, a little below.
        const y0 = Math.max(0, box.y - 150);
        await page.screenshot({
          path: `${DIST}/../public/help-shots/menu-${id}.png`,
          clip: { x: 0, y: y0, width: side.width, height: Math.min(box.y + box.height + 60, 900) - y0 }
        });
      } finally {
        await context.close();
      }
    });
  }
});

// The front page's pictures (#1226), taken with the Help guides' by
// `npm run help:shots`: a strip of the real page for each raid-week card
// (front-shots/<card>.png), and the link preview Discord shows for a pasted
// address (og-banner.png, 1200x630: the front page's hero on its own).
// `frame`: the part of the page shown, from its left edge; `at`, when given,
// where the picture starts down the page, so it shows the page's working part
// rather than its title (Kat, 2026-10-17).
const FRONT_SHOTS = {
  'before-raid': { state: CAL_MONTH, frame: '.month-grid-card', at: '.month-grid-card .night-chip' },
  'raid-night': { state: katProfile(), frame: '.card:has(.priority-table)', at: '.priority-table thead' },
  'after-raid': {
    state: { ...REPORT, path: '/g/wga/t/phoenix/officer/reports/loot-fairness' },
    frame: '.card.fairness'
  },
  'across-the-guild': { state: GUILD, frame: 'main', at: '.guild-team' }
};
const FRONT_FILLED = { ...FRONT, news: NEWS_ENTRIES, tables: { seasons: REPORT_TABLES.seasons } };

describe.runIf(process.env.HELP_SHOTS)('front page pictures', () => {
  for (const [id, { state, frame, at }] of Object.entries(FRONT_SHOTS)) {
    it(`takes ${id}`, async () => {
      const { context, page } = await openApp(browser, server.port, {
        ...state,
        scale: 2,
        viewport: { width: 1000, height: 800 }
      });
      try {
        await page.addStyleTag({ content: '.stream-widget { display: none !important; }' });
        // A window a little wider than a card, so the words stay sharp
        // rather than shrunk and blurry.
        const box = await page.locator(frame).first().boundingBox();
        const y = at ? (await page.locator(at).first().boundingBox()).y - 12 : box.y;
        await page.screenshot({
          path: `${DIST}/../public/front-shots/${id}.png`,
          fullPage: true,
          clip: { x: box.x, y: Math.max(box.y, y), width: Math.min(box.width, 600), height: 214 }
        });
      } finally {
        await context.close();
      }
    });
  }
  it('takes the link preview', async () => {
    const { context, page } = await openApp(browser, server.port, {
      ...FRONT_FILLED,
      viewport: { width: 1200, height: 630 }
    });
    try {
      // Just the hero, filling the picture: no sidebar, top bar or prompt.
      await page.addStyleTag({
        content: `.sidebar, .topbar, .connect-card, .stream-widget { display: none !important; }
          .shell { display: block !important; }
          .content { padding: 28px 56px !important; }
          .front-hero { border-bottom: 0; }
          .front-home > :not(.front-hero) { display: none !important; }`
      });
      await page.screenshot({ path: `${DIST}/../public/og-banner.png` });
    } finally {
      await context.close();
    }
  });
});
