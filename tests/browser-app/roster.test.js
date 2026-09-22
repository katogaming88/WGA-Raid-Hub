import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';
import {
  SCENARIO,
  SIGNUP_SEASON_APP_ROW,
  EXPECTED_CURRENT,
  EXPECTED_INCOMING,
  withoutCounts
} from '../behavior/roster.js';

// The new app's Roster page against the behavior recorded from the current
// site's Roster tab (tests/browser/roster-recorded.test.js, #1102 step 1).

const ROSTER_TABLES = {
  players: SCENARIO.players,
  incoming_roster: SCENARIO.incoming,
  team_seasons: [SIGNUP_SEASON_APP_ROW]
};

const STATE = {
  path: '/g/wga/t/phoenix/roster',
  sentinel: 'table.roster-table',
  tables: ROSTER_TABLES
};

// The shape tests/behavior/roster.js describes, read from the new markup.
function readTable(table) {
  return table.evaluate((root) => {
    const groups = [];
    for (const body of root.querySelectorAll('tbody')) {
      const heading = body.querySelector('.role-row th');
      const group = {
        label: heading.querySelector('.role-name').textContent.trim(),
        count: Number(heading.querySelector('.role-count').textContent),
        rows: []
      };
      for (const tr of body.querySelectorAll('tr:not(.role-row)')) {
        group.rows.push({
          name: tr.querySelector('.raider-name').textContent.trim(),
          character: tr.querySelector('.raider-character')?.textContent.trim() ?? null,
          // "Frost Mage": the spec is the words before the class.
          spec: tr.querySelector('.raider-spec').textContent.trim().split(' ')[0]
        });
      }
      groups.push(group);
    }
    return { groups };
  });
}

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

describe('Roster page (new app), checked against the current site', () => {
  let opened;

  beforeAll(async () => {
    opened = await openApp(browser, server.port, STATE);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('groups the roster by role and sorts each group by the name shown', async () => {
    const table = opened.page.getByRole('table', { name: 'Current roster' });
    expect(withoutCounts(await readTable(table))).toEqual(EXPECTED_CURRENT);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('offers next season’s roster, named for the signup season, with its approved signups', async () => {
    const tab = opened.page.getByRole('tab', { name: EXPECTED_INCOMING.tabLabel });
    await tab.click();
    const heading = opened.page.getByRole('main').getByRole('heading', { level: 2, name: EXPECTED_INCOMING.title });
    await expect(heading.count()).resolves.toBe(1);
    const table = opened.page.getByRole('table', { name: 'Next season’s tentative roster' });
    expect(await readTable(table)).toEqual({ groups: EXPECTED_INCOMING.groups });
  });
});

describe('Roster page (new app) layout', () => {
  it('starts the summary panel level with the top of the roster table', async () => {
    const opened = await openApp(browser, server.port, STATE);
    try {
      const top = (selector) => opened.page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
      expect(await top('#roster-panel-current .roster-side')).toBe(
        await top('#roster-panel-current .roster-table-wrap')
      );
    } finally {
      await opened.context.close();
    }
  });
});

describe('Roster page (new app), without approved signups', () => {
  it('shows no next-season tab', async () => {
    const opened = await openApp(browser, server.port, { ...STATE, tables: { ...ROSTER_TABLES, incoming_roster: [] } });
    try {
      await expect(opened.page.getByRole('tablist').count()).resolves.toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Roster page (new app), with no tier open for signups', () => {
  it('calls the tab Next Season Roster', async () => {
    const opened = await openApp(browser, server.port, {
      ...STATE,
      tables: { ...ROSTER_TABLES, team_seasons: [] }
    });
    try {
      await expect(opened.page.getByRole('tab', { name: 'Next Season Roster (Tentative)' }).count()).resolves.toBe(1);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Roster page (new app), spec icons', () => {
  it('shows each raider’s spec icon, loaded from the app', async () => {
    const opened = await openApp(browser, server.port, STATE);
    try {
      const table = opened.page.getByRole('table', { name: 'Current roster' });
      await table.locator('img.spec-icon').first().waitFor();
      const icons = await table.locator('tbody tr:not(.role-row)').evaluateAll((rows) =>
        rows.map((tr) => {
          const img = tr.querySelector('img.spec-icon');
          return img && img.complete && img.naturalWidth > 0 && img.getAttribute('alt') === '';
        })
      );
      expect(icons.length).toBeGreaterThan(0);
      expect(icons.every(Boolean)).toBe(true);
      expect(opened.unexpected).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Roster page (new app), attendance and items awarded', () => {
  const OFFICER_TABLES = {
    ...ROSTER_TABLES,
    team_settings: [{}],
    // The window the officer columns count over (#1269): the tier, starting
    // on this team's first raid night, which the rpc answers below.
    seasons: [
      {
        code: 'MID2',
        display_name: 'Midnight Season 2',
        starts_at: '2026-07-18',
        ends_at: '2026-12-31'
      }
    ],
    attendance: SCENARIO.players.slice(0, 1).flatMap((p) => [
      { player_id: p.id, raid_date: '2026-08-12', status: 'Present', report_excluded: false },
      { player_id: p.id, raid_date: '2026-08-14', status: 'No Show', report_excluded: false }
    ]),
    rclc_loot: [
      {
        id: 1,
        player_id: SCENARIO.players[0].id,
        track: 'Hero',
        season: 'MID2',
        awarded_at: '2026-08-20T18:00:00Z',
        items: { name: 'X' }
      }
    ]
  };
  const columns = (page) => page.getByRole('table', { name: 'Current roster' }).locator('thead th').allTextContents();

  it('are shown to an officer', async () => {
    const opened = await openApp(browser, server.port, {
      ...STATE,
      tables: OFFICER_TABLES,
      session: storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Officer' }),
      who: 'officer',
      sentinel: 'table.roster-table .roster-attendance'
    });
    try {
      expect((await columns(opened.page)).map((c) => c.trim())).toEqual(
        expect.arrayContaining(['Attendance', 'Items'])
      );
      const first = opened.page.locator('table.roster-table tbody tr', {
        has: opened.page.locator('.raider-name', {
          hasText: SCENARIO.players[0].nickname || SCENARIO.players[0].name_realm.split('-')[0]
        })
      });
      await expect(first.locator('.roster-attendance').textContent()).resolves.toBe('50.0%');
      await expect(first.locator('.roster-items').textContent()).resolves.toBe('1');
      expect(opened.unexpected).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  it('are not shown to a visitor, who never reads them', async () => {
    const reads = [];
    const opened = await openApp(browser, server.port, { ...STATE, tables: OFFICER_TABLES });
    opened.page.on('request', (r) => reads.push(new URL(r.url()).pathname));
    try {
      await opened.page.waitForLoadState('networkidle');
      expect((await columns(opened.page)).map((c) => c.trim())).not.toContain('Attendance');
      await expect(opened.page.locator('.roster-attendance').count()).resolves.toBe(0);
      expect(reads.some((path) => path.endsWith('/rest/v1/attendance') || path.endsWith('/rest/v1/rclc_loot'))).toBe(
        false
      );
    } finally {
      await opened.context.close();
    }
  });
});
