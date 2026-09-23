import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// The /join/<code> page (#1264 step 3). team_invite_link_join is mocked: the
// database function lands in its own PR.

const TARGET = { team_id: 1, team_name: 'Phoenix', team_slug: 'phoenix', guild_id: 1, guild_name: 'WGA' };
const CHARACTER = {
  blizzard_id: 1,
  name: 'Katorri',
  realm: 'Stormrage',
  realm_slug: 'stormrage',
  class_name: 'Priest',
  spec_name: 'Holy',
  level: 90,
  item_level: 640,
  saved: false,
  roster: null
};

function handlers(opts: { target?: boolean; signedIn?: boolean; outcome?: 'joined' | 'waiting' } = {}): FakeHandlers {
  const { target = true, signedIn = true, outcome = 'joined' } = opts;
  const base = seededHandlers();
  return seededHandlers({
    ...(signedIn ? { session: fakeSession({ battlenet: 'K#1', discord: { id: 'd', name: 'Kat' } }) } : {}),
    rpc(name) {
      if (name === 'team_invite_link_resolve') return { data: target ? [TARGET] : [] };
      if (name === 'team_invite_link_join') return { data: { outcome } };
      return base.rpc!(name, {});
    },
    invoke: () => ({ data: { characters: [CHARACTER], roster: [] } })
  });
}

describe('the Join page', () => {
  it('says a reset or expired link does not work', async () => {
    renderApp('/join/phoenix-dead', handlers({ target: false, signedIn: false }));
    expect(await screen.findByRole('heading', { name: 'This link doesn’t work' })).toBeInTheDocument();
  });

  it('names the team and guild and offers Battle.net sign-in to a visitor', async () => {
    renderApp('/join/phoenix-abc', handlers({ signedIn: false }));
    expect(await screen.findByRole('heading', { name: 'Join Phoenix (WGA)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Battle.net' })).toBeInTheDocument();
  });

  it('asks a signed-in person without a token to load their characters', async () => {
    renderApp('/join/phoenix-abc', handlers());
    expect(await screen.findByRole('button', { name: 'Load your characters from Battle.net' })).toBeInTheDocument();
  });

  it('joins with the picked character and links to the team', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/join/phoenix-abc', handlers(), { battlenetToken: 'tok' });
    const join = await screen.findByRole('button', { name: 'Join Phoenix' });
    expect(join).toBeDisabled();
    await user.click(await screen.findByRole('radio', { name: /Katorri/ }));
    await user.click(join);
    expect(await screen.findByRole('heading', { name: 'You’re on the roster' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Phoenix' })).toHaveAttribute('href', '/g/wga/t/phoenix');
    expect(client.rpcs).toContainEqual([
      'team_invite_link_join',
      { p_code: 'phoenix-abc', p_name: 'Katorri', p_realm: 'Stormrage', p_class: 'Priest', p_spec: 'Holy' }
    ]);
  });

  it('says so when the team is at its character limit', async () => {
    const user = userEvent.setup();
    renderApp('/join/phoenix-abc', handlers({ outcome: 'waiting' }), { battlenetToken: 'tok' });
    await user.click(await screen.findByRole('radio', { name: /Katorri/ }));
    await user.click(screen.getByRole('button', { name: 'Join Phoenix' }));
    expect(await screen.findByRole('heading', { name: 'You’ve joined Phoenix' })).toBeInTheDocument();
    expect(screen.getByText(/roster is full/)).toBeInTheDocument();
  });
});
