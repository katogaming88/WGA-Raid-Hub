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
  COUNTS,
  OWN_ANSWER,
  OWN_NOTE_REQUIRED,
  OWN_WRITES,
  CLEAR_DATE,
  CLEAR_WRITES,
  OFFICER_CHANGE,
  OFFICER_NOTE_REQUIRED,
  OFFICER_WRITES
} from '../behavior/calendar.js';

// The new app's Calendar page against the behaviour recorded from the current
// site's calendar.html (tests/browser/calendar-recorded.test.js, #1102 step 1),
// plus what the redesign changes on purpose.

const BASE = '/g/wga/t/phoenix/calendar';

// The new app also sends the team's id with each Discord notice (#959), so two
// guilds using the same team key can't mix them up; the current site does not.
const withTeamId = (writes) =>
  writes.map((w) => (w.name === 'discord-bot-webhook' ? { ...w, body: { ...w.body, teamId: 1 } } : w));

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
    if (!['set_own_rsvp', 'officer_set_rsvp'].includes(rpc) && !fn) return;
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
  // Everyone coming, late or not: the total that heads the Tonight panel.
  in: parseInt(await page.locator('.tonight-total').textContent(), 10),
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
    expect(await readCounts(opened.page)).toEqual(COUNTS);
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
    expect(calls).toEqual(withTeamId(OWN_WRITES));
    await expect.poll(() => opened.page.getByRole('status').filter({ hasText: 'Saved: Tentative' }).count()).toBe(1);
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
    expect(calls).toEqual(withTeamId(OFFICER_WRITES));
    await expect.poll(() => opened.page.getByRole('dialog').count()).toBe(0);
    calls.length = 0;
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
      expect(calls).toEqual(withTeamId(CLEAR_WRITES));
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
      expect(await readCounts(opened.page)).toEqual(COUNTS);
      expect(await opened.page.locator('.edit-button').count()).toBe(0);
      expect(opened.unexpected).toEqual([]);
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

// The boss lineup (#1216), new to this app: each boss has a usual group, and
// the night starts as a copy of it. Everyone on the roster is in the grid:
// Frostvale said they are out but is still planned in for Nek'zali, Em is on
// the bench and out on every boss, and Aur is usually in for Sszorak but out
// tonight.
const ZONE = { id: 10, name: 'The Venomous Abyss', season: 'S1', is_mini_raid: false, sort_index: 0 };
const LINEUP_TABLES = {
  seasons: [{ code: 'S1', display_name: 'Season One', starts_at: '2026-01-01', ends_at: null }],
  raid_encounters: [
    { id: 101, name: "Nek'zali the Soulcoiler", sort_index: 1, wcl_encounter_id: 3101, zone: ZONE },
    { id: 102, name: 'Sszorak', sort_index: 2, wcl_encounter_id: 3102, zone: ZONE }
  ],
  raid_night_bosses: [
    { raid_date: NIGHT, encounter_id: 101, position: 1, skipped: false, confirmed_at: null },
    { raid_date: NIGHT, encounter_id: 102, position: 2, skipped: false, confirmed_at: null }
  ],
  raid_night_lineups: [
    ...[1, 2, 3, 4, 6].map((player_id) => ({ encounter_id: 101, player_id })),
    ...[2, 3, 4].map((player_id) => ({ encounter_id: 102, player_id }))
  ],
  boss_groups: [
    ...[1, 2, 3, 4, 6].map((player_id) => ({ encounter_id: 101, player_id })),
    ...[1, 2, 3, 4].map((player_id) => ({ encounter_id: 102, player_id }))
  ]
};

describe('Calendar (new app): the boss lineup', () => {
  let opened;
  const calls = [];

  beforeAll(async () => {
    opened = await openApp(
      browser,
      server.port,
      asOfficer(`${BASE}?date=${NIGHT}&view=lineup`, 'main:has(.blg-cell)', {
        tables: { ...tables(), ...LINEUP_TABLES },
        rpc: { ...signedIn(VIEWER, 'officer').rpc, set_raid_night_lineup: 4 }
      })
    );
    opened.page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/rpc/set_raid_night_lineup')) {
        calls.push(JSON.parse(request.postData()));
      }
    });
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('lists everyone on the roster by role, with the plan, the counts and the changes', async () => {
    const rows = await opened.page.locator('.blg-grid tbody .blg-raider-name').allTextContents();
    expect(rows).toEqual(['Aur', 'Brightmoor', 'Frostvale', 'Dawnthistle', 'Em', 'Zed']);
    expect(await opened.page.getByRole('button', { name: 'Zed, Sszorak: in' }).count()).toBe(1);
    expect(
      await opened.page.getByRole('button', { name: 'Aur, Sszorak: out, changed for tonight only, usually in' }).count()
    ).toBe(1);
    expect(
      await opened.page
        .getByRole('button', { name: "Frostvale, Nek'zali the Soulcoiler: in, but said they’re not coming" })
        .count()
    ).toBe(1);
    expect(await opened.page.getByRole('button', { name: "Em, Nek'zali the Soulcoiler: out" }).count()).toBe(1);
    expect(await opened.page.locator('thead .blg-count [data-tone]').allTextContents()).toEqual(['5/20', '3/20']);
    // Each boss's art comes from Warcraft Logs by its fight id.
    expect(await opened.page.locator('thead .blg-icon').first().getAttribute('src')).toBe(
      'https://assets.rpglogs.com/img/warcraft/bosses/3101-icon.jpg'
    );
    expect(opened.unexpected).toEqual([]);
    expect(opened.pageErrors).toEqual([]);
  });

  it('saves one boss for tonight, with the lineup it replaces', async () => {
    await opened.page.getByRole('button', { name: 'Aur, Sszorak: out, changed for tonight only, usually in' }).click();
    await opened.page.getByRole('button', { name: 'Save…' }).click();
    const dialog = opened.page.getByRole('dialog', { name: 'Save the boss lineup' });
    expect(await dialog.getByRole('radio', { name: /^Just / }).isChecked()).toBe(true);
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toEqual({
      p_team_id: TEAM_ID,
      p_raid_date: NIGHT,
      p_encounter_id: 102,
      p_player_ids: [1, 2, 3, 4],
      p_expected_player_ids: [2, 3, 4],
      p_picks: [],
      p_expected_picks: []
    });
  });
});

describe('Calendar (new app): on a phone', () => {
  it('drags a boss onto another and saves the new pull order (#1679)', async () => {
    const moved = await openApp(
      browser,
      server.port,
      asOfficer(`${BASE}?date=${NIGHT}&view=lineup`, 'main:has(.blg-cell)', {
        tables: { ...tables(), ...LINEUP_TABLES },
        rpc: { ...signedIn(VIEWER, 'officer').rpc, set_raid_night_boss_order: null }
      })
    );
    try {
      const sent = [];
      moved.page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/rpc/set_raid_night_boss_order')) {
          sent.push(JSON.parse(request.postData()));
        }
      });
      const head = (name) => moved.page.getByRole('columnheader', { name: new RegExp(`^${name}, pull`) });
      await head("Nek'zali the Soulcoiler").dragTo(head('Sszorak'));
      expect(await head('Sszorak').textContent()).toContain('1');
      expect(await moved.page.getByRole('columnheader', { name: /^Sszorak, pull 1/ }).count()).toBe(1);
      await moved.page.getByRole('button', { name: 'Save…' }).click();
      const dialog = moved.page.getByRole('dialog', { name: 'Save the boss lineup' });
      await dialog.getByRole('button', { name: 'Save' }).click();
      await expect.poll(() => sent.length).toBe(1);
      expect(sent[0]).toMatchObject({ p_encounter_ids: [102, 101], p_expected_ids: [101, 102], p_every_night: false });
      expect(moved.unexpected).toEqual([]);
      expect(moved.pageErrors).toEqual([]);
    } finally {
      await moved.context.close();
    }
  });

  it('lets an officer put raiders in and out of the boss lineup, but not skip a boss (#1681)', async () => {
    const lineup = await openApp(
      browser,
      server.port,
      asOfficer(`${BASE}?date=${NIGHT}&view=lineup`, 'main:has(.blg-cell)', {
        tables: { ...tables(), ...LINEUP_TABLES },
        viewport: NARROW,
        touch: true
      })
    );
    try {
      const cell = lineup.page.getByRole('button', { name: 'Zed, Sszorak: in' });
      await cell.click({ timeout: 8000 });
      expect(await lineup.page.getByRole('button', { name: /^Zed, Sszorak: out/ }).count()).toBe(1);
      expect(await lineup.page.getByRole('button', { name: /^Skip / }).count()).toBe(0);
      // The grid scrolls inside its own box; the page never scrolls sideways.
      const overflow = await lineup.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect(lineup.unexpected).toEqual([]);
    } finally {
      await lineup.context.close();
    }
  });

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
      // The boss lineup is the exception (#1681): it opens on a phone too.
      expect(await night.page.getByRole('link', { name: 'Boss lineup' }).count()).toBe(1);
    } finally {
      await night.context.close();
    }
  });
});
