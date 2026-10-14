import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// Record Sale's first-come-first-served prompt (#1205): it names the older
// find, and its main button records the sale there instead.
const row = (id: number, finder: string, foundAt: string) => ({
  id,
  team_id: 1,
  finder_name: finder,
  item_name: 'Voidglass Cloak',
  track: 'Champion',
  upgrade_rank: '2/6',
  note: null,
  status: 'found',
  found_at: foundAt,
  sold_at: null,
  payout_paid_at: null,
  retired_at: null,
  sale_price: null,
  finder_payout: null,
  guild_cut: null,
  ah_fee: null,
  payout_donated: false
});

function boeManager(): FakeHandlers {
  const base = seededHandlers();
  return {
    ...base,
    session: fakeSession({ discord: { id: 'discord-boe', name: 'BoE Manager' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-boe' };
      if (name === 'resolve_person')
        return { data: { site_admin: false, guild_officer: false, boe_manager: true, teams: [] } };
      if (name === 'boe_record_sale') return { data: [] };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'boe_items') {
        return {
          data: [
            row(1, 'Firstfinder-Dalaran', '2026-08-19T01:00:00Z'),
            row(2, 'Second-Illidan', '2026-08-20T01:00:00Z')
          ]
        };
      }
      return base.from!(read);
    }
  };
}

async function openWarningOnNewerFind() {
  const { client } = renderApp('/g/wga/boe', boeManager());
  const newer = (await screen.findByText('Second-Illidan')).closest('tr')!;
  await userEvent.click(within(newer).getByRole('button', { name: 'Record Sale' }));
  await userEvent.type(screen.getByLabelText('Sale price in gold'), '250000');
  await userEvent.keyboard('{Enter}');
  await screen.findByRole('button', { name: 'Record on older find' });
  const alert = screen.getByRole('dialog');
  expect(within(alert).getAllByText('Firstfinder-Dalaran', { selector: 'strong' })).toHaveLength(2);
  expect(within(alert).getByText('Second-Illidan', { selector: 'strong' })).toBeInTheDocument();
  return client;
}

describe('Record Sale on a newer copy of an open item (#1205)', () => {
  it('records the sale on the first finder’s find from the main button', async () => {
    const client = await openWarningOnNewerFind();
    await userEvent.click(screen.getByRole('button', { name: 'Record on older find' }));
    await waitFor(() => expect(client.rpcs).toContainEqual(['boe_record_sale', { p_id: 1, p_sale_price: 250000 }]));
    expect(client.rpcs.filter(([name]) => name === 'boe_record_sale')).toHaveLength(1);
  });

  it('still records it on the row it was opened from when asked to', async () => {
    const client = await openWarningOnNewerFind();
    await userEvent.click(screen.getByRole('button', { name: 'Record here anyway' }));
    await waitFor(() => expect(client.rpcs).toContainEqual(['boe_record_sale', { p_id: 2, p_sale_price: 250000 }]));
  });
});
