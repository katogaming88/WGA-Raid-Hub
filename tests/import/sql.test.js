import { describe, it, expect } from 'vitest';
import { sqlString, sqlBool, sqlNumber, sqlDate, sqlJsonb, insertStatement } from '../../scripts/import/lib/sql.js';

describe('sqlString', () => {
  it('doubles single quotes', () => {
    expect(sqlString("Slayer's Determination")).toBe("'Slayer''s Determination'");
  });
  it('maps empty and null to SQL null', () => {
    expect(sqlString('')).toBe('null');
    expect(sqlString(null)).toBe('null');
  });
});

describe('sqlNumber', () => {
  it('passes numerics', () => {
    expect(sqlNumber('9.2')).toBe('9.2');
  });
  it('rejects non-numeric text loudly', () => {
    expect(() => sqlNumber('Excluded')).toThrow(/finite/);
  });
  it('maps empty to null', () => {
    expect(sqlNumber('')).toBe('null');
  });
});

describe('sqlDate', () => {
  it('accepts ISO and slash dates', () => {
    expect(sqlDate('2026-07-06')).toBe("'2026-07-06'");
    expect(sqlDate('2026/07/06')).toBe("'2026-07-06'");
  });
  it('accepts sheet-locale M/d/yyyy dates', () => {
    expect(sqlDate('4/21/2026')).toBe("'2026-04-21'");
    expect(sqlDate('12/3/2025')).toBe("'2025-12-03'");
  });
  it('rejects garbage', () => {
    expect(() => sqlDate('June 5th')).toThrow(/Unrecognized/);
  });
});

describe('sqlJsonb', () => {
  it('drops empty values and escapes quotes', () => {
    const lit = sqlJsonb({ target: "Kael'thas", from: '', to: 'x' });
    expect(lit).toContain('::jsonb');
    expect(lit).toContain("Kael''thas");
    expect(lit).not.toContain('from');
  });
});

describe('insertStatement', () => {
  it('emits a multi-row insert with conflict clause', () => {
    const sql = insertStatement(
      't',
      ['a', 'b'],
      [
        ['1', "'x'"],
        ['2', "'y'"]
      ],
      'on conflict do nothing'
    );
    expect(sql).toContain('insert into t (a, b)');
    expect(sql).toContain("  (1, 'x'),");
    expect(sql.trim().endsWith('on conflict do nothing;')).toBe(true);
  });
  it('comments out empty inputs', () => {
    expect(insertStatement('t', ['a'], [])).toContain('no rows');
  });
});
