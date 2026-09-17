import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession, NARROW } from './harness.js';
import {
  TODAY,
  NIGHT,
  TEAM_ID,
  PLAYERS,
  SCHEDULE,
  RSVPS,
  VIEWER,
  BENCH_VIEWER,
  EXPECTED_MONTH,
  EXPECTED_NIGHT,
  NEW_COUNTS,
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

// The new app's Calendar page against the behaviour recorded from the current
// site's calendar.html (tests/browser/calendar-recorded.test.js, #1102 step 1),
// plus what the redesign changes on purpose.

const BASE = '/g/wga/t/phoenix/calendar';

const person = (viewer, role) => ({
  discordId: viewer.discordId,
  person: {
    site_admin: false,
    guild_officer: false,
    boe_manager: false,
    teams: [
      {
        team_id: TEAM_ID,
        team_member_id: viewer.teamMemberId,
        role,
        characters: [{ player_id: viewer.playerId, name_realm: viewer.nameRealm, url_code: null, archived_at: null }]
      }
    ]
  }
});

// team_rsvp_answers() leaves notes out; a raider's own read returns only
// their own rows. The harness ignores filters, so each state lists exactly
// what that reader's reads would return.
const withoutNotes = RSVPS.map(({ player_id, raid_date, status, updated_at }) => ({
  player_id,
  raid_date,
  status,
  updated_at
}));

const tables = (rsvps = RSVPS) => ({
  players: PLAYERS,
  raid_schedule: SCHEDULE,
  raid_schedule_exceptions: [],
  raid_rsvps: rsvps
});

const signedIn = (viewer, role, extra = {}) => ({
  clock: TODAY,
  session: storedSession({ discord: viewer.nameRealm.split('-')[0] }),
  person: person(viewer, role),
  functions: ['discord-bot-webhook'],
  rpc: {
    set_own_rsvp: null,
    officer_set_rsvp: null,
    officer_set_rotator_week: null,
    team_rsvp_answers: withoutNotes
  },
  ...extra
});

const asOfficer = (path, sentinel, extra = {}) => ({
  path,
  sentinel,
  tables: tables(),
  ...signedIn(VIEWER, 'officer'),
  ...extra
});

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

// The shapes tests/behavior/calendar.js describes, read from the new markup.
const readMonth = (page) =>
  page.locator('.month-grid .night-chip[data-date]').evaluateAll((chips) =>
    chips.map((chip) => ({
      date: chip.dataset.date,
      status: chip.querySelector('.night-mine')?.dataset.status ?? null
    }))
  );

const readNight = async (page) =>
  (
    await page.evaluate(() => {
      const text = (el) => (el ? el.textContent.trim() : '');
      const rows = [...document.querySelectorAll('.night-row')].map((row) => ({
        name: text(row.querySelector('.night-name')),
        status: text(row.querySelector('.pill')) || 'Present',
        note: ''
      }));
      const headsUp = [...document.querySelectorAll('.heads-up-item')].map((item) => ({
        name: text(item.querySelector('.night-name')),
        status: text(item.querySelector('.pill')),
        note: text(item.querySelector('.heads-up-note')).replace(/^“|”$/g, '')
      }));
      return [...rows, ...headsUp];
    })
  ).sort((a, b) => a.name.localeCompare(b.name));

const readCounts = async (page) => ({
  in: Number(await page.locator('.night-count-row[data-kind="in"] dd').textContent()),
  out: Number(await page.locator('.night-count-row[data-kind="out"] dd').textContent())
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

describe('Calendar (new app): the month, checked against the current site', () => {
  it('shows the month’s raid nights with the reader’s own answers', async () => {
    const opened = await openApp(browser, server.port, asOfficer(BASE, '.night-mine[data-status="Late"]'));
    try {
      expect(await readMonth(opened.page)).toEqual(EXPECTED_MONTH);
      expect(opened.pageErrors).toEqual([]);
      expect(opened.unexpected).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Calendar (new app): a raid night, checked against the current site', () => {
  let opened;
  let calls;

  beforeAll(async () => {
    opened = await openApp(browser, server.port, asOfficer(`${BASE}?date=${NIGHT}`, '.own-answer'));
    calls = recordCalls(opened.page);
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('lists every raider’s status and note for the night', async () => {
    expect(await readNight(opened.page)).toEqual(EXPECTED_NIGHT);
    // The rotator is counted with the bench now, not as coming.
    expect(await readCounts(opened.page)).toEqual(NEW_COUNTS);
    expect(opened.pageErrors).toEqual([]);
    expect(opened.unexpected).toEqual([]);
  });

  it('will not save your own answer without a note', async () => {
    const form = opened.page.locator('.own-answer');
    await form.getByRole('radio', { name: OWN_ANSWER.status }).check();
    await form.getByRole('button', { name: 'Save' }).click();
    await expect(form.getByRole('alert').textContent()).resolves.toBe(OWN_NOTE_REQUIRED);
    expect(calls).toEqual([]);
  });

  it('saves your own answer and tells the Discord bot', async () => {
    const form = opened.page.locator('.own-answer');
    await form.getByLabel('Note for officers (required)').fill(OWN_ANSWER.note);
    await form.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls.length).toBe(OWN_WRITES.length);
    expect(calls).toEqual(OWN_WRITES);
    await expect(opened.page.getByRole('status').filter({ hasText: 'Saved: Tentative' }).count()).resolves.toBe(1);
    calls.length = 0;
  });

  it('will not save an officer change without a reason', async () => {
    await opened.page.getByRole('button', { name: `Change ${OFFICER_CHANGE.name}’s answer` }).click();
    const dialog = opened.page.getByRole('dialog', { name: `Change ${OFFICER_CHANGE.name}’s answer` });
    await dialog.getByRole('radio', { name: OFFICER_CHANGE.status }).check();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert').textContent()).resolves.toBe(OFFICER_NOTE_REQUIRED);
    expect(calls).toEqual([]);
  });

  it('lets an officer change a raider’s answer, with a reason', async () => {
    const dialog = opened.page.getByRole('dialog');
    await dialog.getByLabel('Reason (required, the raider sees it)').fill(OFFICER_CHANGE.note);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls.length).toBe(OFFICER_WRITES.length);
    expect(calls).toEqual(OFFICER_WRITES);
    await expect(opened.page.getByRole('dialog').count()).resolves.toBe(0);
    calls.length = 0;
  });

  it('lets an officer put a rotator in for the week', async () => {
    await opened.page.getByRole('button', { name: `Change ${ROTATOR.nickname}’s answer` }).click();
    await opened.page.getByRole('dialog').getByRole('button', { name: 'In for the week' }).click();
    await expect.poll(() => calls.length).toBe(ROTATOR_WRITES.length);
    expect(calls).toEqual(ROTATOR_WRITES);
  });
});

describe('Calendar (new app): going back to the default', () => {
  it('choosing Present clears your answer and refreshes the signup sheet', async () => {
    const opened = await openApp(browser, server.port, asOfficer(`${BASE}?date=${CLEAR_DATE}`, '.own-answer'));
    try {
      const calls = recordCalls(opened.page);
      const form = opened.page.locator('.own-answer');
      await form.getByRole('radio', { name: 'Present' }).check();
      await form.getByRole('button', { name: 'Save' }).click();
      await expect.poll(() => calls.length).toBe(CLEAR_WRITES.length);
      expect(calls).toEqual(CLEAR_WRITES);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Calendar (new app): a benched raider', () => {
  it('has nothing to answer on a normal night', async () => {
    const own = RSVPS.filter((r) => r.player_id === BENCH_VIEWER.playerId);
    const opened = await openApp(browser, server.port, {
      path: `${BASE}?date=${NIGHT}`,
      sentinel: '.heads-up',
      tables: tables(own),
      ...signedIn(BENCH_VIEWER, 'raider')
    });
    try {
      expect(await opened.page.locator('.own-answer').count()).toBe(0);
      expect(await opened.page.locator('.edit-button').count()).toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});

// What the redesign changes on purpose.

describe('Calendar (new app): a raider sees answers, not notes', () => {
  it('shows who is out and late, without their reasons', async () => {
    // Zed (Cinderfall, player 3) is the reader: late, with their own note.
    const zed = {
      userId: 'user-zed',
      discordId: 'discord-zed',
      playerId: 3,
      nameRealm: 'Cinderfall-Illidan',
      teamMemberId: 3
    };
    const own = RSVPS.filter((r) => r.player_id === zed.playerId);
    const opened = await openApp(browser, server.port, {
      path: `${BASE}?date=${NIGHT}`,
      sentinel: '.heads-up-item',
      tables: tables(own),
      ...signedIn(zed, 'raider')
    });
    try {
      const night = await readNight(opened.page);
      expect(night.find((r) => r.name === 'Frostvale')).toEqual({ name: 'Frostvale', status: 'Absent', note: '' });
      expect(night.find((r) => r.name === 'Zed')).toEqual({ name: 'Zed', status: 'Late', note: 'Work until 9:15' });
      expect(await readCounts(opened.page)).toEqual(NEW_COUNTS);
      expect(await opened.page.locator('.edit-button').count()).toBe(0);
      expect(opened.unexpected).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Calendar (new app): signed out', () => {
  it('shows the schedule, but nobody’s answers', async () => {
    const opened = await openApp(browser, server.port, {
      path: BASE,
      sentinel: '.month-grid .night-chip',
      clock: TODAY,
      tables: tables()
    });
    try {
      const month = await readMonth(opened.page);
      expect(month.map((m) => m.date)).toEqual(EXPECTED_MONTH.map((m) => m.date));
      expect(month.every((m) => m.status === null)).toBe(true);
      expect(await opened.page.locator('.night-count').count()).toBe(0);
      await expect(opened.page.locator('.calendar-note').textContent()).resolves.toBe(
        'Sign in to see who’s coming and to give your answer.'
      );
      expect(opened.unexpected).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  it('shows a night’s time, but not the roster', async () => {
    const opened = await openApp(browser, server.port, {
      path: `${BASE}?date=${NIGHT}`,
      sentinel: '.calendar-note',
      clock: TODAY,
      tables: tables()
    });
    try {
      await expect(opened.page.locator('main h1').textContent()).resolves.toBe('Thursday, May 14');
      await expect(opened.page.locator('.page-subtitle').textContent()).resolves.toBe(
        '9:00 PM to midnight Eastern · Raid night'
      );
      expect(await opened.page.locator('.night-row').count()).toBe(0);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Calendar (new app): moving between nights', () => {
  it('steps to the previous and next raid night, not the next calendar day', async () => {
    const opened = await openApp(browser, server.port, asOfficer(`${BASE}?date=${NIGHT}`, '.own-answer'));
    try {
      await opened.page.getByRole('link', { name: 'Next raid night: Tue, May 19' }).click();
      await opened.page.waitForURL(/date=2026-05-19/);
      await expect.poll(() => opened.page.locator('main h1').textContent()).toBe('Tuesday, May 19');
      await opened.page.getByRole('link', { name: 'Previous raid night: Thu, May 14' }).click();
      await opened.page.waitForURL(/date=2026-05-14/);
    } finally {
      await opened.context.close();
    }
  });
});

// The boss lineup (#1216), new to this app: officers pick who sits out each
// boss. Zed is late and still in the grid; the bench, the rotator and
// Frostvale (out) are not.
const LINEUP_RAIDS = [
  { name: 'The Venomous Abyss', bosses: [{ name: "Nek'zali the Soulcoiler" }, { name: 'Sszorak' }] }
];

describe('Calendar (new app): the boss lineup', () => {
  let opened;
  const calls = [];

  beforeAll(async () => {
    opened = await openApp(
      browser,
      server.port,
      asOfficer(`${BASE}?date=${NIGHT}&view=lineup`, 'main:has(.lineup-toggle)', {
        tables: {
          ...tables(),
          team_settings: [{ raids: LINEUP_RAIDS }],
          boss_lineup_sitouts: [
            { raid_date: NIGHT, raid_name: 'The Venomous Abyss', boss_name: 'Sszorak', player_id: 3 }
          ]
        },
        rpc: { ...signedIn(VIEWER, 'officer').rpc, set_boss_lineup: 2 }
      })
    );
    opened.page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/rpc/set_boss_lineup')) {
        calls.push(JSON.parse(request.postData()));
      }
    });
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('lists who is coming, with the saved sit-out and the counts', async () => {
    const rows = await opened.page
      .locator('.lineup-grid:not(.lineup-buffs) tbody .lineup-raider-name')
      .allTextContents();
    expect(rows).toEqual(['Aur', 'Brightmoor', 'Dawnthistle', 'Zed']);
    expect(await opened.page.getByRole('button', { name: 'Zed, Sszorak: sitting out' }).count()).toBe(1);
    expect(await opened.page.locator('.lineup-not-coming').textContent()).toBe(
      'Not coming tonight, so not in the grid: Em (bench), Frostvale (absent), Glim (rotator).'
    );
    expect(await opened.page.locator('tfoot .lineup-total-count').allTextContents()).toEqual(['4/20', '3/20']);
    expect(opened.unexpected).toEqual([]);
    expect(opened.pageErrors).toEqual([]);
  });

  it('saves the whole raid’s sit-outs in one call', async () => {
    await opened.page.getByRole('button', { name: 'Aur, Sszorak: in' }).click();
    await opened.page.getByRole('button', { name: 'Save lineup' }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({
      p_team_id: TEAM_ID,
      p_raid_date: NIGHT,
      p_raid_name: 'The Venomous Abyss',
      p_sitouts: [
        { boss: 'Sszorak', player_id: 1 },
        { boss: 'Sszorak', player_id: 3 }
      ]
    });
  });
});

describe('Calendar (new app): on a phone', () => {
  it('lists the month’s nights, and leaves officer changes to a computer', async () => {
    const month = await openApp(
      browser,
      server.port,
      asOfficer(BASE, '.month-list .night-chip', { viewport: NARROW, touch: true })
    );
    try {
      expect(await month.page.locator('.month-grid-card').isVisible()).toBe(false);
      expect(await month.page.locator('.month-list .night-chip').count()).toBe(EXPECTED_MONTH.length);
      const overflow = await month.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    } finally {
      await month.context.close();
    }
    const night = await openApp(
      browser,
      server.port,
      asOfficer(`${BASE}?date=${NIGHT}`, '.own-answer', { viewport: NARROW, touch: true })
    );
    try {
      // Your own answer works on a phone; changing someone else's does not.
      expect(await night.page.locator('.own-answer').isVisible()).toBe(true);
      expect(await night.page.locator('.edit-button').count()).toBe(0);
      expect(await night.page.getByRole('button', { name: 'In for the week' }).count()).toBe(0);
      // So is the boss lineup (#1216).
      expect(await night.page.getByRole('link', { name: 'Boss lineup' }).count()).toBe(0);
    } finally {
      await night.context.close();
    }
  });
});
