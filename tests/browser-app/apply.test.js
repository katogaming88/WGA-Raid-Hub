import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';

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

// The application form (#1547), signed in with Battle.net and Discord, back
// from Battle.net with a token. The fake answers the character list, its
// numbers, the form, and the send.
const FORM_STATE = {
  path: '/g/wga/apply/phoenix/form',
  sentinel: '#character',
  session: storedSession({ battlenet: 'Katorri#1', discord: 'Katorri', providerToken: 'battlenet-token' }),
  sessionStorage: { 'wga-auth-intent': 'signup-character', 'wga-auth-provider': 'custom:battlenet' },
  rpc: {
    team_recruiting_page: [TEAM],
    team_application_form: {
      starters: [
        {
          key: 'about',
          group: 'About them',
          label: 'A line',
          prompt: 'Tell the team about yourself.',
          answer_type: 'short_text',
          max_length: 100,
          choices: [],
          required: true
        },
        {
          key: 'sent_by',
          group: 'How',
          label: 'Who',
          prompt: 'Who sent you?',
          answer_type: 'recruiter',
          max_length: null,
          choices: [],
          required: false
        }
      ],
      questions: [
        {
          id: 9,
          label: 'Voice',
          prompt: 'Can you listen on voice?',
          answer_type: 'yes_no',
          max_length: null,
          choices: null,
          required: true
        }
      ]
    },
    guild_active_recruiters: [{ name: 'Rexa', code: 'abcd1234' }],
    send_application: 55
  },
  tables: {
    classes_specs: [
      { spec: 'Affliction', role: 'Ranged' },
      { spec: 'Demonology', role: 'Ranged' }
    ],
    characters: [{ id: 7 }]
  },
  functionAnswers: {
    'battlenet-characters': {
      characters: [
        {
          blizzard_id: 77,
          name: 'Katorri',
          realm: 'Stormrage',
          realm_slug: 'stormrage',
          class_name: 'Warlock',
          spec_name: 'Demonology',
          level: 90,
          item_level: 250,
          saved: false,
          roster: null
        }
      ],
      roster: []
    },
    'character-stats': {
      success: true,
      failed: ['mythic_keystone'],
      character: {
        item_level: 250,
        mplus_score: null,
        heroic_logs: { best: 91, median: 80 },
        mythic_logs: null,
        mythic_bosses_killed: { killed: 4, total: 9 }
      }
    },
    'discord-join': { success: true, status: 'off' }
  }
};

describe.each([
  { label: 'the form', ...FORM_STATE },
  { label: 'the form, light', ...FORM_STATE, colorScheme: 'light' },
  { label: 'the form, on a phone', ...FORM_STATE, viewport: NARROW }
])('$label, signed in', (state) => {
  it('has no WCAG 2.1 AA violations after a character is picked, and no sideways scroll', async () => {
    const { context, page, unexpected, pageErrors } = await openApp(browser, server.port, state);
    try {
      await page.locator('#character').selectOption('77');
      await page.getByText('Couldn’t load').waitFor();
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

describe('the application form, in use', () => {
  it('shows a failed number on its own and the friend box only for a friend', async () => {
    const { context, page } = await openApp(browser, server.port, FORM_STATE);
    try {
      await page.locator('#character').selectOption('77');
      await page.getByText('Couldn’t load').waitFor();
      await expect(page.getByText('Couldn’t load').count()).resolves.toBe(1);
      await expect(page.getByText('91', { exact: true }).count()).resolves.toBe(1);
      await expect(page.locator('#friend').count()).resolves.toBe(0);
      await page.locator('#sent-by').selectOption('friend');
      await expect(page.locator('#friend').count()).resolves.toBe(1);
    } finally {
      await context.close();
    }
  });

  it('holds back a missing required answer, then sends a full application', async () => {
    const { context, page } = await openApp(browser, server.port, FORM_STATE);
    const sent = [];
    page.on('request', (r) => {
      if (r.url().includes('rpc/send_application')) sent.push(r.postDataJSON());
    });
    try {
      await page.locator('#character').selectOption('77');
      await page.getByRole('button', { name: 'Send application' }).click();
      await expect(page.getByText('Please answer this.').count()).resolves.toBe(2);
      expect(sent).toEqual([]);

      await page.getByLabel('Tell the team about yourself.').fill('Hi there');
      await page.getByRole('radio', { name: 'Yes' }).check();
      await page.getByRole('button', { name: 'Send application' }).click();
      await page.waitForURL('**/g/wga/applications/55');
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ p_team_id: 1, p_character_id: 7, p_answers: { about: 'Hi there', 9: true } });
    } finally {
      await context.close();
    }
  });
});
