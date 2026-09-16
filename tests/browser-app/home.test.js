import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp } from './harness.js';
import {
  SCENARIO,
  SEASON,
  NEW_STAT_LABELS,
  expectedStats,
  EXPECTED_FEED,
  EXPECTED_SEARCH,
  SEARCH,
  NO_MATCH
} from '../behavior/home.js';

// The new app's Home page -- the stats row and the recent loot feed -- against
// the behavior recorded from the current site's landing view
// (tests/browser/home-recorded.test.js, #1102 step 1).

const STATE = {
  path: '/g/wga/t/phoenix',
  sentinel: '.home-loot-table tbody tr',
  tables: {
    players: SCENARIO.players,
    rclc_loot: SCENARIO.loot,
    team_settings: [{ name: SEASON.name, start: null, end: null }]
  }
};

// The shapes tests/behavior/home.js describes, read from the new markup.
const readStats = (page) =>
  page.locator('.home-stat').evaluateAll((els) =>
    els.map((el) => ({
      label: el.querySelector('dt').textContent.trim(),
      value: Number(el.querySelector('dd').textContent.trim())
    }))
  );

const readFeed = (page) =>
  page.locator('.home-loot-table tbody tr').evaluateAll((els) =>
    els.map((el) => ({
      player: el.querySelector('.loot-player').textContent.trim(),
      item: el.querySelector('.loot-name').textContent.trim(),
      difficulty: el.querySelector('.difficulty').textContent.trim(),
      date: el.querySelector('.loot-date').textContent.trim(),
      offSpec: el.querySelector('.loot-offspec') !== null
    }))
  );

const search = (page, query) => page.getByRole('searchbox', { name: 'Search item name' }).fill(query);

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

describe('Home page (new app), checked against the current site', () => {
  let opened;

  beforeAll(async () => {
    opened = await openApp(browser, server.port, STATE);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('counts the raiders on the roster and this season’s items', async () => {
    expect(await readStats(opened.page)).toEqual(expectedStats(NEW_STAT_LABELS));
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('shows the ten newest awards, newest first, with the raid night’s own date', async () => {
    expect(await readFeed(opened.page)).toEqual(EXPECTED_FEED);
  });

  it('searches item names, past the ten-item preview', async () => {
    await search(opened.page, SEARCH.query);
    const rows = await readFeed(opened.page);
    expect(rows).toHaveLength(SEARCH.matches);
    expect(rows).toEqual(EXPECTED_SEARCH);
  });

  it('says so when a search matches nothing', async () => {
    await search(opened.page, NO_MATCH.query);
    await expect(opened.page.locator('.home-loot-note').textContent()).resolves.toBe(NO_MATCH.message);
    expect(await opened.page.locator('.home-loot-table').count()).toBe(0);
  });

  it('goes back to the preview when the search is cleared', async () => {
    await search(opened.page, '');
    expect(await readFeed(opened.page)).toEqual(EXPECTED_FEED);
  });
});

describe('Home page (new app), for a team with no loot yet', () => {
  it('says so instead of showing an empty table', async () => {
    const opened = await openApp(browser, server.port, {
      ...STATE,
      sentinel: '.home-loot-note',
      tables: { ...STATE.tables, rclc_loot: [] }
    });
    try {
      await expect(opened.page.locator('.home-loot-note').textContent()).resolves.toBe(
        `No loot recorded in ${SEASON.name} yet.`
      );
      expect(await opened.page.locator('.home-loot-table').count()).toBe(0);
      expect(await readStats(opened.page)).toEqual([
        { label: NEW_STAT_LABELS[0], value: 6 },
        { label: NEW_STAT_LABELS[1], value: 0 }
      ]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});
