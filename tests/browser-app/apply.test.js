import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { launchBrowser, openApp, startApp, NARROW } from './harness.js';

// The public apply pages (#1546) in a real browser, signed out: no violations
// at WCAG 2.1 AA in dark and light, no sideways scroll on a phone, and the
// role filter. The pages' rules are in app/src/apply/apply.test.tsx.

const NIGHT = {
  weekday: 3,
  start_time: '20:00:00',
  timezone: 'America/New_York',
  duration_minutes: 180,
  is_optional: false,
  difficulty: null
};

const TEAM = {
  team_id: 1,
  name: 'Phoenix',
  slug: 'phoenix',
  taking_applications: true,
  join_method: 'application',
  ticket_link: null,
  about: 'Cutting Edge Mythic. Two nights, tight roster.',
  schedule_note: null,
  extra_night: 'none',
  raid_languages: ['English'],
  split_runs: 'none',
  alts_expected: 1,
  ptr_testing: 'none',
  min_item_level: 265,
  attendance_percent: 90,
  trial_days: 14,
  logs_required: true,
  other_requirements: null,
  exceptional_line: 'Exceptional players of any class or spec are welcome to apply.',
  spots: [
    { role: 'healer', class_spec_id: 264, class: 'Shaman', spec: 'Restoration', priority: 'high' },
    { role: 'ranged', class_spec_id: null, class: null, spec: null, priority: 'low' }
  ],
  nights: [NIGHT, { ...NIGHT, weekday: 0, is_optional: true }],
  progress: [
    { zone: 'Raid', season: 1, boss: 'A', mythic_date: '2026-10-01', heroic_date: '2026-09-01' },
    { zone: 'Raid', season: 1, boss: 'B', mythic_date: null, heroic_date: '2026-09-02' }
  ]
};

const TICKET = {
  ...TEAM,
  team_id: 2,
  name: 'Immolation',
  slug: 'immolation',
  join_method: 'discord_ticket',
  ticket_link: 'https://discord.gg/ticket',
  spots: [{ role: 'tank', class_spec_id: null, class: null, spec: null, priority: 'high' }]
};

const CLOSED = { ...TEAM, team_id: 3, name: 'Wrathless', slug: 'wrathless', taking_applications: false };

const GUILD = { path: '/g/wga/apply', sentinel: '.apply-card', rpc: { team_recruiting_page: [TEAM, TICKET, CLOSED] } };
const TEAM_PAGE = { path: '/g/wga/apply/phoenix', sentinel: '.apply-grid', rpc: { team_recruiting_page: [TEAM] } };

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

describe.each([
  { label: 'the guild page', ...GUILD },
  { label: 'the guild page, light', ...GUILD, colorScheme: 'light' },
  { label: 'the guild page, on a phone', ...GUILD, viewport: NARROW },
  { label: 'a team page', ...TEAM_PAGE },
  { label: 'a team page, light', ...TEAM_PAGE, colorScheme: 'light' },
  { label: 'a team page, on a phone', ...TEAM_PAGE, viewport: NARROW }
])('$label, signed out', (state) => {
  it('has no WCAG 2.1 AA violations, no stray requests and no sideways scroll', async () => {
    const { context, page, unexpected, pageErrors } = await openApp(browser, server.port, state);
    try {
      expect(await axe(page)).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
        0
      );
    } finally {
      await context.close();
    }
  });
});

describe('the role filter', () => {
  it('outlines the teams that need the role and keeps the filter without them clean', async () => {
    const { context, page } = await openApp(browser, server.port, GUILD);
    try {
      await page.getByRole('radio', { name: 'Healer' }).check();
      await expect(page.locator('.apply-match').count()).resolves.toBe(1);
      await expect(page.locator('.apply-match .apply-needs').textContent()).resolves.toBe('Needs a healer');
      await expect(page.locator('.apply-faded').count()).resolves.toBe(2);
      await page.getByRole('radio', { name: 'Anything' }).check();
      await expect(page.locator('.apply-match').count()).resolves.toBe(0);
    } finally {
      await context.close();
    }
  });
});
