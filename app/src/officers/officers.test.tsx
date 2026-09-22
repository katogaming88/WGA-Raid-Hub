import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { seededHandlers } from '../test/fakeSupabase';

// Guild officers and Team officers (#1102): the same card shape, two reads.

const BIO = {
  name: 'Kat',
  characterName: 'Katorri',
  pronouns: 'she/her',
  title: 'Loot officer',
  classKey: 'Priest',
  spec: 'Holy',
  bio: 'Runs the Hub.',
  imagePath: null
};

describe('Guild officers', () => {
  it('shows every field on the card', async () => {
    const base = seededHandlers();
    renderApp(
      '/g/wga/officers',
      seededHandlers({
        from: (read) => (read.table === 'site_settings' ? { data: { guild_officer_bios: [BIO] } } : base.from!(read))
      })
    );
    await screen.findByRole('heading', { level: 1, name: 'Guild officers' });
    const card = within(await within(screen.getByRole('main')).findByRole('listitem'));
    expect(card.getByText('Kat')).toBeInTheDocument();
    expect(card.getByText('(she/her)')).toBeInTheDocument();
    expect(card.getByText('Katorri')).toBeInTheDocument();
    expect(card.getByText('Loot officer')).toBeInTheDocument();
    expect(card.getByText('Holy')).toBeInTheDocument();
    expect(card.getByText('Runs the Hub.')).toBeInTheDocument();
  });

  it('says so when nobody is listed', async () => {
    renderApp('/g/wga/officers');
    expect(await screen.findByText('No guild officers listed yet.')).toBeInTheDocument();
  });
});

describe('Team officers', () => {
  it('reads the team’s own bios', async () => {
    const base = seededHandlers();
    renderApp(
      '/g/wga/t/phoenix/officers',
      seededHandlers({
        from: (read) => (read.table === 'team_settings' ? { data: { bios: [BIO] } } : base.from!(read))
      })
    );
    await screen.findByRole('heading', { level: 1, name: 'Team officers' });
    expect(await screen.findByText('Kat')).toBeInTheDocument();
  });

  it('says so when nobody is listed', async () => {
    renderApp('/g/wga/t/phoenix/officers');
    expect(await screen.findByText('No team officers listed yet.')).toBeInTheDocument();
  });
});
