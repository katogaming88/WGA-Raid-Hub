import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, NARROW } from './harness.js';
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

// The new app's News page against the behavior recorded from the current
// site's News tab (tests/browser/news-recorded.test.js, #1102 step 1), plus
// what the redesign changes on purpose.

const STATE = { path: '/g/wga/news', sentinel: '.news-entry', news: ENTRIES };

// The shape tests/behavior/news.js describes, read from the new markup. The
// date is the machine-readable one; the page writes it out (below).
const readEntries = (page) =>
  page.locator('.news-entry').evaluateAll((els) =>
    els.map((el) => {
      const open = el.querySelector('.news-entry-header').getAttribute('aria-expanded') === 'true';
      return {
        title: el.querySelector('.news-entry-title').textContent.trim(),
        date: el.querySelector('time').getAttribute('datetime'),
        category: el.querySelector('.news-category').textContent.trim(),
        version: el.querySelector('.news-entry-version').textContent.trim().replace(/^v/, ''),
        pinned: el.querySelector('.news-pinned') !== null,
        open,
        body: open ? el.querySelector('.news-entry-body').textContent.trim() : null
      };
    })
  );

const markShown = async (page) =>
  (await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'News, new' }).count()) > 0;

const toggle = (page, title) => page.getByRole('button', { name: new RegExp(title) }).click();

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

describe('News (new app)', () => {
  let opened;

  beforeAll(async () => {
    opened = await openApp(browser, server.port, STATE);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('lists pinned entries first, then the newest, with the pinned and newest open', async () => {
    expect(await readEntries(opened.page)).toEqual(EXPECTED);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('remembers the newest entry once News has been opened, and shows no mark', async () => {
    await expect.poll(() => opened.page.evaluate((k) => localStorage.getItem(k), SEEN_KEY)).toBe(NEWEST_VERSION);
    expect(await markShown(opened.page)).toBe(false);
  });

  it('opens and closes an entry from its header', async () => {
    await toggle(opened.page, TOGGLE_OPEN);
    await toggle(opened.page, TOGGLE_CLOSED);
    expect(await readEntries(opened.page)).toEqual(AFTER_TOGGLES);
  });

  // Deliberate: dates are written out.
  it('writes the date out', async () => {
    await expect(opened.page.locator('.news-entry time').first().textContent()).resolves.toBe('Jun 1, 2026');
  });

  it('keeps a closed entry’s text away from the keyboard and screen readers', async () => {
    const closed = opened.page.locator('.news-entry', { hasText: 'Loot history on every profile' });
    await expect(closed.locator('.news-entry-body-wrap').evaluate((el) => el.inert)).resolves.toBe(true);
    await expect(closed.locator('.news-entry-body').isVisible()).resolves.toBe(false);
  });
});

describe('News (new app), other states', () => {
  it('marks the News item on another page while there is something new', async () => {
    const { context, page } = await openApp(browser, server.port, { path: '/g/wga/streams', news: ENTRIES });
    try {
      await expect.poll(() => markShown(page)).toBe(true);
    } finally {
      await context.close();
    }
  });

  it('shows no mark to a reader who has seen the newest entry', async () => {
    const { context, page } = await openApp(browser, server.port, {
      path: '/g/wga/streams',
      news: ENTRIES,
      newsSeen: NEWEST_VERSION
    });
    try {
      await page.waitForLoadState('networkidle');
      expect(await markShown(page)).toBe(false);
    } finally {
      await context.close();
    }
  });

  it('says so when there is no news', async () => {
    const { context, page } = await openApp(browser, server.port, {
      ...STATE,
      news: [],
      sentinel: `text=${EMPTY_MESSAGE}`
    });
    try {
      expect(await markShown(page)).toBe(false);
    } finally {
      await context.close();
    }
  });

  // Deliberate (#1041): the body slides open, unless the reader asked for less motion.
  it('slides an entry open, and does not animate with reduced motion', async () => {
    for (const [reducedMotion, animates] of [
      ['no-preference', true],
      ['reduce', false]
    ]) {
      const { context, page } = await openApp(browser, server.port, { ...STATE, reducedMotion });
      try {
        await toggle(page, TOGGLE_OPEN);
        // Reduced motion shortens every transition to next to nothing (base.css).
        const slide = await page.evaluate(() =>
          Math.max(
            0,
            ...document
              .getAnimations()
              .filter((a) => a.transitionProperty === 'grid-template-rows')
              .map((a) => a.effect.getTiming().duration)
          )
        );
        expect(slide > 50).toBe(animates);
      } finally {
        await context.close();
      }
    }
  });

  it('fits a narrow screen without scrolling sideways', async () => {
    const { context, page } = await openApp(browser, server.port, { ...STATE, viewport: NARROW });
    try {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});
