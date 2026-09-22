import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';
import {
  ATTENDANCE,
  GEAR,
  LOOT,
  MPLUS_REJECTIONS,
  PRIORITY_ITEMS,
  PRIORITY_ORDER,
  RAID_ZONES,
  SEASON,
  SELF_RECEIVED,
  TIER_TOKEN_MAP,
  WISHLIST
} from '../behavior/profile.js';
import {
  MARKABLE,
  MPLUS_NONE_CLOSED,
  MPLUS_NONE_OPEN,
  MPLUS_REJECTED_CLOSED,
  MPLUS_REJECTED_OPEN,
  MPLUS_REQUEST,
  NEW_SOURCES,
  OTHER_WITHOUT_NOTE,
  REPORTS,
  REVIEW_REPORT,
  VIEWERS
} from '../behavior/profile-forms.js';

// The new app's profile forms against the behavior recorded from the current
// site (tests/browser/profile-forms-recorded.test.js, #868 part 4).

function signedIn(viewerKey) {
  const viewer = VIEWERS[viewerKey];
  const p = viewer.player;
  return {
    session: storedSession({ battlenet: `${p.name_realm}#1`, discord: p.name_realm }),
    person: {
      discordId: viewer.discordId,
      person: {
        site_admin: false,
        guild_officer: false,
        boe_manager: false,
        teams: [
          {
            team_id: 1,
            team_member_id: viewer.teamMember,
            role: viewer.role,
            characters: [{ player_id: p.id, name_realm: p.name_realm, url_code: p.url_code, archived_at: null }]
          }
        ]
      }
    }
  };
}

function openOwnProfile(viewerKey, { mplusOpen = true, rejections = true, autoApproved = true, viewport } = {}) {
  const own = VIEWERS[viewerKey].player;
  return openApp(browser, server.port, {
    path: '/g/wga/t/phoenix/me',
    sentinel: 'main .profile-name',
    viewport,
    tables: {
      players: [own],
      seasons: [{ code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start, ends_at: null }],
      // One row answers every team_settings read the profile makes.
      team_settings: [
        { name: SEASON.name, start: SEASON.start, end: SEASON.end, requests: null, mplusOpen: String(mplusOpen) }
      ],
      attendance: ATTENDANCE.filter((r) => r.player_id === own.id),
      rclc_loot: LOOT.filter((r) => r.player_id === own.id),
      player_equipped_gear: GEAR.filter((r) => r.player_id === own.id),
      items: PRIORITY_ITEMS,
      raid_zones: RAID_ZONES,
      item_preferences: WISHLIST.filter((r) => r.player_id === own.id),
      priority_order: PRIORITY_ORDER.filter((r) => r.season === SEASON.code),
      tier_token_map: TIER_TOKEN_MAP.filter((r) => r.class === own.classes_specs.class),
      self_received_requests: SELF_RECEIVED.filter((r) => r.player_id === own.id),
      mplus_exclusion_requests: rejections ? MPLUS_REJECTIONS.filter((r) => r.player_id === own.id) : []
    },
    rpc: { submit_self_received: [{ id: 99, auto_approved: autoApproved }], submit_mplus_exclusion: 7 },
    functions: ['discord-bot-webhook'],
    ...signedIn(viewerKey)
  });
}

function recordCalls(page) {
  const calls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    const rpc = url.pathname.split('/rest/v1/rpc/')[1];
    const fn = url.pathname.split('/functions/v1/')[1];
    if (request.method() === 'OPTIONS' || (!rpc && !fn)) return;
    if (['resolve_address', 'current_discord_id', 'resolve_person'].includes(rpc)) return;
    calls.push({ name: rpc ?? fn, body: request.postData() ? JSON.parse(request.postData()) : null });
  });
  return calls;
}

const priorityRow = (page, name) =>
  page.locator('main .priority-table tbody tr').filter({ has: page.locator('.priority-item', { hasText: name }) });

async function openReport(page, name) {
  await page.waitForSelector('main .priority-table tbody tr');
  await priorityRow(page, name)
    .getByRole('button', { name: /^Mark .* received$/ })
    .click();
  return page.getByRole('dialog', { name: 'Mark received' });
}

async function fillReport(page, report) {
  const dialog = await openReport(page, report.row);
  await dialog.getByLabel('Difficulty').selectOption({ label: report.difficulty });
  if (report.source) await dialog.getByLabel('How did you get it?').selectOption(report.source);
  // The box asks where it came from once Other is chosen.
  if (report.note) await dialog.getByLabel(/^(Notes \(optional\)|Where did it come from\?)$/).fill(report.note);
  return dialog;
}

function readMplus(page) {
  return page.evaluate(() => {
    const text = (el) => (el ? el.textContent.trim() : null);
    const card = [...document.querySelectorAll('main section.profile-card')].find(
      (s) => text(s.querySelector('h2')) === 'M+ exclusion'
    );
    return {
      status: text(card.querySelector('.mplus-status')),
      note: text(card.querySelector('.mplus-note')),
      canRequest: !!card.querySelector('.mplus-request')
    };
  });
}

const statusText = (page) =>
  page
    .locator('[role="status"]')
    .allTextContents()
    .then((t) => t.join(' '));

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

describe('Mark Received (new app), checked against the current site', () => {
  it('is offered on each loot priority row without a Mythic copy on file', async () => {
    const opened = await openOwnProfile('torbjorn');
    try {
      await opened.page.waitForSelector('main .priority-table .mark-received');
      const names = await opened.page.evaluate(() =>
        [...document.querySelectorAll('main .priority-table tbody tr')]
          .filter((tr) => tr.querySelector('.mark-received'))
          .map((tr) => tr.querySelector('.priority-item').textContent.trim())
      );
      expect(names.sort()).toEqual([...MARKABLE].sort());
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  // #1195: the buttons used to sit after the status text, which is a different
  // length on every row, so they started in a different place on each one.
  it('puts every button in its own column, lined up, and leaves the column out for a viewer', async () => {
    const opened = await openOwnProfile('torbjorn');
    try {
      await opened.page.waitForSelector('main .priority-table .mark-received');
      const layout = await opened.page.evaluate(() => {
        const table = document.querySelector('main .priority-table');
        return {
          headers: [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
          // Each button's own cell, and where that cell starts.
          inOwnCell: [...table.querySelectorAll('.mark-received')].every(
            (b) => b.closest('td')?.className === 'priority-action'
          ),
          lefts: [...table.querySelectorAll('.mark-received')].map((b) => Math.round(b.getBoundingClientRect().left))
        };
      });
      expect(layout.headers).toEqual(['Item', 'Heroic', 'Mythic', 'Status', 'Mark received']);
      expect(layout.inOwnCell).toBe(true);
      expect(new Set(layout.lefts).size).toBe(1);
    } finally {
      await opened.context.close();
    }
  });

  it('offers the sources, with Weekly quest and Pug raid added', async () => {
    const opened = await openOwnProfile('torbjorn');
    try {
      const dialog = await openReport(opened.page, 'Band of the Hollow Choir');
      const options = await dialog
        .getByLabel('How did you get it?')
        .locator('option')
        .evaluateAll((opts) => opts.map((o) => o.value).filter(Boolean));
      expect(options).toEqual(NEW_SOURCES);
    } finally {
      await opened.context.close();
    }
  });

  for (const report of REPORTS) {
    it(`sends a report for ${report.row}`, async () => {
      const opened = await openOwnProfile('torbjorn');
      try {
        const calls = recordCalls(opened.page);
        const dialog = await fillReport(opened.page, report);
        if (report.defaultSource) {
          await expect(dialog.getByLabel('How did you get it?').inputValue()).resolves.toBe(report.defaultSource);
        }
        await dialog.getByRole('button', { name: 'Mark received' }).click();
        await expect.poll(() => calls.find((c) => c.name === 'submit_self_received')?.body).toEqual(report.call);
        await expect.poll(() => statusText(opened.page)).toContain('as received');
        await dialog.waitFor({ state: 'detached' });
        expect(calls.some((c) => c.name === 'discord-bot-webhook')).toBe(false);
      } finally {
        await opened.context.close();
      }
    });
  }

  it('tells the officers in Discord about a report held for review', async () => {
    const opened = await openOwnProfile('torbjorn', { autoApproved: false });
    try {
      const calls = recordCalls(opened.page);
      const dialog = await fillReport(opened.page, REVIEW_REPORT);
      await dialog.getByRole('button', { name: 'Mark received' }).click();
      await expect.poll(() => calls.find((c) => c.name === 'discord-bot-webhook')?.body).toEqual(REVIEW_REPORT.webhook);
      await expect.poll(() => statusText(opened.page)).toContain('to an officer for review');
    } finally {
      await opened.context.close();
    }
  });

  it('sends nothing until a difficulty and a source are chosen', async () => {
    const opened = await openOwnProfile('torbjorn');
    try {
      const calls = recordCalls(opened.page);
      const dialog = await openReport(opened.page, 'Band of the Hollow Choir');
      const submit = dialog.getByRole('button', { name: 'Mark received' });
      await submit.click();
      await dialog.getByLabel('Difficulty').selectOption({ label: 'Heroic' });
      await submit.click();
      await expect(dialog.getByRole('alert').textContent()).resolves.toContain('Choose a difficulty');
      expect(calls.filter((c) => c.name === 'submit_self_received')).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  it('is not offered on someone else’s profile', async () => {
    const opened = await openApp(browser, server.port, {
      path: `/g/wga/t/phoenix/p/${VIEWERS.torbjorn.player.url_code}`,
      sentinel: 'main .priority-table tbody tr',
      tables: {
        players: [VIEWERS.torbjorn.player],
        seasons: [{ code: SEASON.code, display_name: SEASON.name, starts_at: SEASON.start, ends_at: null }],
        team_settings: [{ name: SEASON.name, start: SEASON.start, end: SEASON.end, mplusOpen: 'true' }],
        items: PRIORITY_ITEMS,
        raid_zones: RAID_ZONES,
        item_preferences: WISHLIST,
        priority_order: PRIORITY_ORDER,
        tier_token_map: TIER_TOKEN_MAP,
        self_received_requests: SELF_RECEIVED,
        attendance: [],
        rclc_loot: LOOT,
        mplus_exclusion_requests: []
      },
      ...signedIn('officer')
    });
    try {
      await expect(opened.page.locator('main .mark-received').count()).resolves.toBe(0);
      await expect(opened.page.locator('main .mplus-request').count()).resolves.toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Mark Received (new app), an Other report, checked against the current site', () => {
  it('is not sent without a note, and asks where it came from', async () => {
    const opened = await openOwnProfile('torbjorn', { autoApproved: false });
    try {
      const calls = recordCalls(opened.page);
      const dialog = await fillReport(opened.page, OTHER_WITHOUT_NOTE);
      const note = dialog.getByLabel('Where did it come from?');
      await expect(note.getAttribute('required')).resolves.not.toBeNull();
      await dialog.getByRole('button', { name: 'Mark received' }).click();
      await expect(dialog.getByRole('alert').textContent()).resolves.toContain('Say where it came from');
      await expect(note.getAttribute('aria-invalid')).resolves.toBe('true');
      await opened.page.waitForTimeout(300);
      expect(calls.filter((c) => c.name === 'submit_self_received')).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('M+ exclusion request (new app), checked against the current site', () => {
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
        await opened.page.waitForFunction(() => !document.querySelector('main .data-loading'), null, {
          timeout: 20000
        });
        await expect.poll(() => readMplus(opened.page)).toEqual(expected);
      } finally {
        await opened.context.close();
      }
    });
  }

  it('refuses a request without the Myth and socket confirmations, then sends it', async () => {
    const opened = await openOwnProfile('dodgey', { mplusOpen: true, rejections: false });
    try {
      const calls = recordCalls(opened.page);
      await opened.page.getByRole('button', { name: 'Request M+ exclusion' }).click();
      const dialog = opened.page.getByRole('dialog', { name: 'Request M+ exclusion' });
      await expect(dialog.getByLabel('Raider.IO profile').inputValue()).resolves.toBe(
        MPLUS_REQUEST.call.p_raiderio_url
      );
      await dialog.getByLabel('Notes (optional)').fill(MPLUS_REQUEST.note);
      const submit = dialog.getByRole('button', { name: 'Send request' });

      await submit.click();
      await dialog.getByLabel('I am 6/6 Myth in every slot M+ can fill.').check();
      await dialog.getByLabel('Gem sockets filled (helm, bracers, belt)').selectOption('1');
      await submit.click();
      await expect(dialog.getByRole('alert').textContent()).resolves.toContain('at least 2 of 3 gem sockets');
      expect(calls.filter((c) => c.name === 'submit_mplus_exclusion')).toEqual([]);

      await dialog.getByLabel('Gem sockets filled (helm, bracers, belt)').selectOption('2');
      await submit.click();
      await expect.poll(() => calls.find((c) => c.name === 'submit_mplus_exclusion')?.body).toEqual(MPLUS_REQUEST.call);
      await expect.poll(() => calls.find((c) => c.name === 'discord-bot-webhook')?.body).toEqual(MPLUS_REQUEST.webhook);
      await expect.poll(() => statusText(opened.page)).toContain('An officer will review it');
    } finally {
      await opened.context.close();
    }
  });
});
