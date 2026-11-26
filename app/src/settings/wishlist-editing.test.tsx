import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';

// Settings > Season > Wishlist editing (#1823).

const PATH = '/g/wga/t/phoenix/officer/settings/season';

const person = (role: 'officer' | 'team_leader') => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role,
      characters: [{ player_id: 1, name_realm: 'Katorri-Stormrage', url_code: null, archived_at: null }]
    }
  ]
});

// Season 2 has its raid; Season 3 is named but its raid isn't added yet (#1928).
const SEASONS = [
  { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-01-01', ends_at: null },
  { code: 'MID3', display_name: 'Midnight Season 3', starts_at: null, ends_at: null }
];

function handlers(
  role: 'officer' | 'team_leader',
  rpcs: [string, Record<string, unknown>][] = [],
  open: string[] = []
): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'Katorri#1', discord: { id: 'd', name: 'Katorri' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: person(role) };
      if (name === 'set_team_season') {
        rpcs.push([name, args]);
        return { data: null };
      }
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table === 'seasons') return { data: SEASONS };
      if (read.table === 'raid_zones') return { data: [{ season: 'MID1' }, { season: 'MID2' }] };
      if (read.table === 'team_seasons')
        return { data: open.map((season_code) => ({ season_code, wishlist_open: true })) };
      return base.from!(read);
    }
  });
}

describe('Wishlist editing switch', () => {
  it('lets the team leader turn it on, leaving signups alone', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers('team_leader', rpcs));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Wishlist editing' }));
    expect(rpcs).toEqual([['set_team_season', { p_team_id: 1, p_season_code: 'MID2', p_wishlist_open: true }]]);
  });

  it('hides the switch from an officer who cannot lead the team', async () => {
    renderApp(PATH, handlers('officer'));
    expect(await screen.findByText('Only the team leader can turn wishlist editing on or off.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Wishlist editing' })).toBeNull();
  });
});

describe('Wishlist editing seasons (#1928)', () => {
  it('offers only seasons whose raid has been added', async () => {
    renderApp(PATH, handlers('team_leader'));
    const select = await screen.findByLabelText('Wishlist season');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['Midnight Season 2']);
  });

  it('keeps a season already open without a raid, so it can be closed', async () => {
    const rpcs: [string, Record<string, unknown>][] = [];
    renderApp(PATH, handlers('team_leader', rpcs, ['MID3']));
    const select = await screen.findByLabelText('Wishlist season');
    expect([...select.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'Midnight Season 2',
      'Midnight Season 3 (no raid yet)'
    ]);
    await userEvent.selectOptions(select, 'MID3');
    expect(screen.getByText(/raid hasn.t been added yet/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Wishlist editing' }));
    expect(rpcs).toEqual([['set_team_season', { p_team_id: 1, p_season_code: 'MID3', p_wishlist_open: false }]]);
  });
});
