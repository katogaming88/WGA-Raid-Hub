import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, fixture, REPO_ROOT } from './harness.js';
import {
  SCENARIO,
  SEASON,
  CURRENT_STAT_LABELS,
  expectedStats,
  EXPECTED_FEED,
  EXPECTED_SEARCH,
  SEARCH,
  NO_MATCH
} from '../behavior/home.js';

// The landing view as the current site shows it -- the stats row and the
// recent loot feed -- recorded so the new app's Home page can be checked
// against the same expectations (tests/behavior/home.js, #1102 step 1).

const overrides = (loot = SCENARIO.loot) => ({
  players: SCENARIO.players,
  rclc_loot: loot,
  team_settings: fixture('team_settings', []).map((r) => ({ ...r, config: { ...r.config, seasonName: SEASON.name } }))
});

const STATE = {
  label: 'index-landing',
  path: '/index.html?team=phoenix',
  sentinel: '#landingLoot .pub-loot-row'
};

function readStats(page) {
  return page.locator('#landingStats .pub-stat').evaluateAll((els) =>
    els.map((el) => ({
      label: el.querySelector('.pub-stat-label').textContent.trim(),
      value: Number(el.querySelector('.pub-stat-num').textContent.trim())
    }))
  );
}

// The feed, as tests/behavior/home.js describes it.
function readFeed(page) {
  return page.locator('#landingLoot .pub-loot-row').evaluateAll((els) =>
    els.map((el) => {
      const item = el.querySelector('.pub-loot-item');
      const tag = item.querySelector('.loot-offspec-tag');
      if (tag) tag.remove();
      return {
        player: el.querySelector('.pub-loot-player').textContent.trim(),
        item: item.textContent.trim(),
        difficulty: el.querySelector('.pub-loot-diff').textContent.trim(),
        date: el.querySelector('.pub-loot-date').textContent.trim(),
        offSpec: tag !== null
      };
    })
  );
}

async function search(page, query) {
  const box = page.locator('#lootSearchInput');
  await box.fill(query);
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

describe('Home (current site): stats row and recent loot', () => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, STATE, overrides());
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('counts the raiders on the roster and this season’s items', async () => {
    expect(await readStats(opened.page)).toEqual(expectedStats(CURRENT_STAT_LABELS));
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
    await expect(opened.page.locator('#landingLoot .pub-loot-empty').textContent()).resolves.toBe(NO_MATCH.message);
  });

  it('goes back to the preview when the search is cleared', async () => {
    await search(opened.page, '');
    expect(await readFeed(opened.page)).toEqual(EXPECTED_FEED);
  });
});
