// Item Lookup tab -> items + item_bosses (#320 step 3).
//
// Layout (docs in #228): row 1 title, row 2 header, data from row 3.
// Cols: A name, B wow item id, C slot, D armor type, E sort id, F boss.
// The Boss column feeds the separate item_bosses table (composite PK, so an
// item can gain more bosses later). Placeholder rows (M+, Crafted, Catalyst)
// get is_placeholder = true and stand in for BiS cells that name a source
// instead of an item.
//
// items has no team_id: both teams' registries describe the same game items.
// Each team's file emits the same idempotent inserts (lower(name) conflict
// target), and generate.js reports metadata mismatches between the two
// exports rather than letting one silently overwrite the other.

import { assertHeader } from '../lib/csv.js';
import { normName } from '../lib/names.js';
import { sqlString, sqlNumber, sqlBool, insertStatement } from '../lib/sql.js';
import { itemIdSql } from '../lib/registry.js';

const DATA_START = 2; // 0-based: row 3
const PLACEHOLDERS = new Set(['m+', 'crafted', 'catalyst']);
const ARMOR_TYPES = new Set(['Plate', 'Mail', 'Leather', 'Cloth']);

export function parseItems(rows, label = 'Item Lookup') {
  assertHeader(rows, 1, { 0: 'item', 2: 'slot' }, label);
  const items = [];
  const warnings = [];

  for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = String(row[0] || '').trim();
    if (!name) continue;

    const isPlaceholder = PLACEHOLDERS.has(normName(name));
    const wowItemId = String(row[1] || '').trim();
    let slot = String(row[2] || '').trim();
    const armorType = String(row[3] || '').trim();
    const sortId = String(row[4] || '').trim();
    const boss = String(row[5] || '').trim();

    if (!slot) {
      if (isPlaceholder) {
        slot = 'Placeholder'; // items.slot is NOT NULL; placeholders have no gear slot
      } else {
        throw new Error(`${label} row ${i + 1}: ${name} has no slot (items.slot is required)`);
      }
    }
    if (armorType && !ARMOR_TYPES.has(armorType)) {
      throw new Error(
        `${label} row ${i + 1}: ${name} armor type ${JSON.stringify(armorType)} not in ${[...ARMOR_TYPES]}`
      );
    }

    items.push({ name, wowItemId, slot, armorType, sortId, boss, isPlaceholder });
  }

  return { items, warnings };
}

export function itemsSql(items) {
  const itemRows = items.map((it) => [
    sqlString(it.name),
    sqlNumber(it.wowItemId),
    sqlString(it.slot),
    sqlString(it.armorType),
    sqlNumber(it.sortId),
    sqlBool(it.isPlaceholder)
  ]);
  let sql = insertStatement(
    'items',
    ['name', 'wow_item_id', 'slot', 'armor_type', 'sort_id', 'is_placeholder'],
    itemRows,
    'on conflict ((lower(name))) do nothing'
  );

  const bossRows = items.filter((it) => it.boss);
  if (bossRows.length) {
    sql += '\n';
    sql += bossRows
      .map(
        (it) =>
          `insert into item_bosses (item_id, boss)\n` +
          `  select ${itemIdSql(it.name)}, ${sqlString(it.boss)}\n` +
          `  on conflict do nothing;`
      )
      .join('\n');
    sql += '\n';
  }
  return sql;
}

// Cross-team registry comparison. Returns human-readable mismatch lines.
export function diffItemRegistries(primary, primaryLabel, secondary, secondaryLabel) {
  const notes = [];
  const byKey = new Map(primary.map((it) => [normName(it.name), it]));
  for (const it of secondary) {
    const match = byKey.get(normName(it.name));
    if (!match) {
      notes.push(`${it.name}: only in ${secondaryLabel}`);
      continue;
    }
    for (const field of ['wowItemId', 'slot', 'armorType', 'boss']) {
      if (String(match[field]) !== String(it[field])) {
        notes.push(
          `${it.name}.${field}: ${primaryLabel}=${JSON.stringify(match[field])} ${secondaryLabel}=${JSON.stringify(it[field])}`
        );
      }
    }
  }
  const secondaryKeys = new Set(secondary.map((it) => normName(it.name)));
  for (const it of primary) {
    if (!secondaryKeys.has(normName(it.name))) notes.push(`${it.name}: only in ${primaryLabel}`);
  }
  return notes;
}
