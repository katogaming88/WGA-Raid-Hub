import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer } from './static-server.js';
import { launchBrowser, openState, storedDiscordSession, REPO_ROOT } from './harness.js';
import {
  TODAY,
  NIGHT,
  PLAYERS,
  SCHEDULE,
  RSVPS,
  VIEWER,
  BENCH_VIEWER,
  EXPECTED_MONTH,
  EXPECTED_NIGHT,
  CURRENT_COUNTS,
  OWN_ANSWER,
  OWN_NOTE_REQUIRED,
  OWN_WRITES,
  CLEAR_DATE,
  CLEAR_WRITES,
  OFFICER_CHANGE,
  OFFICER_NOTE_REQUIRED,
  OFFICER_WRITES,
  ROTATOR,
  ROTATOR_WRITES
} from '../behavior/calendar.js';

// calendar.html as the current site shows it to a signed-in officer, recorded
// so the new app's Calendar page can be checked against the same
// expectations (tests/behavior/calendar.js, #1102 step 1).

function open(path, sentinel, { viewer = VIEWER, role = 'officer' } = {}) {
  const own = PLAYERS.find((p) => p.id === viewer.playerId);
  return openState(
    browser,
    server.port,
    {
      label: `calendar ${path}`,
      path,
      sentinel,
      clock: TODAY,
      session: storedDiscordSession({ userId: viewer.userId, discordId: viewer.discordId, name: viewer.nameRealm })
    },
    {
      // The page takes the signed-in character from the first linked player.
      players: [own, ...PLAYERS.filter((p) => p !== own)],
      team_members: [{ id: viewer.teamMemberId, role, name_realm: viewer.nameRealm }],
      raid_schedule: SCHEDULE,
      raid_schedule_exceptions: [],
      raid_rsvps: RSVPS,
      rpc: { is_site_admin: false, is_guild_officer: false }
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
    if (!['set_own_rsvp', 'officer_set_rsvp', 'officer_set_rotator_week'].includes(rpc) && !fn) return;
    calls.push({ name: rpc ?? fn, body: JSON.parse(request.postData()) });
  });
  return calls;
}

const readMonth = (page) =>
  page.locator('#fullCalendar a.mini-cal-day-raid').evaluateAll((days) =>
    days.map((a) => ({
      date: new URL(a.href).searchParams.get('date'),
      status: a.querySelector('.calendar-status').getAttribute('aria-label')
    }))
  );

const readNight = async (page) =>
  (
    await page.locator('.roster-table tbody tr:not(.group-header)').evaluateAll((rows) =>
      rows.map((tr) => ({
        name: tr.cells[0].textContent.trim(),
        status: tr.querySelector('.day-roster-status-label').textContent.trim(),
        note: tr.querySelector('.day-roster-note').textContent.trim()
      }))
    )
  ).sort((a, b) => a.name.localeCompare(b.name));

const readCounts = async (page) => {
  const [inCount, outCount] = await page.locator('.day-view-counts strong').allTextContents();
  return { in: Number(inCount), out: Number(outCount) };
};

const nightPath = (date) => `/calendar.html?date=${date}`;

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

describe('Calendar (current site): the month', () => {
  it('shows the month’s raid nights with the reader’s own answers', async () => {
    const opened = await open('/calendar.html', '#fullCalendar a.mini-cal-day-raid');
    try {
      // The answers arrive once the sign-in resolves.
      await opened.page.waitForSelector('#fullCalendar .calendar-status[aria-label="Late"]');
      expect(await readMonth(opened.page)).toEqual(EXPECTED_MONTH);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Calendar (current site): a raid night', () => {
  let opened;
  let calls;

  beforeAll(async () => {
    opened = await open(nightPath(NIGHT), '.roster-table');
    calls = recordCalls(opened.page);
    await opened.page.waitForSelector('.day-view-my-status');
    await opened.page.waitForSelector('.day-roster-edit-btn');
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('lists every raider’s status and note for the night', async () => {
    expect(await readNight(opened.page)).toEqual(EXPECTED_NIGHT);
    expect(await readCounts(opened.page)).toEqual(CURRENT_COUNTS);
    expect(opened.pageErrors).toEqual([]);
  });

  it('will not save your own answer without a note', async () => {
    await opened.page.locator('#dayViewMyStatusOptions button', { hasText: OWN_ANSWER.status }).click();
    await opened.page.click('#dayViewMySaveBtn');
    await expect(opened.page.locator('#dayViewMyError').textContent()).resolves.toBe(OWN_NOTE_REQUIRED);
    expect(calls).toEqual([]);
  });

  it('saves your own answer and tells the Discord bot', async () => {
    await opened.page.fill('#dayViewMyNote', OWN_ANSWER.note);
    await opened.page.click('#dayViewMySaveBtn');
    await expect.poll(() => calls.length).toBe(OWN_WRITES.length);
    expect(calls).toEqual(OWN_WRITES);
    calls.length = 0;
  });

  it('will not save an officer change without a reason', async () => {
    const row = opened.page.locator('.roster-table tr', { hasText: OFFICER_CHANGE.name });
    await row.getByRole('button', { name: 'Edit' }).click();
    await opened.page.locator('#officerRsvpEditOptions button', { hasText: OFFICER_CHANGE.status }).click();
    await opened.page.click('#officerRsvpEditSaveBtn');
    await expect(opened.page.locator('#officerRsvpEditError').textContent()).resolves.toBe(OFFICER_NOTE_REQUIRED);
    expect(calls).toEqual([]);
  });

  it('lets an officer change a raider’s answer, with a reason', async () => {
    await opened.page.fill('#officerRsvpEditNote', OFFICER_CHANGE.note);
    await opened.page.click('#officerRsvpEditSaveBtn');
    await expect.poll(() => calls.length).toBe(OFFICER_WRITES.length);
    expect(calls).toEqual(OFFICER_WRITES);
    calls.length = 0;
  });

  it('lets an officer put a rotator in for the week', async () => {
    await opened.page.waitForSelector('.day-roster-edit-btn');
    const row = opened.page.locator('.roster-table tr', { hasText: ROTATOR.nickname });
    await row.getByRole('button', { name: 'Set in for week' }).click();
    await expect.poll(() => calls.length).toBe(ROTATOR_WRITES.length);
    expect(calls).toEqual(ROTATOR_WRITES);
  });
});

describe('Calendar (current site): going back to the default', () => {
  it('clears your answer and refreshes the signup sheet', async () => {
    const opened = await open(nightPath(CLEAR_DATE), '.roster-table');
    try {
      const calls = recordCalls(opened.page);
      await opened.page.waitForSelector('.day-view-my-status');
      await opened.page.getByRole('button', { name: 'Clear (back to default)' }).click();
      await expect.poll(() => calls.length).toBe(CLEAR_WRITES.length);
      expect(calls).toEqual(CLEAR_WRITES);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Calendar (current site): a benched raider', () => {
  it('has nothing to answer on a normal night', async () => {
    const opened = await open(nightPath(NIGHT), '.roster-table', { viewer: BENCH_VIEWER, role: 'raider' });
    try {
      // Wait for the sign-in to settle: the header shows the character.
      await opened.page.waitForFunction(() => document.body.textContent.includes('Emberlyn'));
      await opened.page.waitForTimeout(500);
      expect(await opened.page.locator('.day-view-my-status').count()).toBe(0);
      expect(await opened.page.locator('.day-roster-edit-btn').count()).toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});
