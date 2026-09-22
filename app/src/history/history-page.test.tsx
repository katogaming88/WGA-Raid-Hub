import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { seededHandlers } from '../test/fakeSupabase';

const HISTORY = [
  {
    name: 'Season One',
    raids: [{ bosses: [{ name: 'Warden', mythicDate: '2026-08-01', mythicPulls: 5 }] }],
    roster: [
      {
        nameRealm: 'Aur-Illidan',
        role: 'Tank',
        isTrial: false,
        isBench: false,
        joinDate: '2026-01-01',
        attendance: '90%'
      }
    ]
  }
];

describe('History', () => {
  it('shows a season’s recap, and its roster behind a toggle', async () => {
    const base = seededHandlers();
    renderApp(
      '/g/wga/t/phoenix/history',
      seededHandlers({
        from: (read) => (read.table === 'team_settings' ? { data: { history: HISTORY } } : base.from!(read))
      })
    );
    await screen.findByRole('heading', { level: 1, name: 'History' });
    const card = within(
      await screen.findByRole('heading', { level: 2, name: 'Season One' }).then((h) => h.closest('article')!)
    );
    expect(card.getByText(/1\/1 Mythic/)).toBeInTheDocument();

    expect(card.queryByRole('table')).not.toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'View roster' }));
    expect(card.getByRole('cell', { name: 'Aur-Illidan' })).toBeInTheDocument();
    await userEvent.click(card.getByRole('button', { name: 'Hide roster' }));
    expect(card.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says so when there is no past season', async () => {
    renderApp('/g/wga/t/phoenix/history');
    expect(await screen.findByText('No past seasons yet.')).toBeInTheDocument();
  });
});
