import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { seededHandlers, type Read } from '../test/fakeSupabase';
import {
  equippedItemLevel,
  summarize,
  summaryLine,
  toIncoming,
  toRoster,
  type GearRow,
  type PlayerRow
} from './roster';

const player = (id: number, nameRealm: string, klass: string, spec: string, role: string | null, over = {}) =>
  ({
    id,
    name_realm: nameRealm,
    nickname: null,
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: role === null ? null : { class: klass, spec, role },
    ...over
  }) satisfies PlayerRow;

const gearAt = (playerId: number, level: number, slots: string[]): GearRow[] =>
  slots.map((equipment_slot) => ({ player_id: playerId, equipment_slot, item_level: level }));

const SIXTEEN = [
  'HEAD',
  'NECK',
  'SHOULDER',
  'BACK',
  'CHEST',
  'WRIST',
  'HANDS',
  'WAIST',
  'LEGS',
  'FEET',
  'FINGER_1',
  'FINGER_2',
  'TRINKET_1',
  'TRINKET_2',
  'MAIN_HAND',
  'OFF_HAND'
];

describe('equippedItemLevel', () => {
  it('averages the sixteen gear slots and ignores the shirt and tabard', () => {
    const gear = [
      ...gearAt(1, 320, SIXTEEN.slice(0, 15)),
      ...gearAt(1, 336, ['OFF_HAND']),
      ...gearAt(1, 1, ['SHIRT', 'TABARD'])
    ];
    expect(equippedItemLevel(gear)).toBe(321);
  });

  it('counts a two-handed weapon in both hands when the off hand is empty', () => {
    const gear = [...gearAt(1, 320, SIXTEEN.slice(0, 14)), ...gearAt(1, 336, ['MAIN_HAND'])];
    expect(equippedItemLevel(gear)).toBe(322);
  });

  it('has no item level before any gear is synced', () => {
    expect(equippedItemLevel([])).toBeNull();
    expect(equippedItemLevel(gearAt(1, 300, ['SHIRT']))).toBeNull();
  });
});

describe('toRoster', () => {
  it('leaves out players without a role and sorts each role by the name shown', () => {
    const groups = toRoster(
      [
        player(1, 'Zuggz-Illidan', 'Warrior', 'Arms', 'Melee'),
        player(2, 'Torbjorn-Illidan', 'Death Knight', 'Frost', 'Melee', { nickname: 'Raz' }),
        player(3, 'Nospec-Illidan', '', '', null),
        player(4, 'Fluphie-Illidan', 'Warrior', 'Protection', 'Tank', { nickname: 'Fluffy' })
      ],
      []
    );
    expect(groups.map((g) => [g.label, g.raiders.map((r) => [r.name, r.character])])).toEqual([
      ['Tanks', [['Fluffy', 'Fluphie']]],
      [
        'Melee',
        [
          ['Raz', 'Torbjorn'],
          ['Zuggz', null]
        ]
      ]
    ]);
  });

  it('carries trial, bench and rotator as tags', () => {
    const [group] = toRoster(
      [player(1, 'Dodgey-Illidan', 'Monk', 'Windwalker', 'Melee', { is_trial: true, is_rotator: true })],
      []
    );
    expect(group!.raiders[0]!.statuses).toEqual(['Trial', 'Rotator']);
  });
});

describe('summarize', () => {
  it('counts statuses, roles and armor types, and finds the lowest item level', () => {
    const groups = toRoster(
      [
        player(1, 'Angryamazon-Illidan', 'Evoker', 'Preservation', 'Heal', { is_trial: true }),
        player(2, 'Grihzy-Illidan', 'Evoker', 'Preservation', 'Heal', { is_bench: true }),
        player(3, 'Zuggz-Illidan', 'Warrior', 'Arms', 'Melee'),
        player(4, 'Fluphie-Illidan', 'Warrior', 'Protection', 'Tank')
      ],
      [...gearAt(1, 321, SIXTEEN), ...gearAt(2, 314, SIXTEEN), ...gearAt(3, 322, SIXTEEN)]
    );
    const summary = summarize(groups);
    expect(summaryLine(summary)).toBe('4 raiders, 1 on trial, 1 on the bench');
    expect(summary.roles.map((r) => r.count)).toEqual([1, 2, 1, 0]);
    expect(summary.armor).toEqual([
      { type: 'Cloth', count: 0 },
      { type: 'Leather', count: 0 },
      { type: 'Mail', count: 2 },
      { type: 'Plate', count: 2 }
    ]);
    expect(summary.averageItemLevel).toBe(319);
    expect(summary.lowest).toEqual({ name: 'Grihzy', itemLevel: 314 });
    expect(summary.withoutGear).toBe(1);
  });
});

describe('toIncoming', () => {
  it('groups approved signups by role under their character name', () => {
    const groups = toIncoming([
      { signup_id: 1, signup_name_realm: 'Gloamwing-Illidan', class: 'Shaman', spec: 'Elemental', role: 'Ranged' },
      { signup_id: 2, signup_name_realm: null, class: 'Mage', spec: 'Fire', role: 'Ranged' }
    ]);
    expect(groups.map((g) => [g.label, g.raiders.map((r) => r.name)])).toEqual([['Ranged', ['Gloamwing']]]);
  });
});

// The page against a fake database.
function rosterHandlers(tables: Record<string, unknown>) {
  return seededHandlers({
    from(read: Read) {
      const seeded = seededHandlers();
      if (read.table in tables) {
        const value = tables[read.table];
        return typeof value === 'function' ? (value as (r: Read) => unknown)(read) : { data: value };
      }
      return seeded.from!(read);
    }
  } as never);
}

describe('Roster page', () => {
  it('shows the roster by role with item level, tier pieces and tags', async () => {
    renderApp(
      '/g/wga/t/phoenix/roster',
      rosterHandlers({
        players: [
          player(1, 'Torbjorn-Illidan', 'Death Knight', 'Frost', 'Melee', { nickname: 'Raz', tier_pieces_equipped: 4 }),
          player(2, 'Dodgey-Illidan', 'Monk', 'Windwalker', 'Melee', { is_trial: true })
        ],
        player_equipped_gear: gearAt(1, 321, SIXTEEN),
        incoming_roster: [],
        team_settings: { signupSeason: '' }
      })
    );
    const table = await screen.findByRole('table', { name: 'Current roster' });
    const raz = within(table).getByRole('rowheader', { name: /Raz/ }).closest('tr')!;
    expect(raz).toHaveTextContent('Raz');
    expect(raz).toHaveTextContent('Torbjorn');
    expect(raz).toHaveTextContent('Frost Death Knight');
    expect(raz).toHaveTextContent('321.0');
    expect(raz).toHaveTextContent('4/5');
    const dodgey = within(table)
      .getByRole('rowheader', { name: /Dodgey/ })
      .closest('tr')!;
    expect(dodgey).toHaveTextContent('Trial');
    expect(dodgey).toHaveTextContent('Not synced');
    expect(screen.getByText('2 raiders, 1 on trial')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('filters to one role', async () => {
    renderApp(
      '/g/wga/t/phoenix/roster',
      rosterHandlers({
        players: [
          player(1, 'Zuggz-Illidan', 'Warrior', 'Arms', 'Melee'),
          player(2, 'Fluphie-Illidan', 'Warrior', 'Protection', 'Tank')
        ]
      })
    );
    const table = await screen.findByRole('table', { name: 'Current roster' });
    await userEvent.click(screen.getByRole('button', { name: 'Tanks' }));
    expect(screen.getByRole('button', { name: 'Tanks' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).queryByText('Zuggz')).not.toBeInTheDocument();
    expect(within(table).getByText('Fluphie')).toBeInTheDocument();
  });

  it('offers next season’s roster as a tab, reachable with the arrow keys', async () => {
    renderApp(
      '/g/wga/t/phoenix/roster',
      rosterHandlers({
        players: [player(1, 'Zuggz-Illidan', 'Warrior', 'Arms', 'Melee')],
        incoming_roster: [
          { signup_id: 1, signup_name_realm: 'Gloamwing-Illidan', class: 'Shaman', spec: 'Elemental', role: 'Ranged' }
        ],
        team_settings: { signupSeason: 'MN Season 3' }
      })
    );
    const current = await screen.findByRole('tab', { name: 'Current Roster' });
    expect(current).toHaveAttribute('aria-selected', 'true');
    current.focus();
    await userEvent.keyboard('{ArrowRight}');
    const next = screen.getByRole('tab', { name: 'MN Season 3 Roster (Tentative)' });
    expect(next).toHaveAttribute('aria-selected', 'true');
    expect(next).toHaveFocus();
    expect(screen.getByRole('heading', { name: '1 Pending Raider' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Next season’s tentative roster' })).toHaveTextContent('Gloamwing');
  });

  it('shows a failed read with a way to retry', async () => {
    renderApp(
      '/g/wga/t/phoenix/roster',
      rosterHandlers({ player_equipped_gear: () => ({ error: { message: 'gear read failed' } }) })
    );
    const alert = await within(screen.getByRole('main')).findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the roster.');
    expect(alert).toHaveTextContent('gear read failed');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
