import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AxeBuilder } from '@axe-core/playwright';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';

// The Recruits page (#1549) in a real browser as a team officer: no WCAG 2.1
// AA violations on each tab and with a dialog open, in dark, light and on a
// phone, no sideways scroll, and the four jobs the issue names: starting a
// trial, extending one with a reason, declining and adding a note.

const HOUR = 3_600_000;
const ago = (ms) => new Date(Date.now() - ms - 60_000).toISOString();
const dayOffset = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const base = {
  name: null,
  class_name: null,
  spec_name: null,
  item_level: null,
  mplus_score: null,
  logs_best_average: null,
  logs_median_average: null,
  mythic_bosses_killed: null,
  source: 'application',
  status: 'waiting_on_officers',
  sent_by: 'nobody',
  sent_by_name: null,
  applied_at: ago(2 * HOUR),
  closed_at: null,
  applicant_last_message_at: null,
  officers_last_message_at: null,
  trial_starts_on: null,
  trial_ends_on: null,
  reminded: false,
  ticket_url: null
};

const RECRUITS = [
  {
    ...base,
    id: 1,
    name_realm: 'Katorrí-Stormrage',
    class_name: 'Warlock',
    spec_name: 'Demonology',
    item_level: 268,
    mplus_score: 2840,
    logs_best_average: 91,
    mythic_bosses_killed: 4,
    sent_by: 'recruiter',
    sent_by_name: 'Dana',
    ticket_url: 'https://discord.com/channels/1/2'
  },
  {
    ...base,
    id: 2,
    name_realm: 'Lumenae-Area 52',
    class_name: 'Shaman',
    spec_name: 'Restoration',
    item_level: 258,
    logs_best_average: 48,
    status: 'waiting_on_applicant',
    applied_at: ago(5 * 24 * HOUR),
    officers_last_message_at: ago(4 * 24 * HOUR),
    reminded: true
  },
  {
    ...base,
    id: 3,
    name_realm: 'Torbjorn-Illidan',
    class_name: 'Warrior',
    spec_name: 'Fury',
    item_level: 270,
    status: 'on_trial',
    trial_starts_on: dayOffset(-11),
    trial_ends_on: dayOffset(3)
  },
  {
    ...base,
    id: 4,
    name_realm: 'Brightmane-Draenor',
    class_name: 'Paladin',
    spec_name: 'Holy',
    item_level: 272,
    status: 'joined',
    closed_at: ago(24 * HOUR)
  }
];

const RECORD = {
  access: 'manage',
  id: 1,
  team_name: 'Team Phoenix',
  name: 'Kat',
  name_realm: 'Katorrí-Stormrage',
  class_name: 'Warlock',
  spec_name: 'Demonology',
  other_specs: ['Destruction'],
  status: 'waiting_on_officers',
  answers: [
    {
      key: 'nights',
      label: 'Can you make our raid nights?',
      prompt: '',
      answer_type: 'short_text',
      answer: 'Every week'
    },
    {
      key: 'log',
      label: "Log you're proud of",
      prompt: '',
      answer_type: 'link',
      answer: 'https://www.warcraftlogs.com/reports/abc'
    }
  ],
  notes: [{ id: 1, author: 'Dana', mine: false, body: 'Great attitude.', source: 'site', created_at: ago(HOUR) }],
  events: [{ kind: 'applied', actor: null, detail: null, created_at: ago(2 * HOUR) }],
  messages: [],
  applied_before: [],
  ticket_deleted_at: null
};

const state = (path) => ({
  path,
  sentinel: '.rcs-layout',
  session: storedSession({ battlenet: 'Kato#1499', discord: 'Phoenix Officer' }),
  who: 'officer',
  rpc: {
    team_recruits: {
      access: 'manage',
      min_item_level: 265,
      needs: [{ role: 'healer', class_spec_id: 1, class: 'Shaman', spec: 'Restoration', priority: 'high' }],
      recruits: RECRUITS
    },
    recruit_record: RECORD,
    add_recruit_note: null,
    start_recruit_trial: 1,
    close_recruit: null,
    extend_recruit_trial: dayOffset(17),
    mark_recruit_joined: null,
    mark_recruit_not_joining: null,
    add_recruit: 9
  },
  tables: {
    classes_specs: [
      { id: 1, class: 'Shaman', spec: 'Restoration', role: 'Heal' },
      { id: 2, class: 'Warlock', spec: 'Demonology', role: 'Ranged' },
      { id: 3, class: 'Warrior', spec: 'Fury', role: 'Melee' }
    ]
  }
});

const PATH = '/g/wga/t/phoenix/officer/recruiting';
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
  'Recruits, $label',
  (variant) => {
    it('has no WCAG 2.1 AA violations on a tab or with a dialog open, and no sideways scroll', async () => {
      const { context, page, unexpected, pageErrors } = await openApp(browser, server.port, {
        ...state(PATH),
        ...variant
      });
      try {
        await page.getByText('Great attitude.').waitFor();
        expect(await axe(page), 'open tab').toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
          0
        );

        await page.getByRole('link', { name: /^On trial/ }).click();
        await page.getByRole('button', { name: 'Extend trial' }).first().click();
        await page.getByRole('dialog').waitFor();
        expect(await axe(page), 'dialog').toEqual([]);
        await page.keyboard.press('Escape');

        expect(unexpected).toEqual([]);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }
);

async function watched(path) {
  const { context, page } = await openApp(browser, server.port, state(path));
  const sent = [];
  page.on('request', (r) => {
    if (/rpc\/(add_recruit_note|start_recruit_trial|close_recruit|extend_recruit_trial)/.test(r.url())) {
      sent.push([r.url().split('/').pop(), r.postDataJSON()]);
    }
  });
  return { context, page, sent };
}

describe('Recruits, in use', () => {
  it('starts a trial', async () => {
    const { context, page, sent } = await watched(PATH);
    try {
      await page.getByRole('button', { name: 'Start a trial' }).click();
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]).toEqual(['start_recruit_trial', { p_application_id: 1 }]);
    } finally {
      await context.close();
    }
  });

  it('extends a trial only with a reason', async () => {
    const { context, page, sent } = await watched(`${PATH}?tab=trial`);
    try {
      await page.getByRole('button', { name: 'Extend trial' }).first().click();
      const go = page.getByRole('dialog').getByRole('button', { name: 'Extend trial' });
      await expect(go.isDisabled()).resolves.toBe(true);
      await page.getByLabel('Why is it extended?').fill('Missed two raids for a move');
      await go.click();
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]).toEqual([
        'extend_recruit_trial',
        { p_application_id: 3, p_reason: 'Missed two raids for a move' }
      ]);
    } finally {
      await context.close();
    }
  });

  it('declines with a reason', async () => {
    const { context, page, sent } = await watched(PATH);
    try {
      await page.getByRole('button', { name: 'Decline' }).click();
      await page.getByLabel('Reason (optional)').fill('Full on healers');
      await page.getByRole('dialog').getByRole('button', { name: 'Decline' }).click();
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]).toEqual([
        'close_recruit',
        { p_application_id: 1, p_status: 'declined', p_reason: 'Full on healers' }
      ]);
    } finally {
      await context.close();
    }
  });

  it('adds a note', async () => {
    const { context, page, sent } = await watched(PATH);
    try {
      await page.getByLabel('Add a note').fill('Wants Thursdays');
      await page.getByRole('button', { name: 'Add note' }).click();
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]).toEqual(['add_recruit_note', { p_application_id: 1, p_body: 'Wants Thursdays' }]);
    } finally {
      await context.close();
    }
  });
});
