import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, fixture, REPO_ROOT } from './harness.js';
import { SCENARIO, EXPECTED_CURRENT, EXPECTED_INCOMING, withoutCounts } from '../behavior/roster.js';

// The Roster tab as the current site shows it, recorded so the new app's
// Roster page can be checked against the same expectations
// (tests/behavior/roster.js, #1102 step 1).

const settings = (activeSignupSeason) =>
  fixture('team_settings', []).map((row) => ({ ...row, config: { ...row.config, activeSignupSeason } }));

const overrides = (incoming, activeSignupSeason = SCENARIO.activeSignupSeason) => ({
  players: SCENARIO.players,
  incoming_roster: incoming,
  team_settings: settings(activeSignupSeason)
});

const STATE = {
  label: 'roster',
  path: '/index.html?team=phoenix#roster',
  sentinel: '#rosterView .roster-table tbody tr'
};

// The table's rows, as tests/behavior/roster.js describes a roster.
function readTable(section) {
  return section.evaluate((root) => {
    const groups = [];
    for (const tr of root.querySelectorAll('.roster-table tbody tr')) {
      if (tr.classList.contains('group-header')) {
        const m = /^(.*?)(?: \((\d+)\))?$/.exec(tr.textContent.trim());
        groups.push({ label: m[1], count: m[2] ? Number(m[2]) : null, rows: [] });
        continue;
      }
      const spans = tr.querySelectorAll('.player-name-cell > span');
      const character = spans[1] ? spans[1].textContent.trim().replace(/^\((.*)\)$/, '$1') : null;
      groups[groups.length - 1].rows.push({
        name: spans[0].textContent.trim(),
        character,
        spec: tr.querySelector('.badge-class')?.textContent.trim() ?? null
      });
    }
    return { groups };
  });
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

describe('Roster tab (current site)', () => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, STATE, overrides(SCENARIO.incoming));
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('groups the roster by role and sorts each group by the name shown', async () => {
    expect(withoutCounts(await readTable(opened.page.locator('#rosterView')))).toEqual(EXPECTED_CURRENT);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('offers next season’s roster, named for the signup season, with its approved signups', async () => {
    const tab = opened.page.locator('#rosterSubTabIncoming');
    await expect(tab.textContent()).resolves.toBe(EXPECTED_INCOMING.tabLabel);
    await tab.click();
    const section = opened.page.locator('#incomingRosterSection');
    await expect(section.locator('.pub-loot-title').textContent()).resolves.toBe(EXPECTED_INCOMING.title);
    expect(await readTable(section)).toEqual({ groups: EXPECTED_INCOMING.groups });
  });
});

describe('Roster tab (current site), without approved signups', () => {
  it('shows no next-season tab', async () => {
    const opened = await openState(browser, server.port, STATE, overrides([]));
    try {
      await expect(opened.page.locator('#rosterSubNav').isVisible()).resolves.toBe(false);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Roster tab (current site), before a signup season is named', () => {
  it('calls the tab Next Season Roster', async () => {
    const opened = await openState(browser, server.port, STATE, overrides(SCENARIO.incoming, ''));
    try {
      await expect(opened.page.locator('#rosterSubTabIncoming').textContent()).resolves.toBe(
        'Next Season Roster (Tentative)'
      );
    } finally {
      await opened.context.close();
    }
  });
});
