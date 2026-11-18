import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, NARROW } from './harness.js';
import { NEWEST_SEEN_KEY, POSTS, READER_POSTS, STAFF } from './news-fixtures.js';

// The new app's News (#1102, #1230): the timeline with its pinned post,
// filters and search, a post's own page, and Staff's editor. News is posts in
// the news_posts table, so a state lists them under `tables`.
// tests/behavior/news.js is the current site's News tab, which keeps reading
// news.json until cutover and is checked by tests/browser/news-recorded.test.js.

const SEEN_KEY = 'wga_news_last_seen';
const EMPTY_MESSAGE = 'No news yet.';
const STATE = { path: '/news', sentinel: '.news-month', tables: { news_posts: READER_POSTS } };
const POST = '/news/raid-calendar';

// The timeline as a reader sees it.
const readTimeline = (page) =>
  page.locator('.news-month').evaluateAll((months) =>
    months.map((month) => ({
      month: month.querySelector('.news-month-title').textContent.trim(),
      posts: [...month.querySelectorAll('.news-item')].map((a) => ({
        title: a.querySelector('.news-item-title').textContent.trim(),
        category: a.querySelector('.news-category').textContent.trim(),
        date: a.querySelector('time').getAttribute('datetime'),
        href: a.getAttribute('href')
      }))
    }))
  );

const markShown = async (page) =>
  (await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'News, new' }).count()) > 0;

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

// Opens a state, runs the check, and always closes the browser context.
async function within(state, check) {
  const opened = await openApp(browser, server.port, state);
  try {
    await check(opened);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  } finally {
    await opened.context.close();
  }
}

describe('News timeline', () => {
  it('lists the posts by month, newest first, a later post first on a shared day', async () => {
    await within(STATE, async ({ page }) => {
      expect(await readTimeline(page)).toEqual([
        {
          month: 'September 2026',
          posts: [
            {
              title: 'Signup form keeps your off-specs',
              category: 'Fix',
              date: '2026-09-07',
              href: '/news/signup-keeps-offspecs'
            },
            {
              title: 'Raid Calendar: a day view for every raid night',
              category: 'Feature',
              date: '2026-09-07',
              href: '/news/raid-calendar'
            }
          ]
        },
        {
          month: 'August 2026',
          posts: [
            {
              title: 'Loot history on every profile',
              category: 'Change',
              date: '2026-08-20',
              href: '/news/loot-history'
            },
            {
              title: 'Welcome to the new Raid Hub',
              category: 'Announcement',
              date: '2026-08-01',
              href: '/news/welcome'
            }
          ]
        }
      ]);
    });
  });

  it('shows the pinned post in its box, with its cover, and only there', async () => {
    await within(STATE, async ({ page }) => {
      const pinned = page.getByRole('region', { name: 'Pinned' });
      await expect(pinned.getByText('Report a BoE and follow it, on one page').count()).resolves.toBe(1);
      await expect(
        pinned.locator('img.news-pinned-cover').evaluate((img) => img.complete && img.naturalWidth > 0)
      ).resolves.toBe(true);
      await expect(page.getByText('Report a BoE and follow it, on one page').count()).resolves.toBe(1);
      await pinned.getByRole('link').click();
      await page.waitForURL('**/news/report-a-boe');
    });
  });

  it('narrows by category and by search', async () => {
    await within(STATE, async ({ page }) => {
      await page.getByRole('button', { name: 'Fixes' }).click();
      await expect(page.getByRole('button', { name: 'Fixes' }).getAttribute('aria-pressed')).resolves.toBe('true');
      expect((await readTimeline(page)).flatMap((m) => m.posts.map((p) => p.title))).toEqual([
        'Signup form keeps your off-specs'
      ]);
      await page.getByRole('button', { name: 'All' }).click();
      await page.getByRole('searchbox', { name: 'Search news' }).fill('welcome');
      expect((await readTimeline(page)).flatMap((m) => m.posts.map((p) => p.title))).toEqual([
        'Welcome to the new Raid Hub'
      ]);
      await page.getByRole('searchbox', { name: 'Search news' }).fill('no such thing');
      await expect(page.getByText('No posts match.').count()).resolves.toBe(1);
    });
  });

  it('remembers the newest post once News has been opened, and shows no mark', async () => {
    await within(STATE, async ({ page }) => {
      await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), SEEN_KEY)).toBe(NEWEST_SEEN_KEY);
      expect(await markShown(page)).toBe(false);
    });
  });

  it('marks the News item on another page while there is something new, until it is seen', async () => {
    const other = { path: '/g/wga/streams', tables: { news_posts: READER_POSTS } };
    await within(other, async ({ page }) => {
      await expect.poll(() => markShown(page)).toBe(true);
    });
    await within({ ...other, newsSeen: NEWEST_SEEN_KEY }, async ({ page }) => {
      await page.waitForLoadState('networkidle');
      expect(await markShown(page)).toBe(false);
    });
  });

  it('says so when there is no news', async () => {
    await within({ ...STATE, tables: { news_posts: [] }, sentinel: `text=${EMPTY_MESSAGE}` }, async ({ page }) => {
      expect(await markShown(page)).toBe(false);
    });
  });

  it('gives a reader no New post button, drafts or posts set for later', async () => {
    await within(STATE, async ({ page }) => {
      await expect(page.getByRole('link', { name: 'New post' }).count()).resolves.toBe(0);
      await expect(page.getByText('Not published yet').count()).resolves.toBe(0);
    });
  });

  it('gives Staff New post, and the drafts and posts set for later', async () => {
    await within({ ...STATE, ...STAFF, tables: { news_posts: POSTS } }, async ({ page }) => {
      await page.getByRole('link', { name: 'New post' }).waitFor();
      const unpublished = page.getByRole('region', { name: 'Not published yet' });
      await expect(unpublished.locator('.news-item-title').allTextContents()).resolves.toEqual([
        'Set for later',
        'A draft'
      ]);
      // Neither is news: the timeline above is the readers' list.
      expect((await readTimeline(page)).flatMap((m) => m.posts)).toHaveLength(4);
    });
  });

  it('fits a narrow screen without scrolling sideways', async () => {
    for (const path of ['/news', POST, '/news/new']) {
      await within(
        { ...STATE, ...STAFF, path, sentinel: 'main h1', viewport: NARROW, tables: { news_posts: POSTS } },
        async ({ page }) => {
          await page.waitForLoadState('networkidle');
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          expect(overflow).toBeLessThanOrEqual(0);
        }
      );
    }
  });
});

describe('A news post', () => {
  const post = { ...STATE, path: POST, sentinel: '.news-post-title' };

  it('shows the post with its cover, body and the next older post', async () => {
    await within(post, async ({ page }) => {
      await expect(page.locator('h1').textContent()).resolves.toBe('Raid Calendar: a day view for every raid night');
      await expect(page.locator('.news-item-meta').textContent()).resolves.toContain('Version 3.93.0');
      await expect(page.locator('.news-cover figcaption').textContent()).resolves.toBe('The month view.');
      await expect(
        page.locator('.news-cover img').evaluate((img) => img.complete && img.naturalWidth > 0)
      ).resolves.toBe(true);
      await expect(page.getByRole('heading', { level: 2, name: 'Open any raid night' }).count()).resolves.toBe(1);
      await expect(page.locator('.news-body li').allTextContents()).resolves.toEqual([
        'Your own status sits at the top.',
        "Everyone's status is below it."
      ]);
      // The other posts that are out, newest first, beside it (never a draft, never itself).
      await expect(page.locator('.news-recent .news-recent-title').allTextContents()).resolves.toEqual([
        'Signup form keeps your off-specs',
        'Report a BoE and follow it, on one page',
        'Loot history on every profile',
        'Welcome to the new Raid Hub'
      ]);
      // Each shows its type, by symbol and name.
      await expect(page.locator('.news-recent .news-category').allTextContents()).resolves.toEqual([
        'Fix',
        'Feature',
        'Change',
        'Announcement'
      ]);
      await expect(page.locator('.news-recent .news-category svg').count()).resolves.toBe(4);
      // Titles are not underlined until pointed at.
      await expect(
        page
          .locator('.news-recent-title')
          .first()
          .evaluate((el) => getComputedStyle(el).textDecorationLine)
      ).resolves.toBe('none');
      // Older than Sep 7 is the pinned BoE post (Sep 3).
      await page.getByRole('link', { name: /^Older: / }).click();
      await page.waitForURL('**/news/report-a-boe');
      await page.getByRole('link', { name: 'All news' }).click();
      await page.waitForURL('**/news');
    });
  });

  // A picture keeps its own shape: a portrait cover is shown whole, not cropped to 16:9.
  it('shows a tall cover picture whole, on its page and in the pinned box', async () => {
    const tall = POSTS.map((p) => (p.id === 1 ? { ...p, cover_path: 'tall.png' } : p));
    const shown = (img) => img.clientWidth / img.clientHeight / (img.naturalWidth / img.naturalHeight);
    await within(
      { ...STATE, path: '/news/report-a-boe', sentinel: '.news-cover img', tables: { news_posts: tall } },
      async ({ page }) => {
        const ratio = await page.locator('.news-cover img').evaluate(shown);
        expect(ratio).toBeGreaterThan(0.98);
        expect(ratio).toBeLessThan(1.02);
      }
    );
    await within({ ...STATE, sentinel: '.news-pinned-cover', tables: { news_posts: tall } }, async ({ page }) => {
      await page.locator('.news-pinned-cover').evaluate((img) => img.decode());
      const ratio = await page.locator('.news-pinned-cover').evaluate(shown);
      expect(ratio).toBeGreaterThan(0.98);
      expect(ratio).toBeLessThan(1.02);
    });
  });

  it('marks the News item in the sidebar while a post is open', async () => {
    await within(post, async ({ page }) => {
      await expect(
        page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^News/ }).getAttribute('aria-current')
      ).resolves.toBe('page');
    });
  });

  it('says so for an address with no post', async () => {
    await within({ ...post, path: '/news/nothing-here', sentinel: 'text=Post not found' }, async () => {});
  });

  it('gives Staff Edit and Delete, and a reader neither', async () => {
    await within({ ...post, ...STAFF }, async ({ page }) => {
      await page.getByRole('link', { name: 'Edit' }).waitFor();
      await expect(page.getByRole('button', { name: 'Delete' }).count()).resolves.toBe(1);
    });
    await within(post, async ({ page }) => {
      await expect(page.getByRole('link', { name: 'Edit' }).count()).resolves.toBe(0);
      await expect(page.getByRole('button', { name: 'Delete' }).count()).resolves.toBe(0);
    });
  });

  it('opens a draft for Staff, with a note that it is not out', async () => {
    await within({ ...post, ...STAFF, path: '/news/a-draft', tables: { news_posts: POSTS } }, async ({ page }) => {
      await expect(page.getByRole('note').textContent()).resolves.toContain('A draft. Only Staff can see it');
    });
  });
});

describe('Writing a post', () => {
  const editor = { ...STATE, ...STAFF, path: '/news/new', sentinel: '.news-editor' };

  it('is for Staff', async () => {
    await within({ ...editor, ...{ session: undefined, person: undefined }, sentinel: 'main h1' }, async ({ page }) => {
      await expect(page.getByText('Sign in to see this page. It is for Staff.').count()).resolves.toBe(1);
    });
  });

  it('previews as you type, and the formatting buttons type for you', async () => {
    await within(editor, async ({ page }) => {
      const box = page.getByRole('textbox', { name: 'Post' });
      await box.fill('Intro');
      await page.getByRole('button', { name: 'Heading' }).click();
      await expect(box.inputValue()).resolves.toBe('## Intro');
      await expect(page.locator('.news-preview h2').textContent()).resolves.toBe('Intro');
      await box.press('End');
      await box.pressSequentially('\n\nwords');
      await page.getByRole('button', { name: 'Bold' }).click();
      await expect(page.locator('.news-preview strong').textContent()).resolves.toBe('bold');
    });
  });

  it('opens a post for editing with its fields filled in and no Publish button', async () => {
    await within({ ...editor, path: `${POST}/edit` }, async ({ page }) => {
      await expect(page.getByRole('textbox', { name: 'Title' }).inputValue()).resolves.toBe(
        'Raid Calendar: a day view for every raid night'
      );
      await expect(page.getByRole('textbox', { name: 'Cover caption (optional)' }).inputValue()).resolves.toBe(
        'The month view.'
      );
      await expect(page.locator('.news-preview h2').textContent()).resolves.toBe('Open any raid night');
      await expect(page.getByRole('button', { name: 'Publish' }).count()).resolves.toBe(0);
      await expect(page.getByRole('button', { name: 'Save changes' }).count()).resolves.toBe(1);
    });
  });
});
