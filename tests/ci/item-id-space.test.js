// Every item id column says which numbers it holds (#1094). In this schema a
// column named like `item_id` means the site's own item, `items.id`, and
// carries a foreign key to it. `player_equipped_gear.item_id` held Blizzard's
// item id under that name instead, and the one reader written purely in SQL
// compared it with an `items.id` (#1091), so a raider wearing an item still
// counted as needing it. Reads the generated `dbdoc/schema.json`; no database
// needed.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../../dbdoc/schema.json', import.meta.url), 'utf8'));

// Columns that hold another id space, each named for it.
const OTHER_SPACES = new Map([
  ['public.items.wow_item_id', "Blizzard's item id; the catalog's own column for it"],
  ['public.boe_listings.boe_item_id', 'a boe_items row, which the name says'],
  ['public.player_equipped_gear.wow_item_id', "Blizzard's item id, as the gear sync gets it"]
]);

const pointsAtItems = (table, column) =>
  schema.relations.some(
    (r) =>
      r.table === table &&
      r.columns.length === 1 &&
      r.columns[0] === column &&
      r.parent_table === 'public.items' &&
      r.parent_columns[0] === 'id'
  );

describe('item id columns', () => {
  it('each one points at items.id, or is named for the other id space it holds', () => {
    const unexplained = schema.tables
      .filter((t) => t.type === 'BASE TABLE')
      .flatMap((t) => t.columns.filter((c) => /item_id$/.test(c.name)).map((c) => [t.name, c.name]))
      .filter(([table, column]) => !pointsAtItems(table, column) && !OTHER_SPACES.has(`${table}.${column}`))
      .map(([table, column]) => `${table}.${column}`);
    expect(unexplained).toEqual([]);
  });

  it('lists no column that has gone or now points at items.id', () => {
    const stale = [...OTHER_SPACES.keys()].filter((key) => {
      const [, table, column] = key.match(/^(.*)\.([^.]+)$/);
      const exists = schema.tables.some((t) => t.name === table && t.columns.some((c) => c.name === column));
      return !exists || pointsAtItems(table, column);
    });
    expect(stale).toEqual([]);
  });
});
