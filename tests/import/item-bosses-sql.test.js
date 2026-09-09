import { describe, it, expect } from 'vitest';
import { itemBossRows } from '../../scripts/item-bosses-sql.js';

// #1012: the boss name was escaped by hand and the item id went in raw, from a
// Wowhead clipboard paste. Both go through scripts/import/lib/sql.js now.
//
// The ids are validated before the split into rows and manual lookups, because
// a bad id on a "Zone Drop" line never reaches a value tuple and would
// otherwise sit in the maintainer's manual list looking like a real item.

const ZONE = 'The Venomous Abyss';

describe('itemBossRows', () => {
  it('doubles an apostrophe in the boss name', () => {
    const { rows } = itemBossRows(['12345'], [`Ula'tek ${ZONE}`], ZONE, {});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("'Ula''tek'");
  });

  it('strips the zone suffix Wowhead appends to the source', () => {
    const { rows } = itemBossRows(['12345'], [`Vashnik ${ZONE}`], ZONE, {});
    expect(rows[0]).toContain("'Vashnik'");
    expect(rows[0]).not.toContain('Abyss');
  });

  it('applies the encounter rename so the name matches what RCLootCouncil records', () => {
    const { rows } = itemBossRows(['12345'], [`Vexhul ${ZONE}`], ZONE, { Vexhul: 'The Twin Fangs' });
    expect(rows[0]).toContain("'The Twin Fangs'");
  });

  it('resolves the item by id in a subquery, not by name', () => {
    const { rows } = itemBossRows(['12345'], [`Vashnik ${ZONE}`], ZONE, {});
    expect(rows[0]).toContain('(select id from items where wow_item_id = 12345)');
  });

  it('routes Drop and Zone Drop to the manual list instead of the insert', () => {
    const { rows, manual } = itemBossRows(['1', '2', '3'], [`Vashnik ${ZONE}`, 'Drop', 'Zone Drop'], ZONE, {});
    expect(rows).toHaveLength(1);
    expect(manual).toHaveLength(2);
    expect(manual.join('\n')).toContain('wow_item_id 2');
  });

  it('throws on a non-numeric id in a row that would become SQL', () => {
    expect(() => itemBossRows(['abc'], [`Vashnik ${ZONE}`], ZONE, {})).toThrow(/Not a finite number/);
  });

  it('throws on a non-numeric id even on a Zone Drop line, which emits no SQL', () => {
    expect(() => itemBossRows(['1', 'abc'], [`Vashnik ${ZONE}`, 'Zone Drop'], ZONE, {})).toThrow(/Not a finite number/);
  });

  it('throws when the two pasted columns do not line up', () => {
    expect(() => itemBossRows(['1', '2'], [`Vashnik ${ZONE}`], ZONE, {})).toThrow(/mismatch/i);
  });
});
