import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp } from './harness.js';
import { SCENARIO, EXPECTED_CURRENT, EXPECTED_INCOMING, withoutCounts } from '../behavior/roster.js';

// The new app's Roster page against the behavior recorded from the current
// site's Roster tab (tests/browser/roster-recorded.test.js, #1102 step 1).

const ROSTER_TABLES = {
  players: SCENARIO.players,
  incoming_roster: SCENARIO.incoming,
  team_settings: [{ signupSeason: SCENARIO.activeSignupSeason }]
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

describe('Roster page (new app), before a signup season is named', () => {
  it('calls the tab Next Season Roster', async () => {
    const opened = await openApp(browser, server.port, {
      ...STATE,
      tables: { ...ROSTER_TABLES, team_settings: [{ signupSeason: '' }] }
    });
    try {
      await expect(opened.page.getByRole('tab', { name: 'Next Season Roster (Tentative)' }).count()).resolves.toBe(1);
    } finally {
      await opened.context.close();
    }
  });
});
