import { describe, it, expect } from 'vitest';
import {
  sqlString,
  sqlBool,
  sqlNumber,
  sqlDate,
  sqlJsonb,
  insertStatement,
  seasonGuardStatement
} from '../../scripts/import/lib/sql.js';

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
  // An array is a value in its own right, not a bag of keys to compact: the
  // stat columns are read as arrays and an empty one means "rolls none of the
  // tracked types", which is a different fact from the column being null.
  it('emits a JSON array for an array, so the stat columns keep their shape', () => {
    expect(sqlJsonb(['CRIT_RATING', 'HASTE_RATING'])).toBe('\'["CRIT_RATING","HASTE_RATING"]\'::jsonb');
  });
  it('keeps an empty array as [], the value that means the item rolls none of them', () => {
    expect(sqlJsonb([])).toBe("'[]'::jsonb");
  });
  it('doubles an apostrophe inside an array element', () => {
    expect(sqlJsonb(["Kael'thas"])).toContain("Kael''thas");
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

// The guard the generated file opens with (#938): every season code the file
// stamps has to be a seasons row where the file is applied, and the check
// raises before the first insert rather than at the first foreign key.
describe('seasonGuardStatement', () => {
  it('raises for a code the seasons table does not hold, naming it', () => {
    const sql = seasonGuardStatement(['MID2', 'MID1']);
    expect(sql).toContain("select 1 from public.seasons where code = 'MID1'");
    expect(sql).toContain("select 1 from public.seasons where code = 'MID2'");
    expect(sql).toMatch(/raise exception/);
    expect(sql).toContain('MID1');
  });
  it('dedupes and sorts the codes and escapes them as strings', () => {
    const sql = seasonGuardStatement(['MID2', 'MID2', "O'Neil"]);
    expect(sql.match(/select 1 from public\.seasons/g)).toHaveLength(2);
    expect(sql).toContain("code = 'O''Neil'");
  });
  it('emits a comment and no check when nothing is stamped', () => {
    expect(seasonGuardStatement([])).toMatch(/^--/);
    expect(seasonGuardStatement([])).not.toMatch(/raise exception/);
  });
});
