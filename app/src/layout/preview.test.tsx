import { describe, it, expect, afterEach, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// The preview shows only the test team to anyone but a site admin (#1676).
const TEAMS = [
  { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null, unlisted: false },
  { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', archived_at: null, unlisted: false },
  { id: 3, name: 'Sandbox', slug: 'sandbox', archived_at: null, unlisted: true }
];

// Officer of Phoenix and of the Sandbox, as a real officer testing would be.
function signedIn(opts: { siteAdmin?: boolean; guildOfficer?: boolean } = {}): FakeHandlers {
  const base = seededHandlers();
  return {
    ...base,
    session: fakeSession({ discord: { id: 'discord-x', name: 'Someone' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person') {
        return {
          data: {
            site_admin: opts.siteAdmin ?? false,
            guild_officer: opts.guildOfficer ?? false,
            boe_manager: false,
            teams: [1, 3].map((id) => ({ team_id: id, team_member_id: id, role: 'officer', characters: [] }))
          }
        };
      }
      if (name === 'resolve_address' && args['p_team_key'] === 'sandbox') {
        return {
          data: [{ guild_id: 1, guild_key: 'wga', team_id: 3, team_key: 'sandbox', is_canonical: true }]
        };
      }
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === 'teams') return { data: TEAMS };
      return base.from!(read);
    }
  };
}

const sidebar = () => screen.getByRole('complementary', { name: 'Site' });

async function switcherTeams() {
  const button = await within(sidebar()).findByRole('button', { name: /switch team|Choose a team/ });
  await userEvent.click(button);
  const list = document.getElementById(button.getAttribute('aria-controls')!)!;
  return within(list)
    .getAllByRole('link')
    .map((a) => a.textContent);
}

afterEach(() => vi.unstubAllEnvs());

describe('the preview with a test team set', () => {
  it('a tester sees only the Sandbox, with no BoE or Guild settings', async () => {
    vi.stubEnv('VITE_PREVIEW_TEAMS', 'sandbox');
    renderApp('/g/wga/t/sandbox', signedIn({ guildOfficer: true }));
    expect(await switcherTeams()).toEqual(['Sandbox']);
    expect(within(sidebar()).queryByRole('link', { name: 'BoE sales' })).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole('link', { name: 'Guild settings' })).not.toBeInTheDocument();
    expect(within(sidebar()).queryByRole('button', { name: 'New team' })).not.toBeInTheDocument();
  });

  for (const path of ['/g/wga/t/phoenix/roster', '/g/wga/boe', '/g/wga/settings/teams']) {
    it(`${path} shows "not part of the test" with a way to the Sandbox`, async () => {
      vi.stubEnv('VITE_PREVIEW_TEAMS', 'sandbox');
      renderApp(path, signedIn({ guildOfficer: true }));
      expect(await screen.findByRole('heading', { name: 'Not part of the test' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Go to the Sandbox' })).toHaveAttribute('href', '/g/wga/t/sandbox');
    });
  }

  it('the sidebar team links go to the Sandbox from a guild page', async () => {
    vi.stubEnv('VITE_PREVIEW_TEAMS', 'sandbox');
    renderApp('/g/wga', signedIn());
    expect(await within(sidebar()).findByRole('link', { name: 'Roster' })).toHaveAttribute(
      'href',
      '/g/wga/t/sandbox/roster'
    );
  });

  it('signed out, a real team is not part of the test either', async () => {
    vi.stubEnv('VITE_PREVIEW_TEAMS', 'sandbox');
    renderApp('/g/wga/t/phoenix', seededHandlers());
    expect(await screen.findByRole('heading', { name: 'Not part of the test' })).toBeInTheDocument();
  });

  it('a site admin sees every team and BoE as today', async () => {
    vi.stubEnv('VITE_PREVIEW_TEAMS', 'sandbox');
    renderApp('/g/wga/t/phoenix/roster', signedIn({ siteAdmin: true }));
    expect(await switcherTeams()).toEqual(['Phoenix', 'Hellfire Rollers', 'Sandbox']);
    expect(screen.queryByRole('heading', { name: 'Not part of the test' })).not.toBeInTheDocument();
    expect(within(sidebar()).getByRole('link', { name: 'BoE sales' })).toBeInTheDocument();
  });
});

describe('with no test team set', () => {
  for (const value of [undefined, '', ' , ']) {
    it(`every team shows, as today (${JSON.stringify(value)})`, async () => {
      if (value !== undefined) vi.stubEnv('VITE_PREVIEW_TEAMS', value);
      renderApp('/g/wga/t/phoenix/roster', signedIn());
      expect(await switcherTeams()).toEqual(['Phoenix', 'Hellfire Rollers', 'Sandbox']);
      expect(screen.queryByRole('heading', { name: 'Not part of the test' })).not.toBeInTheDocument();
      expect(within(sidebar()).getByRole('link', { name: 'BoE sales' })).toBeInTheDocument();
    });
  }
});
