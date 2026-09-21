import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, storedDiscordSession, REPO_ROOT } from './harness.js';
import {
  TEAM_SETTINGS,
  TEAM_SEASONS,
  EXPECTED_TEAMS,
  MEMBER,
  EXPECTED_MEMBER_TEAMS,
  ARCHIVED_AT,
  STREAMS,
  EXPECTED_LIVE,
  NOBODY_LIVE,
  EXPECTED_NEWS,
  OFFICER_BIOS,
  EXPECTED_OFFICERS,
  LINKS
} from '../behavior/guild.js';

// The guild landing page as the current site shows it -- team cards, live
// streams, the news teaser, guild officers and the guild's links -- recorded
// so the new app's Guild home can be checked against the same expectations
// (tests/behavior/guild.js, #1102 step 1).

const overrides = ({ streamers = STREAMS, bios = OFFICER_BIOS, members = [] } = {}) => ({
  team_settings: TEAM_SETTINGS,
  team_seasons: TEAM_SEASONS,
  streamers,
  site_settings: [{ id: 1, maintenance_mode: false, maintenance_message: '', guild_officer_bios: bios }],
  team_members: members
});

const STATE = { label: 'guild-home', path: '/guild.html', sentinel: '#guildTeams .guild-team-card' };

// The shapes tests/behavior/guild.js describes, read from guild.html.
const readTeams = (page) =>
  page.locator('#guildTeams .guild-team-card').evaluateAll((cards) =>
    cards.map((card) => {
      const links = [...card.querySelectorAll('.guild-team-links a')];
      const logs = links.find((a) => a.textContent.trim() === 'Logs');
      return {
        name: card.querySelector('.guild-team-name').textContent.trim(),
        mine: card.querySelector('.guild-team-badge') !== null,
        signup: links.some((a) => a.textContent.trim() === 'Sign up'),
        logs: logs ? logs.getAttribute('href') : null
      };
    })
  );

const readLive = (page) =>
  page.locator('#guildStreams .stream-card .stream-name').evaluateAll((els) => els.map((el) => el.textContent.trim()));

const readNews = (page) =>
  page.locator('#guildNews .guild-news-item').evaluateAll((items) =>
    items.map((item) => ({
      title: item.querySelector('.guild-news-title').textContent.trim(),
      date: item.querySelector('.guild-news-date').textContent.trim()
    }))
  );

const readOfficers = (page) =>
  page.locator('#guildBios .bio-card').evaluateAll((cards) =>
    cards.map((card) => {
      const name = card.querySelector('.bio-name').cloneNode(true);
      name.querySelector('.bio-pronouns')?.remove();
      return { name: name.textContent.trim(), title: card.querySelector('.bio-title').textContent.trim() };
    })
  );

const readLinks = async (page) => ({
  raiderIo: await page.getByRole('link', { name: 'Raider.IO' }).getAttribute('href'),
  armory: await page.getByRole('link', { name: 'Armory' }).getAttribute('href')
});

const memberRow = (archivedAt = null) => ({
  team_id: MEMBER.teamId,
  players: [{ name_realm: MEMBER.nameRealm, archived_at: archivedAt }]
});

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

describe('Guild home (current site), signed out', () => {
  let opened;

  beforeAll(async () => {
    opened = await openState(browser, server.port, STATE, overrides());
    await opened.page.waitForSelector('#guildBios .bio-card');
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
});

describe('Guild home (current site), other states', () => {
  it('marks the team a signed-in raider has a character on', async () => {
    const opened = await openState(
      browser,
      server.port,
      { ...STATE, label: 'guild-home-member', session: storedDiscordSession(MEMBER) },
      overrides({ members: [memberRow()] })
    );
    try {
      await opened.page.waitForSelector('#guildTeams .guild-team-badge');
      expect(await readTeams(opened.page)).toEqual(EXPECTED_MEMBER_TEAMS);
    } finally {
      await opened.context.close();
    }
  });

  it('does not mark a team for an archived character', async () => {
    const opened = await openState(
      browser,
      server.port,
      { ...STATE, label: 'guild-home-archived', session: storedDiscordSession(MEMBER) },
      overrides({ members: [memberRow(ARCHIVED_AT)] })
    );
    try {
      await opened.page.waitForSelector('#guildLoading', { state: 'hidden' });
      expect(await readTeams(opened.page)).toEqual(EXPECTED_TEAMS);
    } finally {
      await opened.context.close();
    }
  });

  it('shows nobody live when nobody is', async () => {
    const opened = await openState(
      browser,
      server.port,
      { ...STATE, label: 'guild-home-offline', sentinel: '#guildStreams .guild-empty' },
      overrides({ streamers: NOBODY_LIVE })
    );
    try {
      expect(await readLive(opened.page)).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  it('leaves the officers out when there are none', async () => {
    const opened = await openState(
      browser,
      server.port,
      { ...STATE, label: 'guild-home-no-bios' },
      overrides({ bios: [] })
    );
    try {
      await opened.page.waitForSelector('#guildLoading', { state: 'hidden' });
      await expect(opened.page.locator('#about').isHidden()).resolves.toBe(true);
    } finally {
      await opened.context.close();
    }
  });
});
