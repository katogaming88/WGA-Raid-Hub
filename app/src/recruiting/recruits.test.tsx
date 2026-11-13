import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import { easternToday } from '../lib/dates';
import {
  age,
  notOnNeeds,
  tabCounts,
  trialDay,
  trialEnds,
  underMinimum,
  waitingOnOfficers,
  whereItsAt,
  type Need,
  type Recruit,
  type RecruitList,
  type RecruitRecord
} from './recruits';

// The Recruits page (#1549): tabs and counts, the list's columns and
// warnings, on-trial rows, the recruit's record beside it, and the buttons.

const PATH = '/g/wga/t/phoenix/officer/recruiting';

const HOUR = 3_600_000;
// A minute over, so a test that takes a moment still reads the same unit.
const ago = (ms: number) => new Date(Date.now() - ms - 60_000).toISOString();
const dayOffset = (days: number) => {
  const [y, m, d] = easternToday().split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};

const base: Recruit = {
  id: 0,
  name: null,
  name_realm: 'X-Y',
  class_name: null,
  spec_name: null,
  item_level: null,
  mplus_score: null,
  logs_best_average: null,
  logs_median_average: null,
  mythic_bosses_killed: null,
  source: 'application',
  status: 'waiting_on_officers',
  sent_by: 'nobody',
  sent_by_name: null,
  applied_at: ago(2 * HOUR),
  closed_at: null,
  applicant_last_message_at: null,
  officers_last_message_at: null,
  trial_starts_on: null,
  trial_ends_on: null,
  reminded: false,
  ticket_url: null
};

const NEEDS: Need[] = [{ role: 'healer', class_spec_id: 1, class: 'Shaman', spec: 'Restoration', priority: 'high' }];

const SPECS = [
  { id: 1, class: 'Shaman', spec: 'Restoration', role: 'Heal' },
  { id: 2, class: 'Warlock', spec: 'Demonology', role: 'Ranged' },
  { id: 3, class: 'Warrior', spec: 'Fury', role: 'Melee' }
];

function recruits(): Recruit[] {
  return [
    {
      ...base,
      id: 1,
      name_realm: 'Katorrí-Stormrage',
      class_name: 'Warlock',
      spec_name: 'Demonology',
      item_level: 268,
      mplus_score: 2840,
      logs_best_average: 91,
      mythic_bosses_killed: 4,
      sent_by: 'recruiter',
      sent_by_name: 'Dana',
      ticket_url: 'https://discord.com/channels/1/2'
    },
    {
      ...base,
      id: 2,
      name_realm: 'Lumenae-Area 52',
      class_name: 'Shaman',
      spec_name: 'Restoration',
      item_level: 258,
      logs_best_average: 48,
      status: 'waiting_on_applicant',
      applied_at: ago(5 * 24 * HOUR),
      officers_last_message_at: ago(4 * 24 * HOUR),
      reminded: true
    },
    {
      ...base,
      id: 3,
      name_realm: 'Torbjorn-Illidan',
      class_name: 'Warrior',
      spec_name: 'Fury',
      item_level: 270,
      status: 'on_trial',
      trial_starts_on: dayOffset(-11),
      trial_ends_on: dayOffset(3)
    },
    {
      ...base,
      id: 4,
      name_realm: 'Brightmane-Draenor',
      class_name: 'Paladin',
      spec_name: 'Holy',
      item_level: 272,
      status: 'joined',
      closed_at: ago(24 * HOUR)
    },
    {
      ...base,
      id: 5,
      name_realm: 'Gone-Silvermoon',
      class_name: 'Mage',
      spec_name: 'Fire',
      status: 'declined',
      closed_at: ago(48 * HOUR)
    }
  ];
}

const RECORD: RecruitRecord = {
  access: 'manage',
  id: 1,
  team_name: 'Team Phoenix',
  name: 'Kat',
  name_realm: 'Katorrí-Stormrage',
  class_name: 'Warlock',
  spec_name: 'Demonology',
  other_specs: ['Destruction'],
  status: 'waiting_on_officers',
  answers: [
    {
      key: 'nights',
      label: 'Can you make our raid nights?',
      prompt: '',
      answer_type: 'short_text',
      answer: 'Every week'
    },
    {
      key: 'log',
      label: "Log you're proud of",
      prompt: '',
      answer_type: 'link',
      answer: 'https://www.warcraftlogs.com/reports/abc'
    },
    { key: 'voice', label: 'Can you use voice chat?', prompt: '', answer_type: 'yes_no', answer: true }
  ],
  notes: [
    {
      id: 1,
      author: 'Dana',
      mine: false,
      body: 'Great attitude, can do Wed/Thu.',
      source: 'site',
      created_at: ago(HOUR)
    },
    { id: 2, author: 'Aur', mine: true, body: 'Seen them in keys.', source: 'site', created_at: ago(HOUR / 2) }
  ],
  events: [
    { kind: 'applied', actor: null, detail: null, created_at: ago(2 * HOUR) },
    { kind: 'note_added', actor: 'Dana', detail: null, created_at: ago(HOUR) }
  ],
  messages: [],
  applied_before: [],
  ticket_deleted_at: null
};

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

type World = { rpcs: [string, Record<string, unknown>][] };
const WRITES = [
  'add_recruit_note',
  'start_recruit_trial',
  'close_recruit',
  'reopen_recruit',
  'mark_recruit_joined',
  'extend_recruit_trial',
  'mark_recruit_not_joining'
];

function handlers(
  world: World,
  over: { list?: Partial<RecruitList>; record?: Partial<RecruitRecord>; failWith?: string } = {}
): FakeHandlers {
  const base = seededHandlers();
  const list: RecruitList = { access: 'manage', min_item_level: 265, needs: NEEDS, recruits: recruits(), ...over.list };
  return seededHandlers({
    session: fakeSession({ battlenet: 'Kat#1', discord: { id: 'd', name: 'Kat' } }),
    rpc(name, args) {
      switch (name) {
        case 'current_discord_id':
          return { data: 'd' };
        case 'resolve_person':
          return { data: officer };
        case 'team_recruits':
          return { data: list };
        case 'recruit_record':
          return { data: { ...RECORD, access: list.access, ...over.record, id: args['p_application_id'] } };
        default:
          if (WRITES.includes(name)) {
            world.rpcs.push([name, args]);
            return over.failWith ? { data: null, error: { message: over.failWith } } : { data: null };
          }
          return base.rpc!(name, args);
      }
    },
    from(read) {
      if (read.table === 'classes_specs') return { data: SPECS };
      return base.from!(read);
    }
  });
}

const world = (): World => ({ rpcs: [] });

describe('the rules behind the page', () => {
  // Read when each test runs, so the minute ago() adds stays in front of it.
  const now = { getTime: () => Date.now() } as Date;
  it('counts the tabs and who is waiting on officers', () => {
    expect(tabCounts(recruits())).toEqual({ open: 2, trial: 1, joined: 1, declined: 1, noreply: 0 });
    expect(waitingOnOfficers(recruits())).toBe(1);
  });

  it('says how long in the largest whole unit', () => {
    expect(age(ago(19 * 60_000), now)).toBe('20 m');
    expect(age(ago(2 * HOUR), now)).toBe('2 h');
    expect(age(ago(30 * HOUR), now)).toBe('1 d');
    expect(age(ago(4 * 24 * HOUR), now)).toBe('4 d');
  });

  it('counts the trial day by its dates', () => {
    const r = { ...base, trial_starts_on: '2026-11-01', trial_ends_on: '2026-11-15' };
    expect(trialDay(r, '2026-11-12')).toEqual({ day: 12, of: 14 });
    expect(trialDay(r, '2026-11-30')).toEqual({ day: 14, of: 14 });
    expect(trialEnds(r, '2026-11-12')).toBe('ends Sunday');
    expect(trialEnds(r, '2026-11-15')).toBe('ends today');
    expect(trialEnds(r, '2026-11-02')).toBe('ends Nov 15');
  });

  it('reads where it is at from whose turn it is', () => {
    const [officers, applicant] = recruits();
    expect(whereItsAt(officers!, now, easternToday())).toEqual({ label: 'Waiting on officers', detail: '2 h' });
    expect(whereItsAt(applicant!, now, easternToday())).toEqual({
      label: 'Waiting on them',
      detail: '4 d · reminded'
    });
  });

  it('flags an item level under the minimum and a class nobody asked for', () => {
    expect(underMinimum({ item_level: 258 }, 265)).toBe(true);
    expect(underMinimum({ item_level: 265 }, 265)).toBe(false);
    expect(underMinimum({ item_level: null }, 265)).toBe(false);
    expect(underMinimum({ item_level: 100 }, null)).toBe(false);
    expect(notOnNeeds({ class_name: 'Warlock' }, NEEDS, SPECS)).toBe(true);
    expect(notOnNeeds({ class_name: 'Shaman' }, NEEDS, SPECS)).toBe(false);
    // "Any ranged" covers every class with a ranged spec; no spots asks for everyone.
    const anyRanged: Need[] = [{ role: 'ranged', class_spec_id: null, class: null, spec: null, priority: 'low' }];
    expect(notOnNeeds({ class_name: 'Warlock' }, anyRanged, SPECS)).toBe(false);
    expect(notOnNeeds({ class_name: 'Warrior' }, anyRanged, SPECS)).toBe(true);
    expect(notOnNeeds({ class_name: 'Warlock' }, [], SPECS)).toBe(false);
  });
});

describe('the Recruits page', () => {
  it('lists the open recruits with warnings and where each stands', async () => {
    renderApp(PATH, handlers(world()));
    expect(await screen.findByRole('heading', { name: 'Recruits' })).toBeInTheDocument();
    const tabs = await screen.findByRole('navigation', { name: 'Recruit status' });
    expect(within(tabs).getByRole('link', { name: 'Open 2' })).toHaveAttribute('aria-current', 'page');
    for (const name of ['On trial 1', 'Joined 1', 'Declined 1', 'No reply 0'])
      expect(within(tabs).getByRole('link', { name })).toBeInTheDocument();

    const table = await screen.findByRole('table');
    for (const h of ['Recruit', 'Spec', 'Item level', 'Logs', 'Where it’s at', 'Sent by'])
      expect(within(table).getByRole('columnheader', { name: h })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    const kat = rows.find((r) => within(r).queryByRole('link', { name: 'Katorrí' }))!;
    expect(within(kat).getByText('Demonology Warlock')).toBeInTheDocument();
    expect(within(kat).getByText('Waiting on officers')).toBeInTheDocument();
    expect(within(kat).getByText('Dana')).toBeInTheDocument();
    // A Warlock isn't on a needs list asking for one healer spec.
    expect(within(kat).getByText('Not on your needs list')).toBeInTheDocument();
    expect(within(kat).getByText('268')).not.toHaveClass('rcs-warn');
    const lumenae = rows.find((r) => within(r).queryByRole('link', { name: 'Lumenae' }))!;
    expect(within(lumenae).getByText('258')).toHaveClass('rcs-warn');
    expect(within(lumenae).queryByText('Not on your needs list')).not.toBeInTheDocument();
    expect(within(lumenae).getByText(/Waiting on them/)).toBeInTheDocument();
    expect(within(lumenae).getByText(/4 d · reminded/)).toBeInTheDocument();
    expect(within(lumenae).getByText('Found us')).toBeInTheDocument();
    // The others are on other tabs.
    expect(within(table).queryByRole('link', { name: 'Torbjorn' })).not.toBeInTheDocument();
  });

  it('shows the on-trial day and the three trial buttons, and Extend asks why', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(`${PATH}?tab=trial`, handlers(w));
    const row = (await screen.findByRole('link', { name: 'Torbjorn' })).closest('tr')!;
    expect(within(row).getByText('Day 12 of 14')).toBeInTheDocument();
    expect(within(row).getByText(/ends /)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Joined' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Not joining' })).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Extend trial' }));
    const dialog = await screen.findByRole('dialog', { name: /Extend Torbjorn-Illidan/ });
    const go = within(dialog).getByRole('button', { name: 'Extend trial' });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Why is it extended?'), 'Missed two raids for a move');
    await user.click(go);
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual([
      'extend_recruit_trial',
      { p_application_id: 3, p_reason: 'Missed two raids for a move' }
    ]);
  });

  it('marks someone who joined, and takes a reason for not joining', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(`${PATH}?tab=trial`, handlers(w));
    const row = (await screen.findByRole('link', { name: 'Torbjorn' })).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Joined' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual(['mark_recruit_joined', { p_application_id: 3 }]);

    await user.click(within(row).getByRole('button', { name: 'Not joining' }));
    const dialog = await screen.findByRole('dialog', { name: /is not joining/ });
    const go = within(dialog).getByRole('button', { name: 'Not joining' });
    expect(go).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText('Why'), 'schedule_conflict');
    await user.click(go);
    await expect.poll(() => w.rpcs.length).toBe(2);
    expect(w.rpcs[1]).toEqual([
      'mark_recruit_not_joining',
      { p_application_id: 3, p_reason: 'schedule_conflict', p_detail: null }
    ]);
  });

  it('opens the first recruit beside the list, with what they sent and what has happened', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers(world()));
    const panel = await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    await within(panel).findByText('Great attitude, can do Wed/Thu.');
    expect(within(panel).getByRole('heading', { name: 'Katorrí-Stormrage' })).toBeInTheDocument();
    expect(within(panel).getByText(/Demonology Warlock/)).toBeInTheDocument();
    expect(within(panel).getByText(/also Destruction/)).toBeInTheDocument();
    expect(within(panel).getByText(/Sent by Dana/)).toBeInTheDocument();
    // The recruiter's note is theirs, apart from the officers' notes.
    expect(within(panel).getByText('Seen them in keys.')).toBeInTheDocument();
    expect(within(panel).getByText('2,840')).toBeInTheDocument();
    expect(within(panel).getByText('91')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Open their ticket/ })).toHaveAttribute(
      'href',
      'https://discord.com/channels/1/2'
    );
    expect(within(panel).getByRole('link', { name: /Warcraft Logs/ })).toHaveAttribute(
      'href',
      'https://www.warcraftlogs.com/character/us/stormrage/Katorr%C3%AD'
    );
    // Two answers, then the whole application.
    expect(within(panel).getByText('Every week')).toBeInTheDocument();
    expect(within(panel).queryByText('Can you use voice chat?')).not.toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'See the whole application' }));
    expect(within(panel).getByText('Can you use voice chat?')).toBeInTheDocument();
    expect(within(panel).getByText('Yes')).toBeInTheDocument();
    // Newest first.
    const history = within(within(panel).getByRole('list', { name: 'History, newest first' })).getAllByRole('listitem');
    expect(history.map((li) => li.textContent)).toEqual(['1 h agoDana: Added a note', '2 h agoApplied']);
  });

  it('switches recruit from the list', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers(world()));
    await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    await user.click(screen.getByRole('link', { name: 'Lumenae' }));
    expect(await screen.findByRole('region', { name: "Lumenae-Area 52's record" })).toBeInTheDocument();
  });

  it('adds an officer note', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    const panel = await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    const add = await within(panel).findByRole('button', { name: 'Add note' });
    expect(add).toBeDisabled();
    await user.type(within(panel).getByLabelText('Add a note'), 'Wants Thursdays');
    await user.click(add);
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual(['add_recruit_note', { p_application_id: 1, p_body: 'Wants Thursdays' }]);
  });

  it('starts a trial from the record', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    const panel = await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    await user.click(await within(panel).findByRole('button', { name: 'Start a trial' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual(['start_recruit_trial', { p_application_id: 1 }]);
  });

  it('declines with a reason', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(PATH, handlers(w));
    const panel = await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    await user.click(await within(panel).findByRole('button', { name: 'Decline' }));
    const dialog = await screen.findByRole('dialog', { name: /Decline Katorrí-Stormrage/ });
    await user.type(within(dialog).getByLabelText('Reason (optional)'), 'Full on healers');
    await user.click(within(dialog).getByRole('button', { name: 'Decline' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual([
      'close_recruit',
      { p_application_id: 1, p_status: 'declined', p_reason: 'Full on healers' }
    ]);
  });

  it('shows the database’s refusal in the dialog instead of closing it', async () => {
    const user = userEvent.setup();
    renderApp(PATH, handlers(world(), { failWith: 'Only an open recruit who isn’t on trial can start one' }));
    const panel = await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    await user.click(await within(panel).findByRole('button', { name: 'Start a trial' }));
    expect((await screen.findAllByRole('alert')).map((a) => a.textContent).join(' ')).toMatch(/isn’t on trial/);
  });

  it('lets an assistant add notes and nothing else', async () => {
    renderApp(PATH, handlers(world(), { list: { access: 'note' } }));
    const panel = await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    expect(await within(panel).findByRole('button', { name: 'Add note' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Start a trial' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Decline' })).not.toBeInTheDocument();
  });

  it('is read-only for someone who may only look', async () => {
    renderApp(PATH, handlers(world(), { list: { access: 'read' } }));
    const panel = await screen.findByRole('region', { name: "Katorrí-Stormrage's record" });
    expect(await within(panel).findByText(/You can read this record/)).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Add note' })).not.toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'Start a trial' })).not.toBeInTheDocument();
  });

  it('can reopen a declined recruit', async () => {
    const user = userEvent.setup();
    const w = world();
    renderApp(`${PATH}?tab=declined`, handlers(w));
    const panel = await screen.findByRole('region', { name: "Gone-Silvermoon's record" });
    await user.click(await within(panel).findByRole('button', { name: 'Reopen' }));
    await expect.poll(() => w.rpcs.length).toBe(1);
    expect(w.rpcs[0]).toEqual(['reopen_recruit', { p_application_id: 5 }]);
  });

  it('says so when a tab is empty', async () => {
    renderApp(`${PATH}?tab=noreply`, handlers(world()));
    expect(await screen.findByText('No ticket has closed for lack of a reply.')).toBeInTheDocument();
  });

  it('counts the ones waiting on officers in the sidebar', async () => {
    renderApp(PATH, handlers(world()));
    expect(await screen.findByRole('link', { name: 'Recruits, 1 waiting' })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/officer/recruiting'
    );
  });
});
