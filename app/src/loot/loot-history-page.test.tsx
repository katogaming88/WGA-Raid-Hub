import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { asMember, seededHandlers } from '../test/fakeSupabase';

const LOOT = [
  {
    id: 1,
    team_id: 1,
    track: 'Myth',
    season: 'MID2',
    awarded_at: '2026-11-10T02:00:00Z',
    boss: 'Warden',
    response: 'BiS',
    item_id: 10,
    items: {
      name: 'Venomwoven Effigy',
      slot: 'Head',
      armor_type: 'Cloth',
      wow_item_id: 249000,
      is_ptr: false,
      icon: null
    }
  },
  {
    id: 2,
    team_id: 1,
    track: 'Hero',
    season: 'MID1',
    awarded_at: '2026-05-01T02:00:00Z',
    boss: 'Warden',
    response: 'BiS',
    item_id: 10,
    items: {
      name: 'Venomwoven Effigy',
      slot: 'Head',
      armor_type: 'Cloth',
      wow_item_id: 249000,
      is_ptr: false,
      icon: null
    }
  },
  {
    id: 3,
    team_id: 1,
    track: 'Myth',
    season: 'MID2',
    awarded_at: '2026-11-10T02:00:00Z',
    boss: 'Queen',
    response: 'BiS',
    item_id: 20,
    items: { name: 'Venomous Boneglaive', slot: 'Two-Hand', armor_type: null }
  }
];

// team_loot_history() answers flat rows: the item's fields beside the award's.
const ROWS = LOOT.map(({ items, ...row }) => ({
  ...row,
  item_name: items.name,
  slot: items.slot,
  armor_type: items.armor_type,
  wow_item_id: 'wow_item_id' in items ? items.wow_item_id : null,
  is_ptr: 'is_ptr' in items ? items.is_ptr : false,
  icon: null
}));

function handlers({ locked = false } = {}) {
  const base = seededHandlers();
  return asMember(
    seededHandlers({
      rpc: (name, args) =>
        name === 'team_loot_history'
          ? locked
            ? { error: { message: 'Not authorized' } }
            : { data: ROWS }
          : base.rpc!(name, args),
      from: (read) => (read.table === 'tier_token_map' ? { data: [{ token_item_id: 10 }] } : base.from!(read))
    })
  );
}

describe('Loot history', () => {
  it('opens on every item and its count, with no player anywhere', async () => {
    renderApp('/g/wga/t/phoenix/loot', handlers());
    await screen.findByRole('heading', { level: 1, name: 'Loot history' });
    const table = await screen.findByRole('table', { name: 'Drops by item' });
    expect(screen.getByText('drops').parentElement).toHaveTextContent('3 drops');
    const link = within(table).getByRole('link', { name: /Venomwoven Effigy/ });
    expect(link).toHaveAttribute('href', 'https://www.wowhead.com/item=249000');
    const row = link.closest('tr')!;
    expect(within(row).getByRole('cell', { name: '2' })).toBeInTheDocument();
    expect(within(table).queryByText(/player|raider/i)).not.toBeInTheDocument();
  });

  it('counts a token family and shows every drop behind it', async () => {
    renderApp('/g/wga/t/phoenix/loot', handlers());
    await userEvent.selectOptions(await screen.findByLabelText('Tier tokens'), 'Cloth tier tokens');
    expect(screen.getByText('drops').parentElement).toHaveTextContent('2 drops');
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'Every drop');
    const table = screen.getByRole('table', { name: 'Every drop' });
    expect(within(table).getAllByRole('rowheader')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('drops').parentElement).toHaveTextContent('3 drops');
  });

  it('says so when the team keeps loot history to its officers (#1560)', async () => {
    renderApp('/g/wga/t/phoenix/loot', handlers({ locked: true }));
    expect(await screen.findByText('This team keeps loot history to its officers.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
