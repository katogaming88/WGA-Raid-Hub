import { describe, it, expect } from 'vitest';
import { statsUpdateSql } from '../../scripts/fetch-item-stats.js';

// #1012: the two stat literals were JSON.stringify dropped inside single quotes,
// which does not escape an apostrophe, beside a raw item id. What kept the file
// safe was the stat allowlists filtering Blizzard's response, which is safety by
// filtering rather than by quoting.
//
// The arrays go through sqlJsonb, which serialises an array as an array: both
// columns are read as lists, and an empty one records that the item rolls none
// of the tracked types, which is not the same fact as the column being null.

const update = (over) => ({
  id: '12345',
  stats: ['CRIT_RATING'],
  mainStats: ['AGILITY'],
  weaponSubtype: null,
  ...over
});

describe('statsUpdateSql', () => {
  it('writes both stat columns as JSON arrays', () => {
    const sql = statsUpdateSql([update({ stats: ['CRIT_RATING', 'HASTE_RATING'], mainStats: ['AGILITY'] })]);
    expect(sql).toContain('\'["CRIT_RATING","HASTE_RATING"]\'::jsonb');
    expect(sql).toContain('\'["AGILITY"]\'::jsonb');
  });

  it('keeps an empty array as [], the value meaning the item rolls none of them', () => {
    const sql = statsUpdateSql([update({ stats: [], mainStats: [] })]);
    expect(sql).toContain("'[]'::jsonb");
    expect(sql).not.toContain("'{}'::jsonb");
  });

  it('doubles an apostrophe in the weapon subtype', () => {
    const sql = statsUpdateSql([update({ weaponSubtype: "Warglaive's Edge" })]);
    expect(sql).toContain("'Warglaive''s Edge'");
  });

  it('maps a missing weapon subtype to SQL null', () => {
    const sql = statsUpdateSql([update({ weaponSubtype: null })]);
    expect(sql).toContain('weapon_subtype = null');
  });

  it('targets the row by numeric id', () => {
    expect(statsUpdateSql([update()])).toContain('where wow_item_id = 12345;');
  });

  it('throws on a non-numeric id rather than writing the statement', () => {
    expect(() => statsUpdateSql([update({ id: 'abc' })])).toThrow(/Not a finite number/);
  });

  it('emits one statement per update', () => {
    const sql = statsUpdateSql([update({ id: '1' }), update({ id: '2' })]);
    expect(sql.split('\n').filter(Boolean)).toHaveLength(2);
  });
});
