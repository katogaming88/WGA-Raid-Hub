import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import { toNames, type NameRow } from './names';

describe('toNames', () => {
  it('sorts by label and derives bare/claimed from team_member_id', () => {
    const rows: NameRow[] = [
      { id: 1, label: 'Zeta', team_member_id: null, role: null },
      { id: 2, label: 'Anders', team_member_id: 5, role: null }
    ];
    expect(toNames(rows)).toEqual([
      { id: 2, label: 'Anders', team_member_id: 5, role: null, status: 'claimed' },
      { id: 1, label: 'Zeta', team_member_id: null, role: null, status: 'bare' }
    ]);
  });
});

// The Roster page's Names (#1355): a claimed Name overrides its character
// row's display name; a bare one is a plain row with no role group of its
// own, only shown under the unfiltered Everyone view. No separate Names
// section -- a roster row starts with the Name.

const TORBJORN = {
  id: 1,
  name_realm: 'Torbjorn-Illidan',
  nickname: null,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  team_member_id: 9,
  classes_specs: { class: 'Death Knight', spec: 'Frost', role: 'Melee' }
};

const NAMES: NameRow[] = [
  { id: 1, label: 'Bare Raider', team_member_id: null, role: null },
  { id: 2, label: 'Raz', team_member_id: 9, role: null },
  { id: 3, label: 'Needs A Tank', team_member_id: null, role: 'Tank' }
];

function namesHandlers(
  overrides: {
    rpc?: FakeHandlers['rpc'];
    role?: 'officer' | 'raider' | null;
  } = {}
): FakeHandlers {
  const base = seededHandlers();
  const person = (role: string) => ({
    site_admin: false,
    guild_officer: false,
    boe_manager: false,
    teams: [{ team_id: 1, team_member_id: 1, role, characters: [] }]
  });
  return seededHandlers({
    session: overrides.role === null ? undefined : fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') return { data: person(overrides.role ?? 'raider') };
      if (overrides.rpc) return overrides.rpc(name, args);
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table === 'names') return { data: NAMES };
      if (read.table === 'players') return { data: [TORBJORN] };
      return base.from!(read);
    }
  });
}

describe('Names on the Roster page', () => {
  it('shows the claimed Name as the row, not the character name', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers());
    const table = await screen.findByRole('table', { name: 'Current roster' });
    expect(within(table).getByRole('rowheader', { name: /Raz/ })).toBeInTheDocument();
    expect(within(table).getByText('Torbjorn')).toBeInTheDocument();
  });

  it('offers Claim on a bare Name to a signed-in raider, and calls claim_name', async () => {
    const user = userEvent.setup();
    const seen: Record<string, unknown>[] = [];
    const { client } = renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        rpc(name, args) {
          if (name === 'claim_name') {
            seen.push(args);
            return { data: null };
          }
          return seededHandlers().rpc!(name, args);
        }
      })
    );
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const bareRow = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    await user.click(within(bareRow).getByRole('button', { name: 'More actions for Bare Raider' }));
    const menu = await screen.findByRole('menu', { name: 'More actions for Bare Raider' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Claim' }));
    expect(await screen.findByText('Claimed Bare Raider.')).toBeInTheDocument();
    expect(seen[0]).toEqual({ p_team_id: 1, p_name_id: 1 });
    expect(client.rpcs.some(([n]) => n === 'claim_name')).toBe(true);
  });

  it('hides a bare Name once a specific role tab is picked, since it has none', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers());
    const table = await screen.findByRole('table', { name: 'Current roster' });
    expect(within(table).getByText('Bare Raider')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Melee' }));
    expect(within(table).queryByText('Bare Raider')).not.toBeInTheDocument();
    expect(within(table).getByText('Raz')).toBeInTheDocument();
  });

  it('a bare Name with a role guess sits in that role group, on that tab', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers());
    const table = await screen.findByRole('table', { name: 'Current roster' });
    expect(within(table).getByRole('rowheader', { name: 'Needs A Tank' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tanks' }));
    expect(within(table).getByRole('rowheader', { name: 'Needs A Tank' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Melee' }));
    expect(within(table).queryByRole('rowheader', { name: 'Needs A Tank' })).not.toBeInTheDocument();
  });

  it('shows no "..." menu at all for a signed-out visitor on a bare row', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: null }));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const bareRow = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    expect(within(bareRow).queryByRole('button', { name: 'More actions for Bare Raider' })).not.toBeInTheDocument();
  });

  it('shows officer-only actions on both a claimed row and a bare one, in the "..." menu', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const claimedRow = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    await user.click(within(claimedRow).getByRole('button', { name: 'More actions for Raz' }));
    const claimedMenu = await screen.findByRole('menu', { name: 'More actions for Raz' });
    expect(within(claimedMenu).getByRole('menuitem', { name: 'Remove claim' })).toBeInTheDocument();
    expect(within(claimedMenu).getByRole('menuitem', { name: 'Archive Member' })).toBeInTheDocument();

    const bareRow = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    await user.click(within(bareRow).getByRole('button', { name: 'More actions for Bare Raider' }));
    const bareMenu = await screen.findByRole('menu', { name: 'More actions for Bare Raider' });
    expect(within(bareMenu).getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument();
    expect(within(bareMenu).getByRole('menuitem', { name: 'Delete Name' })).toBeInTheDocument();
  });

  it('archives a member after confirming, via archive_team_member', async () => {
    const user = userEvent.setup();
    const seen: Record<string, unknown>[] = [];
    renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        role: 'officer',
        rpc(name, args) {
          if (name === 'archive_team_member') {
            seen.push(args);
            return { data: null };
          }
          return seededHandlers().rpc!(name, args);
        }
      })
    );
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const claimedRow = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    await user.click(within(claimedRow).getByRole('button', { name: 'More actions for Raz' }));
    const menu = await screen.findByRole('menu', { name: 'More actions for Raz' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Raz?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive Member' }));
    expect(await screen.findByText('Raz archived.')).toBeInTheDocument();
    expect(seen[0]).toEqual({ p_team_id: 1, p_team_member_id: 9 });
  });

  it('an officer sees the Add a Name form, with a role picker', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    await screen.findByRole('table', { name: 'Current roster' });
    expect(screen.getByLabelText('Add a Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Role')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Name' })).toBeInTheDocument();
  });

  it('a raider does not see the Add a Name form', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'raider' }));
    await screen.findByRole('table', { name: 'Current roster' });
    expect(screen.queryByLabelText('Add a Name')).not.toBeInTheDocument();
  });

  it('a raider sees no "..." menu on an already-claimed row, but gets Claim-only on a bare one', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'raider' }));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const claimedRow = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    expect(within(claimedRow).queryByRole('button', { name: 'More actions for Raz' })).not.toBeInTheDocument();

    const bareRow = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    await user.click(within(bareRow).getByRole('button', { name: 'More actions for Bare Raider' }));
    const menu = await screen.findByRole('menu', { name: 'More actions for Bare Raider' });
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1);
    expect(within(menu).getByRole('menuitem', { name: 'Claim' })).toBeInTheDocument();
  });
});
