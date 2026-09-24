import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, fixture, storedDiscordSession, REPO_ROOT } from './harness.js';
import { VIEWERS } from '../behavior/profile.js';
import {
  EXPECTED_EDITOR,
  ITEMS,
  NEW_BIS_ROW,
  RAID_ZONES,
  SEASON,
  TIER_TOKEN_MAP,
  TORBJORN,
  WISHLIST
} from '../behavior/wishlist.js';

// My Wishlist as the current site shows it (#868 part 3), recorded so the new
// app's wishlist editor can be checked against the same expectations
// (tests/behavior/wishlist.js).

const settings = () =>
  fixture('team_settings', []).map((row) => ({
    ...row,
    config: {
      ...row.config,
      seasonView: null
    }
  }));

// The live tier is the seasons read (#938): SEASON as the one started tier.
const SEASONS = [{ code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start, ends_at: SEASON.end }];

// Wishlist editing is a switch per tier (#939): the team_seasons row for the
// tier the wishlist is stamped with, here the live season.
const teamSeasons = (open) => [{ team_id: 1, season_code: SEASON.code, wishlist_open: open }];

function openWishlist({ open = true, allowed = false, seasons = SEASONS } = {}) {
  const viewer = VIEWERS.torbjorn;
  const own = { ...TORBJORN, wishlist_allowed: allowed };
  return openState(
    browser,
    server.port,
    {
      label: 'Torbjorn’s wishlist',
      path: '/index.html?team=phoenix#profile/Torbjorn',
      sentinel: 'body',
      session: storedDiscordSession({ userId: viewer.userId, discordId: viewer.discordId, name: own.name_realm })
    },
    {
      players: [own],
      team_members: [{ id: viewer.teamMember, role: viewer.role, name_realm: own.name_realm }],
      team_settings: settings(),
      seasons,
      team_seasons: teamSeasons(open),
      attendance: [],
      rclc_loot: [],
      items: ITEMS,
      raid_zones: RAID_ZONES,
      player_equipped_gear: [],
      mplus_exclusion_requests: [],
      incoming_roster: [],
      item_preferences: WISHLIST,
      self_received_requests: [],
      priority_order: [],
      tier_token_map: TIER_TOKEN_MAP,
      rpc: { is_site_admin: false, is_guild_officer: false, team_season_start: SEASON.start }
    }
  );
}

// Opens the Wishlist sub-tab with every slot card expanded. The cards open one
// at a time when clicked, so they are opened through the page's own state.
async function showEditor(page) {
  await page.waitForSelector('#profileSubTabWishlist', { timeout: 20000 });
  await page.click('#profileSubTabWishlist');
  await page.waitForSelector('#profileTabWishlist [onclick^="toggleWishlistSlot"]', { timeout: 20000 });
  await page.evaluate(() => {
    document.querySelectorAll('#profileTabWishlist [onclick^="toggleWishlistSlot"]').forEach((header) => {
      const key = /toggleWishlistSlot\('(.*)'\)/.exec(header.getAttribute('onclick'))[1];
      window._wishlistExpandedSlots[key] = true;
    });
    window.renderProfile('Torbjorn', 'landing');
  });
  await page.waitForSelector('#profileTabWishlist input[id^="wishlistNote_"]');
}

// The shape tests/behavior/wishlist.js describes, read from the slot cards.
function readEditor(page) {
  return page.evaluate(() => {
    const text = (el) => (el ? el.textContent.trim() : null);
    const LABELS = { BiS: 'bis', Pass: 'pass' };
    return [...document.querySelectorAll('#profileTabWishlist [onclick^="toggleWishlistSlot"]')]
      .map((header) => ({ key: /toggleWishlistSlot\('(.*)'\)/.exec(header.getAttribute('onclick'))[1], header }))
      .filter(({ key }) => key !== '__other__')
      .map(({ key, header }) => {
        const body = header.nextElementSibling;
        const rows = [...body.querySelectorAll('input[id^="wishlistNote_"]')].map((input) => input.parentElement);
        const entry = { slot: key, items: [], bis: [], pass: [], taken: [], notFromRaid: null };
        for (const row of rows) {
          const name = text(row.querySelector('span[style*="a335ee"]'));
          entry.items.push(name);
          const lock = [...row.children].find((c) => /^Already your (.*) BiS pick$/.test(text(c)));
          if (lock) {
            entry.taken.push({ item: name, by: /^Already your (.*) BiS pick$/.exec(text(lock))[1] });
            continue;
          }
          const active = [...row.querySelectorAll('button')].find((b) => b.style.fontWeight === '700');
          const status = active && LABELS[text(active)];
          if (status) entry[status].push(name);
        }
        const covered = [...body.querySelectorAll('p')].find((p) => text(p).startsWith('You already have'));
        entry.notFromRaid = covered ? text(covered.querySelector('strong')) : null;
        entry.items.sort();
        return entry;
      });
  });
}

// Every write the page sends to item_preferences.
function recordWrites(page) {
  const writes = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.endsWith('/rest/v1/item_preferences') || request.method() === 'GET') return;
    writes.push({
      method: request.method(),
      query: Object.fromEntries(url.searchParams),
      body: request.postData() ? JSON.parse(request.postData()) : null
    });
  });
  return writes;
}

const rowFor = (page, slot, itemName) =>
  page
    .locator('#profileTabWishlist [onclick^="toggleWishlistSlot"]', { hasText: slot })
    .locator('xpath=..')
    .locator('div', { has: page.locator('input[id^="wishlistNote_"]') })
    .filter({ hasText: itemName })
    .last();

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

describe('Wishlist (current site), what each slot offers and shows', () => {
  it('offers the raid items the raider can use, with their BiS and Pass marks', async () => {
    const opened = await openWishlist();
    try {
      await showEditor(opened.page);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Wishlist (current site), when editing is closed', () => {
  const buttonsEnabled = (page) =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('#profileTabWishlist [onclick^="wishlistSetStatus"]')].filter((b) => !b.disabled)
          .length
    );

  it('shows the marks read-only', async () => {
    const opened = await openWishlist({ open: false });
    try {
      await showEditor(opened.page);
      expect(await readEditor(opened.page)).toEqual(EXPECTED_EDITOR);
      expect(await buttonsEnabled(opened.page)).toBe(0);
    } finally {
      await opened.context.close();
    }
  });

  it('stays editable for a raider an officer allowed', async () => {
    const opened = await openWishlist({ open: false, allowed: true });
    try {
      await showEditor(opened.page);
      expect(await buttonsEnabled(opened.page)).toBeGreaterThan(0);
    } finally {
      await opened.context.close();
    }
  });
});

// The seasons read warns and returns an empty list on failure, so a transient
// failure leaves the page unable to say which tier it is planning. It shows
// everything the raider holds and goes read-only rather than narrowing to the
// picks with no season, which would look like an empty wishlist, and rather
// than letting a raider an officer allowed write a second seasonless pick
// beside one they already hold (#936).
//
// In a browser and not the sandbox on purpose: the sandbox cases assert the
// shape of the queries, and three entries in this project’s lessons are pages
// that did the wrong thing in a browser while every test agreed they were fine.
describe('Wishlist (current site), when the season did not load', () => {
  const buttonsEnabled = (page) =>
    page.evaluate(
      () =>
        [...document.querySelectorAll('#profileTabWishlist [onclick^="wishlistSetStatus"]')].filter((b) => !b.disabled)
          .length
    );
  const sectionLabels = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('#profileView .profile-section .section-label')].map((el) =>
        (el.textContent || '').trim().split('\n')[0].trim()
      )
    );

  // The marks, not the catalog. With no season resolving the raid catalog
  // widens, because an item whose zone belongs to no known season is shown
  // rather than hidden, and that fail-open predates this and is not what this
  // case is about.
  const marks = (rows) =>
    rows.map(({ slot, bis, pass, notFromRaid, taken }) => ({ slot, bis, pass, notFromRaid, taken }));

  it('shows every pick read-only, even for a raider an officer allowed', async () => {
    const opened = await openWishlist({ open: true, allowed: true, seasons: [] });
    try {
      await showEditor(opened.page);
      expect(marks(await readEditor(opened.page))).toEqual(marks(EXPECTED_EDITOR));
      expect(await buttonsEnabled(opened.page)).toBe(0);
      const note = await opened.page.evaluate(() => document.querySelector('#profileTabWishlist')?.textContent || '');
      expect(note).toContain('Wishlist editing is currently closed');
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  // The render chain past the wishlist has to finish too: a throw inside it
  // lands in a catch and truncates the page silently, which no assertion about
  // the wishlist itself can see.
  it('renders the rest of the profile, as it does with the season loaded', async () => {
    const withSeason = await openWishlist({ open: true, allowed: true });
    let expected;
    try {
      await showEditor(withSeason.page);
      expected = await sectionLabels(withSeason.page);
    } finally {
      await withSeason.context.close();
    }
    expect(expected.length).toBeGreaterThan(1);

    const opened = await openWishlist({ open: true, allowed: true, seasons: [] });
    try {
      await showEditor(opened.page);
      expect(await sectionLabels(opened.page)).toEqual(expected);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Wishlist (current site), marking a new BiS pick', () => {
  it('saves the pick and keeps the ring it replaces as 2nd Choice', async () => {
    const opened = await openWishlist();
    try {
      await showEditor(opened.page);
      const writes = recordWrites(opened.page);
      await rowFor(opened.page, 'Finger 1', 'Signet of Coiled Ash').getByRole('button', { name: 'BiS' }).click();
      await expect.poll(() => writes.filter((w) => w.method === 'POST').length).toBe(1);

      const insert = writes.find((w) => w.method === 'POST');
      expect(insert.body).toMatchObject(NEW_BIS_ROW);

      // The current site's own rule, which the new app drops (#1032).
      await expect
        .poll(() =>
          writes.some(
            (w) =>
              w.method === 'PATCH' &&
              w.query.item_id === 'eq.1008' &&
              w.query.slot === 'eq.Finger 1' &&
              w.body.status === 'good'
          )
        )
        .toBe(true);
    } finally {
      await opened.context.close();
    }
  });
});
