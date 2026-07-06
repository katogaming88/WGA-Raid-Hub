import { describe, it, expect } from 'vitest';
import { parseBis, bisSql } from '../../scripts/import/tables/bis.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';
import { normName } from '../../scripts/import/lib/names.js';

// Wide format: players as columns (with nicknames), slots as rows.
function bisRows() {
  return [
    ['Slot', 'Hinda-Thrall (Roth)', 'Tanky-Thrall'],
    ['Head', 'Crown of Testing', 'M+'],
    ['Ring 1', "Slayer's Band", ''],
    ['Ring 2', "Slayer's Band", 'M+'], // duplicate item + duplicate placeholder
    ['Trinket 1', '', 'Crafted']
  ];
}

const KNOWN = new Set(['crown of testing', "slayer's band", 'm+', 'crafted'].map(normName));

describe('parseBis', () => {
  it('reads player columns with nicknames stripped and collects cells', () => {
    const { players, cells } = parseBis(bisRows());
    expect(players).toEqual(['Hinda-Thrall', 'Tanky-Thrall']);
    expect(cells).toHaveLength(6);
  });
  it('rejects an export with no player columns', () => {
    expect(() => parseBis([['Slot'], ['Head']])).toThrow(/player columns/);
  });
});

describe('bisSql', () => {
  it('collapses duplicate (player, item) pairs and emits the conflict clause', () => {
    const registry = buildPlayerRegistry(['Hinda-Thrall', 'Tanky-Thrall']);
    const { cells } = parseBis(bisRows());
    const { sql, count, collapsed, warnings } = bisSql(1, cells, registry, KNOWN);
    expect(count).toBe(4); // 6 cells, Slayer's Band dup + M+ dup collapsed
    expect(collapsed).toBe(2);
    expect(warnings).toHaveLength(0);
    expect(sql).toContain('on conflict (player_id, item_id) do nothing');
    expect(sql).toContain("lower('M+')");
  });
  it('warns when a cell names an item missing from the Item Lookup', () => {
    const registry = buildPlayerRegistry(['Hinda-Thrall', 'Tanky-Thrall']);
    const { warnings } = bisSql(1, [{ nameRealm: 'Hinda-Thrall', item: 'Mystery Sword' }], registry, KNOWN);
    expect(warnings.join('\n')).toContain('Mystery Sword');
  });
});
