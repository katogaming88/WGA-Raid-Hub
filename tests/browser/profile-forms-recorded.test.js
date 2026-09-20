import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, fixture, storedDiscordSession, REPO_ROOT } from './harness.js';
import {
  ATTENDANCE,
  GEAR,
  LOOT,
  MPLUS_REJECTIONS,
  PLAYERS,
  PRIORITY_ITEMS,
  PRIORITY_ORDER,
  RAID_ZONES,
  SEASON,
  SELF_RECEIVED,
  TIER_TOKEN_MAP,
  WISHLIST
} from '../behavior/profile.js';
import {
  CURRENT_SOURCES,
  MARKABLE,
  OTHER_WITHOUT_NOTE,
  MPLUS_NONE_CLOSED,
  MPLUS_NONE_OPEN,
  MPLUS_REJECTED_CLOSED,
  MPLUS_REJECTED_OPEN,
  MPLUS_REQUEST,
  REPORTS,
  REVIEW_REPORT,
  VIEWERS
} from '../behavior/profile-forms.js';

// The profile's Mark Received and M+ exclusion forms as the current site shows
// them (#868 part 4), recorded so the new app's forms can be checked against
// the same expectations (tests/behavior/profile-forms.js).

function openOwnProfile(viewerKey, { mplusOpen = true, rejections = true, autoApproved = true } = {}) {
  const viewer = VIEWERS[viewerKey];
  const own = viewer.player;
  const firstName = own.name_realm.split('-')[0];
  return openState(
    browser,
    server.port,
    {
      label: `${firstName}’s own profile`,
      path: `/index.html?team=phoenix#profile/${firstName}`,
      sentinel: 'body',
      session: storedDiscordSession({ userId: viewer.userId, discordId: viewer.discordId, name: own.name_realm })
    },
    {
      players: [own, ...PLAYERS.filter((p) => p !== own)],
      team_members: [{ id: viewer.teamMember, role: viewer.role, name_realm: own.name_realm }],
      team_settings: fixture('team_settings', []).map((row) => ({
        ...row,
        config: {
          ...row.config,
          seasonName: SEASON.name,
          seasonStart: SEASON.start,
          seasonEnd: SEASON.end,
          seasonView: null,
          mPlusExclusionsOpen: mplusOpen
        }
      })),
      attendance: ATTENDANCE,
      rclc_loot: LOOT,
      items: PRIORITY_ITEMS,
      raid_zones: RAID_ZONES,
      player_equipped_gear: GEAR,
      // A raider reads their own requests (20260914201423).
      mplus_exclusion_requests: rejections ? MPLUS_REJECTIONS.filter((r) => r.player_id === own.id) : [],
      incoming_roster: [],
      item_preferences: WISHLIST.filter((r) => r.player_id === own.id),
      self_received_requests: SELF_RECEIVED.filter((r) => r.player_id === own.id),
      priority_order: PRIORITY_ORDER,
      tier_token_map: TIER_TOKEN_MAP,
      rpc: {
        is_site_admin: false,
        is_guild_officer: false,
        submit_self_received: [{ id: 99, auto_approved: autoApproved }],
        submit_mplus_exclusion: 7
      }
    }
  );
}

// Every RPC and Edge Function call the page sends, with its body.
function recordCalls(page) {
  const calls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const rpc = url.pathname.split('/rest/v1/rpc/')[1];
    const fn = url.pathname.split('/functions/v1/')[1];
    if (!rpc && !fn) return;
    calls.push({ name: rpc ?? fn, body: request.postData() ? JSON.parse(request.postData()) : null });
  });
  return calls;
}

const priorityRow = (page, name) =>
  page
    .locator('#prio-list-Torbjorn .priority-row[id^="bisrow-"]')
    .filter({ has: page.locator('.priority-item-name', { hasText: name }) });

// The BiS List sits under the profile's BiS sub-tab.
async function waitForPriority(page) {
  await page.waitForSelector('#profileSubTabBis', { timeout: 20000 });
  await page.click('#profileSubTabBis');
  await page.waitForFunction(
    () => document.querySelectorAll('#prio-list-Torbjorn .priority-row[id^="bisrow-"]').length > 0,
    null,
    { timeout: 20000 }
  );
}

// The form opens just below its row.
async function openForm(page, name) {
  const row = priorityRow(page, name);
  await row.locator('.mark-received-btn').click();
  return page.locator(`#form-${await row.getAttribute('id')} .self-received-form-inner`);
}

async function fillReport(page, report) {
  const form = await openForm(page, report.row);
  await form.locator('select[id^="diff-"]').selectOption(report.difficulty);
  if (report.source) await form.locator('select[id^="src-"]').selectOption(report.source);
  if (report.note) await form.locator('textarea').fill(report.note);
  return form;
}

// The M+ card as tests/behavior/profile-forms.js reads it.
function readMplus(page) {
  return page.evaluate(() => {
    const text = (el) => (el ? el.textContent.trim() : null);
    const section = [...document.querySelectorAll('#profileView .profile-section')].find((s) =>
      text(s.querySelector('.section-label'))?.startsWith('M+ Exclusion')
    );
    const badge = section.querySelector('.signup-status-badge');
    const note = badge ? [...section.querySelectorAll('div')].find((d) => d.style.fontStyle === 'italic') : null;
    const button = [...section.querySelectorAll('button')].find((b) =>
      ['Request M+ Exclusion', 'Re-submit Request'].includes(text(b))
    );
    return { status: text(badge), note: text(note), canRequest: !!button };
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

describe('Mark Received (current site)', () => {
  it('is offered on each loot priority row without a Mythic copy on file', async () => {
    const opened = await openOwnProfile('torbjorn');
    try {
      await waitForPriority(opened.page);
      const names = await opened.page.evaluate(() =>
        [...document.querySelectorAll('#prio-list-Torbjorn .priority-row[id^="bisrow-"]')]
          .filter((row) => row.querySelector('.mark-received-btn'))
          .map((row) => row.querySelector('.priority-item-name').firstChild.textContent.trim())
      );
      expect(names.sort()).toEqual([...MARKABLE].sort());
    } finally {
      await opened.context.close();
    }
  });

  it('offers the current sources', async () => {
    const opened = await openOwnProfile('torbjorn');
    try {
      await waitForPriority(opened.page);
      const form = await openForm(opened.page, 'Band of the Hollow Choir');
      const options = await form
        .locator('select[id^="src-"] option')
        .evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
      expect(options).toEqual(CURRENT_SOURCES);
    } finally {
      await opened.context.close();
    }
  });

  for (const report of REPORTS) {
    it(`sends a report for ${report.row}`, async () => {
      const opened = await openOwnProfile('torbjorn');
      try {
        await waitForPriority(opened.page);
        const calls = recordCalls(opened.page);
        const form = await fillReport(opened.page, report);
        if (report.defaultSource) {
          await expect(form.locator('select[id^="src-"]').inputValue()).resolves.toBe(report.defaultSource);
        }
        await form.getByRole('button', { name: 'Submit request' }).click();
        await expect.poll(() => calls.find((c) => c.name === 'submit_self_received')?.body).toEqual(report.call);
        await opened.page.waitForSelector('text=Marked as received.');
        // An instant report does not go to Discord.
        expect(calls.some((c) => c.name === 'discord-bot-webhook')).toBe(false);
      } finally {
        await opened.context.close();
      }
    });
  }

  it('tells the officers in Discord about a report held for review', async () => {
    const opened = await openOwnProfile('torbjorn', { autoApproved: false });
    try {
      await waitForPriority(opened.page);
      const calls = recordCalls(opened.page);
      const form = await fillReport(opened.page, REVIEW_REPORT);
      await form.getByRole('button', { name: 'Submit request' }).click();
      await expect.poll(() => calls.find((c) => c.name === 'discord-bot-webhook')?.body).toEqual(REVIEW_REPORT.webhook);
      await opened.page.waitForSelector('text=pending officer approval');
    } finally {
      await opened.context.close();
    }
  });

  it('sends nothing until a difficulty and a source are chosen', async () => {
    const opened = await openOwnProfile('torbjorn');
    try {
      await waitForPriority(opened.page);
      const calls = recordCalls(opened.page);
      const form = await openForm(opened.page, 'Band of the Hollow Choir');
      await form.getByRole('button', { name: 'Submit request' }).click();
      await form.locator('select[id^="diff-"]').selectOption('Heroic');
      await form.getByRole('button', { name: 'Submit request' }).click();
      await opened.page.waitForTimeout(300);
      expect(calls.filter((c) => c.name === 'submit_self_received')).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Mark Received (current site), an Other report', () => {
  it('is not sent without a note', async () => {
    const opened = await openOwnProfile('torbjorn', { autoApproved: false });
    try {
      await waitForPriority(opened.page);
      const calls = recordCalls(opened.page);
      const form = await fillReport(opened.page, OTHER_WITHOUT_NOTE);
      await form.getByRole('button', { name: 'Submit request' }).click();
      await expect(form.locator('textarea').getAttribute('placeholder')).resolves.toContain('required');
      await opened.page.waitForTimeout(300);
      expect(calls.filter((c) => c.name === 'submit_self_received')).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('M+ exclusion request (current site)', () => {
  const states = [
    ['a rejected request, requests open', { mplusOpen: true, rejections: true }, MPLUS_REJECTED_OPEN],
    ['a rejected request, requests closed', { mplusOpen: false, rejections: true }, MPLUS_REJECTED_CLOSED],
    ['no request, requests closed', { mplusOpen: false, rejections: false }, MPLUS_NONE_CLOSED],
    ['no request, requests open', { mplusOpen: true, rejections: false }, MPLUS_NONE_OPEN]
  ];
  for (const [label, options, expected] of states) {
    it(`shows the raider their own status: ${label}`, async () => {
      const opened = await openOwnProfile('dodgey', options);
      try {
        await opened.page.waitForSelector('#profileView .profile-name', { timeout: 20000 });
        await opened.page.waitForLoadState('networkidle');
        expect(await readMplus(opened.page)).toEqual(expected);
      } finally {
        await opened.context.close();
      }
    });
  }

  it('refuses a request without the Myth and socket confirmations, then sends it', async () => {
    const opened = await openOwnProfile('dodgey', { mplusOpen: true, rejections: false });
    try {
      await opened.page.waitForSelector('#profileView .profile-name', { timeout: 20000 });
      const calls = recordCalls(opened.page);
      await opened.page.getByRole('button', { name: 'Request M+ Exclusion' }).click();
      await expect(opened.page.locator('#mplusUrl-Dodgey').inputValue()).resolves.toBe(
        MPLUS_REQUEST.call.p_raiderio_url
      );
      await opened.page.locator('#mplusNotes-Dodgey').fill(MPLUS_REQUEST.note);
      const submit = opened.page.locator('#mplusForm-Dodgey').getByRole('button', { name: 'Submit' });

      await submit.click();
      await opened.page.locator('#mplusMythCheck-Dodgey').check();
      await opened.page.locator('#mplusSocketCount-Dodgey').selectOption('1');
      await submit.click();
      await expect(opened.page.locator('#mplusCheckError-Dodgey').isVisible()).resolves.toBe(true);
      expect(calls.filter((c) => c.name === 'submit_mplus_exclusion')).toEqual([]);

      await opened.page.locator('#mplusSocketCount-Dodgey').selectOption('2');
      await submit.click();
      await expect.poll(() => calls.find((c) => c.name === 'submit_mplus_exclusion')?.body).toEqual(MPLUS_REQUEST.call);
      await expect.poll(() => calls.find((c) => c.name === 'discord-bot-webhook')?.body).toEqual(MPLUS_REQUEST.webhook);
      await opened.page.waitForSelector('text=Request submitted!');
    } finally {
      await opened.context.close();
    }
  });
});
