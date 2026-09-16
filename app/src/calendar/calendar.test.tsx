import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import type { PlayerRow } from '../roster/roster';
import {
  ago,
  isDateParam,
  neighbours,
  nightsBetween,
  nightView,
  parseMonth,
  statusFor,
  timeRange,
  weekStart,
  type Answer,
  type ScheduleChange,
  type ScheduleRule
} from './calendar';

// The Calendar page's rules and states (#1102). The behaviour recorded from
// the current site is checked end to end in tests/browser-app/calendar.test.js.

const rule = (weekday: number, optional = false): ScheduleRule => ({
  weekday,
  start_time: '21:00:00',
  duration_minutes: 180,
  is_optional: optional
});
const change = (raid_date: string, exception_type: string, fields: Partial<ScheduleChange> = {}): ScheduleChange => ({
  raid_date,
  exception_type,
  start_time: '14:00:00',
  duration_minutes: 120,
  is_optional: false,
  note: null,
  ...fields
});

const player = (id: number, name: string, role: string, flags: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name_realm: `${name}-Illidan`,
  nickname: null,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  classes_specs: { class: 'Mage', spec: 'Frost', role },
  ...flags
});

const answer = (player_id: number, raid_date: string, status: string, updated_at = `${raid_date}T12:00:00Z`) => ({
  player_id,
  raid_date,
  status,
  updated_at
});

describe('raid nights', () => {
  it('drops a cancelled night, keeps it to show crossed out, and adds an extra night', () => {
    const { nights, cancelled } = nightsBetween(
      [rule(2), rule(4)],
      [change('2026-05-12', 'cancelled'), change('2026-05-16', 'added', { note: 'Catch-up' })],
      '2026-05-10',
      '2026-05-16'
    );
    expect(nights.map((n) => [n.date, n.extra])).toEqual([
      ['2026-05-14', false],
      ['2026-05-16', true]
    ]);
    expect(nights[1]!.note).toBe('Catch-up');
    expect(cancelled.map((c) => c.date)).toEqual(['2026-05-12']);
  });

  it('writes the time out in Eastern, with midnight as a word', () => {
    expect(timeRange({ start: '21:00:00', durationMinutes: 180 })).toBe('9:00 PM to midnight Eastern');
    expect(timeRange({ start: '19:30:00', durationMinutes: 90 })).toBe('7:30 PM to 9:00 PM Eastern');
    expect(timeRange({ start: null, durationMinutes: null })).toBe('Time not set');
  });

  it('steps between raid nights, not calendar days', () => {
    const { nights } = nightsBetween([rule(2), rule(4)], [], '2026-05-01', '2026-05-31');
    expect(neighbours(nights, '2026-05-14')).toEqual({ previous: '2026-05-12', next: '2026-05-19' });
    expect(neighbours(nights, '2026-05-01')).toEqual({ previous: null, next: '2026-05-05' });
  });

  it('puts a rotator in from the Sunday that starts the week', () => {
    expect(weekStart('2026-05-14')).toBe('2026-05-10');
    expect(weekStart('2026-05-10')).toBe('2026-05-10');
  });

  it('only takes a real date or month from the address', () => {
    expect(isDateParam('2026-05-14')).toBe(true);
    expect(isDateParam('2026-02-30')).toBe(false);
    expect(isDateParam('tomorrow')).toBe(false);
    const today = new Date(2026, 8, 16);
    expect(parseMonth('2026-05', today)).toEqual({ year: 2026, month: 4 });
    expect(parseMonth('2026-13', today)).toEqual({ year: 2026, month: 8 });
  });

  it('says when an answer changed in plain words', () => {
    const now = new Date('2026-05-14T12:00:00Z');
    expect(ago('2026-05-14T11:59:40Z', now)).toBe('Just now');
    expect(ago('2026-05-14T10:00:00Z', now)).toBe('2 hours ago');
    expect(ago('2026-05-13T10:00:00Z', now)).toBe('Yesterday');
  });
});

describe('a night’s statuses', () => {
  const night = { optional: false };
  const optional = { optional: true };

  it('keeps the bench and rotators apart on a normal night only', () => {
    expect(statusFor(player(1, 'A', 'Tank', { is_bench: true }), night)).toEqual({
      label: 'Bench',
      kind: 'apart',
      answered: false
    });
    expect(statusFor(player(1, 'A', 'Tank', { is_rotator: true }), optional).label).toBe('No answer');
  });

  it('reads a rotator put in for the week as coming', () => {
    const rotator = player(1, 'A', 'Tank', { is_rotator: true });
    expect(statusFor(rotator, night, answer(1, '2026-05-14', 'Rotator-In'))).toEqual({
      label: 'In this week',
      kind: 'in',
      answered: true
    });
  });

  it('moves out and late raiders to Heads up, and counts the late ones as coming', () => {
    const players = [
      player(1, 'Ana', 'Tank'),
      player(2, 'Bo', 'Heal'),
      player(3, 'Cy', 'Ranged'),
      player(4, 'Di', 'Ranged', { is_bench: true }),
      player(5, 'Ed', 'Melee', { classes_specs: null })
    ];
    const n = { date: '2026-05-14', start: null, durationMinutes: null, optional: false, extra: false, note: '' };
    const view = nightView(players, n, [
      answer(2, '2026-05-14', 'Absent'),
      { ...answer(3, '2026-05-14', 'Leaving Early', '2026-05-14T13:00:00Z'), note: 'Out at 11' },
      answer(1, '2026-05-12', 'Absent')
    ]);
    expect(view.headsUp.out.map((r) => r.name)).toEqual(['Bo']);
    expect(view.headsUp.flagged.map((r) => [r.name, r.status.label, r.note])).toEqual([
      ['Cy', 'Leaving early', 'Out at 11']
    ]);
    expect(view.counts).toEqual({ in: 2, flagged: 1, out: 1, apart: 1 });
    expect(view.groups.map((g) => [g.label, g.rows.map((r) => r.name), g.coming, g.total])).toEqual([
      ['Tanks', ['Ana'], 1, 1],
      ['Healers', [], 0, 1],
      ['Ranged', [], 1, 1]
    ]);
    expect(view.groups[2]!.apart.map((r) => r.name)).toEqual(['Di']);
    expect(view.latest.map((r) => r.name)).toEqual(['Cy', 'Bo']);
  });

  it('keeps everyone in the columns on an optional night until they answer', () => {
    const n = { date: '2026-05-17', start: null, durationMinutes: null, optional: true, extra: false, note: '' };
    const view = nightView([player(1, 'Ana', 'Tank'), player(2, 'Bo', 'Tank')], n, [
      answer(2, '2026-05-17', 'Attending')
    ]);
    expect(view.headsUp).toEqual({ out: [], flagged: [] });
    expect(view.groups[0]!.rows.map((r) => [r.name, r.status.label])).toEqual([
      ['Ana', 'No answer'],
      ['Bo', 'Attending']
    ]);
    expect(view.counts.in).toBe(1);
  });
});

// The page

const ROSTER = [player(1, 'Ana', 'Tank'), player(2, 'Bo', 'Heal'), player(3, 'Cy', 'Ranged')];
const ANSWERS: Answer[] = [{ ...answer(2, '2026-05-14', 'Absent'), note: 'Away' }];

const who = (role: string) => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role,
      characters: [{ player_id: 1, name_realm: 'Ana-Illidan', url_code: null, archived_at: null }]
    }
  ]
});

function handlers(
  person: ReturnType<typeof who> | null,
  options: { fail?: string; tables?: Record<string, (read: Read) => unknown> } = {}
): FakeHandlers {
  const base = seededHandlers();
  const tables: Record<string, (read: Read) => unknown> = {
    raid_schedule: () => [rule(2), rule(4)],
    raid_schedule_exceptions: () => [],
    players: () => ROSTER,
    // An officer's read has no player filter; a raider's own read does.
    raid_rsvps: (read) => {
      const own = read.filters.find(([op, column]) => op === 'in' && column === 'player_id');
      return own ? ANSWERS.filter((a) => (own[2] as number[]).includes(a.player_id)) : ANSWERS;
    },
    ...options.tables
  };
  return seededHandlers({
    ...(person ? { session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }) } : {}),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: person ? 'discord-ana' : null };
      if (name === 'resolve_person') return { data: person };
      if (name === 'team_rsvp_answers')
        return {
          data: ANSWERS.map(({ player_id, raid_date, status, updated_at }) => ({
            player_id,
            raid_date,
            status,
            updated_at
          }))
        };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table === options.fail) return { error: { message: 'statement timeout' } };
      if (read.table in tables) return { data: tables[read.table]!(read) };
      return base.from!(read);
    }
  });
}

describe('the Calendar page', () => {
  it('shows a month’s nights, each linking to its own page', async () => {
    renderApp('/g/wga/t/phoenix/calendar?month=2026-05', handlers(null));
    const grid = within(await screen.findByRole('region', { name: 'Raid nights in May 2026' }));
    const links = await grid.findAllByRole('link');
    expect(links).toHaveLength(8);
    expect(links[0]).toHaveAttribute('href', '/g/wga/t/phoenix/calendar?date=2026-05-05');
    expect(links[0]).toHaveAccessibleName('Tue, May 5, Raid night, 9:00 PM');
    expect(screen.getByText('Raids Tuesday and Thursday, 9:00 PM to midnight Eastern.')).toBeInTheDocument();
  });

  it('never asks for answers when signed out', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14', handlers(null));
    expect(await screen.findByText('Sign in to see who’s coming and to give your answer.')).toBeInTheDocument();
    expect(client.reads.some((r) => r.table === 'raid_rsvps')).toBe(false);
    expect(client.rpcs.some(([name]) => name === 'team_rsvp_answers')).toBe(false);
  });

  it('reads a raider’s teammates through the notes-free read', async () => {
    const { client } = renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14', handlers(who('raider')));
    const headsUp = within(await screen.findByRole('region', { name: 'Heads up' }));
    expect(await headsUp.findByText('Bo')).toBeInTheDocument();
    expect(headsUp.queryByText('“Away”')).not.toBeInTheDocument();
    expect(client.rpcs).toContainEqual([
      'team_rsvp_answers',
      { p_team_id: 1, p_from: '2026-05-14', p_to: '2026-05-14' }
    ]);
    // Their own notes come from their own rows only.
    const own = client.reads.find((r) => r.table === 'raid_rsvps')!;
    expect(own.filters).toContainEqual(['in', 'player_id', [1]]);
    expect(screen.queryByRole('button', { name: /Change .*’s answer/ })).not.toBeInTheDocument();
  });

  it('shows an officer the notes, and a way to change an answer', async () => {
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14', handlers(who('officer')));
    const headsUp = within(await screen.findByRole('region', { name: 'Heads up' }));
    expect(await headsUp.findByText('“Away”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Bo’s answer' })).toBeInTheDocument();
  });

  it('says so on a date with no raid', async () => {
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-13', handlers(who('officer')));
    expect(await screen.findByText('The team has no raid on this date.')).toBeInTheDocument();
  });

  it('says so on a cancelled night', async () => {
    renderApp(
      '/g/wga/t/phoenix/calendar?date=2026-05-14',
      handlers(who('officer'), { tables: { raid_schedule_exceptions: () => [change('2026-05-14', 'cancelled')] } })
    );
    expect(await screen.findByText('This raid night was cancelled.')).toBeInTheDocument();
  });

  it('shows the error when the schedule cannot load, and keeps the heading', async () => {
    renderApp('/g/wga/t/phoenix/calendar?month=2026-05', handlers(null, { fail: 'raid_schedule' }));
    expect(await screen.findByText('Couldn’t load the calendar.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
  });
});
