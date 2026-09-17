import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import { calendarMonth, raidNights, type RsvpRow } from '../calendar/nights';
import { killDate, raidCards, type ProgressRow } from './progression';
import { liveStreams, liveText, type StreamerRow } from '../streams/streams';

// Home's second half (#1102): raid progression, the calendar and the live
// stream widget. The behavior recorded from the current site is checked end
// to end in tests/browser-app/home.test.js; this file pins the edges that are
// cheaper to cover here, and the page's own states.

const row = (name: string, id: number, fields: Partial<ProgressRow>): ProgressRow => ({
  mythic_date: null,
  mythic_pulls: null,
  mythic_best_pct: null,
  mythic_report_code: null,
  mythic_fight_id: null,
  heroic_date: null,
  heroic_pulls: null,
  heroic_best_pct: null,
  heroic_report_code: null,
  heroic_fight_id: null,
  ...fields,
  raid_encounters: { name, wcl_encounter_id: id, raid_zones: { wcl_zone_id: 42 } }
});

describe('raid progression', () => {
  it('uses the AOTC date an officer typed until the sync sees the last boss', () => {
    const [raid] = raidCards(
      [{ name: 'Spire', aotcDate: 'Apr 1', wclZoneId: 42, bosses: [{ name: 'Only Boss', wclEncounterId: 1 }] }],
      [row('Only Boss', 1, { heroic_pulls: 3 })]
    );
    expect(raid!.aotc).toBe('Apr 1');
    expect(raid!.score).toEqual({ heroic: null, mythic: 0, total: 1 });
  });

  it('never shows AOTC on a mini-raid, even with a typed date', () => {
    const [raid] = raidCards([{ name: 'Mini', aotcDate: '2026-04-01', isMiniRaid: true, bosses: [] }], []);
    expect(raid!.aotc).toBeNull();
  });

  it('matches nothing without a zone, even by name', () => {
    const [raid] = raidCards(
      [{ name: 'No zone', bosses: [{ name: 'Only Boss', wclEncounterId: 1 }] }],
      [row('Only Boss', 1, { mythic_date: '2026-04-01', mythic_pulls: 4 })]
    );
    expect(raid!.bosses[0]).toEqual({ number: 1, name: 'Only Boss', mythic: null, heroic: null });
  });

  it('shows a Mythic kill with no pulls recorded as just the date', () => {
    const [raid] = raidCards(
      [{ name: 'Spire', wclZoneId: 42, bosses: [{ name: 'Only Boss', mythicDate: '2026-04-02' }] }],
      []
    );
    expect(raid!.bosses[0]!.mythic).toEqual({ date: '2026-04-02', pulls: null, best: null, link: null });
  });

  it('writes stored dates out, and leaves a typed one as typed', () => {
    expect(killDate('2026-04-02')).toBe('Apr 2, 2026');
    expect(killDate('April 2nd')).toBe('April 2nd');
  });
});

describe('the calendar', () => {
  const schedule = [
    { weekday: 2, is_optional: false },
    { weekday: 0, is_optional: true }
  ];
  const may = (mine: RsvpRow[] = [], counts = { roster: 6, bench: 1 }) =>
    calendarMonth(2026, 4, raidNights(schedule, [], 2026, 4), counts, mine, new Date(2026, 4, 13));

  it('drops a cancelled night and keeps an added one on the same date', () => {
    const nights = raidNights(
      schedule,
      [
        { raid_date: '2026-05-05', exception_type: 'cancelled', is_optional: false },
        { raid_date: '2026-05-05', exception_type: 'added', is_optional: true }
      ],
      2026,
      4
    );
    expect(nights.filter((n) => n.date === '2026-05-05')).toEqual([{ date: '2026-05-05', optional: true }]);
  });

  it('shows the reader’s own answer in place of the default, without the count', () => {
    const month = may([
      { raid_date: '2026-05-05', status: 'Absent' },
      { raid_date: '2026-05-12', status: 'Late' },
      { raid_date: '2026-05-10', status: 'Attending' }
    ]);
    const day = (date: string) => month.days.find((d) => d.date === date)!.raid;
    expect(day('2026-05-05')).toEqual({ status: 'Absent', tone: 'absent', count: null });
    expect(day('2026-05-12')).toEqual({ status: 'Late', tone: 'tentative', count: null });
    expect(day('2026-05-10')).toEqual({ status: 'Attending', tone: 'present', count: null });
    expect(day('2026-05-19')).toEqual({ status: 'Present', tone: 'present', count: '5/6' });
  });

  it('leaves the count and the bench line out when there is no roster', () => {
    const month = may([], { roster: 0, bench: 0 });
    expect(month.days.find((d) => d.date === '2026-05-05')!.raid!.count).toBeNull();
    expect(month.legend.map((l) => l.label)).toEqual(['No Response', 'Present']);
  });

  it('starts the month under its weekday', () => {
    // May 1, 2026 is a Friday.
    expect(may().offset).toBe(5);
    expect(may().label).toBe('May 2026');
  });
});

describe('the live stream widget', () => {
  const streamer = (id: number, teamId: number, fields: Partial<StreamerRow> = {}): StreamerRow => ({
    id,
    team_id: teamId,
    twitch_channel: `channel${id}`,
    schedule_note: null,
    guild_wide_opt_out: false,
    is_live: true,
    players: { name_realm: `Name${id}-Illidan`, nickname: null },
    ...fields
  });

  it('shows this team’s streamer even when they opted out of other teams’ pages', () => {
    const rows = [streamer(1, 2), streamer(2, 1, { guild_wide_opt_out: true })];
    expect(liveStreams(rows, 1).map((s) => s.name)).toEqual(['Name2', 'Name1']);
    expect(liveStreams(rows, 2).map((s) => s.name)).toEqual(['Name1']);
  });

  it('skips a streamer whose character is gone', () => {
    expect(liveStreams([streamer(1, 1, { players: null })], 1)).toEqual([]);
  });

  it('names who is live', () => {
    expect(liveText(['A'])).toBe('A is live!');
    expect(liveText(['A', 'B', 'C', 'D'])).toBe('A, B, and 2 more are live!');
  });
});

// The page, with a roster, a raid and a schedule. `fail` makes one table's read fail.
const handlers = (options: { fail?: string; raids?: unknown[]; live?: boolean } = {}): FakeHandlers => {
  const base = seededHandlers();
  const answers: Record<string, (read: Read) => unknown> = {
    players: () => [
      { id: 1, name_realm: 'Aurelith-Illidan', nickname: 'Aur', classes_specs: { role: 'Tank' } },
      { id: 2, name_realm: 'Brightmoor-Illidan', nickname: null, is_bench: true, classes_specs: { role: 'Heal' } }
    ],
    team_settings: (read) =>
      read.columns?.includes('raids')
        ? {
            raids: options.raids ?? [
              { name: 'Halls of the Fallen Choir', wclZoneId: 42, bosses: [{ name: 'Warden of Ash' }] }
            ]
          }
        : { name: 'Midnight Season 3', start: null, end: null },
    team_raid_progress: () => [row('Warden of Ash', 1, { heroic_pulls: 17, heroic_best_pct: 3.2 })],
    rclc_loot: () => [],
    raid_schedule: () => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, is_optional: false })),
    raid_schedule_exceptions: () => [],
    streamers: () => [
      {
        id: 1,
        team_id: 1,
        twitch_channel: 'aurelithplays',
        schedule_note: 'Tue and Thu',
        guild_wide_opt_out: false,
        is_live: options.live ?? true,
        players: { name_realm: 'Aurelith-Illidan', nickname: 'Aur' }
      }
    ]
  };
  return seededHandlers({
    from: (read) => {
      if (read.table === options.fail) return { error: { message: 'statement timeout' } };
      const answer = answers[read.table];
      if (answer && !(read.table === 'players' && read.single)) return { data: answer(read) };
      return base.from!(read);
    }
  });
};

const region = async (name: string) => within(await screen.findByRole('region', { name }));

describe('the Home page’s progression and calendar', () => {
  it('shows each raid’s score in words, and a boss’s pulls', async () => {
    renderApp('/g/wga/t/phoenix', handlers());
    const card = await region('Raid progression');
    expect(await card.findByRole('heading', { level: 3, name: 'Halls of the Fallen Choir' })).toBeInTheDocument();
    expect(card.getByText(/^Heroic/, { selector: '.raid-score' })).toHaveTextContent('Heroic 0/1');
    expect(card.getByRole('listitem')).toHaveTextContent('Warden of AshHeroic17 pullsbest 3.2%');
  });

  it('leaves progression out when the season lists no raids', async () => {
    renderApp('/g/wga/t/phoenix', handlers({ raids: [] }));
    await region('Calendar');
    await screen.findAllByRole('link', { name: /, Present,/ });
    expect(screen.queryByRole('region', { name: 'Raid progression' })).not.toBeInTheDocument();
  });

  it('links each raid day to its day on the calendar, saying what it shows', async () => {
    renderApp('/g/wga/t/phoenix', handlers());
    const card = await region('Calendar');
    const links = await card.findAllByRole('link', { name: /Present, 1 of 2 raiders expected/ });
    expect(links.length).toBeGreaterThanOrEqual(28);
    expect(links[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/g\/wga\/t\/phoenix\/calendar\?date=\d{4}-\d{2}-01$/)
    );
    expect(card.getByRole('link', { name: 'View full calendar' })).toHaveAttribute('href', '/g/wga/t/phoenix/calendar');
    expect(card.getByText('1 on Bench (excluded from the count above)')).toBeInTheDocument();
  });

  it('keeps the rest of the page when the calendar cannot load', async () => {
    renderApp('/g/wga/t/phoenix', handlers({ fail: 'raid_schedule' }));
    const card = await region('Calendar');
    expect(await card.findByRole('alert')).toHaveTextContent('Couldn’t load the raid calendar.');
    expect(await screen.findByRole('region', { name: 'Recent loot' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Raid progression' })).toBeInTheDocument();
  });

  it('does not ask for anyone’s answers when signed out', async () => {
    const { client } = renderApp('/g/wga/t/phoenix', handlers());
    await (await region('Calendar')).findAllByRole('link', { name: /Present/ });
    expect(client.reads.some((r) => r.table === 'raid_rsvps')).toBe(false);
  });
});

describe('the live stream widget on the page', () => {
  it('names who is live, and opens and closes', async () => {
    renderApp('/g/wga/t/phoenix', handlers());
    const widget = await region('Live streams');
    const toggle = await widget.findByRole('button', { name: 'Aur is live!' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(widget.getByTitle('Aur’s stream on Twitch')).toHaveAttribute(
      'src',
      expect.stringContaining('channel=aurelithplays')
    );
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(widget.queryByTitle('Aur’s stream on Twitch')).not.toBeInTheDocument();
    expect(localStorage.getItem('wga-stream-widget-collapsed')).toBe('1');
  });

  it('says when nobody is live', async () => {
    renderApp('/g/wga/t/phoenix', handlers({ live: false }));
    const widget = await region('Live streams');
    expect(await widget.findByRole('button', { name: 'Streams' })).toBeInTheDocument();
    expect(widget.getByText('No one is live right now.')).toBeInTheDocument();
  });

  it('stays out of the way when streams cannot load', async () => {
    renderApp('/g/wga/t/phoenix', handlers({ fail: 'streamers' }));
    await region('Recent loot');
    expect(screen.queryByRole('region', { name: 'Live streams' })).not.toBeInTheDocument();
  });
});
