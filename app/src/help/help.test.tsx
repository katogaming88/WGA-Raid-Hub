import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { SUPPORT_DISCORD_URL } from '../config';
import { GUIDES, QUESTIONS, TOPICS } from './guide';

// The Help page (#1526): one page for everyone, officer jobs tagged, guides
// in a side panel at their own address.

describe('the Help page', () => {
  it('has every section, and the support Discord opening in a new tab', async () => {
    renderApp('/help');
    expect(await screen.findByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    const main = within(screen.getByRole('main'));
    for (const name of [
      'Bringing your guild here',
      'Your raid week',
      'How Loot priority works',
      'Guides',
      'Common questions'
    ]) {
      expect(main.getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    const link = main.getByRole('link', { name: /Join the support Discord/ });
    expect(link).toHaveAttribute('href', SUPPORT_DISCORD_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('lists every guide under its topic, officer guides tagged', async () => {
    renderApp('/help');
    await screen.findByRole('heading', { level: 1, name: 'Help' });
    for (const topic of TOPICS) {
      const card = within(screen.getByRole('heading', { level: 3, name: topic.title }).closest('article')!);
      for (const guide of GUIDES.filter((g) => g.topic === topic.id)) {
        const link = card.getByRole('link', { name: guide.title });
        expect(link).toHaveAttribute('href', `/help/${guide.id}`);
        expect(link.parentElement!.textContent?.includes('Officers')).toBe(guide.officers === true);
      }
    }
  });

  it('opens guides from the raid week, and never links off to the pages themselves', async () => {
    renderApp('/help');
    await screen.findByRole('heading', { level: 1, name: 'Help' });
    const week = within(screen.getByRole('heading', { level: 2, name: 'Your raid week' }).closest('section')!);
    expect(week.getByRole('link', { name: 'Say if you’re coming' })).toHaveAttribute('href', '/help/rsvp');
    // No guide yet: plain text, not a link to the page.
    expect(week.getByText('Import the night’s loot').closest('a')).toBeNull();
    const main = within(screen.getByRole('main'));
    for (const link of main.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      expect(href === SUPPORT_DISCORD_URL || href.startsWith('/help')).toBe(true);
    }
  });

  it('answers each common question in place', async () => {
    renderApp('/help');
    await screen.findByRole('heading', { level: 1, name: 'Help' });
    for (const item of QUESTIONS) expect(screen.getByText(item.q).closest('details')).toBeInTheDocument();
  });

  it('opens a guide at its own address, with its quick answer, a way there and its steps', async () => {
    const user = userEvent.setup();
    renderApp('/help/wishlist');
    const panel = within(await screen.findByRole('dialog', { name: 'Set your wishlist' }));
    expect(panel.getByText(/Mark one item BiS for each gear slot/)).toBeInTheDocument();
    expect(panel.getByRole('link', { name: /Take me there/ })).toHaveAttribute('href', '/g/wga/t/phoenix/me/wishlist');
    expect(panel.getAllByRole('listitem')).toHaveLength(GUIDES.find((g) => g.id === 'wishlist')!.steps.length);
    // Full view: the guide as the page, no panel, so the sidebar still works.
    await user.click(panel.getByRole('button', { name: 'Full view' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Set your wishlist' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Side view' }));
    expect(await screen.findByRole('dialog', { name: 'Set your wishlist' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has a picture on disk for every guide that shows one (npm run help:shots)', () => {
    for (const guide of GUIDES.filter((g) => g.popup)) {
      expect(existsSync(join(process.cwd(), 'public', 'help-shots', `${guide.id}-popup.png`)), guide.id).toBe(true);
    }
    for (const guide of GUIDES.filter((g) => g.menu)) {
      expect(existsSync(join(process.cwd(), 'public', 'help-shots', `${guide.id}-menu.png`)), guide.id).toBe(true);
    }
    for (const guide of GUIDES.filter((g) => g.picture)) {
      expect(existsSync(join(process.cwd(), 'public', 'help-shots', `${guide.id}.png`)), guide.id).toBe(true);
    }
  });

  it('sends an unknown guide back to Help', async () => {
    renderApp('/help/no-such-guide');
    expect(await screen.findByRole('heading', { level: 1, name: 'Help' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is reachable from the sidebar on any page, beside the support link', async () => {
    renderApp('/g/wga/t/phoenix/roster');
    const site = await screen.findByRole('complementary');
    expect(within(site).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help');
    expect(within(site).getByRole('link', { name: /Support Discord/ })).toHaveAttribute('href', SUPPORT_DISCORD_URL);
  });
});
