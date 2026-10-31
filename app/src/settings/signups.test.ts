import { describe, expect, it } from 'vitest';
import { currentSeason, visibleSeasons } from '../profile/profile';
import { seasonOn } from '../calendar/lineup';
import { addDays, defaultSeason, signupSeasons } from './signups';

const season = (code: string, starts_at: string | null, ends_at: string | null = null) => ({
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

// A season with no date yet (#1714): never current, on no raid night, and
// listed for signups after the dated ones.
describe('an undated season', () => {
  const seasons = [season('MID2', '2026-08-11'), season('MID3', null)];
  it('is never current, matches no night, and takes signups', () => {
    expect(currentSeason(seasons, '2099-01-01')?.code).toBe('MID2');
    expect(seasonOn(seasons, '2099-01-01')).toBe('MID2');
    expect(signupSeasons(seasons, new Set(), '2026-10-23').map((s) => [s.code, s.startsAt])).toEqual([['MID3', null]]);
  });
});

// Teams see every started season plus only the next one (#1714).
describe('visibleSeasons()', () => {
  it('keeps started seasons and the next one, and hides the undated ones after it', () => {
    const rows = [
      season('MID1', '2026-03-17'),
      season('MID2', '2026-08-11'),
      season('MID3', null),
      season('MID4', null)
    ];
    expect(visibleSeasons(rows, '2026-10-23').map((s) => s.code)).toEqual(['MID1', 'MID2', 'MID3']);
    // Once MID3 is dated and starts, MID4 is the next one.
    const dated = [...rows.slice(0, 2), season('MID3', '2027-02-02'), season('MID4', null)];
    expect(visibleSeasons(dated, '2027-01-01').map((s) => s.code)).toEqual(['MID1', 'MID2', 'MID3']);
    expect(visibleSeasons(dated, '2027-02-02').map((s) => s.code)).toEqual(['MID1', 'MID2', 'MID3', 'MID4']);
  });
});

describe('addDays()', () => {
  it('counts days across a month and a year', () => {
    expect(addDays('2027-01-06', -14)).toBe('2026-12-23');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
