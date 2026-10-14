import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';

// A table read the test answers itself, or undefined to fall through to the seeded world.
type ExtraFrom = (read: Read) => ReturnType<NonNullable<FakeHandlers['from']>> | undefined;
import { likePattern } from './useSiteAdmin';

// Site admin (#1364): Staff only, the last item in the sidebar's Site group.
const KAT = { id: 1, discord_id: '111111111111111111', display_name: 'Kat' };
const REX = { id: 2, discord_id: '222222222222222222', display_name: 'Rex' };

function signedIn(
  siteAdmin: boolean,
  opts: { admins?: unknown[]; settings?: Record<string, unknown>; extraFrom?: ExtraFrom } = {}
): FakeHandlers {
  const base = seededHandlers();
  return {
    ...base,
    session: fakeSession({ discord: { id: 'discord-x', name: 'Someone' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person')
        return { data: { site_admin: siteAdmin, guild_officer: false, boe_manager: false, teams: [] } };
      if (name === 'admin_list_site_admins') return { data: opts.admins ?? [KAT, REX] };
      if (name.startsWith('admin_')) return { data: null };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'site_settings') {
        return {
          data: { maintenance_mode: false, maintenance_message: null, guild_creation_open: false, ...opts.settings }
        };
      }
      return opts.extraFrom?.(read) ?? base.from!(read);
    }
  };
}

const sidebar = () => screen.getByRole('complementary', { name: 'Site' });

describe('the menu item', () => {
  it('is the last item in the Site group, for Staff', async () => {
    renderApp('/g/wga', signedIn(true));
    const link = await within(sidebar()).findByRole('link', { name: 'Site admin' });
    expect(link).toHaveAttribute('href', '/g/wga/site-admin');
    const site = within(sidebar()).getByRole('heading', { name: 'Site' }).parentElement!;
    const labels = within(site)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(labels).toEqual(['News', 'About', 'Help', 'Site admin']);
  });

  it('is not shown to anyone else, and the page stays closed', async () => {
    renderApp('/g/wga/site-admin', signedIn(false));
    expect(await screen.findByText('This page is for Staff.')).toBeInTheDocument();
    expect(within(sidebar()).queryByRole('link', { name: 'Site admin' })).not.toBeInTheDocument();
  });
});

describe('site admins', () => {
  it('lists them, has no way to add one by Discord ID, and removes one after asking', async () => {
    const { client } = renderApp('/g/wga/site-admin', signedIn(true));
    expect(await screen.findByText('Rex')).toBeInTheDocument();

    expect(screen.queryByLabelText(/Discord ID/)).not.toBeInTheDocument();
    expect(screen.getByText(/one-time invite link/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Rex' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(client.rpcs).toContainEqual(['admin_revoke_site_admin', { p_discord_id: '222222222222222222' }])
    );
  });

  it('does not offer to remove the last one', async () => {
    renderApp('/g/wga/site-admin', signedIn(true, { admins: [KAT] }));
    expect(await screen.findByRole('button', { name: 'Remove Kat' })).toBeDisabled();
    expect(screen.getByText('The last site admin cannot be removed.')).toBeInTheDocument();
  });
});

describe('site switches', () => {
  it('asks before turning maintenance mode on, and sends the message', async () => {
    const { client } = renderApp('/g/wga/site-admin', signedIn(true));
    await userEvent.type(await screen.findByLabelText('Message visitors see'), 'Back at 9');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(client.rpcs.some(([name]) => name === 'admin_set_maintenance_mode')).toBe(false);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(client.rpcs).toContainEqual(['admin_set_maintenance_mode', { p_enabled: true, p_message: 'Back at 9' }])
    );
  });

  it('turns it off without asking when it is on', async () => {
    const { client } = renderApp(
      '/g/wga/site-admin',
      signedIn(true, { settings: { maintenance_mode: true, maintenance_message: 'Down' } })
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(client.rpcs).toContainEqual(['admin_set_maintenance_mode', { p_enabled: false, p_message: 'Down' }])
    );
  });

  it('shows guild sign-up as shut, with no control to open it yet', async () => {
    renderApp('/g/wga/site-admin', signedIn(true));
    expect(await screen.findByText('Shut')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign.?up/i })).not.toBeInTheDocument();
  });
});

describe('look someone up', () => {
  const guild = { name: 'We Go Again', url_key: 'wga' };
  const extraFrom: ExtraFrom = (read) => {
    if (read.table === 'players')
      return {
        data: [
          {
            id: 7,
            name_realm: 'Kae-Tichondrius',
            url_code: 'k7',
            archived_at: null,
            teams: { name: 'Phoenix', slug: 'phoenix', archived_at: null, guilds: guild },
            team_members: { role: 'officer', discord_id: '444444444444444444', archived_at: null }
          }
        ]
      };
    if (read.table === 'teams' && read.filters.some(([op]) => op === 'ilike')) return { data: [] };
    if (read.table === 'guilds' && read.filters.some(([op]) => op === 'ilike')) return { data: [] };
    return undefined;
  };

  it('finds a character by part of its name, with its team, rank and Discord ID', async () => {
    const { client } = renderApp('/g/wga/site-admin', signedIn(true, { extraFrom }));
    await userEvent.type(await screen.findByLabelText('Name to look up'), 'kae');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
    const link = await screen.findByRole('link', { name: 'Kae-Tichondrius' });
    expect(link).toHaveAttribute('href', '/g/wga/t/phoenix/p/k7');
    expect(screen.getByText('Phoenix (We Go Again) · Officer · Discord ID 444444444444444444')).toBeInTheDocument();
    expect(client.reads.find((r) => r.table === 'players')?.filters).toContainEqual(['ilike', 'name_realm', '%kae%']);
  });

  it('matches a typed % or _ as itself', () => {
    expect(likePattern(' 50%_off ')).toBe('%50\\%\\_off%');
  });
});
