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

function handlers() {
  const base = seededHandlers();
  return asMember(
    seededHandlers({
      from: (read) => {
        if (read.table === 'rclc_loot') return { data: LOOT };
        if (read.table === 'tier_token_map') return { data: [{ token_item_id: 10 }] };
        return base.from!(read);
      }
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
});
