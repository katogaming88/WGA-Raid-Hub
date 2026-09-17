import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp } from './harness.js';
import {
  TEAMS,
  STREAMS,
  EXPECTED_STREAMS,
  NOBODY_LIVE,
  EXPECTED_NOBODY_LIVE,
  NO_STREAMERS,
  EXPECTED_NO_STREAMERS
} from '../behavior/streams.js';

// The new app's Streams page against the behavior recorded from the current
// site's Streamers tab (tests/behavior/streams.js, #1102 step 1), plus what
// the redesign changes on purpose.

const STATE = { path: '/g/wga/streams', sentinel: 'main h1', teams: TEAMS };

// The shape tests/behavior/streams.js describes, read from the new markup.
const readCards = (page, selector) =>
  page.locator(selector).evaluateAll((items) =>
    items.map((item) => ({
      name: item.querySelector('.stream-name').textContent.trim(),
      channel: (item.querySelector('.stream-channel')?.textContent ?? '').trim().replace(/^twitch\.tv\//, ''),
      note: (item.querySelector('.stream-note')?.textContent ?? '').trim(),
      team: (item.querySelector('.stream-team')?.textContent ?? '').trim()
    }))
  );

const readEmpty = async (page) => {
  const box = page.locator('.stream-empty');
  if ((await box.count()) === 0) return null;
  return (await box.first().textContent()).trim();
};

const readDirectory = async (page) => ({
  live: await readCards(page, '.streams-live li'),
  offline: await readCards(page, '.streams-offline li'),
  empty: await readEmpty(page)
});

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

async function open(state) {
  return openApp(browser, server.port, { ...STATE, ...state });
}

describe('Streams page (new app)', () => {
  let opened;

  beforeAll(async () => {
    opened = await open({ tables: { streamers: STREAMS }, sentinel: '.streams-live .stream-name' });
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('lists who is live and who is not, with their channel, team and schedule', async () => {
    expect(await readDirectory(opened.page)).toEqual(EXPECTED_STREAMS);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('names the page and marks Streams in the sidebar', async () => {
    const { page } = opened;
    await expect(page.getByRole('heading', { level: 1 }).textContent()).resolves.toBe('Streams');
    await expect(page.getByRole('link', { name: 'Streams' }).getAttribute('aria-current')).resolves.toBe('page');
  });

  // Deliberate: a player only for the people actually streaming, where the
  // current tab builds one per streamer, live or not (#797).
  it('plays only the live streams, each named for its streamer', async () => {
    const { page } = opened;
    await expect(page.locator('iframe').count()).resolves.toBe(EXPECTED_STREAMS.live.length);
    await expect(page.locator('.streams-offline iframe').count()).resolves.toBe(0);
    const titles = await page.locator('iframe').evaluateAll((frames) => frames.map((f) => f.getAttribute('title')));
    for (const stream of EXPECTED_STREAMS.live) {
      expect(titles.some((t) => t?.includes(stream.name))).toBe(true);
    }
  });

  // #796: the live dot is not colour alone.
  it('writes "Live" out beside the dot', async () => {
    await expect(opened.page.locator('.streams-live .stream-live').first().textContent()).resolves.toContain('Live');
  });

  it('links each streamer to their channel on Twitch, in a new tab', async () => {
    const link = opened.page.locator('.streams-live a.stream-channel').first();
    await expect(link.getAttribute('href')).resolves.toBe('https://twitch.tv/aurelithplays');
    await expect(link.getAttribute('rel')).resolves.toContain('noopener');
  });

  it('gives each list a heading of its own', async () => {
    const { page } = opened;
    await expect(page.getByRole('heading', { name: /live now/i }).count()).resolves.toBe(1);
    await expect(page.getByRole('heading', { name: /also streaming/i }).count()).resolves.toBe(1);
  });
});

// Deliberate: with nobody live the Live now section is left out, rather than
// showing an empty one. The directory below it is still worth reading.
describe('Streams page (new app), nobody live', () => {
  let opened;

  beforeAll(async () => {
    opened = await open({ tables: { streamers: NOBODY_LIVE }, sentinel: '.streams-offline .stream-name' });
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('lists everyone as offline, with no live section and no players', async () => {
    expect(await readDirectory(opened.page)).toEqual(EXPECTED_NOBODY_LIVE);
    await expect(opened.page.locator('.streams-live').count()).resolves.toBe(0);
    await expect(opened.page.locator('iframe').count()).resolves.toBe(0);
    expect(opened.pageErrors).toEqual([]);
  });
});

describe('Streams page (new app), nobody linked', () => {
  let opened;

  beforeAll(async () => {
    opened = await open({ tables: { streamers: NO_STREAMERS }, sentinel: '.stream-empty' });
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('says so, in the current site’s words', async () => {
    expect(await readDirectory(opened.page)).toEqual(EXPECTED_NO_STREAMERS);
    expect(opened.pageErrors).toEqual([]);
  });
});
