import { describe, it, expect } from 'vitest';
import { parsePastedLoot, parseLegacyLoot, lootSql } from '../../scripts/import/tables/loot.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';
import { normName } from '../../scripts/import/lib/names.js';

function pastedRows() {
  return [
    ['Season', 'RCLC ID', 'Player', 'Date', 'Item Name', 'Instance'],
    ['Season 3', '17-2233', 'Hinda-Thrall', '2026-06-22', 'Crown of Testing', 'Manaforge Omega-Heroic'],
    ['Season 3', '', 'Hinda', '2026-06-23', "Slayer's Band", 'Manaforge Omega-Normal']
  ];
}

// Legacy tracker export, full-width with header row (subset of columns here).
function legacyRows() {
  return [
    ['player', 'date', 'time', 'item', 'itemID', 'response', 'instance', 'boss', 'equipLoc', 'note'],
    [
      'Oldguy-Thrall',
      '2025-11-02',
      '21:15:00',
      '[Ancient Relic]',
      '198765',
      'Mainspec',
      'Old Raid-Mythic',
      'Old Boss',
      'Trinket',
      ''
    ],
    [
      'Hinda-Thrall',
      '2025-12-01',
      '20:00:00',
      '[Crown of Testing]',
      '231234',
      'Mainspec',
      'Old Raid-Normal',
      'Old Boss',
      'Head',
      ''
    ]
  ];
}

const KNOWN = new Set(['crown of testing', "slayer's band"].map(normName));
const SEASONS = [{ name: 'Season 2', start: '2025-09-01', end: '2026-01-15' }];
const OPTS = { knownItems: KNOWN, seasons: SEASONS, tz: 'America/New_York' };

describe('parsePastedLoot / parseLegacyLoot', () => {
  it('reads pasted rows positionally and legacy rows by header name', () => {
    expect(parsePastedLoot(pastedRows())).toHaveLength(2);
    const legacy = parseLegacyLoot(legacyRows());
    expect(legacy).toHaveLength(2);
    expect(legacy[0]).toMatchObject({ wowItemId: '198765', itemName: 'Ancient Relic', boss: 'Old Boss' });
  });
  it('demands the legacy header row', () => {
    expect(() => parseLegacyLoot([['a', 'b'], []])).toThrow(/full-width/);
  });
});

describe('lootSql', () => {
  const registry = () => buildPlayerRegistry(['Hinda-Thrall']);

  it('maps instance suffixes to tracks and derives legacy seasons', () => {
    const entries = [...parsePastedLoot(pastedRows()), ...parseLegacyLoot(legacyRows())];
    const { sql, counts } = lootSql(1, entries, registry(), OPTS);
    expect(counts).toMatchObject({ pasted: 2, legacy: 2 });
    expect(sql).toContain("'Champion'"); // Normal suffix, both sources
    expect(sql).toContain("'Hero'"); // Heroic suffix
    expect(sql).toContain("'Myth'"); // Mythic suffix
    expect(sql).toContain('team_id, player_id, item_id, track, season');
    expect(sql).not.toContain("'Normal'");
    expect(sql).not.toContain("'Heroic'");
    expect(sql).not.toContain("'Mythic'");
    const legacyLine = sql.split('\n').find((l) => l.includes('231234') && l.includes('Season 2'));
    expect(legacyLine).toBeTruthy(); // 2025-12-01 falls in Season 2
  });

  it('creates items rows for old-tier gear missing from the Item Lookup', () => {
    const { sql, newItemCount } = lootSql(1, parseLegacyLoot(legacyRows()), registry(), OPTS);
    expect(newItemCount).toBe(1);
    expect(sql).toContain("('Ancient Relic', 198765, 'Trinket', false)");
    expect(sql).toContain('on conflict ((lower(name))) do nothing');
  });

  it('builds team-prefixed dedupe keys, rclc id when present', () => {
    const { sql } = lootSql(1, parsePastedLoot(pastedRows()), registry(), OPTS);
    expect(sql).toContain("'t1:rclc:17-2233'");
    expect(sql).toContain("'t1:hinda|slayer''s band|2026-06-23 00:00:00'");
    expect(sql).toContain('on conflict (dedupe_key) do nothing');
  });

  it('keeps unknown players with player_id null and counts them', () => {
    const { sql, counts } = lootSql(1, parseLegacyLoot(legacyRows()), registry(), OPTS);
    expect(counts.unknownPlayers).toBe(1); // Oldguy not on roster
    const relicLine = sql.split('\n').find((l) => l.includes('t1:oldguy-thrall|198765'));
    expect(relicLine).toContain('(1, null,');
  });

  it('links loot to archived stubs created by earlier tabs', () => {
    const reg = registry();
    reg.resolveOrStub('Oldguy'); // attendance saw this departed player first
    const { counts, sql } = lootSql(1, parseLegacyLoot(legacyRows()), reg, OPTS);
    expect(counts.unknownPlayers).toBe(0);
    const relicLine = sql.split('\n').find((l) => l.includes('t1:oldguy-thrall|198765'));
    expect(relicLine).toContain("name_realm = 'Oldguy'");
  });
});
