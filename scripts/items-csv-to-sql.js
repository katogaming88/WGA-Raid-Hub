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

function sqlStr(v) {
  return v === '' || v == null ? 'null' : `'${v.replace(/'/g, "''")}'`;
}

function sqlNum(v) {
  return v === '' || v == null ? 'null' : v;
}

const lines = readFileSync('items.csv', 'utf8').trim().split('\n');
const header = lines[0];
if (header !== 'wow_item_id,name,slot,armor_type,sort_id,icon,wcl_zone_id') {
  console.error(`Unexpected items.csv header: ${header}`);
  process.exit(1);
}
const dataLines = lines.slice(1);

const rows = dataLines.map((line) => {
  const [wowId, name, slot, armorType, sortId, icon, wclZoneId] = parseCsvLine(line);
  return `  (${[wowId, sqlStr(name), sqlStr(slot), sqlStr(armorType), sqlNum(sortId), sqlStr(icon), sqlNum(wclZoneId), 'false'].join(', ')})`;
});

const sql =
  'insert into items (wow_item_id, name, slot, armor_type, sort_id, icon, wcl_zone_id, is_placeholder)\nvalues\n' +
  rows.join(',\n') +
  ';\n';

writeFileSync('items_insert.sql', sql, 'utf8');
console.log(`items_insert.sql written -- ${rows.length} rows`);
