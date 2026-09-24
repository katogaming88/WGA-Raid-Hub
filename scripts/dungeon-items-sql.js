// dungeon-items-sql.js
// Turns a season's dungeon loot file (scripts/season-items/<season>-dungeons.txt,
// made in game by scripts/wow/WGA_LootDump) into one SQL file that adds those
// items to the catalog as source 'dungeon' (#1166), with the season each is offered
// in. A list from /wgacrafts (same addon) works the same with a "-- source: crafted"
// line under the season line. Requires Node 18+.
//
// The game already gives the item id, name, slot and armor or weapon type, so
// the only lookup is each item's icon (plus quality and item level, for the
// optional "-- min quality" and "-- min item level" lines), from the tooltip
// endpoint fetch-items.js uses. Stats and weapon type come afterwards from fetch-item-stats.js, the
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
// Safe to run twice, and each season: an item already in the catalog is kept
// and only gets the season, so a dungeon that returns needs no edit. An item
// that clashes with another catalog row on name stops the run and undoes it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sqlNumber, sqlString } from './import/lib/sql.js';

const ARMOR_TYPES = new Set(['Cloth', 'Leather', 'Mail', 'Plate']);
const NOT_GEAR = '(no slot: not gear)';

// The gear rows of a dump, one per item id (an item that drops from two bosses
// is one catalog row). Throws on a file with no season line or a bad id, so a
// hand-edit cannot reach the SQL file.
export function parseDungeonLoot(text) {
  const season = text.match(/^-- season: (\S+)/m)?.[1];
  if (!season) throw new Error('No "-- season: CODE" line at the top of the file');
  // A crafted list (from /wgacrafts) says so on a second line; the default is a dungeon list.
  const source = text.match(/^-- source: (\S+)/m)?.[1] ?? 'dungeon';
  if (!['dungeon', 'crafted'].includes(source)) throw new Error(`Unknown source: ${source}`);
  // Optional filters, applied once each item's level and quality are looked up.
  // A crafted list holds leveling gear, cosmetics and PvP sets next to the
  // endgame pieces, and only quality and item level tell them apart.
  const minQuality = text.match(/^-- min quality: (\d+)/m)?.[1];
  const minItemLevel = text.match(/^-- min item level: (\d+)/m)?.[1];

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
  return {
    season,
    source,
    minQuality: minQuality ? Number(minQuality) : null,
    minItemLevel: minItemLevel ? Number(minItemLevel) : null,
    items: [...items.values()]
  };
}

// What the tooltip endpoint says about an item: its icon, quality (2 green, 3
// rare, 4 epic) and item level, which sits in the tooltip text.
export function itemFacts(tooltip) {
  const html = tooltip?.tooltip ?? '';
  const level = html.match(/Item Level (?:<[^>]*>)?(\d+)/) ?? html.match(/ilvl-->(\d+)/);
  return {
    icon: tooltip?.icon ?? null,
    quality: typeof tooltip?.quality === 'number' ? tooltip.quality : null,
    itemLevel: level ? Number(level[1]) : null
  };
}

// Whether an item passes the file's filters. An item whose level or quality
// could not be read never passes a filter that needs it: guessing here would
// put the wrong gear in the catalog.
export function keepsItem(facts, { minQuality, minItemLevel }) {
  if (minQuality != null && !(facts.quality >= minQuality)) return false;
  if (minItemLevel != null && !(facts.itemLevel >= minItemLevel)) return false;
  return true;
}

export function dungeonItemsSql({ season, source = 'dungeon', items }, icons = {}) {
  const rows = items.map(
    (i) =>
      `  (${sqlNumber(i.id)}, ${sqlString(i.name)}, ${sqlString(i.slot)}, ${sqlString(i.armorType)}, ${sqlString(icons[i.id])})`
  );
  return [
    `-- ${source} items for season ${season} (#1166): ${items.length} rows.`,
    '-- Made by scripts/dungeon-items-sql.js. Items already in the catalog are kept and only get the season.',
    'begin;',
    'create temp table incoming (wow_item_id integer primary key, name text, slot text, armor_type text, icon text) on commit drop;',
    'insert into incoming values',
    rows.join(',\n') + ';',
    // A unique index on wow_item_id and one on lower(name) both guard the
    // catalog, so a clash on either is skipped here and caught below.
    'insert into public.items (wow_item_id, name, slot, armor_type, icon, source)',
    `select wow_item_id, name, slot, armor_type, icon, ${sqlString(source)} from incoming`,
    'on conflict do nothing;',
    // Stop, and undo everything, if any listed item is not in the catalog as
    // a dungeon or crafted item: a name clash with another item would
    // otherwise leave it silently unoffered.
    'do $$',
    'declare bad text;',
    'begin',
    "  select string_agg(n.wow_item_id || ' ' || n.name, '; ') into bad from incoming n",
    "  where not exists (select 1 from public.items i where i.wow_item_id = n.wow_item_id and i.source <> 'raid');",
    "  if bad is not null then raise exception 'Not in the catalog as a dungeon item (name clash?): %', bad; end if;",
    'end $$;',
    'insert into public.item_seasons (item_id, season)',
    `select i.id, ${sqlString(season)} from incoming n join public.items i on i.wow_item_id = n.wow_item_id`,
    'on conflict do nothing;',
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
  console.log(`${parsed.items.length} gear items for ${parsed.season}. Looking up icons and levels...`);

  const icons = {};
  const kept = [];
  const dropped = [];
  const unreadable = [];
  for (const item of parsed.items) {
    let facts = { icon: null, quality: null, itemLevel: null };
    try {
      const res = await fetch(`https://nether.wowhead.com/tooltip/item/${item.id}?dataEnv=1&locale=0`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wga-item-seeder/1.0)' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      facts = itemFacts(await res.json());
    } catch (err) {
      console.error(`[WARN] ${item.id} ${item.name}: lookup failed (${err.message})`);
    }
    icons[item.id] = facts.icon;
    const filtered = parsed.minQuality != null || parsed.minItemLevel != null;
    if (filtered && (facts.quality == null || facts.itemLevel == null)) unreadable.push(item);
    else if (keepsItem(facts, parsed)) kept.push(item);
    else dropped.push(`${item.name} (quality ${facts.quality}, item level ${facts.itemLevel})`);
    await new Promise((r) => setTimeout(r, 150));
  }
  if (unreadable.length) {
    console.error(
      `Could not read the level or quality of ${unreadable.length} items, so nothing was written: ` +
        unreadable.map((i) => `${i.id} ${i.name}`).join('; ')
    );
    process.exit(1);
  }
  if (dropped.length)
    console.log(`Left out ${dropped.length} below the file's filters, for example: ${dropped.slice(0, 3).join('; ')}`);

  mkdirSync('data/sql', { recursive: true });
  const out = `data/sql/${parsed.source}-items.sql`;
  writeFileSync(out, dungeonItemsSql({ ...parsed, items: kept }, icons), 'utf8');
  console.log(`Wrote ${out} with ${kept.length} items. Next: apply it, then run fetch-item-stats.js for the new ids.`);
}

// Run only when executed directly, so tests can import the module without
// kicking off the Wowhead lookups.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
