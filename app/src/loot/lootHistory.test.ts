import { describe, expect, it } from 'vitest';
import { filterDrops, NO_FILTERS, rollup, itemName, type HistoryDrop } from './lootHistory';

const drop = (id: number, name: string, armor: string | null, extra: Partial<HistoryDrop> = {}): HistoryDrop => ({
  id,
  team_id: 1,
  track: 'Myth',
  season: 'MID2',
  awarded_at: '2026-11-10T02:00:00Z',
  boss: 'Warden',
  response: 'BiS',
  item_id: id,
  items: { name, slot: 'Head', armor_type: armor, wow_item_id: null, is_ptr: false, icon: null },
  ...extra
});

const DROPS = [
  drop(1, 'Venomwoven Effigy', 'Cloth'),
  drop(2, 'Venomwoven Effigy', 'Cloth', { season: 'MID1', awarded_at: '2026-05-01T02:00:00Z' }),
  drop(3, 'Venomforged Icon', 'Plate'),
  drop(4, 'Venomous Boneglaive', null)
];
const TOKENS = new Set([1, 2, 3]);

describe('loot history', () => {
  it('counts a token family across every season, not the items sharing its name', () => {
    expect(filterDrops(DROPS, { ...NO_FILTERS, family: 'Cloth' }, TOKENS).map((d) => d.id)).toEqual([1, 2]);
    expect(filterDrops(DROPS, { ...NO_FILTERS, family: 'tokens' }, TOKENS)).toHaveLength(3);
    expect(filterDrops(DROPS, { ...NO_FILTERS, item: 'venom' }, TOKENS)).toHaveLength(4);
  });

  it('filters by season and by Eastern date range', () => {
    expect(filterDrops(DROPS, { ...NO_FILTERS, season: 'MID1' }, TOKENS).map((d) => d.id)).toEqual([2]);
    // 02:00 UTC on 11-10 is still 11-09 in the Eastern wall clock.
    expect(filterDrops(DROPS, { ...NO_FILTERS, to: '2026-11-09' }, TOKENS)).toHaveLength(4);
    expect(filterDrops(DROPS, { ...NO_FILTERS, from: '2026-11-10' }, TOKENS)).toHaveLength(0);
  });

  it('rolls drops up with a count and the latest drop', () => {
    const byItem = rollup(DROPS, itemName);
    expect(byItem.find((r) => r.key === 'Venomwoven Effigy')).toMatchObject({
      key: 'Venomwoven Effigy',
      count: 2,
      last: '2026-11-10T02:00:00Z'
    });
    expect(rollup(DROPS, (d) => d.season!)).toHaveLength(2);
  });
});
