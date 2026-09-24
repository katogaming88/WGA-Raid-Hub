// dungeon-items-sql.js
// Turns a season's dungeon loot file (scripts/season-items/<season>-dungeons.txt,
// made in game by scripts/wow/WGA_LootDump) into one SQL file that adds those
// items to the catalog as source 'dungeon' (#1166). Requires Node 18+.
//
// The game already gives the item id, name, slot and armor or weapon type, so
// the only lookup is each item's icon, from the tooltip endpoint fetch-items.js
// uses. Stats and weapon type come afterwards from fetch-item-stats.js, the
// same follow-up every new item takes.
//
// Why a data file and not a migration: same as fetch-boe-items.js, the seed
// inserts item ids explicitly after migrations run, so sequence-assigned rows
// in a migration would collide on a `supabase db reset`. The file is
// gitignored (data/) and applied by hand at a checkpoint:
//
//   node scripts/dungeon-items-sql.js scripts/season-items/MID2-dungeons.txt
//   psql service=wga-admin -X -v ON_ERROR_STOP=1 -f data/sql/dungeon-items.sql
//
// Safe to run twice: an item already in the catalog is left alone.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fetchIcon } from './fetch-items.js';
import { sqlNumber, sqlString } from './import/lib/sql.js';

const ARMOR_TYPES = new Set(['Cloth', 'Leather', 'Mail', 'Plate']);
const NOT_GEAR = '(no slot: not gear)';

// The gear rows of a dump, one per item id (an item that drops from two bosses
// is one catalog row). Throws on a file with no season line or a bad id, so a
// hand-edit cannot reach the SQL file.
export function parseDungeonLoot(text) {
  const season = text.match(/^-- season: (\S+)/m)?.[1];
  if (!season) throw new Error('No "-- season: CODE" line at the top of the file');

  const items = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('--')) continue;
    const [dungeon, boss, id, name, slot, type] = line.split('|').map((s) => s.trim());
    if (!/^\d+$/.test(id ?? '')) throw new Error(`Bad item id in line: ${line}`);
    if (!name || !slot || slot === NOT_GEAR || items.has(Number(id))) continue;
    items.set(Number(id), {
      id: Number(id),
      name,
      slot,
      // Weapons and shields carry their own type here; weapon_subtype is filled
      // by fetch-item-stats.js, so armor_type stays null for them.
      armorType: ARMOR_TYPES.has(type) ? type : null,
      dungeon,
      boss
    });
  }
  return { season, items: [...items.values()] };
}

export function dungeonItemsSql({ season, items }, icons = {}) {
  const rows = items.map(
    (i) =>
      `  (${sqlNumber(i.id)}, ${sqlString(i.name)}, ${sqlString(i.slot)}, ${sqlString(i.armorType)}, ${sqlString(icons[i.id])})`
  );
  return [
    `-- Dungeon items for season ${season} (#1166): ${items.length} rows.`,
    '-- Made by scripts/dungeon-items-sql.js. An item already in the catalog is skipped.',
    'begin;',
    'insert into public.items (wow_item_id, name, slot, armor_type, icon, source, season)',
    `select v.wow_item_id::integer, v.name::text, v.slot::text, v.armor_type::text, v.icon::text, 'dungeon', ${sqlString(season)}`,
    'from (values',
    rows.join(',\n'),
    ') as v(wow_item_id, name, slot, armor_type, icon)',
    'where not exists (select 1 from public.items i where i.wow_item_id = v.wow_item_id::integer);',
    'commit;',
    ''
  ].join('\n');
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/dungeon-items-sql.js scripts/season-items/MID2-dungeons.txt');
    process.exit(1);
  }
  const parsed = parseDungeonLoot(readFileSync(file, 'utf8'));
  console.log(`${parsed.items.length} gear items for ${parsed.season}. Looking up icons...`);

  const icons = {};
  for (const item of parsed.items) {
    try {
      icons[item.id] = await fetchIcon(item.id);
    } catch (err) {
      console.error(`[WARN] ${item.id} ${item.name}: no icon (${err.message})`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  mkdirSync('data/sql', { recursive: true });
  writeFileSync('data/sql/dungeon-items.sql', dungeonItemsSql(parsed, icons), 'utf8');
  console.log('Wrote data/sql/dungeon-items.sql. Next: apply it, then run fetch-item-stats.js for the new ids.');
}

// Run only when executed directly, so tests can import the module without
// kicking off the Wowhead lookups.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
