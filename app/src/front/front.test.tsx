import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { ADDON_URL, SUPPORT_DISCORD_URL } from '../config';

// The site front page (#1226): the same page for everyone, in the app frame.

const HEADLINE = 'Your raid team’s loot, roster and raid nights, in one place.';
const ON_A_TEAM = {
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [{ team_id: 1, team_member_id: 1, role: 'raider', characters: [] }]
};

function withRpc(answers: Record<string, unknown>, session?: ReturnType<typeof fakeSession>): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    ...(session ? { session } : {}),
    rpc(name, args) {
      if (name in answers) return { data: answers[name] };
      return base.rpc!(name, args);
    }
  });
}

const sidebar = () => screen.getByRole('complementary', { name: 'Site' });

describe('the site front page', () => {
  it('shows the pitch, the closed sign-up box and the support Discord while guild creation is off', async () => {
    const { router } = renderApp('/', seededHandlers());
    expect(await screen.findByRole('heading', { level: 1, name: HEADLINE })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(screen.getByText('New guilds can’t sign up yet')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create your guild' })).not.toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: /Ask in the support Discord/ })) {
      expect(link).toHaveAttribute('href', SUPPORT_DISCORD_URL);
    }
    expect(screen.getByRole('link', { name: /RCLootCouncil/ })).toHaveAttribute('href', ADDON_URL);
  });

  it('keeps its headings in order: h1, then h2 sections with the four week cards as h3', async () => {
    renderApp('/', seededHandlers());
    await screen.findByRole('heading', { level: 1, name: HEADLINE });
    // The sidebar's group headings are h2s too; only the page's own count here.
    const main = within(screen.getByRole('main'))
      .getAllByRole('heading')
      .map((h) => Number(h.tagName.slice(1)));
    expect(main).toEqual([1, 2, 2, 3, 3, 3, 3, 2, 2]);
  });

  it('shows to a person on a team too, instead of sending them to their guild', async () => {
    const { router } = renderApp(
      '/',
      withRpc(
        { current_discord_id: 'discord-ana', resolve_person: ON_A_TEAM },
        fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } })
      )
    );
    expect(await screen.findByRole('heading', { level: 1, name: HEADLINE })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('opens from the WGA Raid Hub title at the top of the sidebar', async () => {
    renderApp('/about');
    const title = await within(sidebar()).findByRole('link', { name: /^WGA Raid Hub/ });
    expect(title).toHaveAttribute('href', '/');
  });
});
