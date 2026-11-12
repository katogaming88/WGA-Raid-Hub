import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import type { RecruitingTeam } from './apply';
import { applicationFacts, steps } from './applications';
import {
  belowItemLevel,
  classNote,
  fillPrompt,
  formQuestions,
  onTheList,
  problemWith,
  problems,
  sendableAnswers,
  sentByOf,
  startingSentBy,
  type ApplicationForm,
  type Question
} from './form';
import { rememberRecruiter } from './recruiterLink';
import { rememberPending } from './pending';
import type { MyApplication } from './useApplyForm';

// The application form, the after-send page and My applications (#1547).

const TEAM: RecruitingTeam = {
  team_id: 1,
  name: 'Phoenix',
  slug: 'phoenix',
  taking_applications: true,
  join_method: 'application',
  ticket_link: null,
  about: null,
  schedule_note: null,
  extra_night: 'none',
  raid_languages: [],
  split_runs: 'none',
  alts_expected: null,
  ptr_testing: 'none',
  min_item_level: 265,
  attendance_percent: null,
  trial_days: 14,
  logs_required: false,
  other_requirements: null,
  exceptional_line: 'Exceptional players of any class or spec are welcome to apply.',
  spots: [{ role: 'healer', class_spec_id: 264, class: 'Shaman', spec: 'Restoration', priority: 'high' }],
  nights: [
    {
      weekday: 3,
      start_time: '20:00:00',
      timezone: 'America/New_York',
      duration_minutes: 180,
      is_optional: false,
      difficulty: null
    }
  ],
  progress: []
};

const FORM: ApplicationForm = {
  starters: [
    {
      key: 'about',
      group: 'About them',
      label: 'A line',
      prompt: 'Tell the team about yourself.',
      answer_type: 'short_text',
      max_length: 100,
      choices: [],
      required: true
    },
    {
      key: 'sent_by',
      group: 'How',
      label: 'Who sent them',
      prompt: 'Who sent you?',
      answer_type: 'recruiter',
      max_length: null,
      choices: [],
      required: false
    }
  ],
  questions: [
    {
      id: 9,
      label: 'Voice',
      prompt: 'Can you make {raid nights}?',
      answer_type: 'yes_no',
      max_length: null,
      choices: null,
      required: true
    },
    {
      id: 10,
      label: 'Log',
      prompt: 'Link a log.',
      answer_type: 'link',
      max_length: null,
      choices: null,
      required: false
    }
  ]
};

const WARLOCK = {
  blizzard_id: 77,
  name: 'Katorri',
  realm: 'Stormrage',
  realm_slug: 'stormrage',
  class_name: 'Warlock',
  spec_name: 'Demonology',
  level: 90,
  item_level: 250,
  saved: false,
  roster: null
};
const SPECS = [
  { spec: 'Affliction', role: 'Ranged' },
  { spec: 'Demonology', role: 'Ranged' },
  { spec: 'Destruction', role: 'Ranged' }
];
const STATS = {
  success: true,
  failed: ['mythic_keystone'],
  character: {
    item_level: 250,
    mplus_score: null,
    heroic_logs: { best: 91, median: 80 },
    mythic_logs: null,
    mythic_bosses_killed: { killed: 4, total: 9 }
  }
};

type World = { sent: unknown[]; joinStatus: string };

function handlers(world: World, over: { discord?: boolean } = {}): FakeHandlers {
  const { discord = true } = over;
  return seededHandlers({
    session: fakeSession({ battlenet: 'Kat#1', ...(discord ? { discord: { id: 'd', name: 'katorri' } } : {}) }),
    rpc(name, args) {
      switch (name) {
        case 'team_recruiting_page':
          return { data: [TEAM] };
        case 'team_application_form':
          return { data: FORM };
        case 'guild_active_recruiters':
          return { data: [{ name: 'Rexa', code: 'abcd1234' }] };
        case 'recruiter_for_code':
          return { data: { name: 'Rexa', active: true } };
        case 'send_application':
          world.sent.push(args);
          return { data: 55 };
        case 'my_applications':
          return { data: [] };
        default:
          return seededHandlers().rpc!(name, args);
      }
    },
    from(read) {
      if (read.table === 'classes_specs') return { data: SPECS };
      if (read.table === 'characters') return { data: { id: 7 } };
      return seededHandlers().from!(read);
    },
    invoke(name) {
      if (name === 'battlenet-characters') return { data: { characters: [WARLOCK], roster: [] } };
      if (name === 'character-stats') return { data: STATS };
      if (name === 'discord-join') return { data: { success: true, status: world.joinStatus } };
      return { data: { success: true } };
    }
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe('the form rules', () => {
  const q = (over: Partial<Question>): Question => ({
    key: 'k',
    prompt: 'P',
    type: 'short_text',
    max: 10,
    choices: [],
    required: true,
    ...over
  });

  it('lists the starters, then the team’s own, keyed for send_application', () => {
    expect(formQuestions(FORM).map((x) => x.key)).toEqual(['about', 'sent_by', '9', '10']);
  });

  it('fills {team} and {raid nights}', () => {
    expect(fillPrompt('Can {team} count on {raid nights}?', 'Phoenix', 'Wednesday, 8 PM')).toBe(
      'Can Phoenix count on Wednesday, 8 PM?'
    );
  });

  it('needs required answers, limits text, wants a link and a listed choice', () => {
    expect(problemWith(q({}), '  ')).toBe('Please answer this.');
    expect(problemWith(q({ required: false }), '')).toBeNull();
    expect(problemWith(q({ max: 3 }), 'abcd')).toBe('That is over 3 characters.');
    expect(problemWith(q({ type: 'link', max: null }), 'warcraftlogs.com/x')).toMatch(/link/);
    expect(problemWith(q({ type: 'link', max: null }), 'https://warcraftlogs.com/x')).toBeNull();
    expect(problemWith(q({ type: 'choice', choices: ['A', 'B'] }), 'C')).toBe('Pick one of the choices.');
    expect(problemWith(q({ type: 'yes_no' }), false)).toBeNull();
  });

  it('leaves who-sent-you out of the answers and skips blanks', () => {
    const qs = formQuestions(FORM);
    expect(problems(qs, { about: 'Hi' })).toEqual({ '9': 'Please answer this.' });
    expect(sendableAnswers(qs, { about: ' Hi ', '9': false, '10': '', sent_by: 'x' })).toEqual({
      about: 'Hi',
      '9': false
    });
  });

  it('picks the saved recruiter only while they are still on the list', () => {
    const list = [{ name: 'Rexa', code: 'abcd1234' }];
    expect(startingSentBy(list, 'abcd1234')).toBe('abcd1234');
    expect(startingSentBy(list, 'gone0000')).toBe('nobody');
    expect(sentByOf('friend', ' Bob ')).toEqual({ kind: 'friend', name: 'Bob' });
    expect(sentByOf('abcd1234', '')).toEqual({ kind: 'recruiter', code: 'abcd1234' });
  });

  it('says when the class is not wanted and when the item level is low', () => {
    expect(onTheList(TEAM.spots, 'Warlock', 'Demonology', SPECS)).toBe(false);
    expect(onTheList(TEAM.spots, 'Shaman', 'Restoration', [])).toBe(true);
    expect(
      onTheList(
        [{ role: 'ranged', class_spec_id: null, class: null, spec: null, priority: 'low' }],
        'Warlock',
        'Demonology',
        SPECS
      )
    ).toBe(true);
    expect(classNote('Phoenix', 'Warlock', true)).toBe(
      'Warlock isn’t on Phoenix’s list right now, but they welcome exceptional players of any class or spec.'
    );
    expect(classNote('Phoenix', 'Warlock', false)).toBe('Warlock isn’t on Phoenix’s list right now.');
    expect(belowItemLevel(265, 250)).toBe(true);
    expect(belowItemLevel(null, 250)).toBe(false);
  });
});

describe('the progress list', () => {
  const app: MyApplication = {
    id: 1,
    team_id: 1,
    team_name: 'Phoenix',
    team_slug: 'phoenix',
    guild_key: 'wga',
    name_realm: 'Katorri-Stormrage',
    status: 'waiting_on_officers',
    applied_at: '2026-11-12T12:00:00Z',
    closed_at: null,
    trial_starts_on: null,
    trial_ends_on: null,
    ticket_url: null,
    joined_discord: false,
    join_failed: false,
    add_to_server: true
  };

  it('is still setting up until the ticket link exists', () => {
    expect(steps(app).map((s) => s.state)).toEqual(['done', 'now', 'later', 'later']);
    expect(steps({ ...app, ticket_url: 'https://discord.com/channels/1/2' }).map((s) => s.state)).toEqual([
      'done',
      'done',
      'now',
      'later'
    ]);
  });

  it('skips the Discord step for a team that does not add applicants', () => {
    const s = steps({ ...app, add_to_server: false });
    expect(s[1]).toMatchObject({ label: 'Officers told', state: 'done' });
  });

  it('shows only the send for a closed application that never joined', () => {
    expect(steps({ ...app, status: 'withdrawn', closed_at: '2026-11-13T00:00:00Z' })).toHaveLength(1);
    expect(applicationFacts(app, () => 'Nov 12')).toBe('Katorri-Stormrage · sent Nov 12');
  });
});

describe('the application form', () => {
  const FORM_PATH = '/g/wga/apply/phoenix/form';

  it('asks a signed-out visitor to sign in with Battle.net first', async () => {
    renderApp(
      FORM_PATH,
      seededHandlers({ rpc: (n, a) => (n === 'team_recruiting_page' ? { data: [TEAM] } : seededHandlers().rpc!(n, a)) })
    );
    expect(await screen.findByRole('heading', { name: 'Apply to Phoenix' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('main')).getByRole('button', { name: 'Sign in with Battle.net' })
    ).toBeInTheDocument();
  });

  it('sends a team with no form to its own page', async () => {
    renderApp(
      FORM_PATH,
      seededHandlers({
        rpc: (n, a) =>
          n === 'team_recruiting_page'
            ? { data: [{ ...TEAM, join_method: 'discord_ticket' }] }
            : seededHandlers().rpc!(n, a)
      })
    );
    expect(await screen.findByRole('heading', { name: 'Phoenix has no application form' })).toBeInTheDocument();
  });

  it('fills a picked character’s numbers, each failing on its own, and notes the class and item level', async () => {
    const user = userEvent.setup();
    renderApp(FORM_PATH, handlers({ sent: [], joinStatus: 'off' }), { battlenetToken: 'tok' });
    await user.selectOptions(await screen.findByLabelText('Character'), '77');
    expect(await screen.findByText('Couldn’t load')).toBeInTheDocument();
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.getByText('4/9')).toBeInTheDocument();
    expect(
      await screen.findByText(/Warlock isn’t on Phoenix’s list right now, but they welcome exceptional players/)
    ).toBeInTheDocument();
    expect(screen.getByText(/asks for item level 265\+/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Affliction' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Demonology' })).toBeNull();
  });

  it('refuses to send with a required answer missing, and says which', async () => {
    const user = userEvent.setup();
    const world = { sent: [], joinStatus: 'off' };
    renderApp(FORM_PATH, handlers(world), { battlenetToken: 'tok' });
    await user.selectOptions(await screen.findByLabelText('Character'), '77');
    await user.click(screen.getByRole('button', { name: 'Send application' }));
    expect(
      await screen.findByText('Pick the character you’d raid on.', {}, { timeout: 100 }).catch(() => null)
    ).toBeNull();
    expect((await screen.findAllByText('Please answer this.')).length).toBe(2);
    expect(world.sent).toEqual([]);
  });

  it('shows the friend box only for a friend, and wants a name', async () => {
    const user = userEvent.setup();
    const world = { sent: [], joinStatus: 'off' };
    renderApp(FORM_PATH, handlers(world), { battlenetToken: 'tok' });
    await user.selectOptions(await screen.findByLabelText('Character'), '77');
    expect(screen.queryByLabelText('Who’s your friend?')).toBeNull();
    await user.selectOptions(screen.getByLabelText(/Who sent you/), 'friend');
    await user.type(screen.getByLabelText(/Tell the team/), 'Hi');
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Send application' }));
    expect(await screen.findByText('Name your friend, or pick another answer.')).toBeInTheDocument();
    expect(world.sent).toEqual([]);
  });

  it('sends a full application with the recruiter from the link and lands on the application', async () => {
    const user = userEvent.setup();
    rememberRecruiter('wga', 'abcd1234');
    const world = { sent: [] as unknown[], joinStatus: 'off' };
    const { client } = renderApp(FORM_PATH, handlers(world), { battlenetToken: 'tok' });
    await user.selectOptions(await screen.findByLabelText('Character'), '77');
    expect(screen.getByText('Already picked because you came from their link.')).toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: 'Destruction' }));
    await user.type(screen.getByLabelText(/Tell the team/), 'Hi there');
    await user.click(screen.getByRole('radio', { name: 'Yes' }));
    await user.click(screen.getByRole('button', { name: 'Send application' }));

    await waitFor(() => expect(world.sent).toHaveLength(1));
    expect(world.sent[0]).toEqual({
      p_team_id: 1,
      p_character_id: 7,
      p_answers: { about: 'Hi there', '9': true },
      p_recruiter_code: 'abcd1234',
      p_friend_name: null,
      p_time_zone: expect.any(String),
      p_other_specs: ['Destruction']
    });
    // No trip to Discord, so the ticket is asked for straight away.
    expect(
      client.authCalls.some(
        ([kind, args]) =>
          kind === 'invoke' &&
          (args as [string, { body: { application?: number } }])[0] === 'recruit-ticket' &&
          (args as [string, { body: { application?: number } }])[1].body.application === 55
      )
    ).toBe(true);
    // The numbers are asked to be kept on the new application.
    expect(
      client.authCalls.some(
        ([kind, args]) =>
          kind === 'invoke' &&
          (args as [string, { body: { application?: number } }])[0] === 'character-stats' &&
          (args as [string, { body: { application?: number } }])[1].body.application === 55
      )
    ).toBe(true);
    expect(
      await screen.findByRole('heading', { name: 'Your application to Phoenix' }, { timeout: 3000 }).catch(() => null)
    ).not.toBeUndefined();
  });

  it('needs Discord linked before it can send', async () => {
    const user = userEvent.setup();
    renderApp(FORM_PATH, handlers({ sent: [], joinStatus: 'off' }, { discord: false }), { battlenetToken: 'tok' });
    await user.selectOptions(await screen.findByLabelText('Character'), '77');
    expect(screen.getByText(/Link your Discord account first/)).toBeInTheDocument();
  });
});

describe('My applications and the after-send page', () => {
  const APP = {
    id: 55,
    team_id: 1,
    team_name: 'Phoenix',
    team_slug: 'phoenix',
    guild_key: 'wga',
    name_realm: 'Katorri-Stormrage',
    status: 'waiting_on_officers',
    applied_at: '2026-11-12T12:00:00Z',
    closed_at: null,
    trial_starts_on: null,
    trial_ends_on: null,
    ticket_url: null,
    joined_discord: false,
    join_failed: false,
    add_to_server: true
  };

  function mine(rows: Record<string, unknown>[], world: { withdrawn: number[] } = { withdrawn: [] }) {
    return seededHandlers({
      session: fakeSession({ battlenet: 'Kat#1', discord: { id: 'd', name: 'katorri' } }),
      rpc(name, args) {
        if (name === 'my_applications') return { data: rows };
        if (name === 'withdraw_application') {
          world.withdrawn.push(args['p_application_id'] as number);
          return { data: null };
        }
        return seededHandlers().rpc!(name, args);
      }
    });
  }

  it('waits for the ticket: no button, a "Setting up" line in its place', async () => {
    renderApp('/g/wga/applications/55', mine([APP]));
    expect(await screen.findByRole('heading', { name: 'Your application to Phoenix' })).toBeInTheDocument();
    expect(screen.getByText('Setting up your ticket…')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open my ticket in Discord' })).toBeNull();
  });

  it('offers a plain link to the ticket once it exists, never a redirect', async () => {
    renderApp(
      '/g/wga/applications/55',
      mine([{ ...APP, ticket_url: 'https://discord.com/channels/1/2', joined_discord: true }])
    );
    const button = await screen.findByRole('link', { name: 'Open my ticket in Discord' });
    expect(button).toHaveAttribute('href', 'https://discord.com/channels/1/2');
    expect(screen.getByRole('heading', { name: 'You’re in our Discord. Say hi in your ticket.' })).toBeInTheDocument();
    expect(screen.getByText(/Find my ticket/)).toBeInTheDocument();
  });

  it('says so when the join failed', async () => {
    renderApp('/g/wga/applications', mine([{ ...APP, join_failed: true }]));
    expect(await screen.findByText(/couldn’t add you to the Discord/)).toBeInTheDocument();
  });

  it('lists every application, and withdraws an open one after asking', async () => {
    const user = userEvent.setup();
    const world = { withdrawn: [] as number[] };
    renderApp(
      '/g/wga/applications',
      mine(
        [
          APP,
          { ...APP, id: 40, team_name: 'Hellfire Rollers', status: 'withdrawn', closed_at: '2026-10-01T00:00:00Z' }
        ],
        world
      )
    );
    const cards = await screen.findAllByRole('region');
    expect(cards.map((c) => c.getAttribute('aria-label')).filter(Boolean)).toEqual([
      'Phoenix application',
      'Hellfire Rollers application'
    ]);
    expect(screen.getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
    await waitFor(() => expect(world.withdrawn).toEqual([55]));
  });

  it('shows the My applications item under You once someone has applied', async () => {
    renderApp('/g/wga/apply', {
      ...mine([APP]),
      rpc: (n, a) =>
        n === 'team_recruiting_page'
          ? { data: [TEAM] }
          : n === 'my_applications'
            ? { data: [APP] }
            : seededHandlers().rpc!(n, a)
    });
    expect(await screen.findByRole('link', { name: 'My applications' })).toHaveAttribute('href', '/g/wga/applications');
  });
});

describe('where Discord sends the applicant back', () => {
  it('hands the code over once and shows an invite when Discord would not add them', async () => {
    rememberPending(55, '/g/wga/applications/55');
    const calls: unknown[] = [];
    renderApp(
      '/apply/discord?code=c1&state=s1',
      seededHandlers({
        session: fakeSession({ battlenet: 'Kat#1', discord: { id: 'd', name: 'katorri' } }),
        invoke(name, body) {
          calls.push([name, (body as { body: unknown }).body]);
          return { data: { success: true, status: 'failed', reason: 'banned', invite: 'https://discord.gg/abc' } };
        }
      })
    );
    expect(await screen.findByRole('link', { name: 'Join the Discord' })).toHaveAttribute(
      'href',
      'https://discord.gg/abc'
    );
    // Then the ticket is asked for, for the application waiting on this trip.
    expect(calls).toEqual([
      ['discord-join', { action: 'finish', state: 's1', code: 'c1' }],
      ['recruit-ticket', { application: 55 }]
    ]);
  });

  it('passes on Discord’s refusal when the applicant said no', async () => {
    const calls: unknown[] = [];
    renderApp(
      '/apply/discord?error=access_denied&state=s1',
      seededHandlers({
        session: fakeSession({ battlenet: 'Kat#1', discord: { id: 'd', name: 'katorri' } }),
        invoke(_name, body) {
          calls.push((body as { body: unknown }).body);
          return { data: { success: true, status: 'failed', reason: 'declined', invite: null } };
        }
      })
    );
    expect(await screen.findByText(/Discord wouldn’t add you automatically/)).toBeInTheDocument();
    expect(calls).toEqual([{ action: 'finish', state: 's1', error: 'access_denied' }]);
  });
});
