import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';

// Player settings (#1360): a gear on each roster row opens a panel where every
// change saves as it is made, with Undo; the arrows step through the roster;
// the Profile opens the same panel.

const ROSTER = [
  {
    id: 1,
    name_realm: 'Torbjorn-Illidan',
    url_code: 'tor1',
    nickname: null,
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    join_date: '2026-08-12',
    team_member_id: 9,
    classes_specs: { class: 'Death Knight', spec: 'Frost', role: 'Melee' }
  },
  {
    id: 2,
    name_realm: 'Wren-Illidan',
    url_code: 'wren2',
    nickname: null,
    is_trial: true,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    join_date: null,
    team_member_id: 10,
    classes_specs: { class: 'Priest', spec: 'Holy', role: 'Heal' }
  }
];

const SETTINGS: Record<number, Record<string, unknown>> = {
  1: {
    id: 1,
    name_realm: 'Torbjorn-Illidan',
    class_spec_id: 11,
    join_date: '2026-08-12',
    is_trial: false,
    is_bench: false,
    is_backup_tank: false,
    is_backup_healer: false,
    m_plus_excluded: false
  },
  2: {
    id: 2,
    name_realm: 'Wren-Illidan',
    class_spec_id: 21,
    join_date: null,
    is_trial: true,
    is_bench: false,
    is_backup_tank: false,
    is_backup_healer: false,
    m_plus_excluded: false
  }
};

const SPECS = [
  { id: 11, class: 'Death Knight', spec: 'Frost', role: 'Melee' },
  { id: 12, class: 'Death Knight', spec: 'Blood', role: 'Tank' },
  { id: 21, class: 'Priest', spec: 'Holy', role: 'Heal' }
];

function handlers(role: 'officer' | 'raider', overrides: { write?: FakeHandlers['write'] } = {}): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') {
        return {
          data: {
            site_admin: false,
            guild_officer: false,
            boe_manager: false,
            teams: [{ team_id: 1, team_member_id: 1, role, characters: [] }]
          }
        };
      }
      return base.rpc!(name, args);
    },
    ...(overrides.write ? { write: overrides.write } : {}),
    from(read: Read) {
      if (read.table === 'players' && read.single) {
        const id = read.filters.find(([, c]) => c === 'id')?.[2] as number | undefined;
        if (read.columns?.includes('class_spec_id')) return { data: id ? (SETTINGS[id] ?? null) : null };
        const code = read.filters.find(([, c]) => c === 'url_code')?.[2];
        const p = ROSTER.find((r) => r.url_code === code);
        return {
          data: p
            ? {
                ...p,
                is_backup_tank: false,
                is_backup_healer: false,
                wishlist_allowed: true,
                m_plus_excluded: false,
                m_plus_note: null
              }
            : null
        };
      }
      if (read.table === 'players') return { data: ROSTER };
      if (read.table === 'player_officer_notes') return { data: { officer_notes: 'Swaps to Blood on farm.' } };
      if (read.table === 'classes_specs') return { data: SPECS };
      return base.from!(read);
    }
  });
}

const audits = (client: ReturnType<typeof renderApp>['client']) =>
  client.rpcs.filter(([name]) => name === 'write_audit_log').map(([, args]) => args);

async function openFor(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: `Player settings for ${name}` }));
  return screen.findByRole('complementary', { name });
}

describe('Player settings on the Roster', () => {
  it('gives officers a gear on each row, and raiders none', async () => {
    renderApp('/g/wga/t/phoenix/roster', handlers('raider'));
    await screen.findByRole('table', { name: 'Current roster' });
    expect(screen.queryByRole('button', { name: /^Player settings for/ })).not.toBeInTheDocument();
  });

  it('opens the panel with the saved values', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', handlers('officer'));
    const panel = await openFor(user, 'Torbjorn');
    expect(await within(panel).findByRole('switch', { name: 'Trial' })).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => expect(within(panel).getByLabelText('Spec')).toHaveValue('11'));
    expect(within(panel).getByLabelText('Joined the team')).toHaveValue('2026-08-12');
    expect(within(panel).getByLabelText(/Officer note/)).toHaveValue('Swaps to Blood on farm.');
  });

  it('saves a switch at once, logs it, and Undo puts it back', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/roster', handlers('officer'));
    const panel = await openFor(user, 'Torbjorn');
    await user.click(await within(panel).findByRole('switch', { name: 'Bench' }));
    await screen.findByText('Bench turned on for Torbjorn.');
    expect(client.writes).toEqual([
      {
        table: 'players',
        method: 'update',
        values: { is_bench: true },
        filters: [
          ['eq', 'id', 1],
          ['eq', 'team_id', 1]
        ]
      }
    ]);
    expect(audits(client)).toEqual([
      {
        p_team_id: 1,
        p_action: 'Bench Status Changed',
        p_target_type: 'players',
        p_target_id: 1,
        p_detail: 'Moved to bench'
      }
    ]);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(client.writes).toHaveLength(2));
    expect(client.writes[1]!.values).toEqual({ is_bench: false });
  });

  it('saves a spec from the one list, which sets the class with it', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/roster', handlers('officer'));
    const panel = await openFor(user, 'Torbjorn');
    const spec = within(panel).getByLabelText('Spec');
    await waitFor(() => expect(spec).toHaveValue('11'));
    await user.selectOptions(spec, '12');
    await screen.findByText('Torbjorn is now Blood Death Knight.');
    expect(client.writes[0]!.values).toEqual({ class_spec_id: 12 });
    expect(audits(client)[0]).toMatchObject({ p_action: 'Spec Changed', p_detail: 'Changed to Blood Death Knight' });
  });

  it('saves the note when the field is left, not on every key', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/g/wga/t/phoenix/roster', handlers('officer'));
    const panel = await openFor(user, 'Torbjorn');
    const note = within(panel).getByLabelText(/Officer note/);
    await waitFor(() => expect(note).toHaveValue('Swaps to Blood on farm.'));
    await user.clear(note);
    await user.type(note, 'Main tank backup');
    expect(client.writes).toEqual([]);
    await user.tab();
    await screen.findByText('Officer note saved for Torbjorn.');
    expect(client.writes).toEqual([
      {
        table: 'player_officer_notes',
        method: 'upsert',
        values: { player_id: 1, team_id: 1, officer_notes: 'Main tank backup' },
        filters: []
      }
    ]);
  });

  it('steps through the roster with the arrows, in the order it shows, and Escape closes', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', handlers('officer'));
    // Healers list before melee, so Wren comes before Torbjorn.
    const panel = await openFor(user, 'Torbjorn');
    expect(within(panel).getByRole('button', { name: /^Next player/ })).toBeDisabled();
    await user.click(within(panel).getByRole('button', { name: 'Previous player, Wren' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Wren' })).toBeInTheDocument();
    expect(await screen.findByRole('switch', { name: 'Trial' })).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Wren' })).not.toBeInTheDocument());
  });

  it('shows the error and leaves the switch as it was when a save fails', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', handlers('officer', { write: () => ({ error: { message: 'denied' } }) }));
    const panel = await openFor(user, 'Torbjorn');
    const bench = await within(panel).findByRole('switch', { name: 'Bench' });
    await user.click(bench);
    expect(await within(panel).findByText('That did not save: denied')).toBeInTheDocument();
    expect(bench).toHaveAttribute('aria-checked', 'false');
  });
});

describe('Player settings on the Profile', () => {
  it('gives an officer a Player settings button that opens the same panel, and closes it again', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/p/tor1', handlers('officer'));
    const button = await screen.findByRole('button', { name: 'Player settings' });
    await user.click(button);
    expect(await screen.findByRole('complementary', { name: 'Torbjorn' })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await user.click(button);
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Torbjorn' })).not.toBeInTheDocument());
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the roster gear', () => {
  it('closes the panel when pressed again for the same player', async () => {
    const user = userEvent.setup();
    renderApp('/g/wga/t/phoenix/roster', handlers('officer'));
    await openFor(user, 'Torbjorn');
    await user.click(screen.getByRole('button', { name: 'Player settings for Torbjorn' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Torbjorn' })).not.toBeInTheDocument());
  });
});
