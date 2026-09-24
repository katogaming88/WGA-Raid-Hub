// #1166: items.source and items.season. A dungeon or crafted item names its
// season; a raid item does not, since its season comes from its raid.
import { describe, it, expect } from 'vitest';
import { pool, seedSeason } from './helpers.js';

async function attempt(source, season) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await seedSeason((text, params) => client.query(text, params), 'src-test');
    await client.query('insert into public.items (id, name, slot, source, season) values (950, $1, $2, $3, $4)', [
      'Source Test Item',
      'Back',
      source,
      season
    ]);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('items.source', () => {
  it('accepts a raid item with no season, and dungeon and crafted items with one', async () => {
    await attempt('raid', null);
    await attempt('dungeon', 'src-test');
    await attempt('crafted', 'src-test');
  });

  it('refuses a dungeon or crafted item with no season, and a raid item with one', async () => {
    await expect(attempt('dungeon', null)).rejects.toThrow(/items_season_by_source/);
    await expect(attempt('crafted', null)).rejects.toThrow(/items_season_by_source/);
    await expect(attempt('raid', 'src-test')).rejects.toThrow(/items_season_by_source/);
  });

  it('refuses a source outside raid, dungeon and crafted', async () => {
    await expect(attempt('vendor', 'src-test')).rejects.toThrow(/items_source_check/);
  });
});
