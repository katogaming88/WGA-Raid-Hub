import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';
import {
  SCENARIO,
  SEASON,
  NEW_STAT_LABELS,
  expectedStats,
  EXPECTED_FEED,
  EXPECTED_SEARCH,
  SEARCH,
  NO_MATCH,
  PROGRESSION,
  EXPECTED_PROGRESSION,
  CALENDAR,
  EXPECTED_CALENDAR,
  TODAY,
  STREAMS,
  EXPECTED_STREAMS,
  LIVE_TEXT,
  NOBODY_LIVE
} from '../behavior/home.js';

// The new app's Home page -- the stats row, the recent loot feed, raid
// progression, the calendar and the live stream widget -- against the
// behavior recorded from the current site's landing view
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

// ---------------------------------------------------------------------------
// Raid progression, the calendar and the live stream widget.

const BLOCKS = {
  ...STATE,
  sentinel: '.home-progression .raid',
  clock: TODAY,
  tables: {
    ...STATE.tables,
    team_settings: [{ name: SEASON.name, start: null, end: null, raids: PROGRESSION.raids }],
    team_raid_progress: PROGRESSION.rows,
    raid_schedule: CALENDAR.schedule,
    raid_schedule_exceptions: CALENDAR.exceptions,
    streamers: STREAMS
  }
};

const whenReady = async (page) => {
  await page.waitForSelector('.home-calendar a.cal-day-raid');
  await page.waitForSelector('.stream-widget');
};

const readProgression = (page) =>
  page.locator('.home-progression .raid').evaluateAll((raids) =>
    raids.map((raid) => {
      const score = { heroic: null, mythic: null, total: 0 };
      raid.querySelectorAll('.raid-score').forEach((el) => {
        const [, killed, total] = /(\d+)\/(\d+)$/.exec(el.textContent.trim());
        score[el.dataset.difficulty] = Number(killed);
        score.total = Number(total);
      });
      const fill = raid.querySelector('.raid-bar-fill');
      const line = (boss, difficulty) => {
        const el = boss.querySelector(`.boss-line[data-difficulty="${difficulty}"]`);
        if (!el) return null;
        const pulls = el.querySelector('.boss-pulls');
        const best = el.querySelector('.boss-best');
        return {
          date: el.querySelector('time')?.getAttribute('datetime') ?? null,
          pulls: pulls ? Number(/^\d+/.exec(pulls.textContent.trim())[0]) : null,
          best: best ? Number(/best ([\d.]+)%/.exec(best.textContent)[1]) : null,
          link: pulls?.getAttribute('href') ?? null
        };
      };
      return {
        name: raid.querySelector('.raid-name').textContent.trim(),
        score,
        bar: fill
          ? {
              pct: parseInt(fill.style.width, 10),
              difficulty: fill.classList.contains('raid-bar-heroic') ? 'heroic' : 'mythic'
            }
          : null,
        bosses: [...raid.querySelectorAll('.boss')].map((boss) => ({
          number: Number(boss.querySelector('.boss-number').textContent),
          name: boss.querySelector('.boss-name').textContent.trim(),
          mythic: line(boss, 'mythic'),
          heroic: line(boss, 'heroic')
        })),
        aotc: raid.querySelector('.raid-aotc time')?.getAttribute('datetime') ?? null
      };
    })
  );

const readCalendar = (page) =>
  page.locator('.home-calendar').evaluate((root) => ({
    month: root.querySelector('.cal-month').textContent.trim(),
    today: Number(root.querySelector('.cal-day-today .cal-daynum').textContent),
    days: [...root.querySelectorAll('a.cal-day-raid')].map((a) => ({
      date: new URL(a.href).searchParams.get('date'),
      status: a.querySelector('.cal-marker').getAttribute('title'),
      count: a.querySelector('.cal-count')?.textContent.trim() ?? null
    })),
    legend: [...root.querySelectorAll('.cal-legend li')].map((el) => el.textContent.trim())
  }));

const readStreams = (page) =>
  page.locator('.stream-widget').evaluate((widget) => ({
    live: [...widget.querySelectorAll('.stream-card')].map((card) => ({
      name: card.querySelector('.stream-name').textContent.trim(),
      channel: card.querySelector('.stream-channel').textContent.trim().replace('twitch.tv/', ''),
      note: card.querySelector('.stream-note')?.textContent.trim() ?? ''
    })),
    empty: widget.querySelector('.stream-empty')?.textContent.trim() ?? null
  }));

describe('Home page (new app): raid progression, calendar and streams, checked against the current site', () => {
  let opened;

  beforeAll(async () => {
    opened = await openApp(browser, server.port, BLOCKS);
    await whenReady(opened.page);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('shows each raid’s progress, matching bosses by encounter id or name', async () => {
    expect(await readProgression(opened.page)).toEqual(EXPECTED_PROGRESSION);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('shows this month’s raid nights, each linking to its day', async () => {
    expect(await readCalendar(opened.page)).toEqual(EXPECTED_CALENDAR);
    const first = opened.page.locator('a.cal-day-raid').first();
    await expect(first.getAttribute('href')).resolves.toBe('/g/wga/t/phoenix/calendar?date=2026-05-03');
    await expect(first.getAttribute('aria-label')).resolves.toBe('Sunday, May 3, No Response');
  });

  it('lists whoever is live in the stream widget, and names them on its button', async () => {
    expect(await readStreams(opened.page)).toEqual(EXPECTED_STREAMS);
    await expect(opened.page.locator('.stream-toggle').textContent()).resolves.toBe(LIVE_TEXT);
    await expect(opened.page.locator('.stream-embed iframe').first().getAttribute('title')).resolves.toBe(
      'Aur’s stream on Twitch'
    );
  });

  it('remembers the widget closed across a reload', async () => {
    await opened.page.locator('.stream-toggle').click();
    await expect(opened.page.locator('.stream-panel').count()).resolves.toBe(0);
    await opened.page.reload();
    await opened.page.waitForSelector('.stream-toggle');
    await expect(opened.page.locator('.stream-toggle').getAttribute('aria-expanded')).resolves.toBe('false');
  });
});

describe('Home page (new app): nobody live', () => {
  it('says so in the stream widget', async () => {
    const opened = await openApp(browser, server.port, {
      ...BLOCKS,
      tables: { ...BLOCKS.tables, streamers: STREAMS.map((s) => ({ ...s, is_live: false })) }
    });
    try {
      await opened.page.waitForSelector('.stream-empty');
      expect(await readStreams(opened.page)).toEqual(NOBODY_LIVE);
      await expect(opened.page.locator('.stream-toggle').textContent()).resolves.toBe('Streams');
    } finally {
      await opened.context.close();
    }
  });
});

// Signed in with a character on the roster, the calendar shows the reader's
// own answers. The current site does the same through its Discord sign-in,
// which the recorded suite does not drive.
describe('Home page (new app): the calendar, signed in', () => {
  it('shows the reader’s own answers in place of the default', async () => {
    const opened = await openApp(browser, server.port, {
      ...BLOCKS,
      session: storedSession({ discord: 'Seedofficer' }),
      who: 'officer',
      tables: {
        ...BLOCKS.tables,
        raid_rsvps: [
          { raid_date: '2026-05-05', status: 'Absent' },
          { raid_date: '2026-05-07', status: 'Tentative' }
        ]
      }
    });
    try {
      await whenReady(opened.page);
      await opened.page.waitForSelector('.cal-marker-absent');
      const calendar = await readCalendar(opened.page);
      const answered = { '2026-05-05': 'Absent', '2026-05-07': 'Tentative' };
      expect(calendar.days).toEqual(
        EXPECTED_CALENDAR.days.map((d) => (answered[d.date] ? { ...d, status: answered[d.date], count: null } : d))
      );
      expect(calendar.legend).toEqual([
        'No Response',
        'Absent',
        'Tentative',
        'Present',
        '1 on Bench (excluded from the count above)'
      ]);
      expect(opened.unexpected).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});
