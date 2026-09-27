import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';

// The new app's Attendance Manage page (#1354, #1103 row 1) against
// tab-attendance.js's recorded behavior (js/tabs/tab-attendance.js): the
// per-night status grid, refresh from WCL, and commit attendance scores.
// The old tab's Attendance Scores sub-tab isn't ported (Kat, 2026-09-27):
// Roster and Profile already show a raider's attendance pct and flagged
// nights.

const TEAM_ID = 1;
const BASE = '/g/wga/t/phoenix/officer/attendance';

const PLAYERS = [
  {
    id: 1,
    name_realm: 'Aurelith-Illidan',
    nickname: 'Aur',
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: 'Warrior', spec: 'Protection', role: 'Tank' }
  },
  {
    id: 2,
    name_realm: 'Brightmoor-Illidan',
    nickname: '',
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: 'Paladin', spec: 'Holy', role: 'Heal' }
  },
  {
    id: 3,
    name_realm: 'Cinderfall-Illidan',
    nickname: 'Zed',
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: 'Mage', spec: 'Frost', role: 'Ranged' }
  },
  {
    id: 4,
    name_realm: 'Dawnthistle-Illidan',
    nickname: '',
    is_trial: true,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: 'Druid', spec: 'Balance', role: 'Ranged' }
  },
  {
    id: 5,
    name_realm: 'Emberlyn-Illidan',
    nickname: 'Em',
    is_trial: false,
    is_bench: true,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: 'Priest', spec: 'Shadow', role: 'Ranged' }
  },
  {
    id: 6,
    name_realm: 'Frostvale-Illidan',
    nickname: null,
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: 'Rogue', spec: 'Assassination', role: 'Melee' }
  }
];

const night = (date, title, rows) =>
  rows.map(([player_id, status, source]) => ({
    id: undefined,
    player_id,
    raid_date: date,
    status,
    report_excluded: false,
    report_title: title,
    source: source ?? 'WCL'
  }));

const ATTENDANCE = [
  ...night('2026-05-07', 'Raid - May 7', [
    [1, 'Present'],
    [2, 'Present'],
    [3, 'Late (no notice)', 'Officer'],
    [4, 'No Show'],
    [5, 'Present']
    // 6 has no row for this night.
  ]),
  ...night('2026-05-14', 'Raid - May 14', [
    [1, 'Present'],
    [2, 'Excused', 'Officer'],
    [3, 'Present'],
    [4, 'Present'],
    [5, 'Bench'],
    [6, null, 'WCL (Late?)']
  ])
].map((row, i) => ({ ...row, id: i + 1 }));

const SEASONS = [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-01-01', ends_at: null }];

const OFFICER = {
  discordId: 'discord-officer-1',
  person: {
    site_admin: false,
    guild_officer: false,
    boe_manager: false,
    teams: [
      {
        team_id: TEAM_ID,
        team_member_id: 1,
        role: 'officer',
        characters: [{ player_id: 1, name_realm: 'Aurelith-Illidan', url_code: null, archived_at: null }]
      }
    ]
  }
};

const state = (path, sentinel, extra = {}) => ({
  path,
  sentinel,
  session: storedSession({ discord: 'Aurelith' }),
  person: OFFICER,
  tables: { players: PLAYERS, seasons: SEASONS, attendance: ATTENDANCE, ...extra.tables },
  rpc: { team_season_start: null, write_audit_log: null, ...extra.rpc },
  functionAnswers: extra.functionAnswers
});

function recordRestCalls(page, table, method) {
  const calls = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() !== method) return;
    if (!url.pathname.endsWith(`/rest/v1/${table}`)) return;
    calls.push(JSON.parse(request.postData()));
  });
  return calls;
}

function recordRpcCalls(page, rpcName) {
  const calls = [];
  page.on('request', (request) => {
    if (!new URL(request.url()).pathname.endsWith(`/rpc/${rpcName}`)) return;
    calls.push(JSON.parse(request.postData()));
  });
  return calls;
}

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

describe('Attendance Manage (new app): the per-night grid', () => {
  let opened;

  beforeAll(async () => {
    opened = await openApp(browser, server.port, state(BASE, '.attend-grid-rows'));
  });

  afterAll(async () => {
    if (opened) await opened.context.close();
  });

  it('shows the latest night first, with the whole roster and any WCL late flag', async () => {
    await expect(opened.page.locator('#attend-night-select').inputValue()).resolves.toBe('0');
    const names = await opened.page.locator('.attend-grid-name').allTextContents();
    expect(names).toEqual(['Aur', 'Brightmoor', 'Dawnthistle', 'Em', 'Frostvale', 'Zed']);
    const statuses = await opened.page.locator('.attend-status-select').evaluateAll((els) => els.map((e) => e.value));
    expect(statuses).toEqual(['Present', 'Excused', 'Present', 'Bench', '', 'Present']);
    await expect(opened.page.locator('.attend-late-flag').textContent()).resolves.toBe('WCL (Late?)');
    expect(opened.unexpected).toEqual([]);
    expect(opened.pageErrors).toEqual([]);
  });

  it('lists a roster player with no row for an older night, still editable', async () => {
    await opened.page.locator('#attend-night-select').selectOption('1');
    const names = await opened.page.locator('.attend-grid-name').allTextContents();
    expect(names).toEqual(['Aur', 'Brightmoor', 'Dawnthistle', 'Em', 'Frostvale', 'Zed']);
    const statuses = await opened.page.locator('.attend-status-select').evaluateAll((els) => els.map((e) => e.value));
    expect(statuses).toEqual(['Present', 'Present', 'No Show', 'Present', '', 'Late (no notice)']);
  });
});

describe('Attendance Manage (new app): editing a status', () => {
  it('upserts the new status for that raider and night', async () => {
    const opened = await openApp(browser, server.port, state(BASE, '.attend-grid-rows'));
    try {
      const calls = recordRestCalls(opened.page, 'attendance', 'POST');
      await opened.page
        .locator('.attend-grid-row', { hasText: 'Frostvale' })
        .locator('.attend-status-select')
        .selectOption('Late (with notice)');
      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({
        team_id: TEAM_ID,
        player_id: 6,
        raid_date: '2026-05-14',
        status: 'Late (with notice)',
        source: 'Officer'
      });
    } finally {
      await opened.context.close();
    }
  });
});

describe('Attendance Manage (new app): excluding a report', () => {
  it('flags the night as excluded from scoring', async () => {
    const opened = await openApp(browser, server.port, state(BASE, '.attend-grid-rows'));
    try {
      const calls = recordRestCalls(opened.page, 'attendance', 'PATCH');
      await opened.page.getByRole('button', { name: 'Exclude Report' }).click();
      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({ report_excluded: true });
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Attendance Manage (new app): refresh from WCL', () => {
  it('reports how many nights were found', async () => {
    const opened = await openApp(
      browser,
      server.port,
      state(BASE, '.attend-grid-rows', {
        functionAnswers: { 'wcl-sync': { success: true, mainNights: 1, excluded: 0 } }
      })
    );
    try {
      await opened.page.getByRole('button', { name: 'Refresh from WCL' }).click();
      await expect
        .poll(() => opened.page.getByRole('status').filter({ hasText: 'Done: 1 night found, 0 excluded.' }).count())
        .toBe(1);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Attendance Manage (new app): commit attendance scores', () => {
  it('writes each raider’s weighted score to Scoring, skipping one with no eligible night', async () => {
    const opened = await openApp(browser, server.port, state(BASE, '.attend-grid-rows'));
    try {
      const scoring = recordRestCalls(opened.page, 'scoring', 'POST');
      const audit = recordRpcCalls(opened.page, 'write_audit_log');
      await opened.page.getByRole('button', { name: 'Commit Attendance Scores' }).click();
      await opened.page.getByRole('button', { name: 'Yes, Commit' }).click();
      await expect.poll(() => scoring.length).toBe(1);
      expect(scoring[0]).toEqual([
        { player_id: 1, season: 'MID2', attendance_score: 10, attendance_pct: 100, team_id: TEAM_ID },
        { player_id: 2, season: 'MID2', attendance_score: 9, attendance_pct: 90, team_id: TEAM_ID },
        { player_id: 3, season: 'MID2', attendance_score: 7.5, attendance_pct: 75, team_id: TEAM_ID },
        { player_id: 4, season: 'MID2', attendance_score: 5, attendance_pct: 50, team_id: TEAM_ID },
        { player_id: 5, season: 'MID2', attendance_score: 10, attendance_pct: 100, team_id: TEAM_ID }
      ]);
      await expect.poll(() => audit.length).toBe(1);
      expect(audit[0]).toEqual({
        p_team_id: TEAM_ID,
        p_action: 'Attendance Scores Committed',
        p_detail: '5 players, 2 nights'
      });
      await expect
        .poll(() => opened.page.getByRole('status').filter({ hasText: '5 players scored (2 nights)' }).count())
        .toBe(1);
    } finally {
      await opened.context.close();
    }
  });
});
