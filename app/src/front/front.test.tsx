import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { SUPPORT_DISCORD_URL } from '../config';

// The site front page (#1226): who sees it, who is sent on.

const ON_A_TEAM = {
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [{ team_id: 1, team_member_id: 1, role: 'raider', characters: [] }]
};
const NO_TEAM = { site_admin: false, guild_officer: false, boe_manager: false, teams: [] };

function signedIn(person: unknown): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: person };
      return base.rpc!(name, args);
    }
  });
}

describe('the site front page', () => {
  it('shows a signed-out visitor what the Hub is, with Battle.net sign-in and the support Discord', async () => {
    const { router } = renderApp('/', seededHandlers());
    expect(await screen.findByRole('heading', { level: 1, name: 'WGA Raid Hub' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByRole('button', { name: 'Sign in with Battle.net' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ask on the support Discord/ })).toHaveAttribute(
      'href',
      SUPPORT_DISCORD_URL
    );
    expect(screen.getByRole('heading', { name: 'Loot priority' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument();
  });

  it('keeps its headings in order: h1, then h2 sections with h3 cards inside', async () => {
    renderApp('/', seededHandlers());
    await screen.findByRole('heading', { level: 1, name: 'WGA Raid Hub' });
    const levels = screen.getAllByRole('heading').map((h) => Number(h.tagName.slice(1)));
    expect(levels).toEqual([1, 2, 3, 3, 3, 3, 3, 3, 2]);
  });

  it('tells a signed-in person with no team to open an invite link, without a sign-in button', async () => {
    renderApp('/', signedIn(NO_TEAM));
    expect(await screen.findByRole('heading', { name: 'You’re not on a team yet' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in with Battle.net' })).not.toBeInTheDocument();
  });

  it('sends a person on a team to the default guild’s home (their own guild once resolve_person() carries it)', async () => {
    const { router } = renderApp('/', signedIn(ON_A_TEAM));
    expect(await screen.findByRole('heading', { level: 1, name: 'We Go Again' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/g/wga');
  });
});
