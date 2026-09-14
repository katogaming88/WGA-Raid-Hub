import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';
import {
  ATTENDANCE,
  EXPECTED_DODGEY_MPLUS_FOR_OFFICER,
  EXPECTED_TORBJORN,
  GEAR,
  LOOT,
  MPLUS_REJECTIONS,
  PLAYERS,
  PRIORITY_ITEMS,
  PRIORITY_ORDER,
  RAID_ZONES,
  SELF_RECEIVED,
  TIER_TOKEN_MAP,
  WISHLIST,
  EXPECTED_PRIORITY,
  SEASON,
  VIEWERS,
  sortedLoot
} from '../behavior/profile.js';

// The new app's profile against the behavior recorded from the current site
// (tests/browser/profile-recorded.test.js, #868 part 1).

// resolve_person() for a viewer, and the session to go with it.
function signedIn(viewerKey) {
  const viewer = VIEWERS[viewerKey];
  const p = viewer.player;
  return {
    session: storedSession({ battlenet: `${p.name_realm}#1`, discord: p.name_realm }),
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
            characters: [{ player_id: p.id, name_realm: p.name_realm, url_code: p.url_code, archived_at: null }]
          }
        ]
      }
    }
  };
}

// The reads answered as the database would. The harness ignores filters, and
// maybeSingle() refuses more than one row, so players holds only the profile's
// own character.
function tablesFor(profilePlayer, viewerKey) {
  return {
    players: PLAYERS.filter((p) => p === profilePlayer),
    team_settings: [{ name: SEASON.name, start: SEASON.start, end: SEASON.end }],
    attendance: ATTENDANCE.filter((r) => r.player_id === profilePlayer.id),
    rclc_loot: LOOT.filter((r) => r.player_id === profilePlayer.id),
    player_equipped_gear: GEAR.filter((r) => r.player_id === profilePlayer.id),
    items: PRIORITY_ITEMS,
    raid_zones: RAID_ZONES,
    item_preferences: WISHLIST.filter((r) => r.player_id === profilePlayer.id),
    priority_order: PRIORITY_ORDER.filter((r) => r.season === SEASON.code),
    tier_token_map: TIER_TOKEN_MAP.filter((r) => r.class === profilePlayer.classes_specs.class),
    self_received_requests: SELF_RECEIVED.filter((r) => r.player_id === profilePlayer.id),
    mplus_exclusion_requests:
      VIEWERS[viewerKey]?.role === 'officer' ? MPLUS_REJECTIONS.filter((r) => r.player_id === profilePlayer.id) : []
  };
}

function open(path, viewerKey, profilePlayer) {
  return openApp(browser, server.port, {
    path,
    sentinel: 'main h1',
    tables: tablesFor(profilePlayer, viewerKey),
    ...(viewerKey ? signedIn(viewerKey) : {})
  });
}

// The shape tests/behavior/profile.js describes, read from the new markup.
// Items received sit on their own tab, so a read of the Overview leaves them
// out and the test opens that tab for them.
function readProfile(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main');
    const text = (el) => (el ? el.textContent.trim() : null);
    const card = (title) =>
      [...main.querySelectorAll('section.profile-card')].find((s) => text(s.querySelector('h2')) === title);
    const link = (site) => main.querySelector(`.profile-links a[data-site="${site}"]`)?.getAttribute('href') ?? null;

    const loot = card('Items received');
    const lastBox = loot?.querySelector('.loot-last');
    const gear = card('Equipped gear');
    const mplus = card('M+ exclusion');
    const status = mplus?.querySelector('.mplus-status');
    const attend = card('Attendance');

    return {
      name: text(main.querySelector('.profile-name')),
      character: text(main.querySelector('.profile-character')),
      role: text(main.querySelector('.profile-role')),
      spec: text(main.querySelector('.profile-spec'))?.split(' ')[0] ?? null,
      tags: [...main.querySelectorAll('.profile-tag')].map(text),
      joined: text(main.querySelector('.profile-joined'))?.replace(/^Joined /, '') ?? null,
      links: { warcraftLogs: link('warcraftLogs'), raiderIo: link('raiderIo'), armory: link('armory') },
      attendance: attend && {
        pct: text(attend.querySelector('.attendance-pct .num')),
        flagged: [...attend.querySelectorAll('.attendance-flagged li')].map((li) => ({
          date: text(li.querySelector('.flagged-date')),
          status: text(li.querySelector('.flagged-status'))
        }))
      },
      loot: loot && {
        count: Number(text(loot.querySelector('.loot-count'))),
        season: text(loot.querySelector('.loot-season')),
        last: lastBox
          ? {
              date: text(lastBox.querySelector('.loot-last-date')),
              items: [...lastBox.querySelectorAll('li')].map((li) => ({
                name: text(li.querySelector('.loot-name')),
                difficulty: text(li.querySelector('.difficulty'))
              }))
            }
          : null,
        all: [...loot.querySelectorAll('.loot-table tbody tr')].map((tr) => ({
          name: text(tr.querySelector('.loot-name')),
          difficulty: text(tr.querySelector('.difficulty')),
          date: text(tr.querySelector('.loot-date'))
        }))
      },
      gear:
        gear &&
        [...gear.querySelectorAll('tbody tr')].map((tr) => ({
          slot: text(tr.querySelector('.gear-slot')),
          item: text(tr.querySelector('.gear-item')),
          itemLevel: Number(text(tr.querySelector('.gear-level'))),
          track: text(tr.querySelector('.gear-track')) || null
        })),
      mplus: !mplus
        ? undefined
        : status
          ? { status: text(status), note: text(mplus.querySelector('.mplus-note')) }
          : null
    };
  });
}

// Waits for every card to finish loading.
async function loaded(page) {
  await page.waitForFunction(() => !document.querySelector('main .data-loading'), null, { timeout: 20000 });
}

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

const TORBJORN = VIEWERS.torbjorn.player;
const DODGEY = VIEWERS.dodgey.player;

describe('Profile (new app), the raider’s own, checked against the current site', () => {
  it('shows the header, attendance, items received, equipped gear and M+ status', async () => {
    const opened = await open('/g/wga/t/phoenix/me', 'torbjorn', TORBJORN);
    try {
      await opened.page.waitForSelector('main .profile-name');
      await loaded(opened.page);
      const overview = await readProfile(opened.page);
      await opened.page.getByRole('tab', { name: 'Loot' }).click();
      await opened.page.waitForSelector('main .loot-table');
      const { loot } = await readProfile(opened.page);
      const profile = { ...overview, loot };
      expect({ ...profile, loot: sortedLoot(profile.loot) }).toEqual({
        ...EXPECTED_TORBJORN,
        loot: sortedLoot(EXPECTED_TORBJORN.loot)
      });
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Profile (new app), who may open it', () => {
  it('does not open for a visitor who is not signed in', async () => {
    const opened = await open(`/g/wga/t/phoenix/p/${TORBJORN.url_code}`, null, TORBJORN);
    try {
      await opened.page.waitForSelector('text=Sign in to see this profile');
      await expect(opened.page.locator('main .profile-name').count()).resolves.toBe(0);
    } finally {
      await opened.context.close();
    }
  });

  it('does not open another raider’s profile for a raider', async () => {
    const opened = await open(`/g/wga/t/phoenix/p/${TORBJORN.url_code}`, 'dodgey', TORBJORN);
    try {
      await opened.page.waitForSelector('text=You can only open your own profile');
      await expect(opened.page.locator('main .profile-name').count()).resolves.toBe(0);
    } finally {
      await opened.context.close();
    }
  });

  it('opens any raider’s profile for an officer, with an M+ refusal the raider cannot see', async () => {
    const opened = await open(`/g/wga/t/phoenix/p/${DODGEY.url_code}`, 'officer', DODGEY);
    try {
      await opened.page.waitForSelector('main .profile-name');
      await opened.page.waitForSelector('main .mplus-status');
      expect((await readProfile(opened.page)).mplus).toEqual(EXPECTED_DODGEY_MPLUS_FOR_OFFICER);
    } finally {
      await opened.context.close();
    }
  });
});

// The loot priority rows, as tests/behavior/profile.js describes them.
function readPriority(page) {
  return page.evaluate(() => {
    const text = (el) => (el ? el.textContent.trim() : null);
    const standing = (cell, track) => {
      const rank = cell.querySelector('.standing .num');
      return rank ? { track, rank: Number(text(rank).replace('#', '')) } : null;
    };
    return [...document.querySelectorAll('main .priority-table tbody tr')].map((tr) => {
      const received = tr.querySelector('.received');
      return {
        slot: tr.dataset.placeholder ? null : text(tr.querySelector('.priority-slot')),
        item: text(tr.querySelector('.priority-item')),
        ranks: [
          standing(tr.querySelector('.priority-heroic'), 'Heroic'),
          standing(tr.querySelector('.priority-mythic'), 'Mythic')
        ].filter(Boolean),
        received: received
          ? {
              track: text(received.querySelector('.received-track')),
              detail: text(received.querySelector('.received-detail'))
            }
          : null
      };
    });
  });
}

describe('Profile (new app), loot priority, checked against the current site', () => {
  it('lists this season’s BiS picks with their ranks and what was already received', async () => {
    const opened = await open('/g/wga/t/phoenix/me', 'torbjorn', TORBJORN);
    try {
      await opened.page.waitForSelector('main .priority-table tbody tr');
      expect(await readPriority(opened.page)).toEqual(EXPECTED_PRIORITY);
      // What the current site does not show: how many are ranked, and the
      // crafted pick's own slot. The ring fills both ring slots, so five slots have a pick.
      const hands = opened.page.locator('main .priority-table tbody tr', { hasText: 'Deathgrips' });
      await expect(hands.locator('.priority-heroic').textContent()).resolves.toBe('#2 of 2');
      const crafted = opened.page.locator('main .priority-table tbody tr[data-placeholder]');
      await expect(crafted.locator('.priority-slot').textContent()).resolves.toBe('Wrist');
      await expect(opened.page.locator('main .wishlist-bis').textContent()).resolves.toBe('5');
      expect(opened.unexpected).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});
