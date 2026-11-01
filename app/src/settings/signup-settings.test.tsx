import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import { easternToday } from '../lib/dates';
import { addDays } from './signups';

// Settings > Signups (#1342): the team leader opens and closes signups, and
// closing shows what will happen first (#1467).

const PATH = '/g/wga/t/phoenix/officer/settings/signups';

const person = (role: 'officer' | 'team_leader') => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role,
      characters: [{ player_id: 1, name_realm: 'Katorrí-Stormrage', url_code: null, archived_at: null }]
    }
  ]
});

const PREVIEW = {
  expected: 'abc123',
  stays: [{ signup_id: 1, player_id: 1, name_realm: 'Katorrí-Stormrage' }],
  joins: [{ signup_id: 2, name_realm: 'Brellik-Illidan' }],
  swaps: [{ signup_id: 3, name_realm: 'Sorrelwind-Illidan', from_player_id: 7, from_name_realm: 'Sorrelmoon-Illidan' }],
  first_mains: [],
  archives: [
    { player_id: 8, name_realm: 'Quietone-Illidan' },
    { player_id: 9, name_realm: 'Gonefishing-Illidan' }
  ],
  skipped: [{ signup_id: 4, name_realm: 'Twomains-Illidan', reason: 'several_characters' }]
};

function handlers({
  role = 'team_leader',
  startsIn,
  open,
  rpcs = []
}: {
  role?: 'officer' | 'team_leader';
  // Days until MID3 starts; null for a season Blizzard has not dated (#1714).
  startsIn: number | null;
  open: boolean;
  rpcs?: [string, Record<string, unknown>][];
}): FakeHandlers {
  const base = seededHandlers();
  const starts = startsIn === null ? null : addDays(easternToday(), startsIn);
  return seededHandlers({
    session: fakeSession({ battlenet: 'Katorri#1', discord: { id: 'd', name: 'Katorri' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: person(role) };
      if (name === 'preview_signup_promotion') return { data: PREVIEW };
      if (name === 'set_team_season' || name === 'promote_season_signups') {
        rpcs.push([name, args]);
        return { data: null };
      }
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table === 'seasons')
        return {
          data: [
            {
              code: 'MID2',
              display_name: 'Midnight Season 2',
              starts_at: '2026-01-01',
              ends_at: starts && addDays(starts, -1)
            },
            { code: 'MID3', display_name: 'Midnight Season 3', starts_at: starts, ends_at: null }
          ]
        };
      if (read.table === 'team_seasons') return { data: open ? [{ season_code: 'MID3', signups_open: true }] : [] };
      return base.from!(read);
    }
  });
}

describe('Signup settings', () => {
  it('lets the team leader open signups for the coming season', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers({ startsIn: 60, open: false, rpcs }));
    expect(await screen.findByRole('combobox', { name: 'Season' })).toHaveValue('MID3');
    expect(screen.getByText('Closed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open signups' }));
    await expect.poll(() => rpcs.length).toBe(1);
    expect(rpcs[0]).toEqual(['set_team_season', { p_team_id: 1, p_season_code: 'MID3', p_signups_open: true }]);
  });

  // The 14-day wait (#648) is gone (#1714): the leader closes whenever they
  // choose, even months ahead.
  it('lets the team leader close signups any time', async () => {
    renderApp(PATH, handlers({ startsIn: 90, open: true }));
    expect(await screen.findByRole('button', { name: 'Close signups…' })).toBeEnabled();
  });

  it('opens signups for a season Blizzard has not dated yet', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers({ startsIn: null, open: false, rpcs }));
    expect(await screen.findByRole('combobox', { name: 'Season' })).toHaveValue('MID3');
    expect(screen.getByText('Midnight Season 3 starts on a date Blizzard has not announced yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open signups' }));
    await expect.poll(() => rpcs.length).toBe(1);
  });

  it('is read-only for an officer', async () => {
    renderApp(PATH, handlers({ role: 'officer', startsIn: 5, open: true }));
    expect(await screen.findByText('Only the team leader can open or close signups.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close signups/ })).not.toBeInTheDocument();
  });

  it('shows what closing will do by name, and archives only the characters left ticked', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers({ startsIn: 5, open: true, rpcs }));
    await userEvent.click(await screen.findByRole('button', { name: 'Close signups…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close signups for Midnight Season 3' });
    expect(within(dialog).getByText('Brellik-Illidan')).toBeInTheDocument();
    expect(within(dialog).getByText('Sorrelwind-Illidan, replacing Sorrelmoon-Illidan')).toBeInTheDocument();
    expect(within(dialog).getByText(/Twomains-Illidan: has more than one character/)).toBeInTheDocument();

    const keep = within(dialog).getByRole('checkbox', { name: 'Quietone-Illidan' });
    expect(keep).toBeChecked();
    await userEvent.click(keep);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close signups and take 1 off' }));
    await expect.poll(() => rpcs.length).toBe(1);
    expect(rpcs[0]).toEqual([
      'promote_season_signups',
      { p_team_id: 1, p_season: 'MID3', p_expected: 'abc123', p_archive_player_ids: [9] }
    ]);
  });
});
