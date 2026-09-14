import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { seededHandlers } from '../test/fakeSupabase';
import { setErrorReporter } from '../lib/errors';
import { canonicalPath } from './address';
import { readSupabaseConfig } from '../lib/supabase';

afterEach(() => setErrorReporter(null));

describe('address lookup (#1114)', () => {
  it('shows the guild and team by name once the address resolves', async () => {
    const { client } = renderApp('/g/wga/t/phoenix');
    expect(await screen.findByText('We Go Again')).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Phoenix')).toBeInTheDocument();
    expect(client.rpcs[0]).toEqual(['resolve_address', { p_guild_key: 'wga', p_team_key: 'phoenix' }]);
  });

  it('shows page not found for a team that does not exist', async () => {
    renderApp('/g/wga/t/nope');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('shows page not found for a guild that does not exist', async () => {
    renderApp('/g/nope/t/phoenix/roster');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('moves a retired team key to the current one, keeping the page', async () => {
    const { router } = renderApp('/g/wga/t/old-phoenix/roster?tab=trials');
    expect(await screen.findByRole('heading', { level: 1, name: 'Roster' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/g/wga/t/phoenix/roster');
    expect(router.state.location.search).toBe('?tab=trials');
  });

  it('moves different capitals to the current keys', async () => {
    const { router } = renderApp('/g/WGA/t/Phoenix');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(router.state.location.pathname).toBe('/g/wga/t/phoenix');
  });

  it('resolves a guild page with no team', async () => {
    const { client } = renderApp('/g/wga/news');
    expect(await screen.findByRole('heading', { level: 1, name: 'News' })).toBeInTheDocument();
    expect(client.rpcs[0]).toEqual(['resolve_address', { p_guild_key: 'wga' }]);
  });
});

describe('canonicalPath', () => {
  const resolved = { guildId: 1, guildKey: 'wga', teamId: 1, teamKey: 'phoenix', isCanonical: false };
  it.each([
    ['/g/WGA/t/old/roster', '/g/wga/t/phoenix/roster'],
    ['/g/WGA/t/old', '/g/wga/t/phoenix'],
    ['/g/old-guild/news', '/g/wga/news']
  ])('%s -> %s', (from, to) => {
    expect(canonicalPath(from, resolved)).toBe(to);
  });
});

describe('the data layer never hides a failed read (#1101)', () => {
  it('shows an error box with the reason, reports it, and recovers on Retry', async () => {
    const reported = vi.fn();
    setErrorReporter(reported);
    let failing = true;
    const base = seededHandlers();
    renderApp(
      '/g/wga/t/phoenix',
      seededHandlers({
        from: (read) =>
          read.table === 'players' && failing
            ? { error: { message: 'canceling statement due to statement timeout' } }
            : base.from!(read)
      })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the roster.');
    expect(alert).toHaveTextContent('canceling statement due to statement timeout');
    expect(reported).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'canceling statement due to statement timeout' }),
      expect.objectContaining({ where: 'read', key: ['roster-count', 1] })
    );

    failing = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('18')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the error when the address lookup itself fails, instead of page not found', async () => {
    setErrorReporter(() => {});
    renderApp('/g/wga/t/phoenix', seededHandlers({ rpc: () => ({ error: { message: 'network down' } }) }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load this page.');
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
  });

  it('announces loading while a read is in flight', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = seededHandlers();
    renderApp(
      '/g/wga/t/phoenix',
      seededHandlers({
        from: async (read) => {
          if (read.table === 'players') await gate;
          return base.from!(read);
        }
      })
    );
    expect(await screen.findByText('Loading the roster…')).toHaveAttribute('role', 'status');
    release();
    expect(await screen.findByText('18')).toBeInTheDocument();
  });
});

describe('one real read (#1101 done-when)', () => {
  it('shows the active roster count, reading only active players on this team', async () => {
    const { client } = renderApp('/g/wga/t/phoenix');
    expect(await screen.findByText('18')).toBeInTheDocument();
    const read = client.reads.find((r) => r.table === 'players')!;
    expect(read.filters).toEqual([
      ['eq', 'team_id', 1],
      ['is', 'archived_at', null]
    ]);
    expect(read.options).toEqual({ count: 'exact', head: true });
  });

  it('reuses cached reads when coming back to a page', async () => {
    const { client } = renderApp('/g/wga/t/phoenix');
    await screen.findByText('18');
    await userEvent.click(screen.getByRole('link', { name: 'Roster' }));
    await screen.findByRole('heading', { level: 1, name: 'Roster' });
    await userEvent.click(screen.getByRole('link', { name: 'Home' }));
    await screen.findByText('18');
    expect(client.reads.filter((r) => r.table === 'players')).toHaveLength(1);
  });
});

describe('team switcher', () => {
  it('lists the active teams in team id order and keeps the current page when switching', async () => {
    const { router } = renderApp('/g/wga/t/phoenix/roster');
    await screen.findByRole('heading', { level: 1, name: 'Roster' });
    const toggle = await screen.findByRole('button', { name: /Phoenix/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(
      within(list)
        .getAllByRole('link')
        .map((a) => a.textContent)
    ).toEqual(['Phoenix', 'Hellfire Rollers']);
    expect(within(list).getByRole('link', { name: 'Phoenix' })).toHaveAttribute('aria-current', 'true');

    await userEvent.click(within(list).getByRole('link', { name: 'Hellfire Rollers' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/g/wga/t/hellfire/roster'));
    expect(screen.getByRole('button', { name: /Hellfire Rollers/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes when clicking outside it', async () => {
    renderApp('/g/wga/t/phoenix');
    const toggle = await screen.findByRole('button', { name: /Phoenix/ });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(screen.getByRole('heading', { level: 1, name: 'Home' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('works from the keyboard: arrows open it and move between teams, Enter picks one', async () => {
    const { router } = renderApp('/g/wga/t/phoenix/roster');
    const toggle = await screen.findByRole('button', { name: /Phoenix/ });
    toggle.focus();

    await userEvent.keyboard('{ArrowDown}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Phoenix' })).toHaveFocus();

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: 'Hellfire Rollers' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('link', { name: 'Phoenix' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('link', { name: 'Hellfire Rollers' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('link', { name: 'Phoenix' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('link', { name: 'Hellfire Rollers' })).toHaveFocus();

    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/g/wga/t/hellfire/roster'));
  });

  it('opens on the last team with Up, and closes when focus tabs out', async () => {
    renderApp('/g/wga/t/phoenix');
    const toggle = await screen.findByRole('button', { name: /Phoenix/ });
    toggle.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getByRole('link', { name: 'Hellfire Rollers' })).toHaveFocus();
    await userEvent.tab();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and returns focus to its button', async () => {
    renderApp('/g/wga/t/phoenix');
    const toggle = await screen.findByRole('button', { name: /Phoenix/ });
    await userEvent.click(toggle);
    await userEvent.keyboard('{Escape}');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveFocus();
  });
});

describe('build settings', () => {
  it('refuses to start without a Supabase URL and key', () => {
    expect(() => readSupabaseConfig({})).toThrow(/VITE_SUPABASE_URL/);
    expect(() => readSupabaseConfig({ VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'k' })).toThrow();
    expect(readSupabaseConfig({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321', VITE_SUPABASE_ANON_KEY: 'k' })).toEqual({
      url: 'http://127.0.0.1:54321',
      key: 'k'
    });
  });
});
