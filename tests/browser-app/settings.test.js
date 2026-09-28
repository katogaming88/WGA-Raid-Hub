import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { launchBrowser, openApp, startApp, storedSession } from './harness.js';

// The new app's officer Settings pages (#1357, #1103 row 1): General, Season,
// Raid progression and Danger zone, against js/tabs/tab-season.js's recorded
// behavior. Close Season is renamed Archive season here (#1103's decision);
// everything it writes is unchanged.

const TEAM_ID = 1;

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

const state = (path, sentinel, extra = {}) => ({
  path,
  sentinel,
  session: storedSession({ discord: 'Aurelith' }),
  person: OFFICER,
  ...extra,
  rpc: { write_audit_log: null, team_season_start: null, set_team_setting: {}, ...extra.rpc }
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

describe('General settings (new app)', () => {
  const GENERAL_TABLES = {
    team_settings: [
      {
        team_id: TEAM_ID,
        seasonView: null,
        trialWeeks: 6,
        trialAttend: 80,
        targetTankCount: 2,
        targetHealCount: 5,
        warcraftLogsUrl: 'https://www.warcraftlogs.com/guild/id/12345',
        discordSignupChannelId: '999',
        signupSheetLeadHours: 48
      }
    ],
    raid_zones: [{ season: 'MID1' }, { season: 'MID2' }]
  };
  const BASE = '/g/wga/t/phoenix/officer/settings';

  it('shows all five cards with their saved values', async () => {
    const opened = await openApp(browser, server.port, state(BASE, '.settings-cards', { tables: GENERAL_TABLES }));
    try {
      await expect(opened.page.locator('#wcl-url-input').inputValue()).resolves.toBe(
        'https://www.warcraftlogs.com/guild/id/12345'
      );
      await expect(opened.page.locator('#discord-channel-input').inputValue()).resolves.toBe('999');
      await expect(opened.page.locator('#discord-lead-hours-input').inputValue()).resolves.toBe('48');
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });

  it('saves Trial Promotion Thresholds, clamped into range', async () => {
    const opened = await openApp(browser, server.port, state(BASE, '.settings-cards', { tables: GENERAL_TABLES }));
    try {
      const calls = recordRpcCalls(opened.page, 'set_team_setting');
      const weeks = opened.page
        .locator('.settings-card', { hasText: 'Trial Promotion Thresholds' })
        .locator('input')
        .first();
      await weeks.fill('999');
      await opened.page
        .locator('.settings-card', { hasText: 'Trial Promotion Thresholds' })
        .getByRole('button', { name: 'Save' })
        .click();
      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({
        p_team_id: TEAM_ID,
        p_updates: { trialWeeks: 52, trialAttend: 80 },
        p_skip_audit: true
      });
    } finally {
      await opened.context.close();
    }
  });
});

describe('Season settings (new app): history and WCL Performance Baseline', () => {
  const HISTORY = [
    {
      code: 'MID1',
      name: 'Midnight Season 1',
      start: '2026-01-01',
      end: '2026-03-31',
      raids: [
        { name: 'Old Raid', wclZoneId: 40, isMiniRaid: false, bosses: [{ name: 'A', mythicDate: '2026-03-01' }] }
      ],
      roster: [
        {
          nameRealm: 'Aurelith-Illidan',
          role: 'Tank',
          isTrial: false,
          isBench: false,
          joinDate: '2025-01-01',
          attendance: '90.0%'
        }
      ]
    }
  ];
  const BASE = '/g/wga/t/phoenix/officer/settings/season';

  it('offers the WCL Performance Baseline fetch on the newest closed tier', async () => {
    const opened = await openApp(
      browser,
      server.port,
      state(BASE, '.settings-history-list', {
        tables: { team_settings: [{ team_id: TEAM_ID, history: HISTORY }], player_wcl_season_perf: [] }
      })
    );
    try {
      await expect(opened.page.getByText('Midnight Season 1').count()).resolves.toBe(1);
      await expect(
        opened.page.getByText('Not fetched yet -- do this before generating Heroic priority.').count()
      ).resolves.toBe(1);
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Raid progression (new app)', () => {
  const BASE = '/g/wga/t/phoenix/officer/settings/progression';

  it('adds a raid and a boss, then saves the whole list', async () => {
    const opened = await openApp(
      browser,
      server.port,
      state(BASE, '.settings-raid-list', { tables: { team_settings: [{ team_id: TEAM_ID }] } })
    );
    try {
      const calls = recordRpcCalls(opened.page, 'set_team_setting');
      await opened.page.getByRole('button', { name: '+ Add Raid' }).click();
      await opened.page.getByPlaceholder('Raid name (e.g. Liberation of Undermine)').fill('Test Raid');
      await opened.page.getByRole('button', { name: '+ Add Boss' }).click();
      await opened.page.getByPlaceholder('Boss name').fill('First Boss');
      await opened.page.getByRole('button', { name: 'Save Progression' }).click();
      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({
        p_team_id: TEAM_ID,
        p_updates: {
          raidProgression: [
            { name: 'Test Raid', isMiniRaid: false, aotcDate: '', bosses: [{ name: 'First Boss', mythicDate: '' }] }
          ]
        },
        p_skip_audit: true
      });
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});

describe('Danger zone (new app): Archive season', () => {
  const SEASONS = [
    { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-01-01', ends_at: '2026-03-31' },
    { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-04-01', ends_at: null }
  ];
  const PLAYERS = [
    {
      id: 1,
      name_realm: 'Aurelith-Illidan',
      nickname: null,
      is_trial: false,
      is_bench: false,
      is_rotator: false,
      tier_pieces_equipped: null,
      join_date: '2025-01-01',
      classes_specs: { class: 'Warrior', spec: 'Protection', role: 'Tank' }
    }
  ];
  const ATTENDANCE = [
    {
      id: 1,
      player_id: 1,
      raid_date: '2026-01-05',
      status: 'Present',
      report_excluded: false,
      report_title: null,
      source: null
    }
  ];
  const BASE = '/g/wga/t/phoenix/officer/settings/danger';

  it('is labeled Archive season, not Close Season', async () => {
    const opened = await openApp(
      browser,
      server.port,
      state(BASE, '.settings-danger-card', {
        tables: { seasons: SEASONS, team_settings: [{ team_id: TEAM_ID }], players: PLAYERS, attendance: ATTENDANCE }
      })
    );
    try {
      await expect(opened.page.getByRole('button', { name: 'Archive season' }).count()).resolves.toBe(1);
      await expect(opened.page.getByText('Close Season').count()).resolves.toBe(0);
    } finally {
      await opened.context.close();
    }
  });

  it('reads the team’s first raid night in the tier, then records it into Season History', async () => {
    const opened = await openApp(
      browser,
      server.port,
      state(BASE, '.settings-danger-card', {
        tables: { seasons: SEASONS, team_settings: [{ team_id: TEAM_ID }], players: PLAYERS, attendance: ATTENDANCE },
        rpc: { team_season_start: '2026-01-01', close_season: { seasonHistory: [{ code: 'MID1' }] } }
      })
    );
    try {
      const nightCalls = recordRpcCalls(opened.page, 'team_season_start');
      const closeCalls = recordRpcCalls(opened.page, 'close_season');
      await opened.page.getByRole('button', { name: 'Archive season' }).click();
      await opened.page.getByRole('button', { name: 'Yes, Archive' }).click();
      await expect.poll(() => closeCalls.length).toBe(1);
      expect(nightCalls[0]).toEqual({ p_team_id: TEAM_ID, p_season: 'MID1' });
      expect(closeCalls[0]).toMatchObject({
        p_team_id: TEAM_ID,
        p_season: 'MID1',
        p_roster_snapshot: [
          {
            playerId: 1,
            nameRealm: 'Aurelith-Illidan',
            role: 'Tank',
            isTrial: false,
            isBench: false,
            joinDate: '2025-01-01',
            attendance: '100.0%'
          }
        ]
      });
      await expect.poll(() => opened.page.getByRole('status').filter({ hasText: 'Season archived.' }).count()).toBe(1);
      expect(opened.unexpected).toEqual([]);
      expect(opened.pageErrors).toEqual([]);
    } finally {
      await opened.context.close();
    }
  });
});
