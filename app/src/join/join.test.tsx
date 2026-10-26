import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';

// The /join/<code> page (#1264 step 3; #1355's Member step), against a fake
// team that remembers what the page did: joining, claiming, making a Member
// and putting a character on the roster.

const TARGET = { team_id: 1, team_name: 'Phoenix', team_slug: 'phoenix', guild_id: 1, guild_name: 'WGA' };
const CHARACTER = {
  blizzard_id: 1,
  name: 'Katorri',
  realm: 'Stormrage',
  realm_slug: 'stormrage',
  class_name: 'Warlock',
  spec_name: 'Demonology',
  level: 90,
  item_level: 640,
  saved: false,
  roster: null
};
const MEMBER_ID = 50;

type World = {
  member: boolean;
  name: 'none' | 'bare' | 'mine';
  onRoster: boolean;
};

function handlers(
  opts: { target?: boolean; signedIn?: boolean; outcome?: 'joined' | 'waiting'; world?: Partial<World> } = {}
): FakeHandlers & { world: World } {
  const { target = true, signedIn = true, outcome = 'joined' } = opts;
  const world: World = { member: false, name: 'none', onRoster: false, ...opts.world };
  const base = seededHandlers();
  return {
    world,
    ...seededHandlers({
      ...(signedIn ? { session: fakeSession({ battlenet: 'K#1', discord: { id: 'd', name: 'Kat' } }) } : {}),
      rpc(name, args) {
        if (name === 'team_invite_link_resolve') return { data: target ? [TARGET] : [] };
        if (name === 'current_discord_id') return { data: 'd' };
        if (name === 'resolve_person') {
          const characters = world.onRoster
            ? [{ player_id: 1, name_realm: 'Katorri-Stormrage', url_code: 'k1', archived_at: null }]
            : [];
          return {
            data: {
              teams: world.member ? [{ team_id: 1, team_member_id: MEMBER_ID, role: 'raider', characters }] : []
            }
          };
        }
        if (name === 'team_invite_link_join') {
          world.member = true;
          if (args['p_blizzard_id'] !== null && outcome === 'joined') world.onRoster = true;
          return { data: outcome };
        }
        if (name === 'claim_name' || name === 'create_own_name') {
          world.name = 'mine';
          return { data: null };
        }
        return base.rpc!(name, args);
      },
      from(read) {
        if (read.table === 'names') {
          if (world.name === 'none') return { data: [] };
          return {
            data: [
              {
                id: 5,
                label: 'Katorri',
                team_member_id: world.name === 'mine' ? MEMBER_ID : null,
                role: null
              }
            ]
          };
        }
        return base.from!(read);
      },
      invoke: () => ({ data: { characters: [CHARACTER], roster: [] } })
    })
  };
}

// Signed in, already on the team and holding a Member: straight to the pick.
const atPicker = (opts: Parameters<typeof handlers>[0] = {}) =>
  handlers({ ...opts, world: { member: true, name: 'mine', ...opts.world } });

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

  it('asks for Discord first when the account has none', async () => {
    const noDiscord = { ...handlers(), session: fakeSession({ battlenet: 'K#1' }) };
    renderApp('/join/phoenix-abc', noDiscord, { battlenetToken: 'tok' });
    expect(await screen.findByRole('button', { name: 'Connect Discord' })).toBeInTheDocument();
  });

  it('joins the team with no character, then asks which Member is you', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/join/phoenix-abc', handlers({ world: { name: 'bare' } }), {
      battlenetToken: 'tok'
    });
    await user.click(await screen.findByRole('button', { name: 'Join Phoenix' }));
    expect(client.rpcs).toContainEqual(['team_invite_link_join', { p_code: 'phoenix-abc', p_blizzard_id: null }]);
    expect(await screen.findByRole('heading', { name: 'Which Member is you?' })).toBeInTheDocument();
  });

  it('claims a Member an officer made, then shows the character pick', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/join/phoenix-abc', handlers({ world: { member: true, name: 'bare' } }), {
      battlenetToken: 'tok'
    });
    await user.click(await screen.findByRole('button', { name: 'That’s me' }));
    expect(client.rpcs).toContainEqual(['claim_name', { p_team_id: 1, p_name_id: 5 }]);
    expect(await screen.findByRole('radio', { name: /Katorri/ })).toBeInTheDocument();
  });

  it('makes their own Member when not listed, starting from their Discord name', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/join/phoenix-abc', handlers({ world: { member: true } }), {
      battlenetToken: 'tok'
    });
    const field = await screen.findByRole('textbox', { name: 'Not listed? Your name' });
    expect(field).toHaveValue('Kat');
    await user.clear(field);
    await user.type(field, 'Katorri');
    await user.click(screen.getByRole('button', { name: 'Make my Member' }));
    expect(client.rpcs).toContainEqual(['create_own_name', { p_team_id: 1, p_label: 'Katorri' }]);
    expect(await screen.findByRole('radio', { name: /Katorri/ })).toBeInTheDocument();
  });

  it('lets them skip the Member step', async () => {
    const user = userEvent.setup();
    renderApp('/join/phoenix-abc', handlers({ world: { member: true } }), { battlenetToken: 'tok' });
    await user.click(await screen.findByRole('button', { name: 'Skip for now' }));
    expect(await screen.findByRole('radio', { name: /Katorri/ })).toBeInTheDocument();
  });

  it('asks a member without a token to load their characters', async () => {
    renderApp('/join/phoenix-abc', atPicker());
    expect(await screen.findByRole('button', { name: 'Load your characters from Battle.net' })).toBeInTheDocument();
  });

  it('puts the picked character on the roster and links to the team', async () => {
    const user = userEvent.setup();
    const { client } = renderApp('/join/phoenix-abc', atPicker(), { battlenetToken: 'tok' });
    const join = await screen.findByRole('button', { name: 'Join Phoenix' });
    expect(join).toBeDisabled();
    await user.click(await screen.findByRole('radio', { name: /Katorri/ }));
    await user.click(join);
    expect(await screen.findByRole('heading', { name: 'You’re on the roster' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Phoenix' })).toHaveAttribute('href', '/g/wga/t/phoenix');
    // The pick is saved first, which is what confirms it against Battle.net,
    // and the join then names it by its Battle.net id (#1319).
    expect(client.authCalls).toContainEqual([
      'invoke',
      ['battlenet-characters', { body: { token: 'tok', save: [1], allLevels: true } }]
    ]);
    expect(client.rpcs).toContainEqual(['team_invite_link_join', { p_code: 'phoenix-abc', p_blizzard_id: 1 }]);
  });

  it('says they are on the roster when they already have a character there', async () => {
    renderApp('/join/phoenix-abc', atPicker({ world: { onRoster: true } }), { battlenetToken: 'tok' });
    expect(await screen.findByRole('heading', { name: 'You’re on the roster' })).toBeInTheDocument();
  });

  it('keeps the characters already saved when it saves the pick', async () => {
    const user = userEvent.setup();
    const withAlt = {
      ...atPicker(),
      invoke: () => ({
        data: { characters: [{ ...CHARACTER, blizzard_id: 7, name: 'Altchar', saved: true }, CHARACTER], roster: [] }
      })
    };
    const { client } = renderApp('/join/phoenix-abc', withAlt, { battlenetToken: 'tok' });
    await user.click(await screen.findByRole('radio', { name: /Katorri/ }));
    await user.click(screen.getByRole('button', { name: 'Join Phoenix' }));
    await screen.findByRole('heading', { name: 'You’re on the roster' });
    // A bare [pick] would delete the alt: the save replaces the whole set.
    expect(client.authCalls).toContainEqual([
      'invoke',
      ['battlenet-characters', { body: { token: 'tok', save: [7, 1], allLevels: true } }]
    ]);
  });

  it('does not join when Battle.net cannot confirm the character', async () => {
    const user = userEvent.setup();
    let seen = 0;
    const refuses = {
      ...atPicker(),
      invoke: () =>
        seen++ === 0
          ? { data: { characters: [CHARACTER], roster: [] } }
          : { error: { message: 'Battle.net sign-in has expired' } }
    };
    const { client } = renderApp('/join/phoenix-abc', refuses, { battlenetToken: 'tok' });
    await user.click(await screen.findByRole('radio', { name: /Katorri/ }));
    await user.click(screen.getByRole('button', { name: 'Join Phoenix' }));
    expect(await screen.findByText(/could not confirm that character/i)).toBeInTheDocument();
    expect(client.rpcs.map(([name]) => name)).not.toContain('team_invite_link_join');
  });

  it('says so when the team is at its character limit', async () => {
    const user = userEvent.setup();
    renderApp('/join/phoenix-abc', atPicker({ outcome: 'waiting' }), { battlenetToken: 'tok' });
    await user.click(await screen.findByRole('radio', { name: /Katorri/ }));
    await user.click(screen.getByRole('button', { name: 'Join Phoenix' }));
    expect(await screen.findByRole('heading', { name: 'You’ve joined Phoenix' })).toBeInTheDocument();
    expect(screen.getByText(/roster is full/)).toBeInTheDocument();
  });
});
