import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, installRoutes, REPO_ROOT, DESKTOP } from './harness.js';
import {
  ENTRIES,
  EXPECTED,
  TOGGLE_OPEN,
  TOGGLE_CLOSED,
  AFTER_TOGGLES,
  NEWEST_VERSION,
  SEEN_KEY,
  EMPTY_MESSAGE
} from '../behavior/news.js';

// The News tab as the current site shows it, recorded so the new app's News
// page can be checked against the same expectations (tests/behavior/news.js,
// #1102 step 1).

// openState() goes to the page as soon as its routes are in, and news.json is
// a file the static server would answer, so this opens the page itself with
// news.json answered first.
async function openIndex(browser, port, { news = ENTRIES, seen = null } = {}) {
  const context = await browser.newContext({ viewport: DESKTOP });
  if (seen) await context.addInitScript(([k, v]) => localStorage.setItem(k, v), [SEEN_KEY, seen]);
  const page = await context.newPage();
  const recorded = installRoutes(page, port);
  await page.route('**/news.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(news) })
  );
  await page.goto(`http://127.0.0.1:${port}/index.html?team=phoenix`, { waitUntil: 'load' });
  await page.waitForSelector('#landingLoot .pub-loot-row, #landingLoot .pub-loot-empty', { timeout: 20000 });
  return { context, page, ...recorded };
}

const openNews = (page) => page.click('#navNews');

const dotShown = (page) => page.locator('#navNewsDot').isVisible();

// The shape tests/behavior/news.js describes, read from index.html.
const readEntries = (page) =>
  page.locator('#newsView .news-entry').evaluateAll((els) =>
    els.map((el) => {
      const text = (sel) => el.querySelector(sel)?.textContent.trim() ?? null;
      return {
        title: text('.news-entry-title'),
        date: text('.news-entry-date'),
        category: text('.news-category-badge'),
        version: text('.news-entry-version').replace(/^v/, ''),
        pinned: el.classList.contains('news-entry-pinned'),
        open: el.classList.contains('news-entry-open'),
        body: text('.news-entry-body')
      };
    })
  );

const toggle = (page, title) => page.locator('.news-entry-header', { hasText: title }).click();

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

describe('News (current site)', () => {
  let opened;

  beforeAll(async () => {
    opened = await openIndex(browser, server.port);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('marks the News item while there is something the reader has not opened', async () => {
    await expect.poll(() => dotShown(opened.page)).toBe(true);
  });

  it('lists pinned entries first, then the newest, with the pinned and newest open', async () => {
    await openNews(opened.page);
    await opened.page.waitForSelector('#newsView .news-entry');
    expect(await readEntries(opened.page)).toEqual(EXPECTED);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('clears the mark once News has been opened, and remembers the newest entry', async () => {
    expect(await dotShown(opened.page)).toBe(false);
    await expect(opened.page.evaluate((k) => localStorage.getItem(k), SEEN_KEY)).resolves.toBe(NEWEST_VERSION);
  });

  it('opens and closes an entry from its header', async () => {
    await toggle(opened.page, TOGGLE_OPEN);
    await toggle(opened.page, TOGGLE_CLOSED);
    expect(await readEntries(opened.page)).toEqual(AFTER_TOGGLES);
  });
});

describe('News (current site), other states', () => {
  it('shows no mark to a reader who has seen the newest entry', async () => {
    const opened = await openIndex(browser, server.port, { seen: NEWEST_VERSION });
    try {
      // The mark would be set by now: News loads with the landing view.
      await opened.page.waitForFunction(() => document.querySelector('#navNews') !== null);
      await opened.page.waitForTimeout(300);
      expect(await dotShown(opened.page)).toBe(false);
    } finally {
      await opened.context.close();
    }
  });

  it('says so when there is no news', async () => {
    const opened = await openIndex(browser, server.port, { news: [] });
    try {
      await openNews(opened.page);
      await expect(opened.page.locator('#newsView').textContent()).resolves.toBe(EMPTY_MESSAGE);
      expect(await dotShown(opened.page)).toBe(false);
    } finally {
      await opened.context.close();
    }
  });
});
