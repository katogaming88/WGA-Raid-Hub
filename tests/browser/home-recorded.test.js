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

// The landing view as the current site shows it -- the stats row, the recent
// loot feed, raid progression, the calendar widget and the live stream
// widget -- recorded so the new app's Home page can be checked
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

// ---------------------------------------------------------------------------
// Raid progression, the calendar widget and the live stream widget.

const blockOverrides = (streamers = STREAMS) => ({
  ...overrides(),
  team_settings: fixture('team_settings', []).map((r) => ({
    ...r,
    config: { ...r.config, seasonName: SEASON.name, raidProgression: PROGRESSION.raids }
  })),
  team_raid_progress: PROGRESSION.rows,
  raid_schedule: CALENDAR.schedule,
  raid_schedule_exceptions: CALENDAR.exceptions,
  raid_rsvps: [],
  streamers
});

const BLOCKS = {
  label: 'index-landing-blocks',
  path: '/index.html?team=phoenix',
  sentinel: '#landingCalendar a.mini-cal-day-raid',
  clock: TODAY
};

// "34 pulls -- best 12.4%" -> { pulls: 34, best: 12.4 }
const PULLS = /^(\d+) pulls?(?: -- best ([\d.]+)%)?$/;

function readProgression(page) {
  return page.locator('#landingProgression .prog-card').evaluateAll((cards, pullsSource) => {
    const pullsRe = new RegExp(pullsSource);
    const pullsOf = (el) => {
      if (!el) return { pulls: null, best: null, link: null };
      const m = pullsRe.exec(el.textContent.trim());
      return {
        pulls: m ? Number(m[1]) : null,
        best: m && m[2] !== undefined ? Number(m[2]) : null,
        link: el.getAttribute('href')
      };
    };
    const text = (root, sel) => root.querySelector(sel)?.textContent.trim() ?? null;
    return cards.map((card) => {
      const score = { heroic: null, mythic: null, total: 0 };
      card.querySelectorAll('.prog-score').forEach((el) => {
        const [, killed, total, diff] = /^(\d+)\/(\d+) ([HM])$/.exec(el.textContent.trim());
        score[diff === 'H' ? 'heroic' : 'mythic'] = Number(killed);
        score.total = Number(total);
      });
      const bar = card.querySelector('.prog-bar');
      return {
        name: text(card, '.prog-raid-name'),
        score,
        bar: bar
          ? {
              pct: parseInt(bar.style.width, 10),
              difficulty: bar.classList.contains('prog-bar-heroic') ? 'heroic' : 'mythic'
            }
          : null,
        bosses: [...card.querySelectorAll('.prog-boss-item')].map((item) => {
          const date = text(item, '.prog-boss-date');
          const mythicPulls = pullsOf(item.querySelector('.prog-boss-pulls'));
          const heroicRow = item.querySelector('.prog-boss-heroic');
          return {
            number: Number(text(item, '.prog-boss-num')),
            name: text(item, '.prog-boss-name'),
            mythic: date || mythicPulls.pulls !== null ? { date, ...mythicPulls } : null,
            heroic: heroicRow
              ? {
                  date: text(heroicRow, '.prog-boss-heroic-date'),
                  ...pullsOf(heroicRow.querySelector('.prog-boss-heroic-pulls'))
                }
              : null
          };
        }),
        aotc: text(card, '.prog-aotc-date')
      };
    });
  }, PULLS.source);
}

function readCalendar(page) {
  return page.locator('#landingCalendar').evaluate((root) => ({
    month: root.querySelector('.mini-cal-header span').textContent.trim(),
    today: Number(root.querySelector('.mini-cal-day-today .mini-cal-daynum').textContent),
    days: [...root.querySelectorAll('a.mini-cal-day-raid')].map((a) => ({
      date: new URL(a.href).searchParams.get('date'),
      status: a.querySelector('.calendar-status').getAttribute('aria-label'),
      count: a.querySelector('.mini-cal-daycount')?.textContent.trim() ?? null
    })),
    legend: [...root.querySelectorAll('.calendar-legend-item')].map((el) => el.textContent.trim())
  }));
}

function readStreams(page) {
  return page.locator('#streamWidgetPanel').evaluate((panel) => ({
    live: [...panel.querySelectorAll('.stream-card')].map((card) => ({
      name: card.querySelector('.stream-name').textContent.trim(),
      channel: card.querySelector('.stream-twitch-link').textContent.trim().replace('twitch.tv/', ''),
      note: card.querySelector('.stream-note')?.textContent.trim() ?? ''
    })),
    empty: panel.querySelector('.stream-widget-empty')?.textContent.trim() ?? null
  }));
}

describe('Home (current site): raid progression, calendar and streams', () => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, BLOCKS, blockOverrides());
    await opened.page.waitForSelector('#landingProgression .prog-card');
    await opened.page.waitForSelector('#streamWidgetPanel .stream-card');
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
  });

  it('lists whoever is live in the stream widget, and names them', async () => {
    expect(await readStreams(opened.page)).toEqual(EXPECTED_STREAMS);
    await expect(opened.page.locator('#streamLiveTopbar').textContent()).resolves.toBe(LIVE_TEXT);
  });
});

describe('Home (current site): nobody live', () => {
  it('says so in the stream widget', async () => {
    const offline = STREAMS.map((s) => ({ ...s, is_live: false }));
    const opened = await openState(
      browser,
      server.port,
      { ...BLOCKS, label: 'index-landing-offline', sentinel: '#streamWidgetPanel .stream-widget-empty' },
      blockOverrides(offline)
    );
    try {
      expect(await readStreams(opened.page)).toEqual(NOBODY_LIVE);
      await expect(opened.page.locator('#streamWidgetPill').textContent()).resolves.toBe('Streams');
      await expect(opened.page.locator('#streamLiveTopbar').isVisible()).resolves.toBe(false);
    } finally {
      await opened.context.close();
    }
  });
});
