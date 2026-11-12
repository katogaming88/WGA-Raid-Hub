import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';

// Recruiting settings (#1548) in a real browser as a team officer: no WCAG 2.1
// AA violations with each section open, in dark, light and on a phone, no
// sideways scroll, and the save bar that does not move the page.

const SERVER = '100000000000000001';
const TICKETS = '100000000000000777';

const SETTINGS = {
  taking_applications: true,
  join_method: 'application',
  ticket_link: null,
  listed_on_guild_page: true,
  about: '# Phoenix\n\nWe raid **Wednesday**.',
  schedule_note: null,
  extra_night: 'none',
  raid_languages: ['English'],
  split_runs: 'none',
  alts_expected: null,
  ptr_testing: 'none',
  min_item_level: 265,
  attendance_percent: 90,
  trial_days: 14,
  logs_required: true,
  other_requirements: null,
  exceptional_line_on: true,
  exceptional_line: 'Exceptional players of any class or spec are welcome to apply.',
  discord_mode: 'ticket',
  officer_thread_with_ticket: false,
  add_to_server: true,
  ticket_category_id: TICKETS,
  visible_to_team_officers: true,
  visible_to_team_assistants: false,
  visible_to_guild_admins: false,
  visible_to_role_ids: [],
  dm_reply_after_minutes: 120,
  remind_after_hours: 48,
  close_no_reply_after_hours: 120,
  ping_officers_after_hours: 24,
  ping_owner_after_hours: 72,
  trial_end_notice_hours: 48,
  delete_closed_after_hours: 24,
  spots: [
    { role: 'healer', class_spec_id: 1, priority: 'high', class: 'Shaman', spec: 'Restoration' },
    { role: 'ranged', class_spec_id: null, priority: 'low', class: null, spec: null }
  ]
};

const STATE = {
  path: '/g/wga/t/phoenix/officer/recruiting/settings',
  sentinel: '.rec-form',
  session: storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Officer' }),
  who: 'officer',
  rpc: {
    team_recruiting_settings: SETTINGS,
    // The writes answer nothing, as the functions do.
    save_team_recruiting: null,
    set_team_recruiting_spots: null,
    save_team_application_questions: null,
    team_application_questions: {
      starters: [
        {
          key: 'about',
          group: 'About them',
          label: 'A line about themselves',
          prompt: 'Tell the team about yourself.',
          answer_type: 'short_text',
          max_length: 100,
          choices: [],
          on: true,
          required: true
        },
        {
          key: 'sent_by',
          group: 'How they found you',
          label: 'Who sent them',
          prompt: 'Who sent you?',
          answer_type: 'recruiter',
          max_length: null,
          choices: [],
          on: true,
          required: false
        }
      ],
      questions: [
        {
          id: 9,
          label: 'Voice',
          prompt: 'Can you use voice?',
          answer_type: 'yes_no',
          max_length: null,
          choices: null,
          required: true
        }
      ]
    },
    team_ticket_viewers: [
      { display_name: 'Aur', viewer_group: 'officer', discord_linked: true },
      { display_name: 'Kestrel', viewer_group: 'officer', discord_linked: false }
    ],
    team_discord_settings: {
      server_id: SERVER,
      quiet_hours: null,
      posts: [{ kind: 'officer_requests', channel_id: '201', ping_role_id: null, last_posted_at: null }],
      sheets: []
    }
  },
  tables: {
    classes_specs: [
      { id: 1, class: 'Shaman', spec: 'Restoration', role: 'Heal' },
      { id: 2, class: 'Druid', spec: 'Balance', role: 'Ranged' },
      { id: 3, class: 'Warrior', spec: 'Protection', role: 'Tank' }
    ],
    raid_schedule: [
      {
        id: 1,
        weekday: 3,
        start_time: '20:00:00',
        timezone: 'America/New_York',
        duration_minutes: 180,
        active: true,
        is_optional: false,
        difficulty: null
      }
    ]
  },
  functionAnswers: {
    'discord-settings': {
      success: true,
      hasDiscord: true,
      servers: [{ id: SERVER, name: 'We Go Again' }],
      channelId: null,
      server: {
        id: SERVER,
        name: 'We Go Again',
        botIn: true,
        channels: [{ id: '201', name: 'phoenix-officers', category: null, missing: [] }],
        categories: [{ id: TICKETS, name: 'Tickets', missing: ['Manage Channels'] }],
        roles: [{ id: '301', name: 'Recruiter' }]
      }
    }
  }
};

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

const SECTIONS = [
  'Recruiting Taking applications',
  'About the team',
  'How you raid',
  'What you ask for',
  'Application questions',
  "Who you're looking for",
  'Discord'
];

describe.each([
  { label: 'dark', ...STATE },
  { label: 'light', ...STATE, colorScheme: 'light' },
  { label: 'on a phone', ...STATE, viewport: NARROW }
])('Recruiting settings, $label', (state) => {
  it('has no WCAG 2.1 AA violations in any section, no stray requests and no sideways scroll', async () => {
    const { context, page, unexpected, pageErrors } = await openApp(browser, server.port, state);
    try {
      for (const name of SECTIONS) {
        await page
          .locator('.rec-form')
          .getByRole('button', { name: new RegExp(`^${name}`) })
          .click();
        expect(await axe(page), name).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          name
        ).toBeLessThanOrEqual(0);
      }
      expect(unexpected).toEqual([]);
      expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});

describe('Recruiting settings, in use', () => {
  it('opens one section at a time, and the save bar stays the same size', async () => {
    const { context, page } = await openApp(browser, server.port, STATE);
    try {
      const form = page.locator('.rec-form');
      const open = () => page.locator('.rec-heading button[aria-expanded="true"]').count();
      await expect(open()).resolves.toBe(1);
      const before = await page.locator('.rec-savebar').boundingBox();
      await form.getByRole('button', { name: /^How you raid/ }).click();
      await expect(open()).resolves.toBe(1);
      // Greyed until something changes.
      await expect(page.getByRole('button', { name: 'Save settings' }).isDisabled()).resolves.toBe(true);
      await form.getByRole('button', { name: /^Recruiting Taking applications/ }).click();
      await page.getByRole('checkbox', { name: /List on the guild's apply page/ }).uncheck();
      await expect(page.getByRole('button', { name: 'Save settings' }).isEnabled()).resolves.toBe(true);
      const after = await page.locator('.rec-savebar').boundingBox();
      expect(Math.round(after.height)).toBe(Math.round(before.height));
    } finally {
      await context.close();
    }
  });

  it('saves what changed: a spot added and ranked, and a question switched off', async () => {
    const { context, page } = await openApp(browser, server.port, STATE);
    const sent = [];
    page.on('request', (r) => {
      if (/rpc\/(save_team_recruiting|set_team_recruiting_spots|save_team_application_questions)/.test(r.url())) {
        sent.push([r.url().split('/').pop(), r.postDataJSON()]);
      }
    });
    try {
      const form = page.locator('.rec-form');
      await form.getByRole('button', { name: /^Who you're looking for/ }).click();
      await page.getByLabel('Add a tanks spot').selectOption({ label: 'Protection Warrior' });
      await page.getByRole('button', { name: 'Add to Tanks' }).click();
      await page.getByLabel('Priority for Protection Warrior').selectOption('high');
      await form.getByRole('button', { name: /^Application questions/ }).click();
      await page.getByRole('checkbox', { name: /A line about themselves/ }).uncheck();
      await page.getByRole('button', { name: 'Save settings' }).click();
      await expect.poll(() => sent.length).toBe(2);
      const byName = Object.fromEntries(sent);
      expect(byName.set_team_recruiting_spots.p_spots).toEqual([
        { role: 'healer', class_spec_id: 1, priority: 'high' },
        { role: 'ranged', class_spec_id: null, priority: 'low' },
        { role: 'tank', class_spec_id: 3, priority: 'high' }
      ]);
      expect(byName.save_team_application_questions.p_starters.about).toEqual({ on: false, required: false });
    } finally {
      await context.close();
    }
  });
});
