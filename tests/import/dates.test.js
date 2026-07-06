import { describe, it, expect } from 'vitest';
import { parseSheetTimestamp, sqlTimestampAtZone, seasonForDate } from '../../scripts/import/lib/dates.js';

describe('parseSheetTimestamp', () => {
  it('accepts ISO date and datetime', () => {
    expect(parseSheetTimestamp('2026-01-03')).toBe('2026-01-03 00:00:00');
    expect(parseSheetTimestamp('2026-01-03 19:05')).toBe('2026-01-03 19:05:00');
    expect(parseSheetTimestamp('2026/01/03 9:05:07')).toBe('2026-01-03 09:05:07');
  });
  it('accepts US short format', () => {
    expect(parseSheetTimestamp('1/3/2026 19:00:00')).toBe('2026-01-03 19:00:00');
  });
  it('accepts the display format the request tabs use', () => {
    expect(parseSheetTimestamp('Jan 3, 2026 19:00')).toBe('2026-01-03 19:00:00');
    expect(parseSheetTimestamp('Dec 31, 2025')).toBe('2025-12-31 00:00:00');
  });
  it('maps blank to null and rejects garbage', () => {
    expect(parseSheetTimestamp('')).toBeNull();
    expect(() => parseSheetTimestamp('yesterday')).toThrow(/Unrecognized/);
  });
});

describe('sqlTimestampAtZone', () => {
  it('emits an at-time-zone expression so Postgres handles DST', () => {
    expect(sqlTimestampAtZone('Jan 3, 2026 19:00', 'America/New_York')).toBe(
      "('2026-01-03 19:00:00'::timestamp at time zone 'America/New_York')"
    );
  });
});

describe('seasonForDate', () => {
  const seasons = [
    { name: 'Season 2', start: '2025-09-01', end: '2026-01-15' },
    { name: 'Season 3', start: '2026-01-16' }
  ];
  it('matches closed and open-ended ranges', () => {
    expect(seasonForDate('2025-12-01', seasons)).toBe('Season 2');
    expect(seasonForDate('2026-01-16', seasons)).toBe('Season 3');
    expect(seasonForDate('2026-06-30 20:00:00', seasons)).toBe('Season 3');
  });
  it('returns null outside every range', () => {
    expect(seasonForDate('2024-01-01', seasons)).toBeNull();
    expect(seasonForDate('2024-01-01', null)).toBeNull();
  });
});
