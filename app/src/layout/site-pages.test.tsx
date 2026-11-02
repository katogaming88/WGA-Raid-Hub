import { describe, it, expect, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../test/renderApp';

// News, About, Help and Site admin have site addresses (#1482), in the frame
// of the guild this browser was last on.
afterEach(() => localStorage.clear());

const sidebar = () => screen.getByRole('complementary', { name: 'Site' });

describe('site addresses', () => {
  it.each(['news', 'about', 'help'])(
    '/g/wga/%s forwards to the site address, keeping the rest of the link',
    async (page) => {
      const { router } = renderApp(`/g/wga/${page}?from=discord#top`);
      await waitFor(() => expect(router.state.location.pathname).toBe(`/${page}`));
      expect(router.state.location.search).toBe('?from=discord');
      expect(router.state.location.hash).toBe('#top');
    }
  );

  it('shows the site pages in the frame of the guild last visited, and links to them without a guild', async () => {
    renderApp('/about');
    expect(await within(sidebar()).findByText('We Go Again')).toBeInTheDocument();
    for (const [name, href] of [
      ['News', '/news'],
      ['About', '/about'],
      ['Help', '/help']
    ]) {
      expect(within(sidebar()).getByRole('link', { name: new RegExp(`^${name}`) })).toHaveAttribute('href', href);
    }
  });

  it('remembers the guild a guild page was opened on', async () => {
    renderApp('/g/wga');
    await within(sidebar()).findByText('We Go Again');
    expect(localStorage.getItem('wga_last_guild')).toBe('wga');
  });

  it('falls back to the default guild when the remembered one no longer exists', async () => {
    localStorage.setItem('wga_last_guild', 'gone');
    renderApp('/help');
    expect(await within(sidebar()).findByText('We Go Again')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
    expect(localStorage.getItem('wga_last_guild')).toBeNull();
  });

  it('points the team links at the team last visited in the guild, on guild and site pages', async () => {
    const roster = () => within(sidebar()).getByRole('link', { name: /^Roster/ });
    const view = renderApp('/g/wga/t/hellfire');
    await waitFor(() => expect(localStorage.getItem('wga_last_team:wga')).toBe('hellfire'));
    view.view.unmount();

    renderApp('/g/wga');
    await within(sidebar()).findByText('We Go Again');
    await waitFor(() => expect(roster()).toHaveAttribute('href', '/g/wga/t/hellfire/roster'));
    expect(screen.getByRole('button', { name: /Choose a team/ })).toBeInTheDocument();
  });

  it('keeps the remembered team through a site page', async () => {
    localStorage.setItem('wga_last_team:wga', 'hellfire');
    renderApp('/help');
    await within(sidebar()).findByText('We Go Again');
    await waitFor(() =>
      expect(within(sidebar()).getByRole('link', { name: /^Roster/ })).toHaveAttribute(
        'href',
        '/g/wga/t/hellfire/roster'
      )
    );
  });

  it('skips a remembered team the guild no longer lists', async () => {
    localStorage.setItem('wga_last_team:wga', 'gone');
    renderApp('/help');
    await within(sidebar()).findByText('We Go Again');
    await waitFor(() =>
      expect(within(sidebar()).getByRole('link', { name: /^Roster/ })).not.toHaveAttribute(
        'href',
        '/g/wga/t/gone/roster'
      )
    );
  });
});
