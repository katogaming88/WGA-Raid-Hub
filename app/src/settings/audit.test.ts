import { describe, expect, it } from 'vitest';
import {
  filterAuditEntries,
  formatAuditDetail,
  humanizeAuditKey,
  humanizeAuditValue,
  paginateAuditEntries,
  type AuditEntry
} from './audit';

describe('humanizeAuditKey', () => {
  it('title-cases a snake_case or camelCase key', () => {
    expect(humanizeAuditKey('trial_weeks')).toBe('Trial weeks');
    expect(humanizeAuditKey('targetTankCount')).toBe('Target Tank Count');
  });

  it('uses the special-cased label for a key that would title-case wrong', () => {
    expect(humanizeAuditKey('bis')).toBe('BiS');
    expect(humanizeAuditKey('mplus')).toBe('M+');
  });
});

describe('humanizeAuditValue', () => {
  it('renders a boolean as On/Off', () => {
    expect(humanizeAuditValue(true)).toBe('On');
    expect(humanizeAuditValue(false)).toBe('Off');
  });

  it('renders an array as an item count, not [object Object]', () => {
    expect(humanizeAuditValue([1, 2, 3])).toBe('3 items');
    expect(humanizeAuditValue([1])).toBe('1 item');
  });

  it('stringifies anything else', () => {
    expect(humanizeAuditValue(48)).toBe('48');
  });
});

describe('formatAuditDetail', () => {
  it('passes a plain string straight through', () => {
    expect(formatAuditDetail('6 wk / 80%')).toBe('6 wk / 80%');
  });

  it('returns empty for null', () => {
    expect(formatAuditDetail(null)).toBe('');
  });

  it('flattens a nested object to its leaf key/value pairs', () => {
    expect(formatAuditDetail({ features: { bench: false } })).toBe('Bench: Off');
  });

  it('joins several keys with commas', () => {
    expect(formatAuditDetail({ trialWeeks: 6, trialAttend: 80 })).toBe('Trial Weeks: 6, Trial Attend: 80');
  });
});

describe('filterAuditEntries', () => {
  const entries: AuditEntry[] = [
    { id: 1, ts: '2026-09-01T00:00:00Z', changedBy: 'Aur', action: 'Trial Thresholds Set', target: '', detail: '6 wk' },
    {
      id: 2,
      ts: '2026-09-02T00:00:00Z',
      changedBy: 'Kat',
      action: 'Roster Targets Set',
      target: 'Torbjorn-Illidan',
      detail: '2 tank / 5 heal'
    }
  ];

  it('returns every entry for a blank search', () => {
    expect(filterAuditEntries(entries, '')).toEqual(entries);
    expect(filterAuditEntries(entries, '   ')).toEqual(entries);
  });

  it('matches case-insensitively across every visible column', () => {
    expect(filterAuditEntries(entries, 'aur')).toEqual([entries[0]]);
    expect(filterAuditEntries(entries, 'TORBJORN')).toEqual([entries[1]]);
    expect(filterAuditEntries(entries, 'roster targets')).toEqual([entries[1]]);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterAuditEntries(entries, 'nope')).toEqual([]);
  });
});

describe('paginateAuditEntries', () => {
  const entries: AuditEntry[] = Array.from({ length: 25 }, (_, i) => ({
    id: i,
    ts: '2026-09-01T00:00:00Z',
    changedBy: 'Aur',
    action: `Action ${i}`,
    target: '',
    detail: ''
  }));

  it('slices one page at a time', () => {
    const first = paginateAuditEntries(entries, 0, 10);
    expect(first.rows).toHaveLength(10);
    expect(first.rows[0]!.id).toBe(0);
    expect(first.totalPages).toBe(3);

    const second = paginateAuditEntries(entries, 1, 10);
    expect(second.rows[0]!.id).toBe(10);

    const last = paginateAuditEntries(entries, 2, 10);
    expect(last.rows).toHaveLength(5);
  });

  it('clamps a page past the end back onto the last page', () => {
    const result = paginateAuditEntries(entries, 99, 10);
    expect(result.page).toBe(2);
    expect(result.rows[0]!.id).toBe(20);
  });

  it('is always at least one page, even with no entries', () => {
    const result = paginateAuditEntries([], 0, 10);
    expect(result.totalPages).toBe(1);
    expect(result.rows).toEqual([]);
  });
});
