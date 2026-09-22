import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, fixture, storedDiscordSession, REPO_ROOT } from './harness.js';
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

// The player profile as the current site shows it (#868 part 1), recorded so
// the new app's profile can be checked against the same expectations
// (tests/behavior/profile.js).

const settings = () =>
  fixture('team_settings', []).map((row) => ({
    ...row,
    config: {
      ...row.config,
      seasonStart: SEASON.start,
      seasonEnd: SEASON.end,
      seasonView: null
    }
  }));

// The live tier is the seasons read (#938): SEASON as the one started tier.
const SEASONS = [{ code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start, ends_at: SEASON.end }];

// The reads a page makes, answered as the database would for `viewer` (or for
// no one): the viewer's own character first, since the session looks it up
// with maybeSingle(), and M+ requests only for an officer, who alone may read
// them.
function overridesFor(viewer) {
  const own = viewer ? PLAYERS.find((p) => p.id === viewer.player.id) : null;
  return {
    players: own ? [own, ...PLAYERS.filter((p) => p !== own)] : PLAYERS,
    team_members: viewer ? [{ id: viewer.teamMember, role: viewer.role, name_realm: viewer.player.name_realm }] : [],
    team_settings: settings(),
    seasons: SEASONS,
    attendance: ATTENDANCE,
    rclc_loot: LOOT,
    items: PRIORITY_ITEMS,
    raid_zones: RAID_ZONES,
    player_equipped_gear: GEAR,
    mplus_exclusion_requests: viewer?.role === 'officer' ? MPLUS_REJECTIONS : [],
    incoming_roster: [],
    // A raider reads only their own wishlist and receipts; an officer reads the team's.
    item_preferences: viewer ? WISHLIST : [],
    self_received_requests: viewer ? SELF_RECEIVED : [],
    priority_order: PRIORITY_ORDER,
    tier_token_map: TIER_TOKEN_MAP,
    rpc: { is_site_admin: false, is_guild_officer: false }
  };
}

const openProfile = (viewerKey, firstName) => {
  const viewer = viewerKey ? VIEWERS[viewerKey] : null;
  return openState(
    browser,
    server.port,
    {
      label: `profile ${firstName} as ${viewerKey ?? 'visitor'}`,
      path: `/index.html?team=phoenix#profile/${firstName}`,
      sentinel: 'body',
      ...(viewer
        ? {
            session: storedDiscordSession({
              userId: viewer.userId,
              discordId: viewer.discordId,
              name: viewer.player.name_realm
            })
          }
        : {})
    },
    overridesFor(viewer)
  );
};

// Waits for the deep link to settle. An allowed viewer gets the profile. For a
// refused one, the page drops the #profile hash once the sign-in check is done;
// the hash can also flicker during boot, so the check waits for the page's
// reads to finish before counting.
async function opens(page) {
  await page.waitForSelector('#profileView .profile-name', { timeout: 20000 });
  return true;
}

async function staysClosed(page) {
  await page.waitForFunction(() => !location.hash.includes('profile'), null, { timeout: 20000 });
  await page.waitForLoadState('networkidle');
  return (await page.locator('#profileView .profile-name').count()) === 0;
}

function readProfile(page) {
  return page.evaluate(() => {
    const root = document.getElementById('profileView');
    const text = (el) => (el ? el.textContent.trim() : null);
    const section = (label) =>
      [...root.querySelectorAll('.profile-section')].find((s) =>
        text(s.querySelector('.section-label'))?.startsWith(label)
      );

    const badges = [...root.querySelectorAll('.profile-badges .badge')];
    const joinedEl = [...root.querySelectorAll('.profile-identity div')].find((d) =>
      d.textContent.startsWith('Joined: ')
    );
    const link = (label) => root.querySelector(`.profile-links a[aria-label="${label}"]`)?.getAttribute('href') ?? null;

    const attendSection = section('Attendance');
    const flagged = [...(attendSection.querySelector('[id^="attend-detail-"]')?.children ?? [])].map((row) => ({
      date: text(row.children[0]),
      status: text(row.children[1])
    }));

    const lootSection = section('Items Received');
    const summary = /^(\d+) items? — (.*)$/.exec(text(lootSection.children[1]));
    // The "Last received" box is only there when something was received.
    const lastBox = lootSection.children[2]?.id?.startsWith('loot-list-') ? null : lootSection.children[2];
    const lastInner = lastBox?.firstElementChild;
    const last = lastInner
      ? {
          date: text(lastInner.firstElementChild).replace(/^Last received - /, ''),
          items: [...lastInner.children].slice(1).map((d) => ({
            name: text(d.children[0]),
            difficulty: text(d.children[1])
          }))
        }
      : null;
    const all = [...lootSection.querySelector('[id^="loot-list-"]').children].map((d) => {
      const sub = text(d.querySelector('div')).split(' - ');
      return { name: d.firstChild.textContent.trim(), difficulty: sub[sub.length - 2], date: sub[sub.length - 1] };
    });

    const gearSection = section('Equipped Gear');
    const gear = gearSection
      ? [...gearSection.children].slice(1).map((row) => {
          const [slotEl, valueEl] = row.children;
          const spans = valueEl.querySelectorAll('span');
          return {
            slot: text(slotEl),
            item: valueEl.firstChild.textContent.trim(),
            itemLevel: spans[0] ? Number(text(spans[0])) : null,
            track: spans[1] ? text(spans[1]).replace(/^\((.*)\)$/, '$1') : null
          };
        })
      : [];

    const mplusSection = section('M+ Exclusion');
    const mplusBadge = mplusSection?.querySelector('.signup-status-badge');
    const mplusNote = mplusBadge
      ? [...mplusSection.querySelectorAll('div')].find((d) => d.style.fontStyle === 'italic')
      : null;

    return {
      name: text(root.querySelector('.profile-name')),
      character: text(root.querySelector('.profile-realm')),
      role: text(badges[0]),
      spec: text(root.querySelector('.profile-badges .badge-class')),
      tags: badges
        .slice(1)
        .filter((b) => !b.classList.contains('badge-class') && b.textContent !== 'Fully BiS')
        .map((b) => text(b)),
      joined: joinedEl ? joinedEl.textContent.replace('Joined: ', '').trim() : null,
      links: { warcraftLogs: link('WarcraftLogs'), raiderIo: link('Raider.IO'), armory: link('Armory') },
      attendance: { pct: text(attendSection.querySelector('.attend-label')), flagged },
      loot: {
        count: Number(summary[1]),
        season: summary[2],
        last,
        all
      },
      gear,
      mplus: mplusBadge ? { status: text(mplusBadge), note: text(mplusNote) } : null
    };
  });
}

let server;
let browser;

beforeAll(async () => {
  server = await startServer(REPO_ROOT);
  browser = await launchBrowser();
});

afterAll(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

describe('Profile (current site), the raider’s own', () => {
  let opened;

  beforeAll(async () => {
    opened = await openProfile('torbjorn', 'Torbjorn');
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('opens, and shows the header, attendance, items received, equipped gear and M+ status', async () => {
    expect(await opens(opened.page)).toBe(true);
    const profile = await readProfile(opened.page);
    expect({ ...profile, loot: sortedLoot(profile.loot) }).toEqual({
      ...EXPECTED_TORBJORN,
      loot: sortedLoot(EXPECTED_TORBJORN.loot)
    });
    expect(opened.pageErrors).toEqual([]);
  });
});

describe('Profile (current site), who may open it', () => {
  it('does not open for a visitor who is not signed in', async () => {
    const opened = await openProfile(null, 'Torbjorn');
    try {
      expect(await staysClosed(opened.page)).toBe(true);
    } finally {
      await opened.context.close();
    }
  });

  it('does not open another raider’s profile for a raider', async () => {
    const opened = await openProfile('dodgey', 'Torbjorn');
    try {
      expect(await staysClosed(opened.page)).toBe(true);
    } finally {
      await opened.context.close();
    }
  });

  it('opens any raider’s profile for an officer, with an M+ refusal the raider cannot see', async () => {
    const opened = await openProfile('officer', 'Dodgey');
    try {
      expect(await opens(opened.page)).toBe(true);
      expect((await readProfile(opened.page)).mplus).toEqual(EXPECTED_DODGEY_MPLUS_FOR_OFFICER);
    } finally {
      await opened.context.close();
    }
  });
});

// The BiS List rows, as tests/behavior/profile.js describes the loot priority.
function readPriority(page, firstName) {
  return page.evaluate((name) => {
    const text = (el) => (el ? el.textContent.trim() : null);
    const TRACK = { H: 'Heroic', M: 'Mythic', N: 'Normal' };
    return [...document.querySelectorAll(`#prio-list-${name} .priority-row[id^="bisrow-"]`)].map((row) => {
      const itemEl = row.querySelector('.priority-item-name');
      const item = itemEl.firstChild.textContent.trim();
      const isPlaceholder = ['M+', 'Crafted', 'Catalyst'].includes(item);
      const ranks = [...row.querySelectorAll('.rank-pill')].map((pill) => {
        const [pos, letter] = text(pill).split(' ');
        return { track: TRACK[letter], rank: Number(pos) };
      });
      const badge = row.querySelector('.bis-received-badge');
      return {
        slot: isPlaceholder ? null : text(row.querySelector('.priority-item-slot')),
        item,
        ranks,
        received: badge ? { track: TRACK[text(badge)] ?? text(badge), detail: text(badge.nextElementSibling) } : null
      };
    });
  }, firstName);
}

describe('Profile (current site), loot priority', () => {
  it('lists this season’s BiS picks with their ranks and what was already received', async () => {
    const opened = await openProfile('torbjorn', 'Torbjorn');
    try {
      expect(await opens(opened.page)).toBe(true);
      // The wishlist loads after the first render and the list is drawn again.
      await opened.page.waitForFunction(
        () => document.querySelectorAll('#prio-list-Torbjorn .priority-row[id^="bisrow-"]').length > 0,
        null,
        { timeout: 20000 }
      );
      expect(await readPriority(opened.page, 'Torbjorn')).toEqual(EXPECTED_PRIORITY);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});
