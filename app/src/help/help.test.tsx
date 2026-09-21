import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { SUPPORT_DISCORD_URL } from '../config';
import { GUIDE } from './guide';

// The Help page (#1102): the support Discord, then one card per task.

describe('the Help page', () => {
  it('leads with the support Discord, opening in a new tab', async () => {
    renderApp('/g/wga/help');
    expect(await screen.findByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    const link = main.getByRole('link', { name: /Join the support Discord/ });
    expect(link).toHaveAttribute('href', SUPPORT_DISCORD_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('has one card per task, each with its steps in order', async () => {
    renderApp('/g/wga/help');
    await screen.findByRole('heading', { level: 1, name: 'Help' });
    for (const card of GUIDE) {
      const article = within(screen.getByRole('heading', { level: 3, name: card.title }).closest('article')!);
      expect(article.getAllByRole('listitem')).toHaveLength(card.steps.length);
    }
  });

  it('is reachable from the sidebar on any page, beside the support link', async () => {
    renderApp('/g/wga/t/phoenix/roster');
    const site = await screen.findByRole('complementary');
    expect(within(site).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/g/wga/help');
    expect(within(site).getByRole('link', { name: /Support Discord/ })).toHaveAttribute('href', SUPPORT_DISCORD_URL);
  });
});
