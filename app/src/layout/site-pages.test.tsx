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
});
