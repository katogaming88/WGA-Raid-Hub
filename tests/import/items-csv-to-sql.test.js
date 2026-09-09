import { describe, it, expect } from 'vitest';
import { itemsInsertSql } from '../../scripts/items-csv-to-sql.js';

// #1012: the generator used to carry its own escaper and drop the three ids in
// raw, so a hand-edited items.csv could put anything at all into the file a
// maintainer pastes into the SQL Editor. Every value goes through
// scripts/import/lib/sql.js now, and a non-numeric id stops the run.

const HEADER = 'wow_item_id,name,slot,armor_type,sort_id,icon,wcl_zone_id';

const csv = (...rows) => [HEADER, ...rows].join('\n');

describe('itemsInsertSql', () => {
  it('doubles an apostrophe in the item name', () => {
    const sql = itemsInsertSql(csv('12345,"Slayer\'s Determination",Head,Plate,10,inv_helm_01,42'));
    expect(sql).toContain("'Slayer''s Determination'");
  });

  it('emits the insert head and one value row per data line', () => {
    const sql = itemsInsertSql(csv('1,A,Head,Plate,1,icon_a,42', '2,B,Legs,Cloth,2,icon_b,42'));
    expect(sql).toContain(
      'insert into items (wow_item_id, name, slot, armor_type, sort_id, icon, wcl_zone_id, is_placeholder)'
    );
    expect(sql.trim().endsWith(';')).toBe(true);
    expect(sql.split('\n').filter((l) => l.startsWith('  (')).length).toBe(2);
  });

  it('marks every generated row as not a placeholder', () => {
    const sql = itemsInsertSql(csv('1,A,Head,Plate,1,icon_a,42'));
    expect(sql).toContain('false)');
  });

  it('throws on a non-numeric wow_item_id rather than writing it', () => {
    expect(() => itemsInsertSql(csv('abc,A,Head,Plate,1,icon_a,42'))).toThrow(/Not a finite number/);
  });

  it('throws on a non-numeric sort_id, which is the hand-filled column', () => {
    expect(() => itemsInsertSql(csv('1,A,Head,Plate,later,icon_a,42'))).toThrow(/Not a finite number/);
  });

  it('maps a blank sort_id and wcl_zone_id to SQL null', () => {
    const sql = itemsInsertSql(csv('1,A,Head,Plate,,icon_a,'));
    expect(sql).toContain('null');
    expect(sql).toContain("'icon_a'");
  });

  it('throws when the header does not match the items columns', () => {
    expect(() => itemsInsertSql('wow_item_id,name\n1,A')).toThrow(/header/i);
  });
});
