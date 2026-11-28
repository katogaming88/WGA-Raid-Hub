import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { asMember, seededHandlers, type FakeHandlers } from '../test/fakeSupabase';
import type { PullRow } from './pulls';

// The boss pull chart page (#1474), opened from a boss on the Home card.

const progress = (name: string, encounter: number, fields: Record<string, unknown> = {}) => ({
  encounter_id: encounter,
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
  raid_encounters: { name, wcl_encounter_id: encounter + 100, raid_zones: { wcl_zone_id: 42 } },
  ...fields
});

const pull = (difficulty: string, date: string, n: number, pct: number, extra: Partial<PullRow> = {}): PullRow => ({
  report_code: 'ABC',
  fight_id: n,
  difficulty,
  raid_date: date,
  started_at: `${date}T20:${String(n).padStart(2, '0')}:00Z`,
  boss_percentage: pct,
  kill: false,
  last_phase: 1,
  last_phase_is_intermission: false,
  ...extra
});

const PULLS = [
  pull('mythic', '2026-10-22', 1, 80),
  pull('mythic', '2026-10-22', 2, 55, { last_phase: 2 }),
  pull('mythic', '2026-11-17', 1, 0, { kill: true, last_phase: 3 }),
  pull('heroic', '2026-10-01', 1, 10)
];

const seeded = seededHandlers();

const handlers = (pulls: PullRow[] | { message: string } = PULLS): FakeHandlers => {
  const base = asMember(
    seededHandlers({
      from: (read) => {
        if (read.table === 'team_settings')
          return {
            data: {
              raids: [
                {
                  name: 'Halls of the Fallen Choir',
                  wclZoneId: 42,
                  bosses: [{ name: 'Warden of Ash' }, { name: 'Choirmaster' }, { name: 'Hollow King' }]
                }
              ]
            }
          };
        if (read.table === 'team_raid_progress')
          return { data: [progress('Warden of Ash', 7), progress('Choirmaster', 8), progress('Hollow King', 9)] };
        return seeded.from!(read);
      }
    })
  );
  return {
    ...base,
    rpc: (name, args) =>
      name === 'team_raid_pulls'
        ? 'message' in pulls
          ? { error: pulls }
          : { data: args['p_encounter_id'] === 8 ? pulls : [] }
        : base.rpc!(name, args)
  };
};

describe('the boss pull chart page', () => {
  it('opens from a boss on the Home card', async () => {
    renderApp('/g/wga/t/phoenix', handlers());
    const card = within(await screen.findByRole('region', { name: 'Raid progression' }));
    await userEvent.click(await card.findByRole('link', { name: 'Choirmaster' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Choirmaster' })).toBeInTheDocument();
  });

  it('shows the figures, the night-by-night table and the neighbouring bosses', async () => {
    renderApp('/g/wga/t/phoenix/progression/8', handlers());
    expect(await screen.findByRole('heading', { level: 1, name: 'Choirmaster' })).toBeInTheDocument();
    expect(screen.getByText('Halls of the Fallen Choir, boss 2 of 3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Warden of Ash/ })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/progression/7'
    );
    expect(screen.getByRole('link', { name: /Hollow King/ })).toHaveAttribute('href', '/g/wga/t/phoenix/progression/9');
    expect(screen.getByText('Killed Nov 17, 2026')).toBeInTheDocument();
    expect(screen.getByText('on pull 3')).toBeInTheDocument();
    expect(screen.getByText('nights, Oct 22 to Nov 17')).toBeInTheDocument();
    expect(screen.getByText('first reached Nov 17')).toBeInTheDocument();

    const table = within(screen.getByRole('table', { name: 'Night by night' }));
    const rows = table.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Oct 22, 2026255% leftPhase 2Warcraft Logs');
    expect(rows[1]).toHaveTextContent('Nov 17, 20261KillKillWarcraft Logs');
    expect(table.getAllByRole('link')[0]).toHaveAttribute('href', 'https://www.warcraftlogs.com/reports/ABC#fight=2');
  });

  it('shows a dot’s health the moment it is hovered, in our own tip, not a title', async () => {
    renderApp('/g/wga/t/phoenix/progression/8', handlers());
    await screen.findByRole('table', { name: 'Night by night' });
    const dot = document.querySelector<HTMLElement>('[data-tip="Pull 2: 55% left"]')!;
    expect(dot).not.toHaveAttribute('title');
    await userEvent.hover(dot);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Pull 2: 55% left');
    await userEvent.unhover(dot);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('switches to Heroic', async () => {
    renderApp('/g/wga/t/phoenix/progression/8', handlers());
    await screen.findByRole('table', { name: 'Night by night' });
    await userEvent.click(screen.getByRole('button', { name: 'Heroic' }));
    expect(screen.getByText('Not killed yet')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
  });

  it('says so when a difficulty has no pulls, and when the boss is not on the card', async () => {
    renderApp('/g/wga/t/phoenix/progression/7', handlers());
    expect(await screen.findByText('No Mythic pulls yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says a boss that is not on the card is not', async () => {
    renderApp('/g/wga/t/phoenix/progression/99', handlers());
    expect(await screen.findByText('This boss is not on the team’s progression card.')).toBeInTheDocument();
  });

  it('shows a failed read as an error, not as no pulls', async () => {
    renderApp('/g/wga/t/phoenix/progression/8', handlers({ message: 'statement timeout' }));
    expect(await screen.findByText(/Couldn’t load the pulls/)).toBeInTheDocument();
    expect(screen.queryByText(/No Mythic pulls yet/)).not.toBeInTheDocument();
  });
});
