import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// The team's rank permissions grid on Settings > Ranks (#1653).
const PATH = '/g/wga/t/phoenix/officer/settings';
const DEFAULTS = [
  { permission: 'edit_own_wishlist', default_ranks: ['raider', 'assistant', 'officer'] },
  { permission: 'edit_roster', default_ranks: ['assistant', 'officer'] },
  { permission: 'manage_loot', default_ranks: ['officer'] }
];

function handlers(mine: 'owner' | 'officer', refuse?: string): FakeHandlers {
  const base = seededHandlers();
  // The stored grid: a save below changes it, as the database would.
  let on = DEFAULTS.flatMap((d) => d.default_ranks.map((rank) => ({ rank, permission: d.permission })));
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
            teams: [{ team_id: 1, team_member_id: 1, role: 'officer', characters: [] }]
          }
        };
      }
      if (name === 'team_member_ranks') {
        return { data: [{ team_member_id: 1, display_name: 'Katorri', rank: mine, signed_in: true, is_you: true }] };
      }
      if (name === 'set_team_rank_permissions') {
        if (refuse) return { data: null, error: { message: refuse } };
        for (const c of args['p_changes'] as { rank: string; permission: string; on: boolean }[]) {
          on = on.filter((r) => r.rank !== c.rank || r.permission !== c.permission);
          if (c.on) on.push({ rank: c.rank, permission: c.permission });
        }
        return { data: null };
      }
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'team_rank_permissions') return { data: [...on] };
      if (read.table === 'rank_permissions') return { data: DEFAULTS };
      return base.from!(read);
    }
  };
}

const box = (name: string) => screen.findByRole('checkbox', { name });
const sent = (client: { rpcs: unknown[][] }) => client.rpcs.filter(([name]) => name === 'set_team_rank_permissions');

// The grid's own section: General also has the team basics' Save buttons (#1735).
const gridRegion = async () => within(await screen.findByRole('region', { name: 'Rank permissions' }));

describe('the Team Owner', () => {
  it('sees the stored ticks, with Team Owner fixed', async () => {
    renderApp(PATH, handlers('owner'));
    expect(await box('Raider: Edit own wishlist')).toBeChecked();
    expect(await box('Raider: Edit roster (add, archive, main swaps)')).not.toBeChecked();
    expect(await box('Officer: Edit roster (add, archive, main swaps)')).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /^Team Owner:/ })).not.toBeInTheDocument();
  });

  it('locks Raiders out of their wishlist and saves only that change', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, handlers('owner'));
    const save = await (await gridRegion()).findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.click(await box('Raider: Edit own wishlist'));
    expect(screen.getByText('1 change not saved.')).toBeInTheDocument();
    await user.click(save);
    expect(await screen.findByText('No changes.')).toBeInTheDocument();
    expect(sent(client)).toEqual([
      [
        'set_team_rank_permissions',
        { p_team_id: 1, p_changes: [{ rank: 'raider', permission: 'edit_own_wishlist', on: false }] }
      ]
    ]);
    expect(await box('Raider: Edit own wishlist')).not.toBeChecked();
  });

  it('Discard changes goes back to what is saved, and Reset to defaults waits for Save', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, handlers('owner'));
    const loot = 'Officer: Import loot, edit priority and scoring, review received-item and M+ requests';
    await user.click(await box(loot));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await box(loot)).toBeChecked();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
    expect(sent(client)).toEqual([]);
  });

  it('says so when the database refuses a save', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers('owner', 'Not authorized'));
    await user.click(await box('Raider: Edit own wishlist'));
    await user.click((await gridRegion()).getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText(/Could not save rank permissions: Not authorized/)).length).toBeGreaterThan(0);
  });
});

describe('an Officer', () => {
  it('reads the grid but cannot change it', async () => {
    renderApp(PATH, handlers('officer'));
    expect(await box('Raider: Edit own wishlist')).toBeDisabled();
    expect(screen.getByText(/Only the Team Owner can change these/)).toBeInTheDocument();
    expect((await gridRegion()).queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});
