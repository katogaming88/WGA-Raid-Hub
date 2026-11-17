import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';
import type { NameRow } from '../roster/names';
import type { PlayerRow } from '../roster/roster';
import { unclaimedRows } from './RosterReports';

// The two roster reports (#1344): who nobody has claimed, and how far each
// raider's wishlist is.

const player = (id: number, nameRealm: string, klass: string, spec: string, role: string, member: number | null) =>
  ({
    id,
    name_realm: nameRealm,
    nickname: null,
    is_trial: false,
    is_bench: false,
    tier_pieces_equipped: null,
    join_date: '2026-08-01',
    team_member_id: member,
    classes_specs: { class: klass, spec, role }
  }) satisfies PlayerRow;

const PLAYERS = [
  player(1, 'Torbjorn-Illidan', 'Death Knight', 'Frost', 'Melee', 11),
  player(2, 'Zuggz-Illidan', 'Warrior', 'Arms', 'Melee', null),
  player(3, 'Fluphie-Illidan', 'Warrior', 'Protection', 'Tank', null)
];

const name = (id: number, label: string, member: number | null, role: string | null = null) =>
  ({ id, label, team_member_id: member, role }) as NameRow;

describe('unclaimedRows', () => {
  it('lists characters with no Member and Names nobody has claimed, by name', () => {
    const rows = unclaimedRows(PLAYERS, [
      name(1, 'Bravo', null),
      name(2, 'Alpha', null, 'Healer'),
      name(3, 'Claimed', 11)
    ]);
    expect(rows.map((r) => [r.name, r.kind])).toEqual([
      ['Alpha', 'Member'],
      ['Bravo', 'Member'],
      ['Fluphie', 'Character'],
      ['Zuggz', 'Character']
    ]);
  });

  it('is empty when everyone is claimed', () => {
    expect(unclaimedRows([PLAYERS[0]!], [])).toEqual([]);
  });
});

// The pages, for an officer.
function handlers(tables: Record<string, unknown>) {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person')
        return {
          data: {
            site_admin: false,
            guild_officer: false,
            boe_manager: false,
            teams: [{ team_id: 1, team_member_id: 1, role: 'officer', characters: [] }]
          }
        };
      if (name === 'team_season_start') return { data: '2026-08-01' };
      if (name === 'earlier_characters') return { data: [] };
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table in tables) return { data: tables[read.table] };
      return base.from!(read);
    }
  });
}

const SEASONS = [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-07-18', ends_at: '2026-12-31' }];

const rowNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader')
    .map((th) => th.querySelector('.raider-name')!.textContent);

describe('Unclaimed page', () => {
  it('lists the spots nobody has claimed, with how many of the roster they are', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/reports/unclaimed',
      handlers({ players: PLAYERS, seasons: SEASONS, names: [name(1, 'Bravo', null)] })
    );
    const table = await screen.findByRole('table', { name: 'Unclaimed roster spots' });
    expect(rowNames(table)).toEqual(['Bravo', 'Fluphie', 'Zuggz']);
    expect(screen.getByText(/of 3 characters on the roster/)).toHaveTextContent('3 unclaimed, of 3 characters');
    const count = screen.getByText(/of 3 characters on the roster/);
    expect(within(count).getByRole('link', { name: 'Roster' })).toHaveAttribute('href', '/g/wga/t/phoenix/roster');
  });

  it('says so when everyone is claimed', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/reports/unclaimed',
      handlers({ players: [PLAYERS[0]], seasons: SEASONS, names: [] })
    );
    expect(await screen.findByText('Everyone on the roster is claimed.')).toBeInTheDocument();
  });
});

describe('Wishlist completeness page', () => {
  // A raid item in the season, and a Pass in its slot for the second raider.
  const items = [
    { id: 1, name: 'Plate Helm', slot: 'Head', wcl_zone_id: 53, is_placeholder: false, armor_type: 'Plate' }
  ];
  const tables = {
    players: PLAYERS,
    seasons: SEASONS,
    names: [],
    items,
    raid_zones: [{ wcl_zone_id: 53, season: 'MID2' }],
    item_preferences: [
      { id: 1, player_id: 1, item_id: 1, status: 'bis', slot: null, season: 'MID2', synced_bis: false },
      { id: 2, player_id: 2, item_id: 1, status: 'pass', slot: null, season: 'MID2', synced_bis: false }
    ]
  };

  it('shows who has not started and who is part way, least done first, and asks for this season only', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/officer/reports/wishlist-completeness', handlers(tables));
    const table = await screen.findByRole('table', { name: 'Wishlist completeness' });
    expect(rowNames(table)).toEqual(['Fluphie', 'Torbjorn', 'Zuggz']);
    expect(
      within(table)
        .getByRole('rowheader', { name: /Fluphie/ })
        .closest('tr')
    ).toHaveTextContent('Not started');
    expect(
      within(table)
        .getByRole('rowheader', { name: /Torbjorn/ })
        .closest('tr')
    ).toHaveTextContent('Partly done: 1 of 16 slots');
    // A Pass is a slot done.
    expect(within(table).getByRole('rowheader', { name: /Zuggz/ }).closest('tr')).toHaveTextContent(
      'Partly done: 1 of 16 slots'
    );
    expect(screen.getByText(/Midnight Season 2:/)).toHaveTextContent(
      'Midnight Season 2: 1 not started, 2 partly done, 0 done.'
    );
    const read = client.reads.find((r) => r.table === 'item_preferences')!;
    expect(read.filters).toContainEqual(['eq', 'season', 'MID2']);
  });

  it('narrows to one role', async () => {
    renderApp('/g/wga/t/phoenix/officer/reports/wishlist-completeness', handlers(tables));
    const table = await screen.findByRole('table', { name: 'Wishlist completeness' });
    await userEvent.click(screen.getByRole('button', { name: 'Tanks' }));
    expect(rowNames(table)).toEqual(['Fluphie']);
  });
});
