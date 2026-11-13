import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';

// My recruits (#1550) in a real browser as a recruiter: no WCAG 2.1 AA
// violations in dark, light and on a phone, no sideways scroll, and the three
// things the issue names: copying a link, adding a note, and the page being
// hidden from anyone who is not a recruiter.

const HOUR = 3600000;
const ago = (ms) => new Date(Date.now() - ms - 60000).toISOString();

const PEOPLE = [
  {
    id: 1,
    team_id: 1,
    guild_id: 1,
    team_name: 'Phoenix',
    name: 'Katorri',
    name_realm: 'Katorri-Stormrage',
    class_name: 'Warlock',
    spec_name: 'Demonology',
    status: 'waiting_on_officers',
    applied_at: ago(2 * HOUR),
    closed_at: null,
    trial_starts_on: null,
    trial_ends_on: null,
    notes: [{ id: 9, body: 'Talked for an hour. Great attitude.', created_at: ago(HOUR) }]
  },
  {
    id: 2,
    team_id: 1,
    guild_id: 1,
    team_name: 'Phoenix',
    name: null,
    name_realm: 'Lumenae-Stormrage',
    class_name: 'Shaman',
    spec_name: 'Restoration',
    status: 'waiting_on_officers',
    applied_at: ago(24 * HOUR),
    closed_at: null,
    trial_starts_on: null,
    trial_ends_on: null,
    notes: []
  },
  {
    id: 3,
    team_id: 2,
    guild_id: 1,
    team_name: 'Hellfire Rollers',
    name: null,
    name_realm: 'Brightmane-Draenor',
    class_name: 'Paladin',
    spec_name: 'Holy',
    status: 'joined',
    applied_at: ago(21 * 24 * HOUR),
    closed_at: null,
    trial_starts_on: null,
    trial_ends_on: null,
    notes: []
  }
];

const TEAMS = [
  { team_id: 1, name: 'Phoenix', slug: 'phoenix', taking_applications: true, spots: [] },
  { team_id: 2, name: 'Hellfire Rollers', slug: 'hellfire-rollers', taking_applications: true, spots: [] }
];

const state = (extra = {}) => ({
  path: '/g/wga/me/recruits',
  sentinel: '.rcs-mine, h1',
  session: storedSession({ battlenet: 'Kato#1499', discord: 'Recruiter' }),
  who: 'member',
  rpc: {
    my_recruiter_code: 'r8t2r8t2',
    my_recruits: PEOPLE,
    team_recruiting_page: TEAMS,
    add_recruit_note: 1
  },
  ...extra
});

const WCAG_21_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

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

async function axe(page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const results = await new AxeBuilder({ page }).withTags(WCAG_21_AA).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe.each([{ label: 'dark' }, { label: 'light', colorScheme: 'light' }, { label: 'on a phone', viewport: NARROW }])(
  'My recruits, $label',
  (variant) => {
    it('has no WCAG 2.1 AA violations, with a note form open, and no sideways scroll', async () => {
      const { context, page, unexpected, pageErrors } = await openApp(browser, server.port, {
        ...state(),
        ...variant
      });
      try {
        await page.getByText('Talked for an hour. Great attitude.').waitFor();
        expect(await axe(page), 'page').toEqual([]);
        await page
          .getByRole('button', { name: /Add a note/ })
          .first()
          .click();
        expect(await axe(page), 'note form open').toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
          0
        );
        expect(unexpected).toEqual([]);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
);

describe('My recruits, in use', () => {
  it('copies a link', async () => {
    const { context, page } = await openApp(browser, server.port, state());
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    try {
      await page.getByLabel('Phoenix link').waitFor();
      await page.getByRole('button', { name: /Copy\s*Phoenix link/ }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toMatch(/\/g\/wga\/apply\/phoenix\?from=r8t2r8t2$/);
      await expect.poll(() => page.getByRole('button', { name: /Copied/ }).count()).toBe(1);
    } finally {
      await context.close();
    }
  });

  it('adds a note for a person', async () => {
    const { context, page } = await openApp(browser, server.port, state());
    const sent = [];
    page.on('request', (r) => {
      if (/rpc\/add_recruit_note/.test(r.url())) sent.push(r.postDataJSON());
    });
    try {
      const lumenae = page.locator('li', { hasText: 'Lumenae' }).last();
      await lumenae.getByRole('button', { name: /Add a note/ }).click();
      await lumenae.getByLabel(/Your note for Phoenix/).fill('Can do Wed/Thu.');
      await lumenae.getByRole('button', { name: 'Save note' }).click();
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]).toEqual({ p_application_id: 2, p_body: 'Can do Wed/Thu.' });
    } finally {
      await context.close();
    }
  });

  it('shows My recruits in the sidebar to a recruiter only', async () => {
    const yes = await openApp(browser, server.port, state());
    try {
      await yes.page.getByRole('link', { name: 'My recruits, 2 waiting' }).waitFor();
    } finally {
      await yes.context.close();
    }
    const no = await openApp(browser, server.port, {
      ...state({ rpc: { my_recruiter_code: null, team_recruiting_page: TEAMS } }),
      path: '/g/wga/t/phoenix/roster',
      sentinel: 'h1'
    });
    try {
      await no.page.getByRole('heading', { level: 1 }).first().waitFor();
      expect(await no.page.getByRole('link', { name: /My recruits/ }).count()).toBe(0);
    } finally {
      await no.context.close();
    }
  });

  it('is hidden from someone who is not a recruiter, by its address too', async () => {
    const { context, page } = await openApp(
      browser,
      server.port,
      state({ rpc: { my_recruiter_code: null, team_recruiting_page: TEAMS } })
    );
    try {
      await page.getByRole('heading', { name: 'Page not found' }).waitFor();
      expect(await page.getByText('Your links').count()).toBe(0);
      expect(await page.getByRole('heading', { name: 'My recruits' }).count()).toBe(0);
    } finally {
      await context.close();
    }
  });
});
