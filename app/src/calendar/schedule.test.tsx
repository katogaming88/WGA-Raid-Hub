import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import { nightHeading, nightsBetween, shortDay, type ScheduleChange } from './calendar';
import {
  draftProblem,
  extraNightProblem,
  NEW_EXTRA_NIGHT,
  NEW_NIGHT,
  nightAuditDetail,
  WEEKDAY_NAMES
} from './schedule';

// The officer's raid schedule (#1361): the Edit schedule panel and one-off
// changes from a night's own page. Dates are years ahead, since an officer
// changes the schedule only from today on.

const FUTURE_NIGHT = '2030-05-14';
const EMPTY_DAY = '2030-05-15';
const WEEKDAY = new Date(2030, 4, 14).getDay();
const DAY = WEEKDAY_NAMES[WEEKDAY]!;

const WEEKLY_ROW = {
  id: 7,
  weekday: WEEKDAY,
  start_time: '20:00:00',
  timezone: 'America/New_York',
  duration_minutes: 180,
  active: true,
  is_optional: false,
  difficulty: null
};

const cancelled = (fields: Partial<ScheduleChange> = {}): ScheduleChange => ({
  raid_date: FUTURE_NIGHT,
  exception_type: 'cancelled',
  start_time: null,
  duration_minutes: null,
  is_optional: false,
  note: null,
  ...fields
});

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

const PLAYER = {
  id: 1,
  name_realm: 'Ana-Illidan',
  nickname: null,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  classes_specs: { class: 'Mage', spec: 'Frost', role: 'Ranged' }
};

function handlers(role: string, changes: ScheduleChange[] = []): FakeHandlers {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: who(role) };
      if (name === 'team_rsvp_answers') return { data: [] };
      return base.rpc!(name, args);
    },
    from(read: Read) {
      // The Calendar reads the weekly nights without ids; the editor reads every column.
      if (read.table === 'raid_schedule')
        return {
          data: read.columns?.includes('timezone')
            ? [WEEKLY_ROW]
            : [{ weekday: WEEKDAY, start_time: '20:00:00', duration_minutes: 180, is_optional: false }]
        };
      if (read.table === 'raid_schedule_exceptions') return { data: changes };
      if (read.table === 'team_schedule_settings') return { data: { default_difficulty: 'mythic' } };
      if (read.table === 'players') return { data: [PLAYER] };
      if (read.table === 'raid_rsvps') return { data: [] };
      return base.from!(read);
    }
  });
}

const MONTH = '/g/wga/t/phoenix/calendar?month=2030-05';

async function openEditor(role = 'officer') {
  const user = userEvent.setup();
  const app = renderApp(MONTH, handlers(role));
  await user.click(await screen.findByRole('button', { name: 'Edit schedule' }));
  const editor = within(await screen.findByRole('region', { name: 'Raid schedule' }));
  return { user, editor, client: app.client };
}

describe('the Edit schedule panel', () => {
  it('is for officers only', async () => {
    renderApp(MONTH, handlers('raider'));
    expect(await screen.findByRole('region', { name: 'Raid nights in May 2030' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit schedule' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add a raid night/ })).not.toBeInTheDocument();
  });

  it('lists the weekly nights, each following the team default unless set', async () => {
    const { editor } = await openEditor();
    expect(await editor.findByRole('combobox', { name: `${DAY} difficulty` })).toHaveDisplayValue(
      'Team default (Mythic)'
    );
    expect(editor.getByRole('combobox', { name: 'Team default difficulty' })).toHaveDisplayValue('Mythic');
    expect(screen.getByRole('button', { name: 'Edit schedule' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('saves the team default, with the current site’s audit entry', async () => {
    const { user, editor, client } = await openEditor();
    await user.selectOptions(await editor.findByRole('combobox', { name: 'Team default difficulty' }), 'Heroic');
    await user.click(editor.getByRole('button', { name: 'Save default' }));
    await vi.waitFor(() =>
      expect(client.writes).toContainEqual({
        table: 'team_schedule_settings',
        method: 'upsert',
        values: { team_id: 1, default_difficulty: 'heroic' },
        filters: []
      })
    );
    await vi.waitFor(() =>
      expect(client.rpcs).toContainEqual([
        'write_audit_log',
        {
          p_team_id: 1,
          p_action: 'Raid Difficulty Default Updated',
          p_target_type: 'team_schedule_settings',
          p_target_id: 1,
          p_detail: 'Heroic'
        }
      ])
    );
  });

  it('saves a weekly night once something on it changed', async () => {
    const { user, editor, client } = await openEditor();
    const save = await editor.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.selectOptions(editor.getByRole('combobox', { name: `${DAY} difficulty` }), 'Heroic');
    await user.click(save);
    await vi.waitFor(() =>
      expect(client.writes).toContainEqual({
        table: 'raid_schedule',
        method: 'update',
        values: {
          weekday: WEEKDAY,
          start_time: '20:00',
          duration_minutes: 180,
          timezone: 'America/New_York',
          is_optional: false,
          active: true,
          difficulty: 'heroic'
        },
        filters: [['eq', 'id', 7]]
      })
    );
    await vi.waitFor(() =>
      expect(client.rpcs).toContainEqual([
        'write_audit_log',
        {
          p_team_id: 1,
          p_action: 'Raid Schedule Updated',
          p_target_type: 'raid_schedule',
          p_target_id: 7,
          p_detail: `${DAY} 20:00 (Heroic)`
        }
      ])
    );
  });

  it('adds a weekly night only when its own Save is pressed', async () => {
    const { user, editor, client } = await openEditor();
    await user.click(await editor.findByRole('button', { name: '+ Add a night' }));
    expect(client.writes).toEqual([]);
    await user.selectOptions(editor.getByRole('combobox', { name: 'Day of the new night' }), 'Sunday');
    await user.click(editor.getAllByRole('button', { name: 'Save' }).at(-1)!);
    await vi.waitFor(() =>
      expect(client.writes).toContainEqual(
        expect.objectContaining({
          table: 'raid_schedule',
          method: 'insert',
          values: expect.objectContaining({ team_id: 1, weekday: 0, start_time: '20:00', difficulty: null })
        })
      )
    );
  });

  it('asks before removing a weekly night', async () => {
    const { user, editor, client } = await openEditor();
    await user.click(await editor.findByRole('button', { name: 'Remove' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(client.writes).toEqual([]);
    await user.click(dialog.getByRole('button', { name: 'Remove the night' }));
    await vi.waitFor(() =>
      expect(client.writes).toContainEqual({
        table: 'raid_schedule',
        method: 'delete',
        values: undefined,
        filters: [['eq', 'id', 7]]
      })
    );
  });
});

describe('changes to one date', () => {
  it('links an officer from an empty day to adding a night there', async () => {
    renderApp(MONTH, handlers('officer'));
    const link = await screen.findByRole('link', { name: `Add a raid night on ${shortDay(EMPTY_DAY)}` });
    expect(link).toHaveAttribute('href', `/g/wga/t/phoenix/calendar?date=${EMPTY_DAY}`);
  });

  it('cancels one night from its own page, with a reason raiders see', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(`/g/wga/t/phoenix/calendar?date=${FUTURE_NIGHT}`, handlers('officer'));
    await user.click(await screen.findByRole('button', { name: 'Cancel this night' }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByRole('textbox', { name: 'Why (raiders see it, optional)' }), 'Thanksgiving');
    await user.click(dialog.getByRole('button', { name: 'Cancel the night' }));
    await vi.waitFor(() =>
      expect(client.writes).toContainEqual({
        table: 'raid_schedule_exceptions',
        method: 'insert',
        values: {
          team_id: 1,
          raid_date: FUTURE_NIGHT,
          exception_type: 'cancelled',
          start_time: null,
          duration_minutes: null,
          is_optional: false,
          difficulty: null,
          note: 'Thanksgiving',
          created_by: 1
        },
        filters: []
      })
    );
  });

  it('shows why a night was cancelled, and lets an officer bring it back', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      `/g/wga/t/phoenix/calendar?date=${FUTURE_NIGHT}`,
      handlers('officer', [cancelled({ id: 31, note: 'Thanksgiving' })])
    );
    expect(await screen.findByText('Thanksgiving')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bring this night back' }));
    await vi.waitFor(() =>
      expect(client.writes).toContainEqual({
        table: 'raid_schedule_exceptions',
        method: 'delete',
        values: undefined,
        filters: [['eq', 'id', 31]]
      })
    );
  });

  it('shows a raider the reason, with no way to change it', async () => {
    renderApp(
      `/g/wga/t/phoenix/calendar?date=${FUTURE_NIGHT}`,
      handlers('raider', [cancelled({ id: 31, note: 'Thanksgiving' })])
    );
    expect(await screen.findByText('Thanksgiving')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bring this night back' })).not.toBeInTheDocument();
  });

  it('adds an extra night on an empty day once its difficulty is chosen', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(`/g/wga/t/phoenix/calendar?date=${EMPTY_DAY}`, handlers('officer'));
    const add = await screen.findByRole('button', { name: 'Add the night' });
    expect(add).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Difficulty (required)' }), 'Heroic');
    await user.click(add);
    await vi.waitFor(() =>
      expect(client.writes).toContainEqual({
        table: 'raid_schedule_exceptions',
        method: 'insert',
        values: {
          team_id: 1,
          raid_date: EMPTY_DAY,
          exception_type: 'added',
          start_time: '20:00',
          duration_minutes: 180,
          is_optional: false,
          difficulty: 'heroic',
          note: null,
          created_by: 1
        },
        filters: []
      })
    );
  });

  it('changes nothing about a date that has passed', async () => {
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-13', handlers('officer'));
    expect(await screen.findByText('The team has no raid on this date.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add the night' })).not.toBeInTheDocument();
  });
});

describe('the schedule’s rules', () => {
  it('needs a start, at least 15 minutes and a timezone to save a weekly night', () => {
    expect(draftProblem(NEW_NIGHT)).toBeNull();
    expect(draftProblem({ ...NEW_NIGHT, start: '' })).toBe('Give the night a start time.');
    expect(draftProblem({ ...NEW_NIGHT, duration: '10' })).toBe('A night is at least 15 minutes long.');
    expect(draftProblem({ ...NEW_NIGHT, timezone: ' ' })).toBe('Choose a timezone.');
  });

  it('makes an extra night name its difficulty', () => {
    expect(extraNightProblem(NEW_EXTRA_NIGHT)).toMatch(/^Choose what this night is for/);
    expect(extraNightProblem({ ...NEW_EXTRA_NIGHT, difficulty: 'mythic' })).toBeNull();
  });

  it('writes a weekly night’s audit line as the current site does', () => {
    expect(
      nightAuditDetail({ ...NEW_NIGHT, weekday: 4, start: '19:30', optional: true, difficulty: 'heroic_into_mythic' })
    ).toBe('Thursday 19:30 (optional) (Heroic into Mythic)');
    expect(nightAuditDetail({ ...NEW_NIGHT, active: false })).toBe('Tuesday 20:00 (inactive)');
  });

  it('gives each night its own difficulty, else the team default', () => {
    const rules = [
      { weekday: 2, start_time: '20:00:00', duration_minutes: 180, is_optional: false, difficulty: null },
      { weekday: 4, start_time: '20:00:00', duration_minutes: 180, is_optional: false, difficulty: 'heroic' }
    ];
    const extra = { ...cancelled({ raid_date: '2030-05-11', exception_type: 'added' }), difficulty: null };
    const { nights } = nightsBetween(rules, [extra], '2030-05-11', '2030-05-16', 'mythic');
    expect(nights.map((n) => [n.date, n.difficulty])).toEqual([
      ['2030-05-11', 'mythic'],
      ['2030-05-14', 'mythic'],
      ['2030-05-16', 'heroic']
    ]);
  });

  it('heads a normal night by its difficulty, and keeps the word on optional and extra nights', () => {
    const base = { optional: false, extra: false, difficulty: 'mythic' as const };
    expect(nightHeading(base)).toMatchObject({ title: 'Mythic', level: null });
    expect(nightHeading({ ...base, difficulty: null })).toMatchObject({ title: 'Raid night', level: null });
    expect(nightHeading({ ...base, optional: true })).toMatchObject({
      title: 'Optional night',
      level: { label: 'Mythic' }
    });
    expect(nightHeading({ ...base, extra: true, difficulty: 'heroic_into_mythic' })).toMatchObject({
      title: 'Extra night',
      level: { label: 'Heroic into Mythic' }
    });
  });
});
