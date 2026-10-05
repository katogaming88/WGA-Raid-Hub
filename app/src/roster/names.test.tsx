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
    names?: NameRow[];
    players?: (typeof TORBJORN)[];
    // The memberships an officer's roster reads, with whether each ended.
    members?: { id: number; person_id: number; archived_at: string | null }[];
    // The signed-in person's own membership on the team.
    teamMemberId?: number;
    write?: FakeHandlers['write'];
  } = {}
): FakeHandlers {
  const base = seededHandlers();
  const person = (role: string) => ({
    site_admin: false,
    guild_officer: false,
    boe_manager: false,
    teams: [{ team_id: 1, team_member_id: overrides.teamMemberId ?? 1, role, characters: [] }]
  });
  return seededHandlers({
    session: overrides.role === null ? undefined : fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') return { data: person(overrides.role ?? 'raider') };
      if (overrides.rpc) return overrides.rpc(name, args);
      return base.rpc!(name, args);
    },
    ...(overrides.write ? { write: overrides.write } : {}),
    from(read: Read) {
      if (read.table === 'names') return { data: overrides.names ?? NAMES };
      if (read.table === 'team_members' && overrides.members) return { data: overrides.members };
      if (read.table === 'players') return { data: overrides.players ?? [TORBJORN] };
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

  it('archives a member after picking a reason and detail, via archive_team_member', async () => {
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
    const submit = within(dialog).getByRole('button', { name: 'Archive Member' });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'moved_guilds');
    await user.type(within(dialog).getByLabelText('Detail'), 'Transferred realms');
    await user.click(submit);
    expect(await screen.findByText('Raz archived.')).toBeInTheDocument();
    expect(seen[0]).toEqual({
      p_team_id: 1,
      p_team_member_id: 9,
      p_reason: 'moved_guilds',
      p_detail: 'Transferred realms'
    });
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

// Kat's "No characters yet" row (#1355): a claimed Name whose membership is
// current and has no character on the roster.
describe('a claimed Name with no character yet', () => {
  const WREN: NameRow = { id: 4, label: 'Wren', team_member_id: 21, role: null };
  const LEFT_US: NameRow = { id: 5, label: 'Left Us', team_member_id: 23, role: null };
  const MEMBERS = [
    { id: 9, person_id: 109, archived_at: null },
    { id: 21, person_id: 121, archived_at: null },
    { id: 23, person_id: 123, archived_at: '2026-10-01T12:00:00Z' }
  ];
  const rowFor = async (label: string) => {
    const table = await screen.findByRole('table', { name: 'Current roster' });
    return (await within(table).findByRole('rowheader', { name: label })).closest('tr')!;
  };

  it('shows an officer the row, tagged, with its menu, and not one whose membership ended', async () => {
    renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({ role: 'officer', names: [...NAMES, WREN, LEFT_US], members: MEMBERS })
    );
    const row = await rowFor('Wren');
    expect(within(row).getByText('No characters yet')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'More actions for Wren' })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: 'Left Us' })).not.toBeInTheDocument();
  });

  it('shows the claimer their own row, with no menu', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'raider', teamMemberId: 21, names: [...NAMES, WREN] }));
    const row = await rowFor('Wren');
    expect(within(row).getByText('No characters yet')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'More actions for Wren' })).not.toBeInTheDocument();
  });

  it('shows another raider only their own such row', async () => {
    const mine: NameRow = { id: 6, label: 'Mine', team_member_id: 1, role: null };
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'raider', names: [...NAMES, WREN, mine] }));
    await rowFor('Mine');
    expect(screen.queryByRole('rowheader', { name: 'Wren' })).not.toBeInTheDocument();
  });

  it('shows a signed-out visitor none', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: null, names: [...NAMES, WREN] }));
    await rowFor('Bare Raider');
    expect(screen.queryByRole('rowheader', { name: 'Wren' })).not.toBeInTheDocument();
  });
});

// Kat's "..." menu is on each roster row (#1355), so an officer can archive a
// member whether or not they hold a Name.
describe('Archive Member on a row with no Name', () => {
  const BRANNOC = {
    ...TORBJORN,
    id: 2,
    name_realm: 'Brannoc-Illidan',
    team_member_id: 12,
    classes_specs: { class: 'Paladin', spec: 'Holy', role: 'Heal' }
  };

  it('gives an officer Archive Member alone, and archives that member', async () => {
    const user = userEvent.setup();
    const seen: Record<string, unknown>[] = [];
    renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        role: 'officer',
        players: [TORBJORN, BRANNOC],
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
    const row = within(table)
      .getByRole('rowheader', { name: /Brannoc/ })
      .closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Brannoc' }));
    const menu = await screen.findByRole('menu', { name: 'More actions for Brannoc' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent)
    ).toEqual(['Archive Member']);
    await user.click(within(menu).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Brannoc?' });
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'schedule_conflict');
    await user.type(within(dialog).getByLabelText('Detail'), 'New job');
    await user.click(within(dialog).getByRole('button', { name: 'Archive Member' }));
    await screen.findByText('Brannoc archived.');
    expect(seen).toEqual([{ p_team_id: 1, p_team_member_id: 12, p_reason: 'schedule_conflict', p_detail: 'New job' }]);
  });

  it('gives a raider no menu there', async () => {
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'raider', players: [TORBJORN, BRANNOC] }));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table)
      .getByRole('rowheader', { name: /Brannoc/ })
      .closest('tr')!;
    expect(within(row).queryByRole('button', { name: 'More actions for Brannoc' })).not.toBeInTheDocument();
  });
});
