// BiS List tab -> bis_items (#320 step 7).
//
// Wide format: players are COLUMNS, slots are ROWS. After the #228 cleanup
// row 1 is the true header ("Name-Realm (Nick)" from col B onward); data rows
// carry a slot label in col A and item names in the player cells. Multiple
// items per slot appear as extra rows with the same or suffixed slot label
// ("Trinket 1 - 1"), which doesn't matter here: bis_items is (player, item)
// with no slot column.
//
// Cells naming a source instead of an item (M+, Crafted, Catalyst) map to the
// placeholder item rows (is_placeholder = true, imported with the Item
// Lookup). Duplicate (player, item) pairs -- the same item or placeholder in
// two slots -- collapse to one row per the unique key; collapses are counted
// in the generator output.
//
// "obtained" state does not survive a CSV export if it's tracked as cell
// formatting; every row imports as obtained = false (open input on #320).

import { assertHeader } from '../lib/csv.js';
import { stripNickname, normName } from '../lib/names.js';
import { insertStatement } from '../lib/sql.js';
import { playerIdSql, itemIdSql } from '../lib/registry.js';

const PLAYER_START_COL = 1; // col B

export function parseBis(rows, label = 'BiS List') {
  assertHeader(rows, 0, { 0: 'slot' }, label);
  const header = rows[0] || [];
  const players = [];
  for (let c = PLAYER_START_COL; c < header.length; c++) {
    const raw = String(header[c] || '').trim();
    if (raw) players.push({ col: c, nameRealm: stripNickname(raw).trim() });
  }
  if (!players.length) throw new Error(`${label}: no player columns found in the header row`);

  const cells = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    for (const p of players) {
      const item = String(row[p.col] || '').trim();
      if (item) cells.push({ nameRealm: p.nameRealm, item });
    }
  }
  return { players: players.map((p) => p.nameRealm), cells };
}

export function bisSql(teamId, cells, registry, knownItems) {
  const warnings = [];
  const seen = new Set();
  let collapsed = 0;
  const valueRows = [];

  for (const cell of cells) {
    const nameRealm = registry.resolveOrStub(cell.nameRealm);
    const key = `${normName(nameRealm)}|${normName(cell.item)}`;
    if (seen.has(key)) {
      collapsed++;
      continue;
    }
    seen.add(key);
    if (knownItems && !knownItems.has(normName(cell.item))) {
      warnings.push(`item not in the Item Lookup export: ${JSON.stringify(cell.item)} (bis_items.item_id is required)`);
    }
    valueRows.push([playerIdSql(teamId, nameRealm), itemIdSql(cell.item)]);
  }

  // bis_items_no_dupe_item_key is now a 3-column expression index (#391
  // follow-up: bis_items.slot lets officers disambiguate a second Finger/
  // Trinket placeholder going forward) -- this importer never populates slot,
  // so every inserted row conflicts on the same coalesce(slot, '') = ''.
  const sql = insertStatement(
    'bis_items',
    ['player_id', 'item_id'],
    valueRows,
    "on conflict (player_id, item_id, coalesce(slot, '')) do nothing"
  );
  return { sql, count: valueRows.length, collapsed, warnings };
}
