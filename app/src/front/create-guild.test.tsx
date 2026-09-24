import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// Create your guild (#1226): the form, and the site admin's switch.

const person = (siteAdmin: boolean) => ({
  site_admin: siteAdmin,
  guild_officer: false,
  boe_manager: false,
  teams: []
});

function handlers(
  opts: { open?: boolean; siteAdmin?: boolean; signedIn?: boolean; discord?: boolean } = {}
): FakeHandlers {
  const { open = false, siteAdmin = false, signedIn = true, discord = true } = opts;
  const base = seededHandlers();
  return seededHandlers({
    ...(signedIn
      ? {
          session: fakeSession({
            battlenet: 'A#1',
            ...(discord ? { discord: { id: 'd', name: 'Ana' } } : {})
          })
        }
      : {}),
    rpc(name, args) {
      if (name === 'guild_creation_open') return { data: open };
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: person(siteAdmin) };
      if (name === 'create_guild') return { data: [{ guild_key: 'k7q2m9xa', team_key: 'p3n8v5tc' }] };
      if (name === 'admin_set_guild_creation_open') return { data: null };
      return base.rpc!(name, args);
    }
  });
}

describe('the create-guild page', () => {
  it('points a signed-out visitor to the support Discord while creation is closed', async () => {
    renderApp('/new-guild', handlers({ signedIn: false }));
    expect(await screen.findByText(/set up by hand for now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign in/ })).not.toBeInTheDocument();
  });

  it('offers a signed-out visitor sign-in while creation is open', async () => {
    renderApp('/new-guild', handlers({ signedIn: false, open: true }));
    expect(await screen.findByRole('button', { name: 'Sign in with Battle.net' })).toBeInTheDocument();
  });

  it('shows a signed-in non-admin no form while creation is closed', async () => {
    renderApp('/new-guild', handlers());
    expect(await screen.findByText(/set up by hand for now/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create guild' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open guild creation' })).not.toBeInTheDocument();
  });

  it('shows a site admin only the switch while creation is closed, and flips it', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/new-guild', handlers({ siteAdmin: true }));
    expect(await screen.findByRole('heading', { name: 'Guild creation is closed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create guild' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open guild creation' }));
    expect(client.rpcs).toContainEqual(['admin_set_guild_creation_open', { p_open: true }]);
  });

  it('shows a site admin the switch and the form once creation is open', async () => {
    renderApp('/new-guild', handlers({ siteAdmin: true, open: true }));
    expect(await screen.findByRole('heading', { name: 'Guild creation is open' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close guild creation' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create guild' })).toBeInTheDocument();
  });

  it('asks for Discord before showing the form', async () => {
    renderApp('/new-guild', handlers({ open: true, discord: false }));
    expect(await screen.findByRole('button', { name: 'Connect Discord' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create guild' })).not.toBeInTheDocument();
  });

  it('creates the guild once it is open and links to the new team’s invite page', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/new-guild', handlers({ open: true }));
    const create = await screen.findByRole('button', { name: 'Create guild' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Guild name'), 'Night Watch');
    await user.selectOptions(screen.getByLabelText('Region'), 'eu');
    await user.type(screen.getByLabelText('Home realm'), 'Draenor');
    await user.type(screen.getByLabelText('First team’s name (optional)'), 'Watchers');
    await user.click(create);
    expect(await screen.findByRole('heading', { name: 'Your guild is ready' })).toBeInTheDocument();
    expect(client.rpcs).toContainEqual([
      'create_guild',
      { p_name: 'Night Watch', p_region: 'eu', p_realm: 'Draenor', p_team_name: 'Watchers' }
    ]);
    expect(screen.getByRole('link', { name: 'Make an invite link' })).toHaveAttribute(
      'href',
      '/g/k7q2m9xa/t/p3n8v5tc/officer/invite'
    );
  });

  it('does not send a team name when it is left blank', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/new-guild', handlers({ open: true }));
    await user.type(await screen.findByLabelText('Guild name'), 'Night Watch');
    await user.type(screen.getByLabelText('Home realm'), 'Draenor');
    await user.click(screen.getByRole('button', { name: 'Create guild' }));
    expect(await screen.findByRole('heading', { name: 'Your guild is ready' })).toBeInTheDocument();
    expect(client.rpcs).toContainEqual(['create_guild', { p_name: 'Night Watch', p_region: 'us', p_realm: 'Draenor' }]);
  });

  it('shows the error when the database refuses', async () => {
    const user = userEvent.setup();
    const h = handlers({ open: true });
    const inner = h.rpc!;
    h.rpc = (name, args) =>
      name === 'create_guild' ? { error: { message: 'A guild called Night Watch already exists' } } : inner(name, args);
    renderApp('/new-guild', h);
    await user.type(await screen.findByLabelText('Guild name'), 'Night Watch');
    await user.type(screen.getByLabelText('Home realm'), 'Draenor');
    await user.click(screen.getByRole('button', { name: 'Create guild' }));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.some((a) => a.textContent?.includes('already exists'))).toBe(true);
  });
});

describe('the front page and guild creation', () => {
  it('shows a Create your guild button only when creation is open', async () => {
    renderApp('/', handlers({ signedIn: false, open: true }));
    expect(await screen.findByRole('link', { name: 'Create your guild' })).toHaveAttribute('href', '/new-guild');
  });

  it('does not show it to a visitor while creation is closed', async () => {
    renderApp('/', handlers({ signedIn: false }));
    await screen.findByRole('heading', { level: 1, name: 'WGA Raid Hub' });
    expect(screen.queryByRole('link', { name: 'Create your guild' })).not.toBeInTheDocument();
  });

  it('shows it to a site admin while creation is closed, since the switch is on that page', async () => {
    renderApp('/', handlers({ siteAdmin: true }));
    expect(await screen.findByRole('link', { name: 'Create your guild' })).toHaveAttribute('href', '/new-guild');
  });
});
