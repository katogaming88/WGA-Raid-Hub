import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadCsv } from '../../scripts/import/lib/csv.js';
import { parseItems, itemsSql, diffItemRegistries } from '../../scripts/import/tables/items.js';

const fixture = () => loadCsv(fileURLToPath(new URL('./fixtures/item-lookup.csv', import.meta.url)));

describe('parseItems', () => {
  it('reads data rows and flags placeholders', () => {
    const { items } = parseItems(fixture());
    expect(items).toHaveLength(4);
    const mplus = items.find((i) => i.name === 'M+');
    expect(mplus.isPlaceholder).toBe(true);
    expect(mplus.slot).toBe('Placeholder');
    expect(items.find((i) => i.name === 'Crown of Testing').isPlaceholder).toBe(false);
  });
  it('renames the Crafting registry row to the app vocabulary Crafted', () => {
    const rows = fixture();
    rows.push(['Crafting', '', '', '', '99', '']);
    const { items, warnings } = parseItems(rows);
    const crafted = items.filter((i) => i.name === 'Crafted');
    expect(crafted).toHaveLength(2); // fixture row + renamed export row
    expect(crafted.every((i) => i.isPlaceholder)).toBe(true);
    expect(items.some((i) => i.name === 'Crafting')).toBe(false);
    expect(warnings.join(' ')).toContain('Crafting');
  });
  it('rejects a real item with no slot', () => {
    const rows = fixture();
    rows[1][2] = '';
    expect(() => parseItems(rows)).toThrow(/no slot/);
  });
  it('rejects unknown armor types', () => {
    const rows = fixture();
    rows[1][3] = 'Chainmail';
    expect(() => parseItems(rows)).toThrow(/armor type/);
  });
  it('rejects a wrong-tab export via the header check', () => {
    const rows = fixture();
    rows[0] = ['Player', 'Score'];
    expect(() => parseItems(rows)).toThrow(/header/);
  });
});

describe('itemsSql', () => {
  it('emits idempotent inserts and boss rows with subselects', () => {
    const { items } = parseItems(fixture());
    const sql = itemsSql(items);
    expect(sql).toContain('on conflict ((lower(name))) do nothing');
    expect(sql).toContain("Slayer''s Band");
    expect(sql).toContain('insert into item_bosses');
    expect(sql).toContain("lower('Crown of Testing')");
    expect(sql.match(/insert into item_bosses/g) || []).toHaveLength(2);
  });
});

describe('diffItemRegistries', () => {
  it('reports only-in and metadata mismatches', () => {
    const { items: a } = parseItems(fixture());
    const rows = fixture();
    rows[1][5] = 'Different Boss';
    rows.splice(2, 1); // drop Slayer's Band from the second registry
    const { items: b } = parseItems(rows);
    const notes = diffItemRegistries(a, 'phoenix', b, 'hellfire');
    expect(notes.join('\n')).toContain('Crown of Testing.boss');
    expect(notes.join('\n')).toContain("Slayer's Band: only in phoenix");
  });
});
