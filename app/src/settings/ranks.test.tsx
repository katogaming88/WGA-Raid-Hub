import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { rankChoices, rankLine } from './RanksSettingsPage';

// Settings > Ranks (#1651). The viewer is the row with is_you.
const PATH = '/g/wga/t/phoenix/officer/settings/ranks';

function ranksHandlers(
  mine: string,
  raz: string,
  opts: { role?: string; refuse?: boolean; gridFails?: boolean; more?: object[] } = {}
): FakeHandlers {
  const base = seededHandlers();
  return {
    ...base,
    from(read) {
      if (read.table === 'team_rank_permissions') {
        if (opts.gridFails) return { error: { message: 'no' } };
        return {
          data: [
            { rank: 'raider', permission: 'own_character' },
            { rank: 'assistant', permission: 'own_character' },
            { rank: 'assistant', permission: 'edit_roster' },
            { rank: 'officer', permission: 'own_character' },
            { rank: 'officer', permission: 'edit_roster' },
            { rank: 'officer', permission: 'manage_loot' }
          ]
        };
      }
      return base.from!(read);
    },
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
            { team_member_id: 9, display_name: 'Raz', rank: raz, signed_in: true, is_you: false },
            ...(opts.more ?? [])
          ]
        };
      }
      if (name === 'set_team_rank') return opts.refuse ? { error: { message: 'Not authorized' } } : { data: null };
      return base.rpc!(name, args);
    }
  };
}

// The list item holding this name, as a row of the page.
const rowOf = (name: string) => screen.getByText(name, { exact: false, selector: '.ranks-name' }).closest('li')!;

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
    // Their own row has no box: nobody changes the Team Owner here.
    const ownerColumn = within(screen.getByRole('region', { name: /Team Owner/ }));
    expect(ownerColumn.getByText('Katorri', { exact: false })).toBeInTheDocument();
    expect(ownerColumn.queryByRole('combobox')).not.toBeInTheDocument();
    await user.selectOptions(box, 'Assistant');
    expect(await screen.findByText('Raz is now Assistant.')).toBeInTheDocument();
    expect(client.rpcs).toContainEqual(['set_team_rank', { p_team_id: 1, p_team_member_id: 9, p_rank: 'assistant' }]);
  });

  it('gives an Officer Raider and Assistant only, and says when it is refused', async () => {
    const user = userEvent.setup();
    renderApp(PATH, ranksHandlers('officer', 'raider', { refuse: true }));
    const box = await screen.findByRole('combobox', { name: 'Team rank for Raz' });
    expect(optionsOf(box)).toEqual(['Assistant', 'Raider']);
    await user.selectOptions(box, 'Assistant');
    expect((await screen.findAllByText(/Could not change Raz/)).length).toBeGreaterThan(0);
  });

  it('shows an Officer another Officer with no box', async () => {
    renderApp(PATH, ranksHandlers('officer', 'officer'));
    const officers = await screen.findByRole('region', { name: /Officers/ });
    expect(within(officers).getByText('Raz')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('is closed to a Raider, and missing from their menu', async () => {
    const { client } = renderApp(PATH, ranksHandlers('raider', 'raider', { role: 'raider' }));
    expect(await screen.findByText(/This page is for officers/)).toBeInTheDocument();
    expect(client.rpcs.some(([name]) => name === 'team_member_ranks')).toBe(false);
  });

  it('asks before making someone an Officer, and Cancel changes nothing', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, ranksHandlers('owner', 'raider'));
    const box = await screen.findByRole('combobox', { name: 'Team rank for Raz' });
    await user.selectOptions(box, 'Officer');
    let dialog = within(await screen.findByRole('dialog', { name: 'Make Raz an Officer?' }));
    expect(await dialog.findByText(/import loot and edit priority and scoring/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.rpcs.some(([name]) => name === 'set_team_rank')).toBe(false);
    expect(box).toHaveValue('raider');

    await user.selectOptions(box, 'Officer');
    dialog = within(await screen.findByRole('dialog', { name: 'Make Raz an Officer?' }));
    await user.click(dialog.getByRole('button', { name: 'Make Officer' }));
    expect(await screen.findByText('Raz is now Officer.')).toBeInTheDocument();
    expect(client.rpcs).toContainEqual(['set_team_rank', { p_team_id: 1, p_team_member_id: 9, p_rank: 'officer' }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before taking Officer away, and Cancel changes nothing', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, ranksHandlers('owner', 'officer'));
    const box = await screen.findByRole('combobox', { name: 'Team rank for Raz' });
    await user.selectOptions(box, 'Raider');
    let dialog = within(await screen.findByRole('dialog', { name: 'Take Officer away from Raz?' }));
    expect(dialog.getByText(/Raz becomes a Raider/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(client.rpcs.some(([name]) => name === 'set_team_rank')).toBe(false);
    expect(box).toHaveValue('officer');

    await user.selectOptions(box, 'Assistant');
    dialog = within(await screen.findByRole('dialog', { name: 'Take Officer away from Raz?' }));
    expect(dialog.getByText(/Raz becomes an Assistant/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Take Officer away' }));
    expect(await screen.findByText('Raz is now Assistant.')).toBeInTheDocument();
    expect(client.rpcs).toContainEqual(['set_team_rank', { p_team_id: 1, p_team_member_id: 9, p_rank: 'assistant' }]);
  });

  it('moves between Raider and Assistant without asking', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, ranksHandlers('owner', 'assistant'));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Team rank for Raz' }), 'Raider');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(client.rpcs).toContainEqual(['set_team_rank', { p_team_id: 1, p_team_member_id: 9, p_rank: 'raider' }]);
  });

  it('keeps a refused Officer change in the dialog, with the reason', async () => {
    const user = userEvent.setup();
    renderApp(PATH, ranksHandlers('owner', 'raider', { refuse: true }));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Team rank for Raz' }), 'Officer');
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: 'Make Officer' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Not authorized');
  });

  it('puts people in a section per rank with counts, says what each rank can do, and who has not signed in', async () => {
    renderApp(
      PATH,
      ranksHandlers('owner', 'officer', {
        more: [{ team_member_id: 3, display_name: 'Dorn', rank: 'raider', signed_in: false, is_you: false }]
      })
    );
    const officers = await screen.findByRole('region', { name: 'Officers 1' });
    expect(within(officers).getByText('Raz')).toBeInTheDocument();
    expect(
      await within(officers).findByText('Everything an Assistant can, and: import loot and edit priority and scoring.')
    ).toBeInTheDocument();
    expect(rowOf('Katorri')).toHaveTextContent('(you)');
    expect(rowOf('Dorn')).toHaveTextContent('Hasn’t signed in yet');
    expect(rowOf('Raz')).not.toHaveTextContent('Hasn’t signed in yet');
  });

  it('still lists everyone when the grid cannot be read, and says so', async () => {
    renderApp(PATH, ranksHandlers('owner', 'raider', { gridFails: true }));
    await screen.findByRole('combobox', { name: 'Team rank for Raz' });
    expect((await screen.findAllByText('Couldn’t load what this rank can do.')).length).toBe(4);
  });

  it('searches by name, showing only the sections with a match', async () => {
    const user = userEvent.setup();
    renderApp(PATH, ranksHandlers('owner', 'raider'));
    await screen.findByRole('combobox', { name: 'Team rank for Raz' });
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'RAZ');
    expect(screen.getByText('Raz')).toBeInTheDocument();
    expect(screen.queryByText('Katorri', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Officers/ })).not.toBeInTheDocument();
    await user.clear(screen.getByRole('searchbox', { name: 'Search' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'nobody');
    expect(screen.getByText('Nobody on the team matches that.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Raiders/ })).not.toBeInTheDocument();
  });

  it('keeps the keyboard on the rank box after the person moves section', async () => {
    const user = userEvent.setup();
    let raz = 'raider';
    const handlers = ranksHandlers('owner', 'raider');
    const base = handlers.rpc!;
    handlers.rpc = (name, args) => {
      if (name === 'set_team_rank') {
        raz = String(args['p_rank']);
        return { data: null };
      }
      if (name === 'team_member_ranks') {
        return {
          data: [
            { team_member_id: 1, display_name: 'Katorri', rank: 'owner', signed_in: true, is_you: true },
            { team_member_id: 9, display_name: 'Raz', rank: raz, signed_in: true, is_you: false }
          ]
        };
      }
      return base(name, args);
    };
    renderApp(PATH, handlers);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Team rank for Raz' }), 'Assistant');
    await screen.findByText('Raz is now Assistant.');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Team rank for Raz' })).toHaveValue('assistant'));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Team rank for Raz' })).toHaveFocus());
  });

  it('describes a rank that does not hold all of the rank below by its own list', () => {
    const grid = new Map([
      ['raider' as const, new Set(['own_character'])],
      ['assistant' as const, new Set(['edit_roster'])]
    ]);
    expect(rankLine('assistant', grid)).toBe('Edit the roster.');
    expect(rankLine('raider', grid)).toBe('Keep their own characters.');
    expect(rankLine('officer', new Map())).toBe('Nothing on this team yet.');
    expect(rankLine('owner', new Map())).toBe('Everything here, and makes someone an Officer.');
  });

  it('offers nothing for the Team Owner row, or to someone who can do neither', () => {
    expect(rankChoices('owner', true, true)).toEqual([]);
    expect(rankChoices('raider', false, false)).toEqual([]);
  });
});
