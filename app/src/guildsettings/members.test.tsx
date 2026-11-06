import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import type { GuildMember } from './useMembers';

// The guild's Members tab (#1650). The database functions it calls come in a
// migration of their own, so they are answered here.
const MEMBERS: GuildMember[] = [
  {
    person_id: 1,
    display_name: 'Katorri',
    rank: 'owner',
    is_you: true,
    teams: [{ team_id: 1, name: 'Phoenix', rank: 'owner' }],
    last_sign_in: '2026-11-05T12:00:00Z',
    characters: ['Katorri-Stormrage']
  },
  {
    person_id: 2,
    display_name: 'Rex',
    rank: 'admin',
    is_you: false,
    teams: [{ team_id: 2, name: 'Hellfire Rollers', rank: 'raider' }],
    last_sign_in: null,
    characters: ['Rexgar-Stormrage']
  },
  { person_id: 3, display_name: 'Mira', rank: 'member', is_you: false, teams: [], last_sign_in: null, characters: [] }
];

// `me`: which of MEMBERS is signed in. An Admin or the Owner is a guild
// officer, so the default grids give them the tab.
function signedIn(opts: { me: 1 | 2 | 3; refuse?: string }): FakeHandlers {
  const base = seededHandlers();
  return {
    ...base,
    session: fakeSession({ discord: { id: 'discord-x', name: 'Someone' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') {
        return {
          data: {
            site_admin: false,
            guild_officer: opts.me !== 3,
            boe_manager: false,
            // Someone with no team of their own cannot open the guild's pages at all.
            teams: [{ team_id: 1, team_member_id: 1, role: 'raider', characters: [] }]
          }
        };
      }
      if (name === 'guild_members') {
        return { data: MEMBERS.map((m) => ({ ...m, is_you: m.person_id === opts.me })) };
      }
      if (name === 'set_guild_rank' || name === 'transfer_guild_ownership') {
        return opts.refuse ? { data: null, error: { message: opts.refuse } } : { data: null };
      }
      return base.rpc!(name, args);
    }
  };
}

describe('the Members tab', () => {
  it('lists everyone with their rank, and has its own tab', async () => {
    renderApp('/g/wga/settings/members', signedIn({ me: 1 }));
    const rex = (await screen.findByText('Rex', { selector: '.guildsettings-name' })).closest('tr')!;
    expect(within(rex).getByText('Admin')).toBeInTheDocument();
    expect(within(rex).getByText('Hellfire Rollers')).toBeInTheDocument();
    expect(within(rex).getByText('Never')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('(you)')).toBeInTheDocument();
  });

  it('is closed to someone with no guild rank', async () => {
    renderApp('/g/wga/settings/members', signedIn({ me: 3 }));
    expect(await screen.findByText("This page is for the guild's Owner and Admins.")).toBeInTheDocument();
  });

  it('lets the Owner promote and demote', async () => {
    const { client } = renderApp('/g/wga/settings/members', signedIn({ me: 1 }));
    await userEvent.selectOptions(await screen.findByLabelText('Guild rank for Mira'), 'Team Lead');
    await waitFor(() =>
      expect(client.rpcs).toContainEqual(['set_guild_rank', { p_guild_id: 1, p_person_id: 3, p_rank: 'team_lead' }])
    );
  });

  it('searches by name or character, and filters by guild rank', async () => {
    renderApp('/g/wga/settings/members', signedIn({ me: 1 }));
    await screen.findByText('Mira', { selector: '.guildsettings-name' });
    await userEvent.type(screen.getByLabelText('Search'), 'rexgar');
    expect(screen.getByText('Rex', { selector: '.guildsettings-name' })).toBeInTheDocument();
    expect(screen.queryByText('Mira', { selector: '.guildsettings-name' })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search'));
    await userEvent.selectOptions(screen.getByLabelText('Guild rank'), 'Member');
    expect(screen.getByText('Mira', { selector: '.guildsettings-name' })).toBeInTheDocument();
    expect(screen.queryByText('Rex', { selector: '.guildsettings-name' })).not.toBeInTheDocument();
  });

  it('shows an Admin the list but no way to change it', async () => {
    renderApp('/g/wga/settings/members', signedIn({ me: 2 }));
    await screen.findByText('Mira', { selector: '.guildsettings-name' });
    expect(screen.queryByRole('button', { name: /Hand over/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Guild rank for/)).not.toBeInTheDocument();
  });

  it('says why when the database refuses a change', async () => {
    renderApp('/g/wga/settings/members', signedIn({ me: 1, refuse: 'Only the guild Owner can do that.' }));
    await userEvent.selectOptions(await screen.findByLabelText('Guild rank for Mira'), 'Admin');
    expect(await screen.findAllByText(/Only the guild Owner can do that/)).not.toHaveLength(0);
  });
});

describe('handing over ownership', () => {
  it("asks for the new Owner's name typed in before it sends anything", async () => {
    const { client } = renderApp('/g/wga/settings/members', signedIn({ me: 1 }));
    await userEvent.click(await screen.findByRole('button', { name: 'Hand over ownership to Rex' }));
    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Hand over ownership' });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Type Rex to confirm'), 'rex');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(client.rpcs).toContainEqual(['transfer_guild_ownership', { p_guild_id: 1, p_person_id: 2 }])
    );
  });
});
