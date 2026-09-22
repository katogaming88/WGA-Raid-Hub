import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';

// The Sign Up page (#1102), ported from js/signup.js.

const OPEN_SEASON = { season_code: 'MID3', signups_open: true, seasons: { starts_at: '2099-01-01' } };

const person = (nameRealm: string | null) => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role: 'raider',
      characters: nameRealm ? [{ player_id: 1, name_realm: nameRealm, url_code: 'kt000001', archived_at: null }] : []
    }
  ]
});

function handlers(
  who: ReturnType<typeof person> | null,
  options: { ownSignup?: unknown[]; tables?: Record<string, (read: Read) => unknown> } = {}
) {
  const base = seededHandlers();
  const tables = options.tables ?? {};
  return seededHandlers({
    ...(who ? { session: fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }) } : {}),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: who ? 'discord-x' : null };
      if (name === 'resolve_person') return { data: who };
      if (name === 'get_own_signup') return { data: options.ownSignup ?? [] };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table in tables) return tables[read.table]!(read) as never;
      if (read.table === 'team_seasons') return { data: [OPEN_SEASON] };
      if (read.table === 'team_settings') return { data: {} };
      if (read.table === 'incoming_roster') return { data: [] };
      if (read.table === 'players') return { data: [] };
      return base.from!(read);
    }
  });
}

describe('Sign Up, signed out', () => {
  it('asks to sign in', async () => {
    renderApp('/g/wga/t/phoenix/signup', handlers(null));
    await screen.findByRole('heading', { level: 1, name: 'Sign up' });
    expect(screen.getByText('You must sign in to do this.')).toBeInTheDocument();
  });
});

describe('Sign Up, signups closed', () => {
  it('says so', async () => {
    renderApp('/g/wga/t/phoenix/signup', handlers(person(null), { tables: { team_seasons: () => [] } }));
    expect(await screen.findByText('Signups are not open for this team right now.')).toBeInTheDocument();
  });
});

describe('Sign Up, a fresh signup', () => {
  it('walks the four steps and submits', async () => {
    renderApp('/g/wga/t/phoenix/signup', handlers(person(null)));
    const card = await screen
      .findByRole('heading', { level: 2, name: 'Sign up for next season' })
      .then((h) => h.closest('.card') as HTMLElement);
    const within1 = within(card);

    await userEvent.type(within1.getByLabelText('Character name'), 'Katorri');
    await userEvent.type(within1.getByLabelText('Realm'), 'Stormrage');
    await userEvent.click(within1.getByRole('button', { name: 'Stormrage' }));
    await userEvent.click(within1.getByRole('button', { name: 'Next' }));

    await userEvent.click(await within1.findByRole('radio', { name: 'Priest' }));
    await userEvent.click(within1.getByRole('button', { name: 'Next' }));

    await userEvent.click(await within1.findByRole('radio', { name: 'Holy' }));
    await userEvent.click(within1.getByRole('radio', { name: 'Healer' }));
    await userEvent.click(within1.getByRole('button', { name: 'Next' }));

    await within1.findByText('Additional information');
    await userEvent.type(within1.getByLabelText(/Anything else officers/), 'Trial run');
    await userEvent.click(within1.getByRole('button', { name: 'Submit' }));

    expect(await within1.findByText('Signup submitted')).toBeInTheDocument();
  });
});

describe('Sign Up, character name validation', () => {
  it('rejects a lowercase-led name and blocks Next', async () => {
    renderApp('/g/wga/t/phoenix/signup', handlers(person(null)));
    await screen.findByRole('heading', { level: 2, name: 'Sign up for next season' });
    await userEvent.type(screen.getByLabelText('Character name'), 'katorri');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/must start with a capital letter/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sign up for next season' })).toBeInTheDocument();
  });
});

describe('Sign Up, claim differs', () => {
  it('blocks Next until the raider confirms the typed character is not their claim', async () => {
    renderApp('/g/wga/t/phoenix/signup', handlers(person('Rex-Stormrage')));
    await screen.findByRole('heading', { level: 2, name: 'Sign up for next season' });
    await userEvent.type(screen.getByLabelText('Character name'), 'Katorri');
    await userEvent.type(screen.getByLabelText('Realm'), 'Stormrage');
    await userEvent.click(screen.getByRole('button', { name: 'Stormrage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText(/confirm you meant to sign up/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sign up for next season' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 2, name: 'Select your class' });
  });
});

describe('Sign Up, an existing signup', () => {
  it('shows the summary instead of a fresh form', async () => {
    renderApp(
      '/g/wga/t/phoenix/signup',
      handlers(person(null), {
        ownSignup: [
          {
            id: 5,
            signup_name_realm: 'Katorri-Stormrage',
            class: 'Priest',
            spec: 'Holy',
            off_specs: null,
            main_swap: false,
            swap_class: null,
            swap_spec: null,
            swap_from_name_realm: null,
            player_note: null,
            status: 'pending',
            season: 'MID3',
            submitted_at: '2026-09-01T00:00:00Z'
          }
        ]
      })
    );
    await screen.findByRole('heading', { level: 2, name: 'Your signup' });
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText(/Katorri-Stormrage/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit signup' })).toBeInTheDocument();
  });
});
