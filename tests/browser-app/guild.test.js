import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';
import { GUILD_TABLES, WAITING } from './guild-fixtures.js';
import {
  TEAMS,
  EXPECTED_TEAMS,
  MEMBER,
  EXPECTED_MEMBER_TEAMS,
  ARCHIVED_AT,
  EXPECTED_LIVE,
  NOBODY_LIVE,
  EXPECTED_NEWS,
  EXPECTED_OFFICERS,
  LINKS
} from '../behavior/guild.js';

// The new app's Guild home against the behavior recorded from the current
// site's guild.html (tests/browser/guild-recorded.test.js, #1102 step 1), plus
// what the redesign changes on purpose.

const STATE = { path: '/g/wga', sentinel: '.guild-team', teams: TEAMS, tables: GUILD_TABLES };

const onTeam = (teamId, role, archivedAt = null) => ({
  discordId: MEMBER.discordId,
  person: {
    site_admin: false,
    guild_officer: false,
    boe_manager: false,
    teams: [
      {
        team_id: teamId,
        team_member_id: 42,
        role,
        characters: [{ player_id: 42, name_realm: MEMBER.nameRealm, url_code: null, archived_at: archivedAt }]
      }
    ]
  }
});

const signedIn = { session: storedSession({ discord: MEMBER.name }) };

// The shapes tests/behavior/guild.js describes, read from the new markup.
const readTeams = (page) =>
  page.locator('.guild-team').evaluateAll((cards) =>
    cards.map((card) => {
      const links = [...card.querySelectorAll('a')];
      const logs = links.find((a) => a.textContent.trim() === 'Logs');
      return {
        name: card.querySelector('h2').textContent.trim(),
        mine: card.querySelector('.guild-tag-mine') !== null,
        signup: links.some((a) => a.textContent.trim() === 'Sign up'),
        logs: logs ? logs.getAttribute('href') : null
      };
    })
  );

const readLive = (page) =>
  page.locator('.guild-live .stream-name').evaluateAll((els) => els.map((el) => el.textContent.trim()));

const readNews = (page) =>
  page.locator('.guild-news li').evaluateAll((items) =>
    items.map((item) => ({
      title: item.querySelector('.guild-news-title').textContent.trim(),
      date: item.querySelector('time').getAttribute('datetime')
    }))
  );

const readOfficers = (page) =>
  page.locator('.guild-officer').evaluateAll((rows) =>
    rows.map((row) => ({
      name: row.querySelector('.guild-officer-name').textContent.trim(),
      title: row.querySelector('.guild-officer-title').textContent.trim()
    }))
  );

const readLinks = async (page) => ({
  raiderIo: await page.getByRole('link', { name: 'Raider.IO' }).getAttribute('href'),
  armory: await page.getByRole('link', { name: 'Armory' }).getAttribute('href')
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

describe('Guild home (new app), signed out', () => {
  let opened;

  beforeAll(async () => {
    opened = await open({});
    await opened.page.waitForSelector('.guild-officer');
    await opened.page.waitForSelector('.guild-live .stream-name');
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('shows a card per team, with Sign up only while signups are open and Logs only when set', async () => {
    expect(await readTeams(opened.page)).toEqual(EXPECTED_TEAMS);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('shows who is live, leaving out anyone who opted out of other teams’ pages', async () => {
    expect(await readLive(opened.page)).toEqual(EXPECTED_LIVE);
  });

  it('shows the three newest news entries', async () => {
    expect(await readNews(opened.page)).toEqual(EXPECTED_NEWS);
  });

  it('lists the guild officers in order', async () => {
    expect(await readOfficers(opened.page)).toEqual(EXPECTED_OFFICERS);
  });

  it('links to the guild on Raider.IO and the Armory', async () => {
    expect(await readLinks(opened.page)).toEqual(LINKS);
  });

  it('names the guild and its realm, and marks Guild home in the sidebar', async () => {
    const { page } = opened;
    await expect(page.getByRole('heading', { level: 1 }).textContent()).resolves.toBe('We Go Again');
    await expect(page.locator('.page-subtitle').textContent()).resolves.toBe(
      'Three raid teams on Tichondrius. Pick yours, or find one to join.'
    );
    await expect(page.getByRole('link', { name: 'Guild home' }).getAttribute('aria-current')).resolves.toBe('page');
  });

  it('opens each team from its card, and shows the team’s size', async () => {
    const card = opened.page.getByRole('article', { name: 'Phoenix' });
    await expect(card.getByRole('link', { name: 'Open Phoenix' }).getAttribute('href')).resolves.toBe(
      '/g/wga/t/phoenix'
    );
    await expect(card.getByRole('link', { name: 'Sign up' }).getAttribute('href')).resolves.toBe(
      '/g/wga/t/phoenix/signup'
    );
    await expect(card.locator('.guild-team-progress').textContent()).resolves.toBe('2 raiders');
  });

  // Deliberate: the page's players are the live ones, and the floating widget
  // belongs to the team pages.
  it('plays each live stream on the page, with no floating stream widget', async () => {
    await expect(opened.page.locator('.guild-live iframe').count()).resolves.toBe(EXPECTED_LIVE.length);
    await expect(opened.page.locator('.stream-widget').count()).resolves.toBe(0);
  });

  it('shows no officers’ panel to a visitor', async () => {
    await expect(opened.page.getByRole('heading', { name: 'Needs your attention' }).count()).resolves.toBe(0);
  });
});

describe('Guild home (new app), other states', () => {
  // Until the site front page exists (#1226).
  it('opens Guild home from the site address', async () => {
    const { context, page } = await open({ path: '/' });
    try {
      expect(new URL(page.url()).pathname).toBe('/g/wga');
    } finally {
      await context.close();
    }
  });

  it('marks the team a signed-in raider has a character on', async () => {
    const { context, page } = await open({ ...signedIn, person: onTeam(MEMBER.teamId, 'raider') });
    try {
      await page.waitForSelector('.guild-tag-mine');
      expect(await readTeams(page)).toEqual(EXPECTED_MEMBER_TEAMS);
      // A raider has nothing waiting on them.
      await expect(page.getByRole('heading', { name: 'Needs your attention' }).count()).resolves.toBe(0);
    } finally {
      await context.close();
    }
  });

  it('does not mark a team for an archived character', async () => {
    const { context, page } = await open({ ...signedIn, person: onTeam(MEMBER.teamId, 'raider', ARCHIVED_AT) });
    try {
      await page.waitForSelector('.account-who');
      expect(await readTeams(page)).toEqual(EXPECTED_TEAMS);
    } finally {
      await context.close();
    }
  });

  // Deliberate: the current page says "No one is live right now."
  it('leaves Live now out when nobody is live', async () => {
    const { context, page } = await open({ tables: { ...GUILD_TABLES, streamers: NOBODY_LIVE } });
    try {
      await page.waitForSelector('.guild-officer');
      await expect(page.getByRole('heading', { name: 'Live now' }).count()).resolves.toBe(0);
    } finally {
      await context.close();
    }
  });

  it('leaves the officers out when there are none', async () => {
    const { context, page } = await open({ tables: { ...GUILD_TABLES, site_settings: [{ guild_officer_bios: [] }] } });
    try {
      await page.waitForSelector('.guild-news li');
      await expect(page.getByRole('heading', { name: 'Guild officers' }).count()).resolves.toBe(0);
    } finally {
      await context.close();
    }
  });

  // Deliberate (Kat, 2026-09-17): every team that is not archived.
  it('lists Wrathless, and leaves an archived team out', async () => {
    const teams = [
      ...TEAMS,
      { id: 4, name: 'Wrathless', slug: 'wrathless', archived_at: null },
      { id: 5, name: 'Old Team', slug: 'old-team', archived_at: '2026-01-01T00:00:00+00:00' }
    ];
    const { context, page } = await open({ teams });
    try {
      const names = (await readTeams(page)).map((t) => t.name);
      expect(names).toEqual(['Phoenix', 'Hellfire Rollers', 'Immolation', 'Wrathless']);
      await expect(page.locator('.page-subtitle').textContent()).resolves.toMatch(/^Four raid teams/);
    } finally {
      await context.close();
    }
  });

  // Deliberate: new on this page (Kat, 2026-09-17).
  it('shows an officer what is waiting on their team', async () => {
    const { context, page } = await open({
      ...signedIn,
      person: onTeam(1, 'officer'),
      tables: { ...GUILD_TABLES, ...WAITING }
    });
    try {
      const panel = page.getByRole('region', { name: 'Needs your attention' });
      await panel.getByRole('link').first().waitFor();
      const links = await panel
        .getByRole('link')
        .evaluateAll((els) =>
          els.map((el) => [
            el.querySelector('.guild-attention-label').textContent,
            el.querySelector('.count-badge').textContent,
            el.getAttribute('href')
          ])
        );
      expect(links).toEqual([
        ['Received-item reviews', '3', '/g/wga/t/phoenix/officer/reviews'],
        ['BoE finds to price', '1', '/g/wga/boe']
      ]);
      // The sidebar leads with the Guild group here, and keeps the officer's
      // tools for the team its links go to.
      const headings = await page.locator('.nav-heading').allTextContents();
      expect(headings).toEqual(['Guild', 'Team', 'You', 'Officer']);
    } finally {
      await context.close();
    }
  });

  it('tells an officer when nothing is waiting', async () => {
    const { context, page } = await open({ ...signedIn, person: onTeam(1, 'officer') });
    try {
      await page.getByText('Nothing is waiting on you.').waitFor();
    } finally {
      await context.close();
    }
  });

  it('fits a narrow screen without scrolling sideways', async () => {
    const { context, page } = await open({ viewport: NARROW });
    try {
      await page.waitForSelector('.guild-live .stream-name');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await context.close();
    }
  });
});
