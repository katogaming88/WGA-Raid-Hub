import { describe, it, expect } from 'vitest';
import { parsePriority, prioritySql } from '../../scripts/import/tables/priority.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';
import { normName } from '../../scripts/import/lib/names.js';

// Wide format: one row per (difficulty, item), rank columns from col C.
function priorityRows() {
  return [
    ['Difficulty', 'Item', '1st', '2nd', '3rd'],
    ['Heroic', 'Crown of Testing', 'Hinda', 'Tanky', ''],
    ['Mythic', 'Crown of Testing', 'Tanky-Thrall', '', ''],
    ['', "Slayer's Band", 'Hinda', '', ''] // blank difficulty defaults to Heroic
  ];
}

const KNOWN = new Set(['crown of testing', "slayer's band"].map(normName));

describe('parsePriority', () => {
  it('reshapes wide rank columns to (item, difficulty, rank, name)', () => {
    const entries = parsePriority(priorityRows());
    expect(entries).toHaveLength(4);
    expect(entries[0]).toMatchObject({ item: 'Crown of Testing', difficulty: 'Heroic', rank: 1, name: 'Hinda' });
    expect(entries[2]).toMatchObject({ difficulty: 'Mythic', name: 'Tanky-Thrall' });
    expect(entries[3]).toMatchObject({ item: "Slayer's Band", difficulty: 'Heroic' });
  });
  it('rejects difficulties outside the schema CHECK', () => {
    const rows = priorityRows();
    rows[1][0] = 'Champion';
    expect(() => parsePriority(rows)).toThrow(/Heroic\/Mythic/);
  });
});

describe('prioritySql', () => {
  it('emits ranks, season, and both FK subselects', () => {
    const registry = buildPlayerRegistry(['Hinda-Thrall', 'Tanky-Thrall']);
    const { sql, count, warnings } = prioritySql(1, parsePriority(priorityRows()), registry, 'Season 3', KNOWN);
    expect(count).toBe(4);
    expect(warnings).toHaveLength(0);
    const mythicLine = sql.split('\n').find((l) => l.includes("'Mythic'"));
    expect(mythicLine).toContain("name_realm = 'Tanky-Thrall'"); // realm suffix resolved
    expect(sql).toContain('on conflict (team_id, season, item_id, difficulty, player_id) do nothing');
  });
  it('requires the season argument', () => {
    expect(() => prioritySql(1, [], buildPlayerRegistry([]), '', KNOWN)).toThrow(/--season/);
  });
});
