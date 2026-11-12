import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { Markdown, firstPlainLine } from '../lib/markdown';
import {
  changes,
  draftAbout,
  headings,
  problems,
  raidFilled,
  withCurrent,
  type Draft,
  type QuestionList,
  type Settings,
  type SpecRow
} from './recruiting';

// Recruiting settings (#1548): the seven sections, one save bar, saving only
// what changed, the question and spot editors, and the Discord section's
// notes. The rules behind them are tested directly first.

const PATH = '/g/wga/t/phoenix/officer/recruiting/settings';

const SETTINGS: Settings = {
  taking_applications: true,
  join_method: 'application',
  ticket_link: null,
  listed_on_guild_page: true,
  about: null,
  schedule_note: null,
  extra_night: 'none',
  raid_languages: ['English'],
  split_runs: 'none',
  alts_expected: null,
  ptr_testing: 'none',
  min_item_level: 265,
  attendance_percent: 90,
  trial_days: 14,
  logs_required: true,
  other_requirements: null,
  exceptional_line_on: true,
  exceptional_line: 'Exceptional players of any class or spec are welcome to apply.',
  discord_mode: 'ticket',
  officer_thread_with_ticket: false,
  add_to_server: true,
  ticket_category_id: '100000000000000777',
  visible_to_team_officers: true,
  visible_to_team_assistants: false,
  visible_to_guild_admins: false,
  visible_to_role_ids: [],
  dm_reply_after_minutes: 120,
  remind_after_hours: 48,
  close_no_reply_after_hours: 120,
  ping_officers_after_hours: 24,
  ping_owner_after_hours: 72,
  trial_end_notice_hours: 48,
  delete_closed_after_hours: 24
};

const SPECS: SpecRow[] = [
  { id: 1, class: 'Shaman', spec: 'Restoration', role: 'Heal' },
  { id: 2, class: 'Druid', spec: 'Balance', role: 'Ranged' },
  { id: 3, class: 'Warrior', spec: 'Protection', role: 'Tank' },
  { id: 4, class: 'Rogue', spec: 'Assassination', role: 'Melee' }
];

const QUESTIONS: QuestionList = {
  starters: [
    {
      key: 'about',
      group: 'About them',
      label: 'A line about themselves',
      prompt: 'Tell the team about yourself.',
      answer_type: 'short_text',
      max_length: 100,
      choices: [],
      on: true,
      required: true
    },
    {
      key: 'why',
      group: 'About them',
      label: 'Why this team',
      prompt: 'Why {team}?',
      answer_type: 'paragraph',
      max_length: 1000,
      choices: [],
      on: true,
      required: false
    },
    {
      key: 'sent_by',
      group: 'How they found you',
      label: 'Who sent them',
      prompt: 'Who sent you?',
      answer_type: 'recruiter',
      max_length: null,
      choices: [],
      on: true,
      required: false
    }
  ],
  questions: [
    {
      id: 9,
      label: 'Voice',
      prompt: 'Can you use voice?',
      answer_type: 'yes_no',
      max_length: null,
      choices: null,
      required: true
    }
  ]
};

const draftOf = (settings: Settings, over: Partial<Draft> = {}): Draft => ({
  settings,
  spots: [],
  starters: {},
  questions: [],
  ...over
});

describe('the recruiting rules', () => {
  it('names only what changed', () => {
    expect(changes(SETTINGS, { ...SETTINGS, trial_days: 28, raid_languages: ['English', 'German'] })).toEqual({
      trial_days: 28,
      raid_languages: ['English', 'German']
    });
    expect(changes(SETTINGS, SETTINGS)).toEqual({});
  });

  it('says why it cannot save yet, as the database would', () => {
    expect(
      problems(draftOf({ ...SETTINGS, taking_applications: true, join_method: 'discord_ticket', ticket_link: null }))
    ).toContain('Add the link to your Discord ticket, or turn off "Taking applications".');
    expect(problems(draftOf({ ...SETTINGS, discord_mode: 'ticket', add_to_server: false }))).toContain(
      'A private ticket needs "Add them to the Discord server".'
    );
    expect(problems(draftOf({ ...SETTINGS, remind_after_hours: 120, close_no_reply_after_hours: 120 }))).toContain(
      'The reminder has to come before the ticket closes as "No reply".'
    );
    expect(problems(draftOf({ ...SETTINGS, ping_officers_after_hours: 72, ping_owner_after_hours: 24 }))).toContain(
      'The officer ping has to come before the Team Owner ping.'
    );
    expect(problems(draftOf({ ...SETTINGS, about: 'x'.repeat(2001) }))).toContain(
      'About the team is over 2,000 characters.'
    );
    expect(problems(draftOf(SETTINGS))).toEqual([]);
  });

  it('checks the team’s own questions and spots', () => {
    const own = (over: object) => ({
      key: 1,
      id: null,
      label: 'Q',
      prompt: 'P',
      answer_type: 'short_text',
      max: '100',
      choices: '',
      required: false,
      ...over
    });
    expect(problems(draftOf(SETTINGS, { questions: [own({ label: '' })] }))).toEqual([
      'Question 1: a short name of 1 to 40 characters.'
    ]);
    expect(problems(draftOf(SETTINGS, { questions: [own({ answer_type: 'choice', choices: 'Only one' })] }))).toEqual([
      'Question 1: give 2 to 10 choices, one a line.'
    ]);
    expect(problems(draftOf(SETTINGS, { questions: [own({ max: '500' })] }))).toEqual([
      "Question 1: a short answer's limit is 1 to 200."
    ]);
    const spot = { key: 1, role: 'healer' as const, class_spec_id: null, priority: 'high' as const };
    expect(problems(draftOf(SETTINGS, { spots: [spot, { ...spot, key: 2 }] }))).toEqual([
      'A spot is on the list twice.'
    ]);
  });

  it('counts the seven raid facts, and writes each heading', () => {
    expect(raidFilled(SETTINGS, 2)).toBe(2);
    expect(
      raidFilled(
        {
          ...SETTINGS,
          schedule_note: 'x',
          extra_night: 'sometimes',
          split_runs: 'weekly',
          alts_expected: 1,
          ptr_testing: 'optional'
        },
        1
      )
    ).toBe(7);
    const h = headings(
      draftOf(
        { ...SETTINGS, about: 'Hello' },
        {
          spots: [
            { key: 1, role: 'tank', class_spec_id: 3, priority: 'high' },
            { key: 2, role: 'healer', class_spec_id: null, priority: 'low' }
          ]
        }
      ),
      2
    );
    expect(h.about).toEqual({ status: '5 / 2,000', done: true });
    expect(h.raid).toEqual({ status: '2 of 7 filled in', done: false });
    expect(h.looking).toEqual({ status: '2 spots, 1 high', done: true });
    expect(h.ask.status).toBe('265 item level, 90% attendance, 14-day trial, logs');
    expect(headings(draftOf(SETTINGS), 0).about).toEqual({ status: 'Not written yet', done: false });
    expect(headings(draftOf(SETTINGS), 0).looking.status).toBe('Full, not listed');
  });

  it('drafts an About text from the raid nights and the high spots', () => {
    const text = draftAbout(
      'Phoenix',
      [
        { weekday: 3, is_optional: false },
        { weekday: 4, is_optional: false },
        { weekday: 0, is_optional: true }
      ],
      [
        { key: 1, role: 'healer', class_spec_id: 1, priority: 'high' },
        { key: 2, role: 'ranged', class_spec_id: null, priority: 'low' }
      ],
      SPECS
    );
    expect(text).toContain('We raid Wednesday and Thursday.');
    expect(text).toContain("we're looking for Restoration Shaman.");
    expect(text).not.toContain('Sunday');
  });

  it('keeps a saved timing the list does not offer', () => {
    expect(withCurrent([{ value: 60, label: '1 hour' }], 90, 'minutes')[0]).toEqual({ value: 90, label: '90 minutes' });
    expect(withCurrent([{ value: 60, label: '1 hour' }], 60, 'minutes')).toHaveLength(1);
  });
});

describe('the light Markdown', () => {
  it('renders bold, italic, a heading, a list and an https link, as elements', () => {
    const { container } = render(
      <Markdown
        text={'# Phoenix\n\nWe are **bold** and *calm*.\n\n- Wednesday\n- Thursday\n\n[Our site](https://example.com)'}
      />
    );
    expect(container.querySelector('h3')?.textContent).toBe('Phoenix');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('em')?.textContent).toBe('calm');
    expect([...container.querySelectorAll('li')].map((l) => l.textContent)).toEqual(['Wednesday', 'Thursday']);
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://example.com');
  });

  it('never makes HTML or a non-https link', () => {
    const { container } = render(
      <Markdown text={'<script>alert(1)</script> [bad](javascript:alert(1)) [http](http://example.com)'} />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('takes the first line as plain text for a card', () => {
    expect(firstPlainLine('# **Phoenix** is [great](https://x.test)\nmore')).toBe('Phoenix is great');
  });
});

// ---------------------------------------------------------------------------
// The page

const SERVER_ID = '100000000000000001';
const TICKETS = '100000000000000777';

type World = { rpcs: [string, Record<string, unknown>][]; invokes: Record<string, unknown>[] };

const officer = {
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role: 'officer',
      characters: [{ player_id: 1, name_realm: 'Katorrí-Stormrage', url_code: null, archived_at: null }]
    }
  ]
};

function handlers(
  world: World,
  over: { settings?: Settings; spots?: object[]; role?: string; categoryMissing?: string[]; viewers?: object[] } = {}
): FakeHandlers {
  const {
    settings = SETTINGS,
    spots = [],
    role = 'officer',
    categoryMissing = [],
    viewers = [{ display_name: 'Aur', viewer_group: 'officer', discord_linked: true }]
  } = over;
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'Kat#1', discord: { id: 'd', name: 'Kat' } }),
    rpc(name, args) {
      switch (name) {
        case 'current_discord_id':
          return { data: 'd' };
        case 'resolve_person':
          return { data: { ...officer, teams: [{ ...officer.teams[0]!, role }] } };
        case 'team_recruiting_settings':
          return { data: { ...settings, spots } };
        case 'team_application_questions':
          return { data: QUESTIONS };
        case 'team_ticket_viewers':
          return { data: viewers };
        case 'team_discord_settings':
          return {
            data: {
              server_id: SERVER_ID,
              quiet_hours: null,
              posts: [{ kind: 'officer_requests', channel_id: '201', ping_role_id: null, last_posted_at: null }],
              sheets: []
            }
          };
        case 'save_team_recruiting':
        case 'set_team_recruiting_spots':
        case 'save_team_application_questions':
          world.rpcs.push([name, args]);
          return { data: null };
        default:
          return base.rpc!(name, args);
      }
    },
    from(read) {
      if (read.table === 'classes_specs') return { data: SPECS };
      if (read.table === 'raid_schedule') {
        return {
          data: [
            {
              id: 1,
              weekday: 3,
              start_time: '20:00:00',
              timezone: 'America/New_York',
              duration_minutes: 180,
              active: true,
              is_optional: false,
              difficulty: null
            }
          ]
        };
      }
      return base.from!(read);
    },
    invoke(name, args) {
      if (name !== 'discord-settings') return undefined as never;
      const body = (args as { body: Record<string, unknown> }).body;
      world.invokes.push(body);
      if (body['action'] === 'find_ticket')
        return { data: { success: true, channelId: body['channelId'] === undefined ? null : body['channelId'] } };
      return {
        data: {
          success: true,
          hasDiscord: true,
          servers: [{ id: SERVER_ID, name: 'We Go Again' }],
          server: {
            id: SERVER_ID,
            name: 'We Go Again',
            botIn: true,
            channels: [
              { id: '201', name: 'phoenix-officers', category: null, missing: [] },
              { id: '202', name: 'start-here', category: null, missing: [] }
            ],
            categories: [{ id: TICKETS, name: 'Tickets', missing: categoryMissing }],
            roles: [
              { id: '301', name: 'Recruiter' },
              { id: '302', name: 'Raid Leader' }
            ]
          }
        }
      };
    }
  });
}

const world = (): World => ({ rpcs: [], invokes: [] });
const open = async (name: string | RegExp) => userEvent.click(await screen.findByRole('button', { name }));

describe('the Recruiting settings page', () => {
  it('shows seven sections with where each stands, one open at a time', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers(world(), { spots: [{ role: 'healer', class_spec_id: 1, priority: 'high' }] }));
    expect(await screen.findByRole('heading', { name: 'Recruiting settings' })).toBeInTheDocument();
    await screen.findByRole('button', { name: /^Discord/ });
    const names = [
      'Recruiting Taking applications',
      'About the team',
      'How you raid',
      'What you ask for',
      'Application questions',
      "Who you're looking for",
      'Discord'
    ];
    for (const n of names)
      expect(
        screen.getByRole('button', { name: new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) })
      ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^About the team.*Not written yet/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^How you raid.*2 of 7 filled in/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Application questions.*4 questions/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Who you're looking for.*1 spot, 1 high/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Discord.*Private ticket/ })).toBeInTheDocument();

    // Recruiting starts open; opening another closes it.
    expect(screen.getByRole('button', { name: /^Recruiting Taking applications/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    await user.click(screen.getByRole('button', { name: /^About the team/ }));
    expect(screen.getByRole('button', { name: /^About the team/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /^Recruiting Taking applications/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('keeps the save bar mounted, greyed until something changes', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers(world()));
    const save = await screen.findByRole('button', { name: 'Save settings' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /List on the guild's apply page/ }));
    expect(save).toBeEnabled();
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(save).toBeDisabled();
  });

  it('saves only what changed', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    await user.click(await screen.findByRole('checkbox', { name: /List on the guild's apply page/ }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual(['save_team_recruiting', { p_team_id: 1, p_changes: { listed_on_guild_page: false } }]);
  });

  it('holds back a ticket-only team with no link, then saves once it has one', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    await user.click(await screen.findByRole('radio', { name: /Discord ticket only/ }));
    expect(
      screen.getByText('Add the link to your Discord ticket, or turn off "Taking applications".')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    await user.type(screen.getByLabelText('Link to your Discord ticket'), 'https://discord.com/channels/1/2');
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]![1]).toEqual({
      p_team_id: 1,
      p_changes: { join_method: 'discord_ticket', ticket_link: 'https://discord.com/channels/1/2' }
    });
  });

  it('writes About with the toolbar and a draft, and counts the characters', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers(world()));
    await open(/^About the team/);
    expect(screen.getByText('0 / 2,000')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start from a draft' }));
    const box = screen.getByRole('textbox', { name: 'About the team' }) as HTMLTextAreaElement;
    expect(box.value).toContain('# Phoenix');
    expect(box.value).toContain('We raid Wednesday.');
    await user.click(screen.getByRole('button', { name: 'Bold' }));
    expect(box.value).toContain('**bold text**');
  });

  it('turns a starter question off, marks one Required, and saves the team’s own questions with them', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    await open(/^Application questions/);
    const why = screen.getByText('Why this team').closest('.rec-question') as HTMLElement;
    await user.click(within(why).getByRole('checkbox', { name: /Required/ }));
    const line = screen.getByText('A line about themselves').closest('.rec-question') as HTMLElement;
    await user.click(within(line).getByRole('checkbox', { name: /A line about themselves/ }));
    expect(within(line).getByRole('checkbox', { name: /Required/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual([
      'save_team_application_questions',
      {
        p_team_id: 1,
        p_starters: {
          about: { on: false, required: false },
          why: { on: true, required: true },
          sent_by: { on: true, required: false }
        },
        // The team's own question rides along, so it isn't deleted.
        p_questions: [
          { id: 9, label: 'Voice', prompt: 'Can you use voice?', answer_type: 'yes_no', choices: null, required: true }
        ]
      }
    ]);
  });

  it('adds a question of the team’s own, with its choices', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    await open(/^Application questions/);
    await user.click(screen.getByRole('button', { name: '+ Add a question' }));
    const fields = screen.getAllByRole('group', { name: 'Question 2' })[0]!;
    await user.type(within(fields).getByLabelText('Short name'), 'Main');
    await user.selectOptions(within(fields).getByLabelText('Type of answer'), 'Pick one');
    await user.type(within(fields).getByLabelText('What applicants see'), 'Your main?');
    await user.type(within(fields).getByLabelText('Choices, one a line'), 'Tank{Enter}Healer');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect((w.rpcs[0]![1]['p_questions'] as object[])[1]).toEqual({
      label: 'Main',
      prompt: 'Your main?',
      answer_type: 'choice',
      choices: ['Tank', 'Healer'],
      required: false
    });
  });

  it('adds a healer spot and ranks it High', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    await open(/^Who you're looking for/);
    await user.selectOptions(screen.getByLabelText('Add a healers spot'), 'Restoration Shaman');
    await user.click(screen.getByRole('button', { name: 'Add to Healers' }));
    await user.selectOptions(screen.getByLabelText('Priority for Restoration Shaman'), 'High');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual([
      'set_team_recruiting_spots',
      { p_team_id: 1, p_spots: [{ role: 'healer', class_spec_id: 1, priority: 'high' }] }
    ]);
  });

  it('puts both melee and ranged under DPS, and offers an Any spot per role', async () => {
    renderApp(PATH, handlers(world()));
    await open(/^Who you're looking for/);
    const dps = screen.getByLabelText('Add a dps spot');
    expect(
      within(dps)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Add a spec, or "Any"', 'Any melee', 'Any ranged', 'Balance Druid', 'Assassination Rogue']);
  });

  it('removes a spot and says Full, not listed for an empty group', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w, { spots: [{ role: 'tank', class_spec_id: 3, priority: 'high' }] }));
    await open(/^Who you're looking for/);
    await user.click(screen.getByRole('button', { name: 'Remove Protection Warrior' }));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual(['set_team_recruiting_spots', { p_team_id: 1, p_spots: [] }]);
  });

  it('marks a ticket category the bot cannot use and says what to add', async () => {
    renderApp(
      PATH,
      handlers(world(), { categoryMissing: ['Manage Channels', 'Attach Files', 'Manage Roles (server setting)'] })
    );
    await open(/^Discord/);
    expect(
      await screen.findByRole('option', { name: /Tickets \(the bot is missing permissions here\)/ })
    ).toBeInTheDocument();
    const note = await screen.findByText(/can't make ticket channels in Tickets/);
    expect(note.textContent).toContain('turn on Manage Channels and Attach Files');
    expect(note.textContent).toContain('give the WGA Raid Hub role Manage Roles under Server Settings');
  });

  it('warns about officers who have not linked Discord, and adds an extra role from the server’s list', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(
      PATH,
      handlers(w, {
        viewers: [
          { display_name: 'Aur', viewer_group: 'officer', discord_linked: true },
          { display_name: 'Kestrel', viewer_group: 'officer', discord_linked: false }
        ]
      })
    );
    await open(/^Discord/);
    expect(
      await screen.findByText(/Kestrel hasn't linked Discord yet and won't be added until they do/)
    ).toBeInTheDocument();
    await user.selectOptions(await screen.findByLabelText('Add a role'), '@Recruiter');
    expect(screen.getByText('@Recruiter')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]![1]).toEqual({ p_team_id: 1, p_changes: { visible_to_role_ids: ['301'] } });
  });

  it('keeps a ticket on while it needs to add them, and a thread needs a ticket', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers(world()));
    await open(/^Discord/);
    expect(await screen.findByRole('checkbox', { name: /Add them to the Discord server/ })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /Just post it in your officer channel/ }));
    expect(screen.getByRole('checkbox', { name: /Add them to the Discord server/ })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Also open an officer-only thread/ })).toBeDisabled();
    expect(screen.getByText(/anyone with Manage Threads there sees every private thread/i)).toBeInTheDocument();
  });

  it('posts Find my ticket at once, not with Save', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    await open(/^Discord/);
    await user.selectOptions(await screen.findByLabelText('Find my ticket channel'), '#start-here');
    await expect
      .poll(() => w.invokes.some((b) => b['action'] === 'find_ticket' && b['channelId'] === '202'))
      .toBe(true);
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
  });

  it('is closed to a raider, and the Officer menu shows Recruiting to an officer', async () => {
    renderApp(PATH, handlers(world(), { role: 'raider' }));
    expect(await screen.findByText(/Recruiting settings/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull();
  });

  it('puts Recruiting between Reports and Settings in the Officer menu', async () => {
    renderApp(PATH, handlers(world()));
    await screen.findByRole('heading', { name: 'Recruiting settings' });
    const menu = screen.getByRole('navigation', { name: 'Main' });
    const labels = within(menu)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');
    const at = (label: string) => labels.findIndex((l) => l.includes(label));
    expect(at('Recruiting')).toBeGreaterThan(at('Reports'));
    expect(at('Recruiting')).toBeLessThan(at('Settings'));
  });
});
