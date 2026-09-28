import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';

// Officer Settings (#1357, #1103 row 1): General, Season, Raid progression
// and Danger zone, ported from js/tabs/tab-season.js's Season Settings tab.

const OFFICER_PERSON = {
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role: 'officer',
      characters: [{ player_id: 1, name_realm: 'Aur-Illidan', url_code: null, archived_at: null }]
    }
  ]
};

function officerHandlers(overrides: {
  from?: (read: Read) => unknown;
  rpc?: (name: string, args: Record<string, unknown>) => unknown;
  invoke?: (name: string, args: unknown) => unknown;
} = {}): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'Aur#1', discord: { id: 'd', name: 'Aur' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: OFFICER_PERSON };
      const custom = overrides.rpc?.(name, args);
      if (custom !== undefined) return custom as { data?: unknown };
      return base.rpc!(name, args);
    },
    from(read) {
      const custom = overrides.from?.(read);
      if (custom !== undefined) return custom as { data?: unknown };
      return base.from!(read);
    },
    invoke(name, args) {
      const custom = overrides.invoke?.(name, args);
      return (custom as { data?: unknown }) ?? { data: { success: true } };
    }
  });
}

// -- General --------------------------------------------------------------

describe('General settings', () => {
  const GENERAL_ROW = {
    seasonView: null,
    trialWeeks: 6,
    trialAttend: 80,
    targetTankCount: 2,
    targetHealCount: 5,
    warcraftLogsUrl: 'https://www.warcraftlogs.com/guild/id/12345',
    discordSignupChannelId: '999',
    signupSheetLeadHours: 48
  };

  it('shows every card with its saved value', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings',
      officerHandlers({
        from: (read) =>
          read.table === 'team_settings' ? { data: GENERAL_ROW } : read.table === 'raid_zones' ? { data: [] } : undefined
      })
    );
    await screen.findByRole('heading', { name: 'Season View' });
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('6');
    expect(screen.getByDisplayValue('https://www.warcraftlogs.com/guild/id/12345')).toBeInTheDocument();
    expect(screen.getByDisplayValue('999')).toBeInTheDocument();
  });

  it('saves Trial Promotion Thresholds, clamped into range', async () => {
    const calls: unknown[] = [];
    renderApp(
      '/g/wga/t/phoenix/officer/settings',
      officerHandlers({
        from: (read) =>
          read.table === 'team_settings' ? { data: GENERAL_ROW } : read.table === 'raid_zones' ? { data: [] } : undefined,
        rpc: (name, args) => {
          if (name === 'set_team_setting') {
            calls.push(args);
            return { data: {} };
          }
          return undefined;
        }
      })
    );
    await screen.findByRole('heading', { name: 'Trial Promotion Thresholds' });
    const weeksInput = screen.getAllByRole('spinbutton')[0]!;
    await userEvent.clear(weeksInput);
    await userEvent.type(weeksInput, '999');
    await userEvent.click(within(weeksInput.closest('.settings-card')!).getByRole('button', { name: 'Save' }));
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      p_team_id: 1,
      p_updates: { trialWeeks: 52, trialAttend: 80 },
      p_skip_audit: true
    });
  });

  it('verifies a Discord channel', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings',
      officerHandlers({
        from: (read) =>
          read.table === 'team_settings' ? { data: GENERAL_ROW } : read.table === 'raid_zones' ? { data: [] } : undefined,
        invoke: (name) => (name === 'discord-bot-webhook' ? { data: { ok: true, name: 'raid-attendance' } } : undefined)
      })
    );
    await screen.findByRole('heading', { name: 'Discord Signup Sheet' });
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('#raid-attendance')).toBeInTheDocument();
  });
});

// -- Season -----------------------------------------------------------------

describe('Season settings', () => {
  const HISTORY = [
    {
      code: 'MID1',
      name: 'Midnight Season 1',
      start: '2026-01-01',
      end: '2026-03-31',
      raids: [{ name: 'Old Raid', wclZoneId: 40, isMiniRaid: false, bosses: [{ name: 'A', mythicDate: '2026-03-01' }] }],
      roster: [
        { nameRealm: 'Aur-Illidan', role: 'Tank', isTrial: false, isBench: false, joinDate: '2025-01-01', attendance: '90.0%' }
      ]
    }
  ];

  it('shows the newest entry with its WCL Performance Baseline row', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings/season',
      officerHandlers({
        from: (read) => {
          if (read.table === 'team_settings') return { data: { history: HISTORY } };
          if (read.table === 'player_wcl_season_perf') return { count: 2 };
          if (read.table === 'seasons') return { data: [] };
          return undefined;
        }
      })
    );
    await screen.findByRole('heading', { level: 2, name: 'Season History' });
    expect(screen.getByText('Midnight Season 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fetch WCL Performance' })).toBeInTheDocument();
    expect(await screen.findByText('Already fetched (2 players).')).toBeInTheDocument();
  });

  it('shows the roster snapshot behind a toggle', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings/season',
      officerHandlers({
        from: (read) => {
          if (read.table === 'team_settings') return { data: { history: HISTORY } };
          if (read.table === 'player_wcl_season_perf') return { count: 0 };
          if (read.table === 'seasons') return { data: [] };
          return undefined;
        }
      })
    );
    await screen.findByRole('heading', { level: 2, name: 'Season History' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View Roster' }));
    expect(screen.getByRole('cell', { name: 'Aur-Illidan' })).toBeInTheDocument();
  });

  it('says so when nothing has been closed yet', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings/season',
      officerHandlers({ from: (read) => (read.table === 'team_settings' ? { data: {} } : undefined) })
    );
    expect(await screen.findByText('No tier closed for this team yet.')).toBeInTheDocument();
  });
});

// -- Raid progression ---------------------------------------------------------

describe('Raid progression', () => {
  it('adds a raid and a boss, then saves the whole list', async () => {
    const calls: unknown[] = [];
    renderApp(
      '/g/wga/t/phoenix/officer/settings/progression',
      officerHandlers({
        from: (read) => (read.table === 'team_settings' ? { data: {} } : undefined),
        rpc: (name, args) => {
          if (name === 'set_team_setting') {
            calls.push(args);
            return { data: {} };
          }
          return undefined;
        }
      })
    );
    await screen.findByRole('button', { name: '+ Add Raid' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Raid' }));
    await userEvent.type(screen.getByPlaceholderText('Raid name (e.g. Liberation of Undermine)'), 'Test Raid');
    await userEvent.click(screen.getByRole('button', { name: '+ Add Boss' }));
    await userEvent.type(screen.getByPlaceholderText('Boss name'), 'First Boss');
    await userEvent.click(screen.getByRole('button', { name: 'Save Progression' }));
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]).toMatchObject({
      p_team_id: 1,
      p_updates: {
        raidProgression: [{ name: 'Test Raid', isMiniRaid: false, aotcDate: '', bosses: [{ name: 'First Boss', mythicDate: '' }] }]
      }
    });
  });

  it('hides the AOTC date once a raid is marked mini', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings/progression',
      officerHandlers({ from: (read) => (read.table === 'team_settings' ? { data: {} } : undefined) })
    );
    await screen.findByRole('button', { name: '+ Add Raid' });
    await userEvent.click(screen.getByRole('button', { name: '+ Add Raid' }));
    expect(screen.getByText('AOTC Date')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Mini-raid' }));
    expect(screen.queryByText('AOTC Date')).not.toBeInTheDocument();
  });
});

// -- Danger zone --------------------------------------------------------------

describe('Danger zone', () => {
  const SEASONS = [
    { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-01-01', ends_at: '2026-03-31' },
    { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-04-01', ends_at: null }
  ];

  it('is labeled Archive season, not Close Season', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings/danger',
      officerHandlers({
        from: (read) => {
          if (read.table === 'seasons') return { data: SEASONS };
          if (read.table === 'team_settings') return { data: {} };
          if (read.table === 'players') return { data: [] };
          if (read.table === 'attendance') return { data: [] };
          return undefined;
        }
      })
    );
    await screen.findByRole('button', { name: 'Archive season' });
    expect(screen.getByRole('button', { name: 'Archive season' })).toBeInTheDocument();
    expect(screen.queryByText(/Close Season/)).not.toBeInTheDocument();
  });

  it('archives the closable tier: reads the team’s first raid night, then closes the books', async () => {
    const calls: [string, unknown][] = [];
    renderApp(
      '/g/wga/t/phoenix/officer/settings/danger',
      officerHandlers({
        from: (read) => {
          if (read.table === 'seasons') return { data: SEASONS };
          if (read.table === 'team_settings') return { data: {} };
          if (read.table === 'players') {
            return {
              data: [
                {
                  id: 1,
                  name_realm: 'Aur-Illidan',
                  nickname: null,
                  is_trial: false,
                  is_bench: false,
                  is_rotator: false,
                  tier_pieces_equipped: null,
                  join_date: '2025-01-01',
                  classes_specs: { class: 'Warrior', spec: 'Protection', role: 'Tank' }
                }
              ]
            };
          }
          if (read.table === 'attendance') {
            return {
              data: [{ id: 1, player_id: 1, raid_date: '2026-01-05', status: 'Present', report_excluded: false, report_title: null, source: null }]
            };
          }
          return undefined;
        },
        rpc: (name, args) => {
          calls.push([name, args]);
          if (name === 'team_season_start') return { data: '2026-01-01' };
          if (name === 'close_season') return { data: { seasonHistory: [{ code: 'MID1' }] } };
          return undefined;
        }
      })
    );
    await screen.findByRole('button', { name: 'Archive season' });
    await userEvent.click(screen.getByRole('button', { name: 'Archive season' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Yes, Archive' }));
    await expect.poll(() => calls.filter(([n]) => n === 'close_season').length).toBe(1);
    const [, closeArgs] = calls.find(([n]) => n === 'close_season')!;
    expect(closeArgs).toMatchObject({ p_team_id: 1, p_season: 'MID1' });
    expect(await screen.findByRole('status')).toHaveTextContent('Season archived.');
  });

  it('disables the control once every tier that has ended is closed', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/settings/danger',
      officerHandlers({
        from: (read) => {
          if (read.table === 'seasons') return { data: SEASONS };
          if (read.table === 'team_settings') return { data: { history: [{ code: 'MID1' }] } };
          if (read.table === 'players') return { data: [] };
          if (read.table === 'attendance') return { data: [] };
          return undefined;
        }
      })
    );
    await screen.findByRole('heading', { level: 2, name: 'Archive Season' });
    expect(screen.getByRole('button', { name: 'Archive season' })).toBeDisabled();
    expect(screen.getByText('Every tier that has ended is closed for this team.')).toBeInTheDocument();
  });
});
