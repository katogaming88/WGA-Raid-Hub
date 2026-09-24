// #1166: items.source and item_seasons, and the SQL scripts/dungeon-items-sql.js
// writes for them.
import { describe, it, expect } from 'vitest';
import { pool, seedSeason } from './helpers.js';
import { dungeonItemsSql } from '../../scripts/dungeon-items-sql.js';

async function inTxn(fn) {
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await q('begin');
    await seedSeason(q, 'src-test');
    await seedSeason(q, 'src-next');
    return await fn(q);
  } finally {
    await q('rollback');
    client.release();
  }
}

// The generated file wraps itself in begin/commit; inside the test's own
// transaction those two lines go (the temp table is dropped by hand), so the rollback still undoes it all.
const run = (q, items, season) =>
  q(
    dungeonItemsSql({ season, items }, {})
      .replace(/^begin;$/m, '')
      .replace(/^commit;$/m, 'drop table incoming;')
  );

const item = (id, name, slot = 'Back') => ({ id, name, slot, armorType: null });
const seasonsOf = async (q, wowId) =>
  (
    await q(
      `select s.season from public.item_seasons s join public.items i on i.id = s.item_id
       where i.wow_item_id = $1 order by 1`,
      [wowId]
    )
  ).rows.map((r) => r.season);

describe('items.source', () => {
  it('reads raid for every existing item, and refuses a source outside raid, dungeon and crafted', async () => {
    await inTxn(async (q) => {
      const { rows } = await q("select count(*)::int as n from public.items where source <> 'raid'");
      expect(rows[0].n).toBe(0);
    });
    await expect(
      inTxn((q) => q("insert into public.items (id, name, slot, source) values (950, 'X', 'Back', 'vendor')"))
    ).rejects.toThrow(/items_source_check/);
  });
});

describe('item_seasons', () => {
  it('holds one row per item and season, and only for a season that exists', async () => {
    await expect(
      inTxn(async (q) => {
        await q("insert into public.items (id, name, slot, source) values (950, 'X', 'Back', 'dungeon')");
        await q("insert into public.item_seasons values (950, 'src-test')");
        await q("insert into public.item_seasons values (950, 'src-test')");
      })
    ).rejects.toThrow(/item_seasons_pkey/);
    await expect(
      inTxn(async (q) => {
        await q("insert into public.items (id, name, slot, source) values (950, 'X', 'Back', 'dungeon')");
        await q("insert into public.item_seasons values (950, 'no-such-season')");
      })
    ).rejects.toThrow(/item_seasons_season_fkey/);
  });
});

describe('the dungeon import SQL', () => {
  it('adds new items as dungeon items under the season, and a second run changes nothing', async () => {
    await inTxn(async (q) => {
      await run(q, [item(960001, 'Import Test Cloak')], 'src-test');
      await run(q, [item(960001, 'Import Test Cloak')], 'src-test');
      const { rows } = await q('select source from public.items where wow_item_id = 960001');
      expect(rows).toEqual([{ source: 'dungeon' }]);
      expect(await seasonsOf(q, 960001)).toEqual(['src-test']);
    });
  });

  it('adds only the new season when a dungeon item returns in a later season', async () => {
    await inTxn(async (q) => {
      await run(q, [item(960001, 'Import Test Cloak')], 'src-test');
      await run(q, [item(960001, 'Import Test Cloak')], 'src-next');
      expect((await q('select count(*)::int as n from public.items where wow_item_id = 960001')).rows[0].n).toBe(1);
      expect(await seasonsOf(q, 960001)).toEqual(['src-next', 'src-test']);
    });
  });

  it('stops and undoes the run when an item clashes on name with another item', async () => {
    await expect(
      inTxn(async (q) => {
        await q(
          "insert into public.items (id, wow_item_id, name, slot) values (961, 960002, 'Import Test Belt', 'Waist')"
        );
        await run(q, [item(960003, 'Import Test Belt', 'Waist')], 'src-test');
      })
    ).rejects.toThrow(/Not in the catalog as a dungeon item/);
  });

  it('refuses to file a raid item under a season', async () => {
    await expect(
      inTxn(async (q) => {
        await q(
          "insert into public.items (id, wow_item_id, name, slot) values (962, 960004, 'Import Test Raid Item', 'Head')"
        );
        await run(q, [item(960004, 'Import Test Raid Item', 'Head')], 'src-test');
      })
    ).rejects.toThrow(/Not in the catalog as a dungeon item/);
  });
});
