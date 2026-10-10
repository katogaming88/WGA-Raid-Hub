import { describe, expect, it } from 'vitest';
import { needsALook, newJoiners } from './lookLines';
import type { OfficerStats, Raider } from './roster';

const TODAY = '2026-10-10';
const START = '2026-08-01';
const TRIAL = { weeks: 4, attend: 75 };

const raider = (playerId: number, name: string, trial = false): Raider => ({
  key: `player-${playerId}`,
  playerId,
  urlCode: null,
  name,
  character: null,
  className: 'Mage',
  spec: 'Frost',
  role: 'Ranged',
  itemLevel: null,
  tierPieces: null,
  statuses: trial ? ['Trial'] : []
});

const stats = (pcts: Record<number, number>) =>
  new Map<number, OfficerStats>(
    Object.entries(pcts).map(([id, pct]) => [Number(id), { attendancePct: pct, items: 0 }])
  );

describe('newJoiners', () => {
  const players = [
    { id: 1, join_date: '2026-10-10' },
    { id: 2, join_date: '2026-09-10' },
    { id: 3, join_date: '2026-09-09' },
    { id: 4, join_date: '2026-07-30' },
    { id: 5, join_date: null }
  ];

  it('takes the last 30 days, joined after the season started', () => {
    expect(newJoiners(players, START, TODAY)).toEqual(
      new Map([
        [1, 0],
        [2, 30]
      ])
    );
  });

  it('takes nobody before the first raid night, or with no season', () => {
    expect(newJoiners(players, '2026-10-11', TODAY).size).toBe(0);
    expect(newJoiners(players, null, TODAY).size).toBe(0);
  });
});

describe('needsALook', () => {
  const joinDates = new Map([
    [1, '2026-08-10'],
    [2, '2026-09-20'],
    [3, '2026-07-01'],
    [4, '2026-10-09'],
    [5, '2026-10-01']
  ]);

  it('lists trials past both thresholds, longest first, then new raiders with no wishlist, newest first', () => {
    const lines = needsALook(
      [
        raider(1, 'Frostbyte', true),
        raider(2, 'Short', true),
        raider(3, 'Elder', true),
        raider(4, 'Quiver'),
        raider(5, 'Ember')
      ],
      joinDates,
      stats({ 1: 94.4, 2: 100, 3: 80 }),
      TRIAL,
      new Map([
        [4, 1],
        [5, 9]
      ]),
      new Set<number>(),
      TODAY
    );
    expect(lines.map((l) => [l.name, l.text, l.promote])).toEqual([
      ['Elder', 'Trial for 14 weeks at 80% attendance: ready to promote.', true],
      ['Frostbyte', 'Trial for 8 weeks at 94% attendance: ready to promote.', true],
      ['Quiver', "Joined yesterday and hasn't started a wishlist.", false],
      ['Ember', "Joined 9 days ago and hasn't started a wishlist.", false]
    ]);
  });

  it('leaves out a trial under the attendance bar, or whose attendance is not known', () => {
    const trials = [raider(1, 'Frostbyte', true)];
    expect(needsALook(trials, joinDates, stats({ 1: 74.9 }), TRIAL, new Map(), null, TODAY)).toEqual([]);
    expect(needsALook(trials, joinDates, null, TRIAL, new Map(), null, TODAY)).toEqual([]);
  });

  it('leaves out a new raider who has started a wishlist, or while that is not known', () => {
    const joiners = new Map([[4, 1]]);
    expect(needsALook([raider(4, 'Quiver')], joinDates, null, TRIAL, joiners, new Set([4]), TODAY)).toEqual([]);
    expect(needsALook([raider(4, 'Quiver')], joinDates, null, TRIAL, joiners, null, TODAY)).toEqual([]);
  });
});
