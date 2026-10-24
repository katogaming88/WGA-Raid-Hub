import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';

// The Sign Up page (#1102), ported from js/signup.js.

const OPEN_SEASON = {
  season_code: 'MID3',
  signups_open: true,
  seasons: { starts_at: '2099-01-01', display_name: 'Midnight Season 3' }
};

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

// Saved characters for the one-page form (#1466): the import's list, which
// since #1620 includes the raider's roster character.
const KATORRI = {
  id: 11,
  person_id: 42,
  name: 'Katorrí',
  realm: 'Stormrage',
  class_name: 'Warlock',
  spec_name: 'Demonology',
  item_level: 640
};
const GRIHZ = {
  id: 12,
  person_id: 42,
  name: 'Grihz',
  realm: 'Illidan',
  class_name: 'Warlock',
  spec_name: null,
  item_level: 630
};
const CLASS_SPECS_ROWS = [
  { id: 31, class: 'Warlock', spec: 'Affliction', role: 'Ranged' },
  { id: 32, class: 'Warlock', spec: 'Demonology', role: 'Ranged' },
  { id: 33, class: 'Warlock', spec: 'Destruction', role: 'Ranged' },
  { id: 41, class: 'Death Knight', spec: 'Blood', role: 'Tank' },
  { id: 42, class: 'Death Knight', spec: 'Frost', role: 'Melee' },
  { id: 43, class: 'Death Knight', spec: 'Unholy', role: 'Melee' }
];
const DEEKA = {
  id: 13,
  person_id: 42,
  name: 'Deeka',
  realm: 'Illidan',
  class_name: 'Death Knight',
  spec_name: 'Frost',
  item_level: 620
};

function formHandlers(
  who: ReturnType<typeof person>,
  saved: unknown[],
  options: { ownSignup?: unknown[]; declared?: Record<string, unknown>[]; onDeclare?: () => void } = {}
) {
  const base = handlers(who, {
    ...(options.ownSignup ? { ownSignup: options.ownSignup } : {}),
    tables: { characters: () => ({ data: saved }), classes_specs: () => ({ data: CLASS_SPECS_ROWS }) }
  });
  return {
    ...base,
    rpc(name: string, args: Record<string, unknown>) {
      if (name === 'my_person_id') return { data: 42 };
      if (name === 'declare_season_signup') {
        options.declared?.push(args);
        options.onDeclare?.();
        return { data: 5 };
      }
      return base.rpc!(name, args);
    }
  };
}

const sideCard = () => screen.getByRole('button', { name: /Sign up|Save changes/ }).closest('.card') as HTMLElement;

describe('Sign Up, the one-page form', () => {
  it('offers the import when no characters are saved', async () => {
    renderApp('/g/wga/t/phoenix/signup', formHandlers(person(null), []));
    expect(await screen.findByText(/You have no characters saved yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import your characters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeDisabled();
  });

  it('signs up a first main on one page and says so in plain words', async () => {
    const declared: Record<string, unknown>[] = [];
    renderApp('/g/wga/t/phoenix/signup', formHandlers(person(null), [KATORRI], { declared }));
    await screen.findByRole('heading', { level: 2, name: 'Sign up for Midnight Season 3' });
    expect(screen.queryByText(/Step \d of/)).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('radio', { name: /Katorrí/ }));
    expect(within(sideCard()).getByRole('status')).toHaveTextContent('Katorrí: First main on this team');
    // Blizzard's spec is picked for them; the rest of the form is on this page.
    expect(screen.getByRole('radio', { name: 'Demonology' })).toBeChecked();
    await userEvent.type(screen.getByLabelText(/Anything else officers/), 'Trial run');
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByRole('heading', { level: 2, name: 'You’re signed up' })).toBeInTheDocument();
    expect(
      screen.getByText(/You are now signed up for Midnight Season 3 as/).closest('p') as HTMLElement
    ).toHaveTextContent(
      'You are now signed up for Midnight Season 3 as Katorrí-Stormrage (Demonology Warlock). You’re welcome to change this any time until signups close, around the start of the season.'
    );
    expect(declared).toEqual([
      {
        p_team_id: 1,
        p_season: 'MID3',
        p_character_id: 11,
        p_class_spec_id: 32,
        p_off_specs: '',
        p_note: 'Trial run',
        p_backup_tank: false,
        p_backup_healer: false
      }
    ]);
  });

  it('reads the roster character as the same main, and another pick as a new main replacing it', async () => {
    renderApp('/g/wga/t/phoenix/signup', formHandlers(person('Katorrí-Stormrage'), [GRIHZ, KATORRI]));
    const radios = await screen.findAllByRole('radio', { name: /Katorrí|Grihz/ });
    // The character they raid on now comes first, tagged.
    expect(radios[0]).toHaveAccessibleName(/Katorrí.*Raiding now/);

    await userEvent.click(radios[0]!);
    expect(within(sideCard()).getByRole('status')).toHaveTextContent('Katorrí: Same main as now');

    await userEvent.click(screen.getByRole('radio', { name: /Grihz/ }));
    expect(within(sideCard()).getByRole('status')).toHaveTextContent('Grihz: New main: replaces Katorrí-Stormrage');
    expect(screen.queryByRole('checkbox', { name: /meant to sign up/ })).not.toBeInTheDocument();
  });

  it('offers the backup ticks the class can fill, not the role they main, and sends them', async () => {
    const declared: Record<string, unknown>[] = [];
    renderApp('/g/wga/t/phoenix/signup', formHandlers(person(null), [DEEKA, KATORRI], { declared }));
    // A Warlock has no tank or healer spec, so no ticks.
    await userEvent.click(await screen.findByRole('radio', { name: /Katorrí/ }));
    expect(screen.queryByRole('checkbox', { name: /I can backup/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Deeka/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'DPS' }));
    expect(screen.queryByRole('checkbox', { name: 'I can backup heal' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'I can backup tank' }));
    // A Blood main is a main tank, not a backup one.
    await userEvent.click(screen.getByRole('radio', { name: 'Blood' }));
    expect(screen.queryByRole('checkbox', { name: 'I can backup tank' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Frost' }));
    expect(screen.getByRole('checkbox', { name: 'I can backup tank' })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    await screen.findByRole('heading', { level: 2, name: 'You’re signed up' });
    expect(declared[0]).toMatchObject({ p_class_spec_id: 42, p_backup_tank: true, p_backup_healer: false });
  });

  // Found taking the screenshots: the saved signup loads back straight away,
  // which swapped the confirmation for the summary before anyone read it.
  it('keeps the confirmation up once the new signup has loaded back', async () => {
    const ownSignup: unknown[] = [];
    renderApp(
      '/g/wga/t/phoenix/signup',
      formHandlers(person(null), [KATORRI], { ownSignup, onDeclare: () => ownSignup.push(ownFields) })
    );
    await userEvent.click(await screen.findByRole('radio', { name: /Katorrí/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'You’re signed up' })).toBeInTheDocument();
    await waitFor(() => expect(ownSignup).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 200));
    expect(screen.getByRole('heading', { level: 2, name: 'You’re signed up' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Your signup' })).toBeInTheDocument();
  });

  it('asks for a main spec when Blizzard did not say one', async () => {
    const declared: Record<string, unknown>[] = [];
    renderApp('/g/wga/t/phoenix/signup', formHandlers(person(null), [GRIHZ], { declared }));
    await userEvent.click(await screen.findByRole('radio', { name: /Grihz/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText('Please select your main spec.')).toBeInTheDocument();
    expect(declared).toEqual([]);
  });

  it('asks for a character before anything else', async () => {
    renderApp('/g/wga/t/phoenix/signup', formHandlers(person(null), [KATORRI]));
    await screen.findByRole('radio', { name: /Katorrí/ });
    await userEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText('Please pick the character you’re signing up with.')).toBeInTheDocument();
  });
});

const ownFields = {
  id: 5,
  signup_name_realm: 'Katorrí-Stormrage',
  class: 'Warlock',
  spec: 'Demonology',
  off_specs: null,
  main_swap: false,
  swap_class: null,
  swap_spec: null,
  swap_from_name_realm: null,
  player_note: null,
  status: 'pending' as const,
  season: 'MID3',
  submitted_at: '2026-09-01T00:00:00Z',
  is_backup_tank: false,
  is_backup_healer: false
};

describe('Sign Up, editing an existing signup', () => {
  it('opens on the same form with their character picked, saved through the same call', async () => {
    const declared: Record<string, unknown>[] = [];
    renderApp(
      '/g/wga/t/phoenix/signup',
      formHandlers(person('Katorrí-Stormrage'), [KATORRI, GRIHZ], { ownSignup: [ownFields], declared })
    );
    await screen.findByRole('heading', { level: 2, name: 'Your signup' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit signup' }));
    expect(await screen.findByRole('radio', { name: /Katorrí/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Demonology' })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { level: 2, name: 'You’re signed up' });
    expect(declared.map((d) => d['p_character_id'])).toEqual([11]);
  });

  it('starts with the backup answers they gave, so saving keeps them', async () => {
    const declared: Record<string, unknown>[] = [];
    const own = {
      ...ownFields,
      signup_name_realm: 'Deeka-Illidan',
      class: 'Death Knight',
      spec: 'Frost',
      is_backup_tank: true
    };
    renderApp('/g/wga/t/phoenix/signup', formHandlers(person(null), [DEEKA], { ownSignup: [own], declared }));
    expect(await screen.findByText('Can also backup tank')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit signup' }));
    expect(await screen.findByRole('checkbox', { name: 'I can backup tank' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'DPS' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { level: 2, name: 'You’re signed up' });
    expect(declared[0]).toMatchObject({ p_backup_tank: true, p_backup_healer: false });
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

// A season coded outside the MIDn pattern (#1388): it shows by the name stored
// on the season, never one worked out from the code.
const TLT1_SEASON = {
  season_code: 'TLT1',
  signups_open: true,
  seasons: { starts_at: '2099-06-01', display_name: 'The Last Titan Season 1' }
};

describe('Sign Up, a season not coded like MIDn', () => {
  it('offers it in the season picker by its stored name', async () => {
    renderApp(
      '/g/wga/t/phoenix/signup',
      handlers(person(null), { tables: { team_seasons: () => ({ data: [OPEN_SEASON, TLT1_SEASON] }) } })
    );
    const picker = await screen.findByRole('combobox', { name: 'Signing up for' });
    expect(within(picker).getByRole('option', { name: 'The Last Titan Season 1' })).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: 'Midnight Season 3' })).toBeInTheDocument();
  });

  it('names it under Your signup', async () => {
    renderApp(
      '/g/wga/t/phoenix/signup',
      handlers(person(null), {
        tables: { team_seasons: () => ({ data: [TLT1_SEASON] }) },
        ownSignup: [{ ...ownFields, season: 'TLT1' }]
      })
    );
    const heading = await screen.findByRole('heading', { level: 2, name: 'Your signup' });
    const summary = heading.closest('.signup-summary') as HTMLElement;
    expect(within(summary).getByText('The Last Titan Season 1')).toBeInTheDocument();
  });

  it('names the season picked under Your signup, not the newest one', async () => {
    renderApp(
      '/g/wga/t/phoenix/signup',
      handlers(person(null), {
        tables: { team_seasons: () => ({ data: [OPEN_SEASON, TLT1_SEASON] }) },
        ownSignup: [ownFields]
      })
    );
    expect(await screen.findByText('The Last Titan Season 1', { selector: '.signup-summary p' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Signing up for' }), 'MID3');
    expect(await screen.findByText('Midnight Season 3', { selector: '.signup-summary p' })).toBeInTheDocument();
  });
});

// The way in from the team's own pages (Kat, 2026-10-24).
describe('Sign up button on team Home and the Roster', () => {
  it('links to Sign up while signups are open', async () => {
    renderApp('/g/wga/t/phoenix', handlers(person(null)));
    const link = await screen.findByRole('link', { name: 'Sign up for Midnight Season 3' });
    expect(link).toHaveAttribute('href', '/g/wga/t/phoenix/signup');
  });

  it('says so once they have signed up', async () => {
    renderApp('/g/wga/t/phoenix/roster', handlers(person(null), { ownSignup: [ownFields] }));
    expect(await screen.findByRole('link', { name: 'Your signup for Midnight Season 3' })).toBeInTheDocument();
  });

  it('is not there when signups are closed', async () => {
    renderApp('/g/wga/t/phoenix', handlers(person(null), { tables: { team_seasons: () => ({ data: [] }) } }));
    await screen.findByRole('heading', { level: 1, name: 'Phoenix' });
    expect(screen.queryByRole('link', { name: /Sign up for|Your signup for/ })).not.toBeInTheDocument();
  });
});
