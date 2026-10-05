import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
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

describe('Archive Member on a name-only row', () => {
  it('takes the row away once the membership has ended', async () => {
    const user = userEvent.setup();
    const wren: NameRow = { id: 4, label: 'Wren', team_member_id: 21, role: null };
    let archived = false;
    const handlers = namesHandlers({
      role: 'officer',
      names: [...NAMES, wren],
      rpc(name, args) {
        if (name === 'archive_team_member') {
          archived = true;
          return { data: null };
        }
        return seededHandlers().rpc!(name, args);
      }
    });
    const from = handlers.from!;
    handlers.from = (read) =>
      read.table === 'team_members'
        ? { data: [{ id: 21, person_id: 121, archived_at: archived ? '2026-10-05T20:00:00Z' : null }] }
        : from(read);
    renderApp('/g/wga/t/phoenix/roster', handlers);

    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = (await within(table).findByRole('rowheader', { name: 'Wren' })).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Wren' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Wren?' });
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'moved_guilds');
    await user.type(within(dialog).getByLabelText('Detail'), 'Moved to another guild');
    await user.click(within(dialog).getByRole('button', { name: 'Archive Member' }));

    await waitFor(() => expect(within(table).queryByRole('rowheader', { name: 'Wren' })).not.toBeInTheDocument());
  });
});

// Keyboard focus never lands on the page itself after a row action: it goes
// back to the row's "..." button, or to the roster table when the row the
// action came from is gone.
describe('focus after a row action', () => {
  const openMenu = async (user: ReturnType<typeof userEvent.setup>, rowName: RegExp | string, label: string) => {
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: rowName }).closest('tr')!;
    const trigger = within(row).getByRole('button', { name: `More actions for ${label}` });
    await user.click(trigger);
    return { trigger, menu: await screen.findByRole('menu', { name: `More actions for ${label}` }) };
  };

  it('returns to the "..." button after Edit then Cancel', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    const { trigger, menu } = await openMenu(user, /Raz/, 'Raz');
    await user.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Name' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(trigger).toHaveFocus();
  });

  it('returns to the "..." button after Archive Member then Escape', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    const { trigger, menu } = await openMenu(user, /Raz/, 'Raz');
    await user.click(within(menu).getByRole('menuitem', { name: 'Archive Member' }));
    await screen.findByRole('dialog', { name: 'Archive Raz?' });
    await user.keyboard('{Escape}');
    expect(trigger).toHaveFocus();
  });

  it('closes the menu on Tab and returns to the "..." button', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    const { trigger } = await openMenu(user, /Raz/, 'Raz');
    await user.tab();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('moves to the roster table when a Claim takes the row away', async () => {
    const user = userEvent.setup();
    let claimed = false;
    const handlers = namesHandlers({
      role: 'raider',
      rpc(name, args) {
        if (name === 'claim_name') {
          claimed = true;
          return { data: null };
        }
        return seededHandlers().rpc!(name, args);
      }
    });
    const from = handlers.from!;
    handlers.from = (read) =>
      read.table === 'names' && claimed
        ? { data: NAMES.map((n) => (n.id === 1 ? { ...n, team_member_id: 1 } : n)) }
        : from(read);
    renderApp('/g/wga/t/phoenix/roster', handlers);
    const { menu } = await openMenu(user, 'Bare Raider', 'Bare Raider');
    await user.click(within(menu).getByRole('menuitem', { name: 'Claim' }));
    const region = screen.getByRole('region', { name: 'Current roster' });
    await waitFor(() =>
      expect(within(region).queryByRole('button', { name: 'More actions for Bare Raider' })).not.toBeInTheDocument()
    );
    await waitFor(() => expect(region).toHaveFocus());
  });
});

// A row action says it worked even when the write takes its row away, and the
// Archive dialog closes itself when the row stays.
describe('messages after a row action', () => {
  const KAEL = {
    ...TORBJORN,
    id: 3,
    name_realm: 'Kaelthas-Illidan',
    team_member_id: 1,
    classes_specs: { class: 'Mage', spec: 'Fire', role: 'Ranged' }
  };

  // Answers a table from `after` once the returned function has been called.
  function changing(handlers: FakeHandlers, table: string, after: unknown[]) {
    let changed = false;
    const from = handlers.from!;
    handlers.from = (read) => (read.table === table && changed ? { data: after } : from(read));
    return () => {
      changed = true;
    };
  }

  it('says "Claimed" when the claim moves the Name onto the claimer\'s character row', async () => {
    const user = userEvent.setup();
    let done = () => {};
    const handlers = namesHandlers({
      role: 'raider',
      players: [TORBJORN, KAEL],
      rpc(name, args) {
        if (name === 'claim_name') {
          done();
          return { data: null };
        }
        return seededHandlers().rpc!(name, args);
      }
    });
    done = changing(
      handlers,
      'names',
      NAMES.map((n) => (n.id === 1 ? { ...n, team_member_id: 1 } : n))
    );
    renderApp('/g/wga/t/phoenix/roster', handlers);
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Bare Raider' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Claim' }));
    expect(await screen.findByText('Claimed Bare Raider.')).toBeInTheDocument();
  });

  it('says "archived" when the archive takes the row away', async () => {
    const user = userEvent.setup();
    let done = () => {};
    const handlers = namesHandlers({
      role: 'officer',
      rpc(name, args) {
        if (name === 'archive_team_member') {
          done();
          return { data: null };
        }
        return seededHandlers().rpc!(name, args);
      }
    });
    done = changing(handlers, 'players', []);
    renderApp('/g/wga/t/phoenix/roster', handlers);
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Raz' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Raz?' });
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'drama');
    await user.type(within(dialog).getByLabelText('Detail'), 'Left after a falling out');
    await user.click(within(dialog).getByRole('button', { name: 'Archive Member' }));
    expect(await screen.findByText('Raz archived.')).toBeInTheDocument();
  });

  it('says "removed" when Delete Name takes the row away', async () => {
    const user = userEvent.setup();
    let done = () => {};
    const handlers = namesHandlers({
      role: 'officer',
      write: (w) => {
        if (w.method === 'delete') done();
        return { data: null };
      }
    });
    done = changing(
      handlers,
      'names',
      NAMES.filter((n) => n.id !== 1)
    );
    renderApp('/g/wga/t/phoenix/roster', handlers);
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Bare Raider' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Delete Name' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Bare Raider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete Name' }));
    expect(await screen.findByText('Bare Raider removed.')).toBeInTheDocument();
  });

  it('closes the Archive dialog when the row is still there afterwards', async () => {
    const user = userEvent.setup();
    renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        role: 'officer',
        rpc: (name, args) => (name === 'archive_team_member' ? { data: null } : seededHandlers().rpc!(name, args))
      })
    );
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Raz' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Raz?' });
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'other');
    await user.type(within(dialog).getByLabelText('Detail'), 'Stepping back');
    await user.click(within(dialog).getByRole('button', { name: 'Archive Member' }));
    await screen.findByText('Raz archived.');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Archive Raz?' })).not.toBeInTheDocument());
  });
});

// A label already on the team, possibly held by someone who left, reads as a
// sentence rather than the database's own words.
describe('a duplicate label', () => {
  const DUPLICATE = {
    error: { message: 'duplicate key value violates unique constraint "names_team_id_label_key"', code: '23505' }
  };
  const SENTENCE =
    'That did not save: A Name on this team already has that label. It may belong to someone who has left.';

  it('reads as a sentence on Add a Name', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer', write: () => DUPLICATE }));
    await screen.findByRole('table', { name: 'Current roster' });
    await user.type(screen.getByLabelText('Add a Name'), 'Raz');
    await user.click(screen.getByRole('button', { name: 'Add Name' }));
    expect(await screen.findByText(SENTENCE)).toHaveAttribute('role', 'alert');
  });

  it('reads as a sentence on Edit', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer', write: () => DUPLICATE }));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Bare Raider' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Name' });
    const input = within(dialog).getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Raz');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(SENTENCE);
  });
});

// What each officer write sends: the table write and its audit row.
describe('the officer writes and their audit rows', () => {
  const audits = (client: ReturnType<typeof renderApp>['client']) =>
    client.rpcs.filter(([name]) => name === 'write_audit_log').map(([, args]) => args);
  const openRowMenu = async (user: ReturnType<typeof userEvent.setup>, rowName: RegExp | string, label: string) => {
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: rowName }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: `More actions for ${label}` }));
    return screen.findByRole('menu', { name: `More actions for ${label}` });
  };

  it('Add a Name inserts the label and role and logs Name Created', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    await screen.findByRole('table', { name: 'Current roster' });
    await user.type(screen.getByLabelText('Add a Name'), 'Thalindra');
    await user.selectOptions(screen.getByLabelText('Role'), 'Heal');
    await user.click(screen.getByRole('button', { name: 'Add Name' }));
    await screen.findByText('Thalindra added.');
    expect(client.writes).toEqual([
      { table: 'names', method: 'insert', values: { team_id: 1, label: 'Thalindra', role: 'Heal' }, filters: [] }
    ]);
    expect(audits(client)).toEqual([{ p_team_id: 1, p_action: 'Name Created', p_detail: 'Thalindra (Heal)' }]);
  });

  it('Edit updates the label and logs Name Renamed', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    await user.click(
      within(await openRowMenu(user, 'Bare Raider', 'Bare Raider')).getByRole('menuitem', { name: 'Edit' })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit Name' });
    const input = within(dialog).getByLabelText('Name');
    await user.clear(input);
    await user.type(input, 'Bryn');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText('Name updated.');
    expect(client.writes).toEqual([
      { table: 'names', method: 'update', values: { label: 'Bryn', role: null }, filters: [['eq', 'id', 1]] }
    ]);
    expect(audits(client)).toEqual([
      { p_team_id: 1, p_action: 'Name Renamed', p_target_type: 'names', p_target_id: 1, p_detail: 'Bryn' }
    ]);
  });

  it('Remove claim clears the claim and logs which member held it', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    await user.click(within(await openRowMenu(user, /Raz/, 'Raz')).getByRole('menuitem', { name: 'Remove claim' }));
    await screen.findByText('Raz is unclaimed again.');
    expect(client.writes).toEqual([
      {
        table: 'names',
        method: 'update',
        values: { team_member_id: null },
        filters: [
          ['eq', 'id', 2],
          ['eq', 'team_member_id', 9]
        ]
      }
    ]);
    expect(audits(client)).toEqual([
      {
        p_team_id: 1,
        p_action: 'Name Claim Removed',
        p_target_type: 'names',
        p_target_id: 2,
        p_detail: { label: 'Raz', team_member_id: 9 }
      }
    ]);
  });

  it('Delete Name deletes the bare Name and logs Name Deleted', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    await user.click(
      within(await openRowMenu(user, 'Bare Raider', 'Bare Raider')).getByRole('menuitem', { name: 'Delete Name' })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete Bare Raider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete Name' }));
    await screen.findByText('Bare Raider removed.');
    expect(client.writes).toEqual([
      {
        table: 'names',
        method: 'delete',
        values: undefined,
        filters: [
          ['eq', 'id', 1],
          ['is', 'team_member_id', null]
        ]
      }
    ]);
    expect(audits(client)).toEqual([
      { p_team_id: 1, p_action: 'Name Deleted', p_target_type: 'names', p_target_id: 1, p_detail: null }
    ]);
  });
});

// Coming back is an officer's call (decided on #1355, 2026-10-02): any officer
// action brings an archived member back, and nothing they do themselves does.
describe('the Archive dialog', () => {
  it('says an officer can bring them back', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer' }));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Raz' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Raz?' });
    expect(dialog).toHaveTextContent('an officer can bring them back');
    expect(dialog).not.toHaveTextContent('rejoin');
  });
});

describe('the Archive dialog for a member with no Name', () => {
  it('does not speak of a Name', async () => {
    const user = userEvent.setup();
    const brannoc = {
      ...TORBJORN,
      id: 2,
      name_realm: 'Brannoc-Illidan',
      team_member_id: 12,
      classes_specs: { class: 'Paladin', spec: 'Holy', role: 'Heal' }
    };
    renderApp('/g/wga/t/phoenix/roster', namesHandlers({ role: 'officer', players: [TORBJORN, brannoc] }));
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table)
      .getByRole('rowheader', { name: /Brannoc/ })
      .closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Brannoc' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Brannoc?' });
    expect(dialog).toHaveTextContent('their loot and attendance are not deleted');
    expect(dialog).not.toHaveTextContent('this Name');
  });
});

// A write reads again everything it can have changed on this page.
describe('what a write reads again', () => {
  const readsOf = (client: ReturnType<typeof renderApp>['client'], table: string) =>
    client.reads.filter((r) => r.table === table).length;

  it('Archive Member reads the waiting main swaps again, since archiving cancels them', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        role: 'officer',
        rpc: (name, args) => (name === 'archive_team_member' ? { data: null } : seededHandlers().rpc!(name, args))
      })
    );
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Raz' }));
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Archive Member' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Raz?' });
    await user.selectOptions(within(dialog).getByLabelText('Reason'), 'other');
    await user.type(within(dialog).getByLabelText('Detail'), 'Stepping back');
    const before = readsOf(client, 'main_swap_requests');
    await user.click(within(dialog).getByRole('button', { name: 'Archive Member' }));
    await screen.findByText('Raz archived.');
    await waitFor(() => expect(readsOf(client, 'main_swap_requests')).toBeGreaterThan(before));
  });

  it('a Claim reads the memberships again, since it can create one', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({
        role: 'officer',
        rpc: (name, args) => (name === 'claim_name' ? { data: null } : seededHandlers().rpc!(name, args))
      })
    );
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: 'Bare Raider' }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'More actions for Bare Raider' }));
    const menu = await screen.findByRole('menu');
    await waitFor(() => expect(readsOf(client, 'team_members')).toBeGreaterThan(0));
    const before = readsOf(client, 'team_members');
    await user.click(within(menu).getByRole('menuitem', { name: 'Claim' }));
    await screen.findByText('Claimed Bare Raider.');
    await waitFor(() => expect(readsOf(client, 'team_members')).toBeGreaterThan(before));
  });
});

// Delete Name and Remove claim act only on the Name as the officer saw it.
describe('a Name that changed since the page read it', () => {
  const CHANGED =
    'That did not save: That Name has changed since the page loaded. Reload the page to see it as it is now.';
  const openRowMenu = async (user: ReturnType<typeof userEvent.setup>, rowName: RegExp | string, label: string) => {
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const row = within(table).getByRole('rowheader', { name: rowName }).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: `More actions for ${label}` }));
    return screen.findByRole('menu', { name: `More actions for ${label}` });
  };
  const audits = (client: ReturnType<typeof renderApp>['client']) =>
    client.rpcs.filter(([name]) => name === 'write_audit_log');

  it('is not deleted once someone has claimed it, and says why', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({ role: 'officer', write: () => ({ data: [] }) })
    );
    await user.click(
      within(await openRowMenu(user, 'Bare Raider', 'Bare Raider')).getByRole('menuitem', { name: 'Delete Name' })
    );
    const dialog = await screen.findByRole('dialog', { name: 'Delete Bare Raider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete Name' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(CHANGED);
    expect(audits(client)).toEqual([]);
  });

  it('keeps a claim someone else now holds, and says why', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({ role: 'officer', write: () => ({ data: [] }) })
    );
    await user.click(within(await openRowMenu(user, /Raz/, 'Raz')).getByRole('menuitem', { name: 'Remove claim' }));
    expect(await screen.findByText(CHANGED)).toHaveAttribute('role', 'alert');
    expect(audits(client)).toEqual([]);
  });

  it('shows no earlier failure when Delete Name is opened again', async () => {
    const user = userEvent.setup();
    renderApp(
      '/g/wga/t/phoenix/roster',
      namesHandlers({ role: 'officer', write: () => ({ error: { message: 'Not allowed', code: '42501' } }) })
    );
    await user.click(
      within(await openRowMenu(user, 'Bare Raider', 'Bare Raider')).getByRole('menuitem', { name: 'Delete Name' })
    );
    let dialog = await screen.findByRole('dialog', { name: 'Delete Bare Raider?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete Name' }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(
      within(await openRowMenu(user, 'Bare Raider', 'Bare Raider')).getByRole('menuitem', { name: 'Delete Name' })
    );
    dialog = await screen.findByRole('dialog', { name: 'Delete Bare Raider?' });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });
});
