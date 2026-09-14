import { describe, it, expect, afterEach } from 'vitest';
import { screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { setErrorReporter } from '../lib/errors';
import { can, toAccess, NO_ACCESS, type Access } from './access';
import { isAlreadyLinked, readAuthError, userFromSession } from './session';
import type { Session } from '@supabase/supabase-js';

afterEach(() => setErrorReporter(null));

const OFFICER = fakeSession({ battlenet: 'Kato#1499', discord: { id: 'discord-officer-1', name: 'Phoenix Officer' } });

// The seeded world, signed in as someone resolve_person() describes.
function signedIn(session: unknown, person: unknown, extra: FakeHandlers = {}): FakeHandlers {
  const base = seededHandlers();
  return {
    ...base,
    session,
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: person ? 'discord-x' : null };
      if (name === 'resolve_person') return { data: person };
      return base.rpc!(name, args);
    },
    ...extra
  };
}

type PersonCharacter = { player_id: number; name_realm: string; url_code: string; archived_at: string | null };

const person = (
  role: string,
  characters: PersonCharacter[] = [
    { player_id: 1, name_realm: 'Seedofficer-Illidan', url_code: 'abc', archived_at: null }
  ]
) => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [{ team_id: 1, team_member_id: 1, role, characters }]
});

const sidebar = () => screen.getByRole('complementary', { name: 'Site' });

describe('signed out', () => {
  it('offers Battle.net first and Discord second, and Battle.net starts an OAuth sign-in back to this page', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/roster');
    await screen.findByRole('heading', { level: 1, name: 'Roster' });
    await userEvent.click(within(sidebar()).getByRole('button', { name: 'Sign in with Battle.net' }));
    expect(within(sidebar()).getByRole('button', { name: 'Sign in with Discord' })).toBeInTheDocument();
    expect(client.authCalls[0]).toEqual([
      'signInWithOAuth',
      { provider: 'custom:battlenet', options: { redirectTo: 'http://localhost:3000/' } }
    ]);
  });

  it('hides the Officer group and closes officer pages with a sign-in message', async () => {
    renderApp('/g/wga/t/phoenix/officer/priority');
    expect(await screen.findByRole('heading', { level: 1, name: 'Loot priority' })).toBeInTheDocument();
    expect(screen.getByText('Sign in to see this page. It is for officers.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Officer' })).not.toBeInTheDocument();
  });
});

describe('signed in', () => {
  it('shows who is signed in with their role and main on this team', async () => {
    renderApp('/g/wga/t/phoenix', signedIn(OFFICER, person('officer')));
    expect(await within(sidebar()).findByText('Officer · Seedofficer')).toBeInTheDocument();
    expect(within(sidebar()).getByText('Phoenix Officer')).toBeInTheDocument();
  });

  it('loads roles through resolve_person() with the id current_discord_id() answers', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', signedIn(OFFICER, person('officer')));
    await within(sidebar()).findByText('Officer · Seedofficer');
    expect(client.rpcs).toContainEqual(['resolve_person', { p_discord_id: 'discord-x' }]);
  });

  it('opens officer pages and the Officer group for an officer of this team', async () => {
    renderApp('/g/wga/t/phoenix/officer/priority', signedIn(OFFICER, person('officer')));
    expect(
      await screen.findByText('Not built yet. This page arrives in a later part of the rebuild.')
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Officer' })).toBeInTheDocument();
  });

  it('keeps officer pages closed to a raider, naming the team', async () => {
    renderApp('/g/wga/t/phoenix/officer/priority', signedIn(OFFICER, person('raider')));
    expect(await screen.findByText('This page is for officers of Phoenix.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Officer' })).not.toBeInTheDocument();
  });

  it('does not carry an officer role on one team to another team', async () => {
    renderApp('/g/wga/t/hellfire/officer/priority', signedIn(OFFICER, person('officer')));
    expect(await screen.findByText('This page is for officers of Hellfire Rollers.')).toBeInTheDocument();
  });

  it('shows the access error in the sidebar with a retry, rather than hiding it', async () => {
    setErrorReporter(() => {});
    renderApp(
      '/g/wga/t/phoenix',
      signedIn(OFFICER, person('officer'), {
        rpc: (name) => (name === 'current_discord_id' ? { error: { message: 'boom' } } : { data: [] })
      })
    );
    expect(await within(sidebar()).findByText('Could not load your access')).toBeInTheDocument();
    expect(within(sidebar()).getByRole('button', { name: 'Retry loading access' })).toBeInTheDocument();
  });

  it('signs out', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', signedIn(OFFICER, person('officer')));
    await userEvent.click(await within(sidebar()).findByRole('button', { name: 'Sign out' }));
    expect(client.authCalls).toContainEqual(['signOut', undefined]);
    expect(await within(sidebar()).findByRole('button', { name: 'Sign in with Battle.net' })).toBeInTheDocument();
  });
});

describe('keeping both logins on one account', () => {
  const BATTLENET_ONLY = fakeSession({ battlenet: 'Aeglos#1234' });
  const DISCORD_ONLY = fakeSession({ discord: { id: 'd', name: 'Aeglos' } });

  it('asks a Battle.net-only account to connect Discord', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', signedIn(BATTLENET_ONLY, null));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Discord' }));
    expect(client.authCalls[0]).toEqual([
      'linkIdentity',
      { provider: 'discord', options: { redirectTo: 'http://localhost:3000/' } }
    ]);
  });

  it('asks a Discord-only account to connect Battle.net', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', signedIn(DISCORD_ONLY, person('raider')));
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Battle.net' }));
    expect(client.authCalls[0]?.[1]).toMatchObject({ provider: 'custom:battlenet' });
  });

  it('asks nothing of an account with both', async () => {
    renderApp('/g/wga/t/phoenix', signedIn(OFFICER, person('officer')));
    await within(sidebar()).findByText('Officer · Seedofficer');
    expect(screen.queryByRole('button', { name: /^Connect/ })).not.toBeInTheDocument();
  });

  it('switches an empty Battle.net account to Discord: removes it, signs out locally, signs in with Discord', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', signedIn(BATTLENET_ONLY, null));
    const trigger = await screen.findByRole('button', { name: 'Already use WGA Raid Hub with Discord?' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Use your Discord account' });
    expect(within(dialog).getByRole('button', { name: 'Switch to my Discord account' })).toHaveFocus();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Switch to my Discord account' }));
    await waitFor(() =>
      expect(client.authCalls.map(([name]) => name)).toEqual(['invoke', 'signOut', 'signInWithOAuth'])
    );
    expect(client.authCalls[0]).toEqual(['invoke', ['discard-empty-account', { method: 'POST' }]]);
    expect(client.authCalls[1]).toEqual(['signOut', { scope: 'local' }]);
    expect(client.authCalls[2]?.[1]).toMatchObject({ provider: 'discord' });
  });

  it('keeps the account and says why when the switch is refused', async () => {
    setErrorReporter(() => {});
    const { client } = renderApp(
      '/g/wga/t/phoenix',
      signedIn(BATTLENET_ONLY, null, {
        invoke: () => ({ error: { message: 'This account has data attached, so it was kept' } })
      })
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Already use WGA Raid Hub with Discord?' }));
    await userEvent.click(screen.getByRole('button', { name: 'Switch to my Discord account' }));
    expect(
      await screen.findByText(/Could not switch to your Discord account: This account has data attached/)
    ).toBeInTheDocument();
    expect(client.authCalls.map(([name]) => name)).toEqual(['invoke']);
  });

  it('offers the switch when connecting Discord was refused because that Discord has an account', async () => {
    renderApp('/g/wga/t/phoenix', signedIn(BATTLENET_ONLY, null), {
      authReturn: { intent: 'connect-discord', error: 'Identity is already linked to another user' }
    });
    expect(await screen.findByRole('dialog', { name: 'Use your Discord account' })).toBeInTheDocument();
  });

  it('finishes a switch by connecting Battle.net to the Discord account it landed on', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', signedIn(DISCORD_ONLY, person('raider')), {
      authReturn: { intent: 'switch-to-discord', error: null }
    });
    expect(await screen.findByText('Signed in with Discord. Connecting Battle.net…')).toBeInTheDocument();
    await waitFor(() => expect(client.authCalls[0]?.[1]).toMatchObject({ provider: 'custom:battlenet' }));
  });

  it('confirms a connection when the person comes back with it', async () => {
    renderApp('/g/wga/t/phoenix', signedIn(OFFICER, person('officer')), {
      authReturn: { intent: 'connect-battlenet', error: null }
    });
    const message = await screen.findByText('Battle.net connected.');
    expect(message.closest('[role="status"]')).not.toBeNull();
  });

  it('explains a Battle.net login that belongs to another account, and keeps the message until dismissed', async () => {
    renderApp('/g/wga/t/phoenix', signedIn(DISCORD_ONLY, person('raider')), {
      authReturn: { intent: 'connect-battlenet', error: 'Identity is already linked to another user' }
    });
    const message = await screen.findByText(/already connected to a different login/);
    const box = message.closest('.status-message') as HTMLElement;
    await userEvent.click(within(box).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/already connected to a different login/)).not.toBeInTheDocument();
  });
});

describe('the switch dialog', () => {
  it('keeps Tab inside, closes on Escape, and returns focus to what opened it', async () => {
    renderApp('/g/wga/t/phoenix', signedIn(fakeSession({ battlenet: 'Aeglos#1234' }), null));
    const trigger = await screen.findByRole('button', { name: 'Already use WGA Raid Hub with Discord?' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    for (let i = 0; i < 5; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe('session and access helpers', () => {
  it('reads both logins and the BattleTag off a session', () => {
    const user = userFromSession(OFFICER as unknown as Session);
    expect(user).toMatchObject({
      battleTag: 'Kato#1499',
      hasBattlenet: true,
      hasDiscord: true,
      name: 'Phoenix Officer'
    });
    expect(userFromSession(fakeSession({ battlenet: 'Aeglos#1234' }) as unknown as Session)?.name).toBe('Aeglos');
  });

  it('reads a refused link from the hash or the query', () => {
    expect(readAuthError({ hash: '#error_description=Identity+is+already+linked+to+another+user', search: '' })).toBe(
      'Identity is already linked to another user'
    );
    expect(readAuthError({ hash: '', search: '?error_description=nope' })).toBe('nope');
    expect(readAuthError({ hash: '#access_token=x', search: '' })).toBeNull();
    expect(isAlreadyLinked('Identity is already linked to another user')).toBe(true);
  });

  it('drops archived characters, which keep their link but are not claims', () => {
    const access = toAccess(
      person('raider', [
        { player_id: 1, name_realm: 'Live-Illidan', url_code: 'a', archived_at: null },
        { player_id: 2, name_realm: 'Gone-Illidan', url_code: 'b', archived_at: '2026-01-01' }
      ]),
      false
    );
    expect(access.teams[0]?.characters.map((c) => c.nameRealm)).toEqual(['Live-Illidan']);
  });

  it('answers each ability from the right grant', () => {
    const on = (patch: Partial<Access>): Access => ({ ...NO_ACCESS, ...patch });
    const team = (role: 'raider' | 'officer' | 'team_leader') =>
      on({ teams: [{ teamId: 1, teamMemberId: 1, role, characters: [] }] });

    expect(can(team('officer'), 'actAsOfficer', 1)).toBe(true);
    expect(can(team('officer'), 'actAsOfficer', 2)).toBe(false);
    expect(can(team('officer'), 'leadTeam', 1)).toBe(false);
    expect(can(team('team_leader'), 'leadTeam', 1)).toBe(true);
    expect(can(team('raider'), 'viewOfficerTools', 1)).toBe(false);
    expect(can(on({ guildOfficer: true }), 'viewOfficerTools', 2)).toBe(true);
    expect(can(on({ guildOfficer: true }), 'actAsOfficer', 2)).toBe(false);
    expect(can(on({ siteAdmin: true }), 'actAsOfficer', 2)).toBe(true);
    expect(can(on({ boeManager: true }), 'manageBoe')).toBe(true);
    expect(can(null, 'adminSite')).toBe(false);
  });
});
