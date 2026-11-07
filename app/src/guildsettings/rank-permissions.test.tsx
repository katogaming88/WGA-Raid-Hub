import { describe, it, expect } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// The guild's rank permissions grid (#1652).
const DEFAULTS = [
  { permission: 'create_teams', default_ranks: ['team_lead', 'admin'] },
  { permission: 'record_boe', default_ranks: ['admin'] },
  { permission: 'export_guild_data', default_ranks: [] }
];

function signedIn(opts: { me: 'owner' | 'admin'; refuse?: string; permissions?: string[] }): FakeHandlers {
  const base = seededHandlers();
  // The stored grid: a save below changes it, as the database would.
  let on = [
    { rank: 'team_lead', permission: 'create_teams' },
    { rank: 'admin', permission: 'create_teams' },
    { rank: 'admin', permission: 'record_boe' }
  ];
  return {
    ...base,
    session: fakeSession({ discord: { id: 'discord-x', name: 'Someone' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'my_permissions' && opts.permissions) return { data: { team: [], guild: opts.permissions } };
      if (name === 'resolve_person') {
        // Someone with no team of their own cannot open the guild's pages at all.
        return {
          data: {
            site_admin: false,
            guild_officer: true,
            boe_manager: false,
            teams: [{ team_id: 1, team_member_id: 1, role: 'raider', characters: [] }]
          }
        };
      }
      if (name === 'guild_members') {
        return {
          data: [
            {
              person_id: 1,
              display_name: 'Katorri',
              rank: opts.me,
              is_you: true,
              teams: [],
              last_sign_in: null,
              characters: []
            }
          ]
        };
      }
      if (name === 'set_guild_rank_permissions') {
        if (opts.refuse) return { data: null, error: { message: opts.refuse } };
        for (const c of args['p_changes'] as { rank: string; permission: string; on: boolean }[]) {
          on = on.filter((r) => r.rank !== c.rank || r.permission !== c.permission);
          if (c.on) on.push({ rank: c.rank, permission: c.permission });
        }
        return { data: null };
      }
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'guild_rank_permissions') return { data: [...on] };
      if (read.table === 'rank_permissions') return { data: DEFAULTS };
      return base.from!(read);
    }
  };
}

const PATH = '/g/wga/settings/rank-permissions';
const box = (name: string) => screen.findByRole('checkbox', { name });
const sent = (client: { rpcs: unknown[][] }) => client.rpcs.filter(([name]) => name === 'set_guild_rank_permissions');

describe('the Owner', () => {
  it('sees the stored ticks in Member, Team Lead and Admin columns, with Owner fixed', async () => {
    renderApp(PATH, signedIn({ me: 'owner' }));
    expect(await box('Admin: Record BoE listings and sales')).toBeChecked();
    expect(await box('Member: Record BoE listings and sales')).not.toBeChecked();
    expect(await box('Team Lead: Create teams')).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /^Owner:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Owner' })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /hand over ownership/ })).toBeInTheDocument();
  });

  it('does not show Export guild data, which no guild export backs yet', async () => {
    renderApp(PATH, signedIn({ me: 'owner' }));
    await box('Admin: Create teams');
    expect(screen.queryByText(/Export guild data/)).not.toBeInTheDocument();
  });

  it('saves only what changed, then has nothing left to save', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, signedIn({ me: 'owner' }));
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.click(await box('Admin: Record BoE listings and sales'));
    await user.click(await box('Member: Create teams'));
    expect(screen.getByText('2 changes not saved.')).toBeInTheDocument();
    await user.click(save);
    expect(await screen.findByText('No changes.')).toBeInTheDocument();
    expect(sent(client)).toEqual([
      [
        'set_guild_rank_permissions',
        {
          p_guild_id: 1,
          p_changes: [
            { rank: 'member', permission: 'create_teams', on: true },
            { rank: 'admin', permission: 'record_boe', on: false }
          ]
        }
      ]
    ]);
    expect(await box('Admin: Record BoE listings and sales')).not.toBeChecked();
    expect(save).toBeDisabled();
  });

  it('ticking a box and unticking it again is no change', async () => {
    const user = userEvent.setup();
    renderApp(PATH, signedIn({ me: 'owner' }));
    const member = await box('Member: Create teams');
    await user.click(member);
    await user.click(member);
    expect(screen.getByText('No changes.')).toBeInTheDocument();
  });

  it('Discard changes goes back to what is saved, without asking the database', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, signedIn({ me: 'owner' }));
    await user.click(await box('Admin: Record BoE listings and sales'));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await box('Admin: Record BoE listings and sales')).toBeChecked();
    expect(sent(client)).toEqual([]);
  });

  it('Reset to defaults ticks the defaults, and saves only once Save is clicked', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(PATH, signedIn({ me: 'owner' }));
    const reset = await screen.findByRole('button', { name: 'Reset to defaults' });
    expect(reset).toBeDisabled();
    await user.click(await box('Admin: Record BoE listings and sales'));
    await user.click(reset);
    expect(await box('Admin: Record BoE listings and sales')).toBeChecked();
    expect(screen.getByText('No changes.')).toBeInTheDocument();
    expect(sent(client)).toEqual([]);
  });

  it('keeps the unsaved ticks and says why when the database refuses', async () => {
    const user = userEvent.setup();
    renderApp(PATH, signedIn({ me: 'owner', refuse: 'Not authorized' }));
    await user.click(await box('Admin: Record BoE listings and sales'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText(/Could not save rank permissions: Not authorized/)).not.toHaveLength(0);
    expect(await box('Admin: Record BoE listings and sales')).not.toBeChecked();
    expect(screen.getByText('1 change not saved.')).toBeInTheDocument();
  });
});

describe('an Admin', () => {
  it('reads the grid with every box locked and nothing to save', async () => {
    renderApp(PATH, signedIn({ me: 'admin' }));
    expect(await box('Admin: Record BoE listings and sales')).toBeDisabled();
    expect(screen.getByText('Only the Owner can change these.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });
});

describe('what the grid can leave someone with', () => {
  const nav = () => within(screen.getByRole('navigation', { name: 'Guild settings' }));

  it('only Change Team Owner: the Teams tab opens with that button and nothing else', async () => {
    renderApp('/g/wga/settings', signedIn({ me: 'admin', permissions: ['change_team_owner'] }));
    expect(await screen.findByRole('button', { name: 'Change Team Owner of Phoenix' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Unlisted/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New team' })).not.toBeInTheDocument();
    expect(
      nav()
        .getAllByRole('link')
        .map((a) => a.textContent)
    ).toEqual(['Teams']);
  });

  it('only Edit guild profile: /settings opens on Members and Teams is not offered', async () => {
    renderApp('/g/wga/settings', signedIn({ me: 'admin', permissions: ['edit_guild_profile'] }));
    expect(await screen.findByRole('heading', { name: 'Members' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        nav()
          .getAllByRole('link')
          .map((a) => a.textContent)
      ).toEqual(['Members', 'Rank permissions'])
    );
    expect(
      within(screen.getByRole('complementary', { name: 'Site' })).getByRole('link', { name: 'Guild settings' })
    ).toBeInTheDocument();
  });

  it('nothing on the grid: the page says who it is for', async () => {
    renderApp(PATH, signedIn({ me: 'admin', permissions: [] }));
    expect(await screen.findByText("This page is for the guild's Owner and Admins.")).toBeInTheDocument();
  });
});
