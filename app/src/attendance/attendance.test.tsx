import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read, type Write } from '../test/fakeSupabase';
import { needsALook, nightLabel } from './attendance';

// Manage attendance's Needs a look list (#1846): what the hourly refresh left
// for an officer, set right in the list, with the refresh and the scores'
// state above it and a count on the menu.

const OFFICER = {
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

const player = (id: number, name: string, cls: string) => ({
  id,
  name_realm: name,
  nickname: null,
  is_trial: false,
  is_bench: false,
  is_rotator: false,
  tier_pieces_equipped: null,
  team_member_id: id,
  classes_specs: { class: cls, spec: 'x', role: 'Ranged' }
});

const ROSTER = [
  player(1, 'Katorrí-Stormrage', 'Warlock'),
  player(2, 'Bearspally-Zuljin', 'Druid'),
  player(3, 'Zenshot-Zuljin', 'Hunter')
];

const row = (id: number, playerId: number, date: string, status: string | null, source: string) => ({
  id,
  player_id: playerId,
  raid_date: date,
  status,
  source,
  report_excluded: false,
  report_title: 'The Voidspire'
});

const FLAGGED = [
  row(1, 1, '2026-11-10', null, 'WCL (Late?)'),
  row(2, 2, '2026-11-12', null, 'WCL (Absent?)'),
  row(3, 3, '2026-11-12', null, 'WCL (Absent?)'),
  row(4, 1, '2026-11-12', 'Present', 'WCL')
];

const RUN = {
  started_at: '2026-11-16T20:23:00Z',
  finished_at: '2026-11-16T20:23:20Z',
  main_nights: 36,
  excluded: 0,
  waiting: 3,
  committed: null,
  error: null
};

function handlers(
  opts: {
    rows?: () => unknown[];
    run?: unknown;
    person?: typeof OFFICER;
    writes?: Write[];
  } = {}
): FakeHandlers {
  const base = seededHandlers();
  const rows = opts.rows ?? (() => FLAGGED);
  return seededHandlers({
    session: fakeSession({ battlenet: 'Kat#1', discord: { id: 'd', name: 'Kat' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'd' };
      if (name === 'resolve_person') return { data: opts.person ?? OFFICER };
      if (name === 'team_season_start') return { data: '2026-08-11' };
      if (name === 'attendance_items_waiting') {
        return { data: rows().filter((r) => (r as { status: unknown }).status === null).length };
      }
      if (name === 'attendance_rsvps_before_start') {
        return { data: [{ player_id: 3, raid_date: '2026-11-12', status: 'Tentative' }] };
      }
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table === 'attendance') return { data: rows() };
      if (read.table === 'players') return { data: ROSTER };
      if (read.table === 'seasons')
        return { data: [{ code: 'MID2', display_name: 'Season 2', starts_at: '2026-08-11', ends_at: null }] };
      if (read.table === 'team_settings')
        return { data: { attendance_sync_last_run: opts.run === undefined ? RUN : opts.run } };
      if (read.table === 'raid_night_bosses') {
        return { data: [{ raid_date: '2026-11-10', encounter_id: 7, position: 1, skipped: false }] };
      }
      if (read.table === 'raid_night_lineups')
        return { data: [{ raid_date: '2026-11-10', encounter_id: 7, player_id: 1 }] };
      if (read.table === 'raid_encounters') return { data: [{ id: 7, name: 'Imperator Averzian' }] };
      if (read.table === 'attendance_log_names')
        return { data: [{ raid_date: '2026-11-12', character_name: 'pugzilla' }] };
      return base.from!(read);
    },
    write(w) {
      opts.writes?.push(w);
      return { data: null };
    }
  });
}

const PAGE = '/g/wga/t/phoenix/officer/attendance';

describe('Needs a look (#1846)', () => {
  it('lists each item with its night and why, with the scores waiting and the count on the menu', async () => {
    renderApp(PAGE, handlers());
    const section = (await screen.findByRole('heading', { name: /Needs a look/ })).closest('section')!;
    const items = await within(section).findAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Tue Nov 10Late? Missed Imperator Averzian, the first boss they were in the lineup for.'),
      expect.stringContaining('Thu Nov 12Absent? On the roster, not in the log.'),
      expect.stringContaining('Thu Nov 12Absent? Said Tentative in the Calendar, not in the log.')
    ]);
    expect(within(section).getByText(/In the Thu Nov 12 log but not on the roster: Pugzilla/)).toBeInTheDocument();
    expect(
      await screen.findByText('Scores waiting on 3 items. They go into loot priority once these are set.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit anyway' })).toHaveClass('button-primary');
    // On Attendance its menu group is open, so the count sits on Manage.
    expect(await screen.findByRole('link', { name: 'Manage, 3 waiting' })).toBeInTheDocument();
  });

  it('setting a status from the list saves it as the officer and the item leaves', async () => {
    let rows = FLAGGED;
    const writes: Write[] = [];
    renderApp(PAGE, handlers({ rows: () => rows, writes }));
    const select = await screen.findByLabelText("Bearspally's status for Thu Nov 12");
    rows = FLAGGED.map((r) => (r.id === 2 ? { ...r, status: 'Bench', source: 'Officer' } : r));
    await userEvent.selectOptions(select, 'Bench');
    await expect
      .poll(() => writes.find((w) => w.table === 'attendance')?.values)
      .toMatchObject({ player_id: 2, raid_date: '2026-11-12', status: 'Bench', source: 'Officer' });
    await expect.poll(() => screen.queryByLabelText("Bearspally's status for Thu Nov 12")).toBeNull();
    expect(screen.getByText(/Scores waiting on 2 items/)).toBeInTheDocument();
  });

  it('with nothing to look at: says so, and when the scores last went in', async () => {
    renderApp(
      PAGE,
      handlers({ rows: () => [row(4, 1, '2026-11-12', 'Present', 'WCL')], run: { ...RUN, waiting: 0, committed: 18 } })
    );
    expect(await screen.findByText('Nothing right now. New items show here after a refresh.')).toBeInTheDocument();
    expect(await screen.findByText(/^Scores went into loot priority/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit Attendance Scores' })).not.toHaveClass('button-primary');
  });

  it('shows a failed refresh and its error', async () => {
    renderApp(PAGE, handlers({ run: { ...RUN, error: 'Warcraft Logs did not answer' } }));
    expect(await screen.findByText(/Last refresh failed .*: Warcraft Logs did not answer\./)).toBeInTheDocument();
  });

  it('is not shown to someone who can only read attendance', async () => {
    const admin = { ...OFFICER, guild_officer: true, teams: [] };
    renderApp(PAGE, handlers({ person: admin }));
    await screen.findByRole('heading', { name: 'Every night' });
    expect(screen.queryByRole('heading', { name: /Needs a look/ })).not.toBeInTheDocument();
  });
});

describe('needsALook', () => {
  it('leaves out excluded nights, last season and anyone off the roster', () => {
    const rows = [
      { ...row(1, 1, '2026-11-10', null, 'WCL (Late?)'), report_excluded: true },
      row(2, 2, '2026-08-01', null, 'WCL (Absent?)'),
      row(3, 99, '2026-11-12', null, 'WCL (Absent?)'),
      row(4, 3, '2026-11-12', null, 'WCL (Late?)')
    ];
    const items = needsALook(rows, ROSTER, '2026-08-11', { firstBoss: new Map(), rsvps: new Map() });
    expect(items.map((i) => [i.name, i.reason])).toEqual([['Zenshot', 'Missed the first pull.']]);
  });

  it('labels a night by its calendar day', () => {
    expect(nightLabel('2026-11-10')).toBe('Tue Nov 10');
  });
});
