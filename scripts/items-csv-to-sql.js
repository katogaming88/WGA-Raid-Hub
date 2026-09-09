'use strict';

// Converts items.csv (fetch-items.js's output, hand-edited to fill in sort_id
// and any manually-added rows) into a ready-to-paste `insert into items`
// statement -- so nobody has to hand-write ~90 SQL value tuples or get the
// null-vs-empty-string/quote-escaping right by hand each tier.
//
// --- How to run ---
// 1. Finish editing items.csv (fill in sort_id, add any manual rows -- e.g. a
//    Curio-slot item fetch-items.js missed because Wowhead had no boss/source
//    data for it yet -- and remove anything that turned out not to belong,
//    e.g. see updating-fetch-items-for-new-tier.md's note on cosmetics that
//    sneak into a Wowhead Items-tab paste).
// 2. Run: node scripts/items-csv-to-sql.js
// 3. Paste the generated items_insert.sql into the Supabase SQL Editor.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sqlBool, sqlNumber, sqlString } from './import/lib/sql.js';

const HEADER = 'wow_item_id,name,slot,armor_type,sort_id,icon,wcl_zone_id';

function parseCsvLine(line) {
  const re = /(?:^|,)("(?:[^"]|"")*"|[^,]*)/g;
  const out = [];
  let m;
  while ((m = re.exec(line))) {
    if (m[0] === '' && out.length) break;
    let v = m[1];
    if (v.startsWith('"')) v = v.slice(1, -1).replace(/""/g, '"');
    out.push(v);
    if (re.lastIndex >= line.length) break;
  }
  return out;
}

// The three ids go through sqlNumber, so a hand-edit that leaves text in one
// stops the run rather than reaching the file a maintainer pastes (#1012).
export function itemsInsertSql(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines[0] !== HEADER) {
    throw new Error(`Unexpected items.csv header: ${lines[0]}`);
  }

  const rows = lines.slice(1).map((line) => {
    const [wowId, name, slot, armorType, sortId, icon, wclZoneId] = parseCsvLine(line);
    const values = [
      sqlNumber(wowId),
      sqlString(name),
      sqlString(slot),
      sqlString(armorType),
      sqlNumber(sortId),
      sqlString(icon),
      sqlNumber(wclZoneId),
      sqlBool(false)
    ];
    return `  (${values.join(', ')})`;
  });

  return (
    'insert into items (wow_item_id, name, slot, armor_type, sort_id, icon, wcl_zone_id, is_placeholder)\nvalues\n' +
    rows.join(',\n') +
    ';\n'
  );
}

function main() {
  let sql;
  let rowCount = 0;
  try {
    const csvText = readFileSync('items.csv', 'utf8');
    sql = itemsInsertSql(csvText);
    rowCount = csvText.trim().split('\n').length - 1;
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  writeFileSync('items_insert.sql', sql, 'utf8');
  console.log(`items_insert.sql written -- ${rowCount} rows`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
