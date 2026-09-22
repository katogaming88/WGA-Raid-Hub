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

// One character on the Battle.net account, for the fresh-signup picker
// (#1162): no active spec, so the raider still picks Main spec/Primary role
// by hand in Step 3, same as before Battle.net was wired in.
const BNET_CHARACTER = {
  blizzard_id: 201,
  name: 'Katorri',
  realm: 'Stormrage',
  realm_slug: 'stormrage',
  class_name: 'Priest',
  spec_name: null,
  level: 90,
  item_level: 620,
  saved: false,
  roster: null
};

const bnetHandlers = (who: ReturnType<typeof person> | null, characters = [BNET_CHARACTER]) => ({
  ...handlers(who),
  invoke: () => ({ data: { characters, roster: [] } })
});

describe('Sign Up, a fresh signup', () => {
  it('picks the character from Battle.net and walks the rest of the steps', async () => {
    renderApp('/g/wga/t/phoenix/signup', bnetHandlers(person(null)), { battlenetToken: 'bnet-token' });
    const card = await screen
      .findByRole('heading', { level: 2, name: 'Sign up for next season' })
      .then((h) => h.closest('.card') as HTMLElement);
    const within1 = within(card);

    // Back/Next/Submit live in their own card beside this one (#1162), not
    // scoped under it, so they're queried from the whole screen.
    await userEvent.click(await within1.findByRole('radio', { name: /Katorri/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await within1.findByRole('heading', { level: 2, name: 'Select your class' });
    expect(within1.getByRole('radio', { name: 'Priest', checked: true })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await userEvent.click(await within1.findByRole('radio', { name: 'Holy' }));
    await userEvent.click(within1.getByRole('radio', { name: 'Healer' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await within1.findByText('Additional information');
    await userEvent.type(within1.getByLabelText(/Anything else officers/), 'Trial run');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(await within1.findByText('Signup submitted')).toBeInTheDocument();
  });

  it('has no manual-entry fallback, and points to Discord when the character is missing', async () => {
    renderApp('/g/wga/t/phoenix/signup', bnetHandlers(person(null), []), { battlenetToken: 'bnet-token' });
    await screen.findByText('No characters found on this Battle.net account.');
    expect(screen.queryByLabelText('Character name')).not.toBeInTheDocument();
    expect(screen.getByText(/message an officer on Discord/)).toBeInTheDocument();
  });

  it('blocks Next with a pick-a-character message, not the typed-name one, until one is picked', async () => {
    renderApp('/g/wga/t/phoenix/signup', bnetHandlers(person(null)), { battlenetToken: 'bnet-token' });
    await screen.findByRole('radio', { name: /Katorri/ });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Please pick the character you’re signing up with.')).toBeInTheDocument();
    expect(screen.queryByText(/enter your character name/)).not.toBeInTheDocument();
  });

  it('shows the step label beside Back/Next, not above the step content', async () => {
    renderApp('/g/wga/t/phoenix/signup', bnetHandlers(person(null)), { battlenetToken: 'bnet-token' });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Sign up for next season' });
    const stepLabel = await screen.findByText('Step 1 of 4');
    expect(heading.closest('.card')).not.toBe(stepLabel.closest('.card'));
  });

  it('asks to connect Battle.net first when the account has none linked', async () => {
    const noBattlenet = { ...handlers(person(null)), session: fakeSession({ discord: { id: 'd', name: 'X' } }) };
    renderApp('/g/wga/t/phoenix/signup', noBattlenet);
    expect(await screen.findByRole('button', { name: 'Connect Battle.net' })).toBeInTheDocument();
  });
});

const ownFields = {
  id: 5,
  signup_name_realm: 'Rex-Stormrage',
  class: 'Warrior',
  spec: 'Protection',
  off_specs: null,
  main_swap: false,
  swap_class: null,
  swap_spec: null,
  swap_from_name_realm: null,
  player_note: null,
  status: 'pending' as const,
  season: 'MID3',
  submitted_at: '2026-09-01T00:00:00Z'
};

// Editing an already-submitted signup still uses the manual fields (#1162):
// they are already filled in, and there is no Battle.net round trip to make.
async function openEdit(who: ReturnType<typeof person>) {
  renderApp('/g/wga/t/phoenix/signup', handlers(who, { ownSignup: [ownFields] }));
  await screen.findByRole('heading', { level: 2, name: 'Your signup' });
  await userEvent.click(screen.getByRole('button', { name: 'Edit signup' }));
  return screen.findByRole('heading', { level: 2, name: 'Sign up for next season' });
}

describe('Sign Up, realm field', () => {
  it('browses the whole list on click, and picks with the keyboard', async () => {
    await openEdit(person('Rex-Stormrage'));
    const field = screen.getByLabelText('Realm');
    await userEvent.clear(field);
    await userEvent.click(field);
    const list = screen.getByRole('listbox', { name: 'Realms' });
    expect(within(list).getAllByRole('option').length).toBeGreaterThan(200);

    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(field).toHaveValue('Aerie Peak');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('filters as it is typed, and still lets a real user just type the realm', async () => {
    await openEdit(person('Rex-Stormrage'));
    const field = screen.getByLabelText('Realm');
    await userEvent.clear(field);
    await userEvent.type(field, 'stormrage');
    const list = screen.getByRole('listbox', { name: 'Realms' });
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Stormrage']);
    expect(field).toHaveValue('stormrage');
  });
});

describe('Sign Up, character name validation', () => {
  it('rejects a lowercase-led name and blocks Next', async () => {
    await openEdit(person('Rex-Stormrage'));
    await userEvent.clear(screen.getByLabelText('Character name'));
    await userEvent.type(screen.getByLabelText('Character name'), 'katorri');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/must start with a capital letter/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Sign up for next season' })).toBeInTheDocument();
  });
});

describe('Sign Up, claim differs', () => {
  it('blocks Next until the raider confirms the edited character is not their claim', async () => {
    await openEdit(person('Rex-Stormrage'));
    await userEvent.clear(screen.getByLabelText('Character name'));
    await userEvent.type(screen.getByLabelText('Character name'), 'Katorri');
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
