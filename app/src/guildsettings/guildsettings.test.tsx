import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// Guild settings and New team (#1644): for a guild officer only.
const TEAMS = [
  { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null, unlisted: false },
  { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', archived_at: null, unlisted: false },
  { id: 3, name: 'Sandbox', slug: 'sandbox', archived_at: null, unlisted: true },
  { id: 9, name: 'Old Team', slug: 'old-team', archived_at: '2026-01-01T00:00:00Z', unlisted: false }
];

// `memberOf`: team ids the signed-in person is on.
function signedIn(opts: { guildOfficer: boolean; siteAdmin?: boolean; memberOf?: number[] }): FakeHandlers {
  const base = seededHandlers();
  const teams = [...TEAMS];
  return {
    ...base,
    session: fakeSession({ discord: { id: 'discord-x', name: 'Someone' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') {
        return {
          data: {
            site_admin: opts.siteAdmin ?? false,
            guild_officer: opts.guildOfficer,
            boe_manager: false,
            teams: (opts.memberOf ?? []).map((id) => ({
              team_id: id,
              team_member_id: id,
              role: 'raider',
              characters: []
            }))
          }
        };
      }
      if (name === 'create_team') {
        teams.push({ id: 10, name: String(args['p_name']), slug: 'new-team', archived_at: null, unlisted: false });
        return { data: [{ team_id: 10, team_key: 'new-team' }] };
      }
      const extra = teams.find((t) => t.id >= 3 && t.slug === args['p_team_key']);
      if (name === 'resolve_address' && extra) {
        return {
          data: [
            {
              guild_id: 1,
              guild_key: 'wga',
              team_id: extra.id,
              team_key: extra.slug,
              is_canonical: true,
              player_id: null
            }
          ]
        };
      }
      if (name.startsWith('set_team_') || name === 'update_team') return { data: null };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'teams') return { data: [...teams] };
      return base.from!(read);
    }
  };
}

const sidebar = () => screen.getByRole('complementary', { name: 'Site' });

describe('who sees Guild settings and New team', () => {
  it('a guild officer gets the sidebar item, the page and New team in the picker', async () => {
    renderApp('/g/wga', signedIn({ guildOfficer: true }));
    const link = await within(sidebar()).findByRole('link', { name: 'Guild settings' });
    expect(link).toHaveAttribute('href', '/g/wga/settings');
    await userEvent.click(within(sidebar()).getByRole('button', { name: /switch team|Choose a team/ }));
    expect(within(sidebar()).getByRole('button', { name: 'New team' })).toBeInTheDocument();
  });

  it('Staff without the guild officer grant, and raiders, see neither, and the page stays closed', async () => {
    renderApp('/g/wga/settings/teams', signedIn({ guildOfficer: false, siteAdmin: true }));
    expect(await screen.findByText('This page is for guild officers.')).toBeInTheDocument();
    expect(within(sidebar()).queryByRole('link', { name: 'Guild settings' })).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole('button', { name: 'New team' })).not.toBeInTheDocument();
  });

  it('/settings opens the first tab', async () => {
    renderApp('/g/wga/settings', signedIn({ guildOfficer: true }));
    expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument();
  });
});

describe('the Teams list', () => {
  it('shows every team with its address, the unlisted and the archived marked', async () => {
    renderApp('/g/wga/settings/teams', signedIn({ guildOfficer: true }));
    const sandbox = (await screen.findByText('Sandbox', { selector: '.guildsettings-name' })).closest('li')!;
    expect(within(sandbox).getByText('/g/wga/t/sandbox')).toBeInTheDocument();
    expect(within(sandbox).getByText(/Unlisted/, { selector: 'span.text-muted' })).toBeInTheDocument();
    const old = screen.getByText('Old Team', { selector: '.guildsettings-name' }).closest('li')!;
    expect(within(old).getByText('(archived)')).toBeInTheDocument();
    expect(within(old).getByRole('button', { name: /Bring back/ })).toBeInTheDocument();
  });

  it('unlists a team from its switch', async () => {
    const { client } = renderApp('/g/wga/settings/teams', signedIn({ guildOfficer: true }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Unlisted: Phoenix' }));
    await waitFor(() => expect(client.rpcs).toContainEqual(['set_team_unlisted', { p_team_id: 1, p_unlisted: true }]));
  });

  it('renames a team, sending its address as it is', async () => {
    const { client } = renderApp('/g/wga/settings/teams', signedIn({ guildOfficer: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Rename Phoenix' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Team name');
    await userEvent.clear(input);
    await userEvent.type(input, 'Phoenix Rising');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.rpcs).toContainEqual(['update_team', { p_team_id: 1, p_name: 'Phoenix Rising', p_key: 'phoenix' }])
    );
  });

  it('changes an address, sending the name as it is', async () => {
    const { client } = renderApp('/g/wga/settings/teams', signedIn({ guildOfficer: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Change address of Phoenix' }));
    const dialog = screen.getByRole('dialog');
    const input = within(dialog).getByLabelText('Address');
    await userEvent.clear(input);
    await userEvent.type(input, 'fire');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.rpcs).toContainEqual(['update_team', { p_team_id: 1, p_name: 'Phoenix', p_key: 'fire' }])
    );
  });

  it('archives only once the team name is typed in, and brings one back at once', async () => {
    const { client } = renderApp('/g/wga/settings/teams', signedIn({ guildOfficer: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Archive Phoenix' }));
    const dialog = screen.getByRole('dialog');
    const archive = within(dialog).getByRole('button', { name: 'Archive team' });
    expect(archive).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Type Phoenix to confirm'), 'phoenix');
    await userEvent.click(archive);
    await waitFor(() => expect(client.rpcs).toContainEqual(['set_team_archived', { p_team_id: 1, p_archived: true }]));

    await userEvent.click(await screen.findByRole('button', { name: 'Bring back Old Team' }));
    await waitFor(() => expect(client.rpcs).toContainEqual(['set_team_archived', { p_team_id: 9, p_archived: false }]));
  });
});

describe('New team', () => {
  it('asks only for a name, adds the team and lands on it', async () => {
    const { client } = renderApp('/g/wga', signedIn({ guildOfficer: true }));
    await userEvent.click(await within(sidebar()).findByRole('button', { name: /switch team|Choose a team/ }));
    await userEvent.click(within(sidebar()).getByRole('button', { name: 'New team' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('textbox')).toHaveLength(1);
    await userEvent.type(within(dialog).getByLabelText('Team name'), 'Dungeons');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add team' }));
    await waitFor(() => expect(client.rpcs).toContainEqual(['create_team', { p_guild_id: 1, p_name: 'Dungeons' }]));
    expect(await within(sidebar()).findByRole('button', { name: 'Dungeons, switch team' })).toBeInTheDocument();
  });

  it('refuses an empty name without asking the database', async () => {
    const { client } = renderApp('/g/wga/settings/teams', signedIn({ guildOfficer: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'New team' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add team' }));
    expect(await screen.findByText('Give the team a name of up to 60 characters.')).toBeInTheDocument();
    expect(client.rpcs.some(([name]) => name === 'create_team')).toBe(false);
  });
});

describe('unlisted teams', () => {
  const switcherTeams = async () => {
    await userEvent.click(await within(sidebar()).findByRole('button', { name: /switch team|Choose a team/ }));
    return within(sidebar())
      .getAllByRole('link')
      .map((a) => a.textContent);
  };

  it('are left out of the switcher for someone not on them, a guild officer included', async () => {
    renderApp('/g/wga', signedIn({ guildOfficer: true }));
    const names = await switcherTeams();
    expect(names).toContain('Phoenix');
    expect(names).not.toContain('Sandbox');
  });

  it('are left off Guild home for someone not on them', async () => {
    renderApp('/g/wga', signedIn({ guildOfficer: true }));
    const main = screen.getByRole('main');
    expect(await within(main).findByText('Phoenix')).toBeInTheDocument();
    expect(within(main).queryByText('Sandbox')).not.toBeInTheDocument();
  });

  it('show in the switcher of their own members', async () => {
    renderApp('/g/wga', signedIn({ guildOfficer: false, memberOf: [3] }));
    await waitFor(async () => expect(await switcherTeams()).toContain('Sandbox'));
  });

  it('still open by their address', async () => {
    renderApp('/g/wga/t/sandbox', signedIn({ guildOfficer: false }));
    expect(await within(sidebar()).findByRole('button', { name: 'Sandbox, switch team' })).toBeInTheDocument();
  });
});
