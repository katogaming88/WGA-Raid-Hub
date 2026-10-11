import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';
import { toRoster, type PlayerRow } from '../roster/roster';
import { benchFairness, lootFairness } from './fairness';

const player = (id: number, nameRealm: string, klass: string, spec: string, role: string) =>
  ({
    id,
    name_realm: nameRealm,
    nickname: null,
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    join_date: '2026-08-01',
    classes_specs: { class: klass, spec, role }
  }) satisfies PlayerRow;

const PLAYERS = [
  player(1, 'Torbjorn-Illidan', 'Death Knight', 'Frost', 'Melee'),
  player(2, 'Zuggz-Illidan', 'Warrior', 'Arms', 'Melee'),
  player(3, 'Fluphie-Illidan', 'Warrior', 'Protection', 'Tank')
];

const SEASON = { name: 'Midnight Season 2', code: 'MID2', start: '2026-08-01', end: null };

const award = (id: number, playerId: number, track: string, season = 'MID2') => ({
  id,
  player_id: playerId,
  track,
  season,
  awarded_at: '2026-08-20T18:00:00Z',
  items: { name: 'X' }
});

const night = (playerId: number, raidDate: string, status: string, excluded = false) => ({
  player_id: playerId,
  raid_date: raidDate,
  status,
  report_excluded: excluded
});

describe('lootFairness', () => {
  const loot = [
    award(1, 1, 'Hero'),
    award(2, 1, 'Myth'),
    award(3, 2, 'Hero'),
    award(4, 1, 'Hero', 'MID1'),
    // An earlier character's award counts for the row it belongs to now.
    award(5, 99, 'Myth')
  ];

  it('counts this season’s items by role, most first, against the average', () => {
    const report = lootFairness(toRoster(PLAYERS, []), loot, SEASON, null, new Map([[99, 2]]));
    expect(report.groups.map((g) => [g.label, g.rows.map((r) => [r.name, r.value])])).toEqual([
      ['Tanks', [['Fluphie', 0]]],
      [
        'Melee',
        [
          ['Torbjorn', 2],
          ['Zuggz', 2]
        ]
      ]
    ]);
    expect(report.average).toBeCloseTo(4 / 3);
    expect(report.max).toBe(2);
  });

  it('counts one difficulty when one is picked', () => {
    const report = lootFairness(toRoster(PLAYERS, []), loot, SEASON, 'Mythic', new Map([[99, 2]]));
    const melee = report.groups.find((g) => g.label === 'Melee')!;
    expect(melee.rows.map((r) => [r.name, r.value])).toEqual([
      ['Torbjorn', 1],
      ['Zuggz', 1]
    ]);
  });
});

describe('benchFairness', () => {
  it('counts nights benched this season and the share of nights they had a status on', () => {
    const report = benchFairness(
      toRoster(PLAYERS, []),
      [
        night(1, '2026-08-05', 'Bench'),
        night(1, '2026-08-07', 'Present'),
        night(1, '2026-08-12', 'Bench'),
        night(1, '2026-08-14', 'Present'),
        // Not counted: before the season, an excluded report, Not on Roster.
        night(1, '2026-07-20', 'Bench'),
        night(1, '2026-08-19', 'Bench', true),
        night(1, '2026-08-21', 'Not on Roster'),
        night(2, '2026-08-05', 'Present')
      ],
      SEASON
    );
    const melee = report.groups.find((g) => g.label === 'Melee')!;
    expect(melee.rows.map((r) => [r.name, r.value, r.note])).toEqual([
      ['Torbjorn', 2, '50%'],
      ['Zuggz', 0, '0%']
    ]);
    expect(report.groups.find((g) => g.label === 'Tanks')!.rows[0]!.note).toBeUndefined();
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

const TABLES = {
  players: PLAYERS,
  seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-07-18', ends_at: '2026-12-31' }],
  rclc_loot: [award(1, 1, 'Hero'), award(2, 1, 'Myth'), award(3, 2, 'Hero')],
  attendance: [night(1, '2026-08-05', 'Bench'), night(1, '2026-08-07', 'Present'), night(2, '2026-08-05', 'Present')],
  names: []
};

describe('Loot fairness page', () => {
  it('shows each raider’s items by role, and narrows to one difficulty', async () => {
    renderApp('/g/wga/t/phoenix/officer/reports/loot-fairness', handlers(TABLES));
    const melee = await screen.findByRole('region', { name: 'Melee' });
    expect(within(melee).getByText('Torbjorn').closest('li')).toHaveTextContent('Items received: 2');
    expect(screen.getByText(/average 1 items/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mythic' }));
    expect(within(melee).getByText('Zuggz').closest('li')).toHaveTextContent('Items received: 0');
  });
});

describe('Bench fairness page', () => {
  it('shows nights benched with the bench rate', async () => {
    renderApp('/g/wga/t/phoenix/officer/reports/bench-fairness', handlers(TABLES));
    const melee = await screen.findByRole('region', { name: 'Melee' });
    expect(within(melee).getByText('Torbjorn').closest('li')).toHaveTextContent('Nights benched: 1 (50%)');
  });
});

// The sortable tables (#1359 part 2).
const rowNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader')
    .map((th) => th.querySelector('.raider-name')!.textContent);

describe('Raid nights since last item page', () => {
  const tables = {
    ...TABLES,
    rnlsi: [
      { player_id: 1, last_award_at: '2026-08-20T18:00:00Z', raid_nights_since_last_item: 3 },
      { player_id: 2, last_award_at: null, raid_nights_since_last_item: 9 },
      { player_id: 3, last_award_at: '2026-09-01T18:00:00Z', raid_nights_since_last_item: 1 }
    ]
  };

  it('lists the longest wait first, and sorts by a column when its header is clicked', async () => {
    renderApp('/g/wga/t/phoenix/officer/reports/raid-nights', handlers(tables));
    const table = await screen.findByRole('table', { name: 'Raid nights since last item' });
    expect(rowNames(table)).toEqual(['Zuggz', 'Torbjorn', 'Fluphie']);
    expect(within(table).getByRole('columnheader', { name: /Raid nights since/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    );
    expect(within(table).getByRole('rowheader', { name: /Zuggz/ }).closest('tr')).toHaveTextContent('Never');

    await userEvent.click(within(table).getByRole('button', { name: /Raider/ }));
    expect(rowNames(table)).toEqual(['Fluphie', 'Torbjorn', 'Zuggz']);
    expect(within(table).getByRole('columnheader', { name: /Raider/ })).toHaveAttribute('aria-sort', 'ascending');
    expect(within(table).getByRole('columnheader', { name: /Raid nights since/ })).not.toHaveAttribute('aria-sort');

    await userEvent.click(within(table).getByRole('button', { name: /Raider/ }));
    expect(rowNames(table)).toEqual(['Zuggz', 'Torbjorn', 'Fluphie']);
  });

  it('narrows to one role', async () => {
    renderApp('/g/wga/t/phoenix/officer/reports/raid-nights', handlers(tables));
    const table = await screen.findByRole('table', { name: 'Raid nights since last item' });
    await userEvent.click(screen.getByRole('button', { name: 'Tanks' }));
    expect(rowNames(table)).toEqual(['Fluphie']);
  });
});

describe('Tier sets page', () => {
  it('lists the fewest pieces first, with a never-synced raider below 0/5', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/reports/tier-sets',
      handlers({
        ...TABLES,
        players: [
          { ...PLAYERS[0]!, tier_pieces_equipped: 4, tier_pieces_synced_at: '2026-10-10T12:00:00Z' },
          { ...PLAYERS[1]!, tier_pieces_equipped: 0, tier_pieces_synced_at: '2026-10-10T12:00:00Z' },
          PLAYERS[2]
        ]
      })
    );
    const table = await screen.findByRole('table', { name: 'Tier sets' });
    expect(rowNames(table)).toEqual(['Fluphie', 'Zuggz', 'Torbjorn']);
    expect(
      within(table)
        .getByRole('rowheader', { name: /Fluphie/ })
        .closest('tr')
    ).toHaveTextContent('Not synced');
    expect(
      within(table)
        .getByRole('rowheader', { name: /Torbjorn/ })
        .closest('tr')
    ).toHaveTextContent('4/5');
  });
});

// The season-picked reports (#1359 part 3).
const SEASONS = [
  { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-03-01', ends_at: '2026-07-17' },
  { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-07-18', ends_at: '2026-12-31' }
];

describe('BiS demand page', () => {
  it('opens on the current season, most wanted first, and asks for that season only', async () => {
    const { client } = renderApp(
      '/g/wga/t/phoenix/officer/reports/bis-demand',
      handlers({
        ...TABLES,
        seasons: SEASONS,
        bis_demand_vs_awards: [
          { item_id: 1, item_name: 'Ring of Ash', slot: 'Finger', demand_count: 2, awarded_count: 1 },
          { item_id: 2, item_name: 'Void Cleaver', slot: 'Two-Hand', demand_count: 5, awarded_count: 0 }
        ]
      })
    );
    const table = await screen.findByRole('table', { name: 'BiS demand, Midnight Season 2' });
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((th) => th.textContent)
    ).toEqual(['Void Cleaver', 'Ring of Ash']);
    expect(screen.getByLabelText('Season')).toHaveValue('MID2');
    const read = client.reads.find((r) => r.table === 'bis_demand_vs_awards')!;
    expect(read.filters).toContainEqual(['eq', 'season', 'MID2']);
  });
});

describe('Loot pace page', () => {
  it('lines each week up against the season before, and narrows by track', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/reports/loot-pace',
      handlers({
        ...TABLES,
        seasons: SEASONS,
        season_loot_pace: [
          { season: 'MID2', season_week: 1, track: 'Hero', slot: 'Head', items_awarded: 4 },
          { season: 'MID2', season_week: 1, track: 'Myth', slot: 'Head', items_awarded: 2 },
          { season: 'MID2', season_week: 2, track: 'Hero', slot: 'Hands', items_awarded: 3 },
          { season: 'MID1', season_week: 1, track: 'Hero', slot: 'Head', items_awarded: 5 }
        ]
      })
    );
    const table = await screen.findByRole('table', { name: 'Items awarded per week' });
    const week = (n: number) =>
      within(table)
        .getByRole('rowheader', { name: `Week ${n}` })
        .closest('tr')!;
    expect(week(1)).toHaveTextContent('Week 165');
    expect(week(2)).toHaveTextContent('Week 230');
    await userEvent.selectOptions(screen.getByLabelText('Track'), 'Myth');
    expect(week(1)).toHaveTextContent('Week 120');
  });
});

describe('Priority order health page', () => {
  it('lists raiders who have left, raiders with no entry, and Mythic #1s with the Heroic copy', async () => {
    renderApp(
      '/g/wga/t/phoenix/officer/reports/priority-health',
      handlers({
        ...TABLES,
        seasons: SEASONS,
        priority_order_stale_entries: [
          { priority_order_id: 1, item_name: 'Ring of Ash', track: 'Myth', rank: 2, name_realm: 'Gone-Illidan' }
        ],
        priority_order_gaps: [{ player_id: 2, name_realm: 'Zuggz-Illidan' }],
        priority_order_stale_after_heroic: []
      })
    );
    const left = await screen.findByRole('region', { name: /Raiders who have left/ });
    expect(within(left).getByRole('rowheader', { name: 'Ring of Ash' }).closest('tr')).toHaveTextContent(
      'Ring of AshMythic2Gone'
    );
    expect(screen.getByRole('region', { name: /Not in the priority order/ })).toHaveTextContent('Zuggz');
    expect(screen.getByRole('region', { name: /already have the Heroic one/ })).toHaveTextContent(
      'None for Midnight Season 2.'
    );
  });
});
