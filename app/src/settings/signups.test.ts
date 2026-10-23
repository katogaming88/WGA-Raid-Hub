import { describe, expect, it } from 'vitest';
import { addDays, canClose, closeOpensOn, defaultSeason, signupSeasons } from './signups';

const season = (code: string, starts_at: string, ends_at: string | null = null) => ({
  code,
  display_name: `Season ${code}`,
  starts_at,
  ends_at
});

describe('signupSeasons()', () => {
  const today = '2026-10-23';

  it('lists seasons not yet started and any still open, soonest first', () => {
    const list = signupSeasons(
      [season('MID1', '2026-01-01', '2026-08-10'), season('MID2', '2026-08-11'), season('MID3', '2027-01-20')],
      new Set(['MID2']),
      today
    );
    expect(list.map((s) => [s.code, s.open])).toEqual([
      ['MID2', true],
      ['MID3', false]
    ]);
  });

  it('opens on a season with signups open, else the next one', () => {
    const open = signupSeasons([season('MID2', '2026-08-11'), season('MID3', '2027-01-20')], new Set(['MID2']), today);
    expect(defaultSeason(open)?.code).toBe('MID2');
    const none = signupSeasons([season('MID2', '2026-08-11'), season('MID3', '2027-01-20')], new Set(), today);
    expect(defaultSeason(none)?.code).toBe('MID3');
    expect(defaultSeason([])).toBeNull();
  });
});

describe('closing signups (#648)', () => {
  const mid3 = signupSeasons([season('MID3', '2027-01-20')], new Set(['MID3']), '2026-10-23')[0]!;

  it('opens 14 days before the season starts', () => {
    expect(closeOpensOn(mid3)).toBe('2027-01-06');
    expect(canClose(mid3, '2027-01-05')).toBe(false);
    expect(canClose(mid3, '2027-01-06')).toBe(true);
    expect(canClose(mid3, '2027-02-01')).toBe(true);
  });

  it('counts days across a month and a year', () => {
    expect(addDays('2027-01-06', -14)).toBe('2026-12-23');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
