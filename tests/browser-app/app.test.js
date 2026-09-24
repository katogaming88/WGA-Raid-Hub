import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';
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

const OFFICER = storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Officer' });

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
    from_player: { name_realm: fromNameRealm },
    classes_specs: { class: 'Evoker', spec: 'Preservation', role: 'Heal' }
  }
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

const GUILD = { path: '/g/wga', sentinel: 'main:has(.guild-officer)', teams: GUILD_TEAMS, tables: GUILD_TABLES };
const GUILD_OFFICER = {
  ...GUILD,
  session: OFFICER,
  who: 'officer',
  sentinel: 'main:has(.guild-attention-item)',
  tables: { ...GUILD_TABLES, ...WAITING }
};

const NEWS = { path: '/g/wga/news', sentinel: 'main:has(.news-entry)', news: NEWS_ENTRIES };

// The Streams page (#1102): the live players and the offline directory, which
// between them carry every stream card state axe should measure (#796).
const STREAMS_PAGE = {
  path: '/g/wga/streams',
  sentinel: 'main:has(.stream-card)',
  teams: STREAM_TEAMS,
  tables: { streamers: DIRECTORY }
};

const HELP = { path: '/g/wga/help', sentinel: 'main:has(.help-card)' };
const ABOUT = { path: '/g/wga/about', sentinel: 'main:has(.about-card)' };

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
  tables: { team_seasons: [{ season_code: 'MID3', signups_open: true, seasons: { starts_at: '2099-01-01' } }] }
};
const SIGNUP = { ...SIGNUP_BASE, sentinel: 'main:has(.signup-card)', rpc: { get_own_signup: [] } };
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
        submitted_at: '2026-09-01T00:00:00Z'
      }
    ]
  }
};

const STATES = [
  { label: 'help', ...HELP },
  { label: 'help, light', ...HELP, colorScheme: 'light' },
  { label: 'about', ...ABOUT },
  { label: 'about, light', ...ABOUT, colorScheme: 'light' },
  { label: 'front page', ...FRONT },
  { label: 'front page, light', ...FRONT, colorScheme: 'light' },
  { label: 'create your guild', ...NEW_GUILD },
  { label: 'create your guild, light', ...NEW_GUILD, colorScheme: 'light' },
  { label: 'guild officers', ...GUILD_OFFICERS },
  { label: 'guild officers, light', ...GUILD_OFFICERS, colorScheme: 'light' },
  { label: 'team officers', ...TEAM_OFFICERS },
  { label: 'history', ...HISTORY },
  { label: 'history, light', ...HISTORY, colorScheme: 'light' },
  { label: 'signup', ...SIGNUP },
  { label: 'signup, light', ...SIGNUP, colorScheme: 'light' },
  { label: 'signup summary', ...SIGNUP_SUMMARY },
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
  {
    label: 'calendar night, officer changing an answer',
    ...CAL_NIGHT_PAGE,
    click: '.night-row .edit-button'
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
    path: '/g/wga/t/phoenix/officer/priority',
    session: OFFICER,
    who: 'officer',
    sentinel: 'text=Not built yet'
  },
  {
    label: 'officer page, officer, light',
    path: '/g/wga/t/phoenix/officer/priority',
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
    label: 'roster, officer, alts showing',
    path: '/g/wga/t/phoenix/roster',
    sentinel: 'table.roster-table .alt-count',
    session: OFFICER,
    who: 'officer',
    tables: rosterWithAlts(),
    click: 'role=button[name="Show alts"]'
  },
  pickerState('alts picker'),
  pickerState('alts picker, light', { colorScheme: 'light' }),
  { label: 'roster', path: '/g/wga/t/phoenix/roster', sentinel: 'table.roster-table', tables: ROSTER },
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
    click: 'role=tab[name="Midnight Season 4 Roster (Tentative)"]'
  },
  {
    label: 'roster, officer, a main swap waiting',
    path: '/g/wga/t/phoenix/roster',
    sentinel: '.main-swaps',
    session: OFFICER,
    who: 'officer',
    tables: { ...rosterWithAlts(), main_swap_requests: waitingSwap(SCENARIO.players[0].name_realm) }
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
