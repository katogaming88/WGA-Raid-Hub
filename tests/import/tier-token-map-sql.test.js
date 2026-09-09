import { describe, it, expect } from 'vitest';
import { tierTokenMapRows } from '../../scripts/generate-tier-token-map-sql.js';

// #1012: this generator carried a third private copy of sqlString. It quoted
// correctly, which matters because this tier's resolved names are full of
// apostrophes, but a correct copy is still a copy, and the one in
// scripts/import/lib/sql.js is the one with tests on it.

const entry = (over) => ({
  class: 'Death Knight',
  armor_type: 'Plate',
  items: { Hands: "Baleful Grave-Knight's Deathgrips" },
  ...over
});

describe('tierTokenMapRows', () => {
  it('doubles the apostrophes the resolved names carry', () => {
    const rows = tierTokenMapRows([entry()]);
    expect(rows[0]).toContain("lower('Baleful Grave-Knight''s Deathgrips')");
  });

  it('doubles an apostrophe in the class name as well', () => {
    const rows = tierTokenMapRows([entry({ class: "Kael'thas" })]);
    expect(rows[0]).toContain("'Kael''thas'");
  });

  it('derives the token name from the slot noun and the armor suffix', () => {
    const rows = tierTokenMapRows([entry()]);
    expect(rows[0]).toContain("lower('Venomforged Idol')");
  });

  it('matches both sides by name rather than by a hardcoded id', () => {
    const rows = tierTokenMapRows([entry()]);
    expect(rows[0]).toContain('select id from items where lower(name)');
    expect(rows[0]).not.toMatch(/wow_item_id/);
  });

  it('emits one row per slot on the class', () => {
    const rows = tierTokenMapRows([entry({ items: { Head: 'A', Shoulder: 'B', Chest: 'C', Hands: 'D', Legs: 'E' } })]);
    expect(rows).toHaveLength(5);
  });
});
