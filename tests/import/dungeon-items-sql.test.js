import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDungeonLoot, dungeonItemsSql, itemFacts, keepsItem } from '../../scripts/dungeon-items-sql.js';

// #1166: a season's dungeon loot file, made in game, becomes catalog rows.

const HEAD = '-- season: MID2\n';

describe('parseDungeonLoot', () => {
  it('keeps gear rows, drops the no-slot rows and count lines, and dedupes by item id', () => {
    const { season, items } = parseDungeonLoot(
      HEAD +
        [
          'Den | Boss A | 1 | Staff of Testing | Two-Hand | Staff',
          'Den | Boss A | 2 | The Brood | (no slot: not gear) | Mount',
          '-- Den / Boss A: 2 rows',
          'Den | Boss B | 1 | Staff of Testing | Two-Hand | Staff',
          'Den | Boss B | 3 | Hood of Tests | Head | Leather'
        ].join('\n')
    );
    expect(season).toBe('MID2');
    expect(items.map((i) => i.id)).toEqual([1, 3]);
  });

  it('keeps an armor type for armor and leaves it null for weapons, shields and jewelry', () => {
    const { items } = parseDungeonLoot(
      HEAD +
        [
          'D | B | 1 | Hood | Head | Leather',
          'D | B | 2 | Blade | One-Hand | Dagger',
          'D | B | 3 | Wall | Off Hand | Shield',
          'D | B | 4 | Ring | Finger | '
        ].join('\n')
    );
    expect(items.map((i) => i.armorType)).toEqual(['Leather', null, null, null]);
  });

  it('reads a row whose last column is empty, with or without the trailing space', () => {
    const { items } = parseDungeonLoot(
      HEAD +
        [
          'D | B | 1 | Charm | Trinket |',
          'D | B | 2 | Band | Finger | ',
          'D | B | 3 | Egg | (no slot: not gear) |'
        ].join('\n')
    );
    expect(items.map((i) => [i.id, i.slot])).toEqual([
      [1, 'Trinket'],
      [2, 'Finger']
    ]);
  });

  it('reads a crafted list: the source line sets the source, and the rows are added as crafted', () => {
    const parsed = parseDungeonLoot(
      HEAD + '-- source: crafted\nBlacksmithing | Plate Helm | 7 | Forged Helm | Head | Plate'
    );
    expect(parsed.source).toBe('crafted');
    expect(dungeonItemsSql(parsed, {})).toContain("'crafted' from incoming");
    expect(parseDungeonLoot(HEAD + 'D | B | 1 | Hood | Head | Leather').source).toBe('dungeon');
    expect(() => parseDungeonLoot(HEAD + '-- source: vendor\nD | B | 1 | Hood | Head | Leather')).toThrow(
      /Unknown source/
    );
  });

  it('refuses a file with no season line or a non-numeric item id', () => {
    expect(() => parseDungeonLoot('D | B | 1 | Hood | Head | Leather')).toThrow(/season/);
    expect(() => parseDungeonLoot(HEAD + 'D | B | 1; drop table items | Hood | Head | Leather')).toThrow(/Bad item id/);
  });

  it('reads the real Season 2 file: 208 gear items and none of the not-gear rows', () => {
    const { season, items } = parseDungeonLoot(readFileSync('scripts/season-items/MID2-dungeons.txt', 'utf8'));
    expect(season).toBe('MID2');
    expect(items).toHaveLength(208);
    expect(items.some((i) => i.slot.includes('not gear'))).toBe(false);
  });
});

describe('dungeonItemsSql', () => {
  const parsed = { season: 'MID2', items: [{ id: 5, name: "Slayer's Hood", slot: 'Head', armorType: 'Leather' }] };

  it('doubles an apostrophe, adds the item as a dungeon item and files it under the season', () => {
    const sql = dungeonItemsSql(parsed, { 5: 'inv_helm_01' });
    expect(sql).toContain("'Slayer''s Hood'");
    expect(sql).toContain("'dungeon' from incoming");
    expect(sql).toContain("select i.id, 'MID2' from incoming");
    expect(sql).toContain("'inv_helm_01'");
  });

  it('keeps an item already in the catalog, and stops if one cannot be added', () => {
    const sql = dungeonItemsSql(parsed, {});
    expect(sql).toContain('on conflict do nothing');
    expect(sql).toContain('raise exception');
  });

  it('writes null for an item whose icon lookup failed', () => {
    expect(dungeonItemsSql(parsed, {})).toContain("'Leather', null)");
  });
});

describe('the crafted list filter', () => {
  it('reads the minimum quality and item level from the file, and none when the lines are absent', () => {
    const crafted = parseDungeonLoot(readFileSync('scripts/season-items/MID2-crafted.txt', 'utf8'));
    expect(crafted).toMatchObject({ source: 'crafted', minQuality: 4, minItemLevel: 240 });
    expect(crafted.items).toHaveLength(203);
    const dungeon = parseDungeonLoot(readFileSync('scripts/season-items/MID2-dungeons.txt', 'utf8'));
    expect(dungeon).toMatchObject({ minQuality: null, minItemLevel: null });
  });

  it('reads quality and item level from the tooltip, in either spelling Wowhead uses', () => {
    expect(itemFacts({ icon: 'inv_a', quality: 4, tooltip: '<b>Item Level <!--ilvl-->246</b>' })).toEqual({
      icon: 'inv_a',
      quality: 4,
      itemLevel: 246
    });
    expect(itemFacts({ icon: 'inv_b', quality: 2, tooltip: 'Item Level 263' }).itemLevel).toBe(263);
    expect(itemFacts({}).itemLevel).toBeNull();
  });

  it('keeps an epic at item level 246, drops a green at 263 and a rare at 201, and never guesses', () => {
    const filters = { minQuality: 4, minItemLevel: 240 };
    expect(keepsItem({ quality: 4, itemLevel: 246 }, filters)).toBe(true);
    expect(keepsItem({ quality: 2, itemLevel: 263 }, filters)).toBe(false);
    expect(keepsItem({ quality: 3, itemLevel: 201 }, filters)).toBe(false);
    expect(keepsItem({ quality: null, itemLevel: null }, filters)).toBe(false);
    expect(keepsItem({ quality: 2, itemLevel: 1 }, { minQuality: null, minItemLevel: null })).toBe(true);
  });
});
