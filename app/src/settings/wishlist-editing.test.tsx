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

function handlers(role: 'officer' | 'team_leader', rpcs: [string, Record<string, unknown>][] = []): FakeHandlers {
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
      if (read.table === 'seasons')
        return { data: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-01-01', ends_at: null }] };
      if (read.table === 'team_seasons') return { data: [] };
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
