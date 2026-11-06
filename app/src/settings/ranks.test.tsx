import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { rankChoices } from './RanksSettingsPage';

// Settings > Ranks (#1651). The viewer is the row with is_you.
const PATH = '/g/wga/t/phoenix/officer/settings/ranks';

function ranksHandlers(mine: string, raz: string, opts: { role?: string; refuse?: boolean } = {}): FakeHandlers {
  const base = seededHandlers();
  return {
    ...base,
    session: fakeSession({ battlenet: 'X#1', discord: { id: 'discord-x', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') {
        return {
          data: {
            site_admin: false,
            guild_officer: false,
            boe_manager: false,
            teams: [{ team_id: 1, team_member_id: 1, role: opts.role ?? 'officer', characters: [] }]
          }
        };
      }
      if (name === 'team_member_ranks') {
        return {
          data: [
            { team_member_id: 1, display_name: 'Katorri', rank: mine, signed_in: true, is_you: true },
            { team_member_id: 9, display_name: 'Raz', rank: raz, signed_in: true, is_you: false }
          ]
        };
      }
      if (name === 'set_team_rank') return opts.refuse ? { error: { message: 'Not authorized' } } : { data: null };
      return base.rpc!(name, args);
    }
  };
}

const optionsOf = (box: HTMLElement) =>
  within(box)
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('Settings > Ranks', () => {
  it('gives the Team Owner every rank but Team Owner, and saves a change', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, ranksHandlers('owner', 'raider'));
    const box = await screen.findByRole('combobox', { name: 'Team rank for Raz' });
    expect(optionsOf(box)).toEqual(['Officer', 'Assistant', 'Raider']);
    // Their own row is plain text: nobody changes the Team Owner here.
    expect(screen.getByRole('row', { name: /Katorri/ })).toHaveTextContent('Team Owner');
    await user.selectOptions(box, 'Officer');
    expect(await screen.findByText('Raz is now Officer.')).toBeInTheDocument();
    expect(client.rpcs).toContainEqual(['set_team_rank', { p_team_id: 1, p_team_member_id: 9, p_rank: 'officer' }]);
  });

  it('gives an Officer Raider and Assistant only, and says when it is refused', async () => {
    const user = userEvent.setup();
    renderApp(PATH, ranksHandlers('officer', 'raider', { refuse: true }));
    const box = await screen.findByRole('combobox', { name: 'Team rank for Raz' });
    expect(optionsOf(box)).toEqual(['Assistant', 'Raider']);
    await user.selectOptions(box, 'Assistant');
    expect((await screen.findAllByText(/Could not change Raz/)).length).toBeGreaterThan(0);
  });

  it('shows an Officer another Officer as plain text', async () => {
    renderApp(PATH, ranksHandlers('officer', 'officer'));
    expect(await screen.findByRole('row', { name: /Raz/ })).toHaveTextContent('Officer');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('is closed to a Raider, and missing from their menu', async () => {
    const { client } = renderApp(PATH, ranksHandlers('raider', 'raider', { role: 'raider' }));
    expect(await screen.findByText(/This page is for officers/)).toBeInTheDocument();
    expect(client.rpcs.some(([name]) => name === 'team_member_ranks')).toBe(false);
  });

  it('offers nothing for the Team Owner row, or to someone who can do neither', () => {
    expect(rankChoices('owner', true, true)).toEqual([]);
    expect(rankChoices('raider', false, false)).toEqual([]);
  });
});
