import { describe, expect, it } from 'vitest';
import { bestText, nightLog, pullChart, xPct, type PullRow } from './pulls';

const pull = (date: string, n: number, pct: number | null, extra: Partial<PullRow> = {}): PullRow => ({
  report_code: `RPT${date}`,
  fight_id: n,
  difficulty: 'mythic',
  raid_date: date,
  started_at: `${date}T20:${String(n).padStart(2, '0')}:00Z`,
  boss_percentage: pct,
  kill: false,
  last_phase: null,
  last_phase_is_intermission: null,
  ...extra
});

describe('pullChart', () => {
  it('groups pulls into nights in order and numbers them across the run', () => {
    const chart = pullChart(
      [pull('2026-11-05', 1, 40), pull('2026-10-22', 1, 80), pull('2026-10-22', 2, 60), pull('2026-11-05', 2, 30)],
      'mythic'
    );
    expect(chart.total).toBe(4);
    expect(chart.nights.map((n) => [n.date, n.pulls.map((p) => p.number), n.start])).toEqual([
      ['2026-10-22', [1, 2], 0],
      ['2026-11-05', [3, 4], 2]
    ]);
  });

  it('takes a night’s best as the lowest health left, the earlier pull on a tie', () => {
    const [night] = pullChart(
      [pull('2026-10-22', 1, 50), pull('2026-10-22', 2, 20), pull('2026-10-22', 3, 20)],
      'mythic'
    ).nights;
    expect(night!.best!.number).toBe(2);
    expect(bestText(night!)).toBe('20% left');
  });

  it('lets a kill be the best, at 0, and records which pull and night', () => {
    const chart = pullChart(
      [pull('2026-11-17', 1, 9), pull('2026-11-17', 2, 0, { kill: true }), pull('2026-11-17', 3, 3)],
      'mythic'
    );
    expect(chart.kill).toEqual({ date: '2026-11-17', pull: 2 });
    expect(chart.nights[0]!.best!.kill).toBe(true);
    expect(bestText(chart.nights[0]!)).toBe('Kill');
  });

  it('stops at the first kill: later kills are farm, not progress', () => {
    const chart = pullChart(
      [
        pull('2026-08-24', 1, 30),
        pull('2026-08-24', 2, 0, { kill: true }),
        pull('2026-08-24', 3, 0, { kill: true }),
        pull('2026-09-01', 1, 0, { kill: true })
      ],
      'mythic'
    );
    expect(chart.total).toBe(2);
    expect(chart.nights.map((n) => n.date)).toEqual(['2026-08-24']);
    expect(chart.kill).toEqual({ date: '2026-08-24', pull: 2 });
  });

  it('keeps a pull with no health in the counts but never as a best', () => {
    const [night] = pullChart([pull('2026-10-22', 1, null), pull('2026-10-22', 2, 70)], 'mythic').nights;
    expect(night!.pulls).toHaveLength(2);
    expect(night!.best!.number).toBe(2);
    expect(bestText(pullChart([pull('2026-10-22', 1, null)], 'mythic').nights[0]!)).toBe('n/a');
  });

  it('keeps one difficulty only', () => {
    const chart = pullChart([pull('2026-10-22', 1, 50), pull('2026-10-22', 2, 10, { difficulty: 'heroic' })], 'heroic');
    expect(chart.total).toBe(1);
    expect(chart.nights[0]!.best!.health).toBe(10);
  });

  it('finds the furthest phase and the night it was first reached; an intermission comes after its phase', () => {
    const chart = pullChart(
      [
        pull('2026-10-22', 1, 80, { last_phase: 1 }),
        pull('2026-10-22', 2, 60, { last_phase: 1, last_phase_is_intermission: true }),
        pull('2026-11-05', 1, 40, { last_phase: 2 }),
        pull('2026-11-12', 1, 30, { last_phase: 2 })
      ],
      'mythic'
    );
    expect(chart.furthest).toEqual({ label: 'Phase 2', date: '2026-11-05' });
    expect(chart.nights.map((n) => n.phase?.label)).toEqual(['Intermission 1', 'Phase 2', 'Phase 2']);
  });

  it('says nothing about phases when no pull has one, and handles no pulls', () => {
    expect(pullChart([pull('2026-10-22', 1, 80)], 'mythic').furthest).toBeNull();
    expect(pullChart([], 'mythic')).toEqual({ nights: [], total: 0, kill: null, furthest: null });
  });

  it('links a night to its best pull’s fight', () => {
    const [night] = pullChart([pull('2026-10-22', 1, 50), pull('2026-10-22', 2, 20)], 'mythic').nights;
    expect(nightLog(night!)).toBe('https://www.warcraftlogs.com/reports/RPT2026-10-22#fight=2');
  });

  it('puts a pull in the middle of its slot', () => {
    expect(xPct(0, 4)).toBe(12.5);
    expect(xPct(3, 4)).toBe(87.5);
  });
});
