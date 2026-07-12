// fetch-items.js
// Fetches item data from Wowhead and outputs CSVs for Supabase import.
// Requires Node 18+ (uses native fetch). No external dependencies.
//
// Outputs:
//   items.csv         -- ready to import into the `items` table
//   item_bosses.csv   -- raw boss mappings (uses wow_item_id; swap for DB id after import)
//
// Usage: node scripts/fetch-items.js

import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// UPDATE THESE EACH TIER
// Slot keywords and armor type suffixes are specific to each raid tier.
// The suffix pattern (cast/cured/forged/woven) is consistent across tiers.
// The slot keywords and prefix change each tier -- update them here.
//
// Current tier: The Venomous Abyss (12.1)
// Token prefix: Venom (e.g. Venomforged Effigy)
const TOKEN_SLOT_KEYWORDS = {
  effigy: 'Head',
  icon: 'Chest',
  idol: 'Hands',
  relic: 'Legs',
  remnant: 'Shoulder'
};
// ---------------------------------------------------------------------------

// Types to skip entirely. Junk is NOT here -- tier tokens have type Junk on Wowhead,
// so Junk items are fetched and kept only if they have a raid boss source.
const SKIP_TYPES = new Set(['Decor', 'Reagent', 'Cosmetic']);

// [wow_item_id, wowhead_type] from Wowhead export
const RAW_DATA = [
  [268213, 'Two-Handed Axe'],
  [270175, 'Trinket'],
  [271093, 'Dagger'],
  [268209, 'One-Handed Axe'],
  [270162, 'Trinket'],
  [268202, 'One-Handed Sword'],
  [271092, 'Dagger'],
  [270173, 'Trinket'],
  [270171, 'Trinket'],
  [271878, 'Plate Armor'],
  [271876, 'Mail Armor'],
  [270164, 'Trinket'],
  [271875, 'Leather Armor'],
  [268265, 'Amulet'],
  [268207, 'Bow'],
  [268215, 'Polearm'],
  [270169, 'Trinket'],
  [270174, 'Trinket'],
  [270165, 'Trinket'],
  [270163, 'Trinket'],
  [270168, 'Trinket'],
  [270161, 'Trinket'],
  [271874, 'Cloth Armor'],
  [270160, 'Trinket'],
  [268249, 'Ring'],
  [270166, 'Trinket'],
  [268250, 'Amulet'],
  [268252, 'Ring'],
  [268251, 'Amulet'],
  [270909, 'Reagent'],
  [268198, 'Two-Handed Mace'],
  [268211, 'One-Handed Sword'],
  [268201, 'Warglaive'],
  [279129, 'Decor'],
  [268214, 'Two-Handed Sword'],
  [268205, 'Staff'],
  [268196, 'Shield'],
  [268208, 'One-Handed Axe'],
  [270170, 'Trinket'],
  [270930, 'Fist Weapon'],
  [268229, 'Plate Armor'],
  [268203, 'Dagger'],
  [270910, 'Junk'],
  [268197, 'Off-hand Frill'],
  [268219, 'Leather Armor'],
  [268200, 'Gun'],
  [268243, 'Cloth Armor'],
  [268246, 'Leather Armor'],
  [268254, 'Mail Armor'],
  [268231, 'Mail Armor'],
  [268248, 'Cloak'],
  [268253, 'Cloak'],
  [268257, 'Cloth Armor'],
  [268206, 'One-Handed Mace'],
  [268241, 'Cloth Armor'],
  [268259, 'Plate Armor'],
  [270911, 'Junk'],
  [268204, 'Dagger'],
  [268230, 'Mail Armor'],
  [268237, 'Mail Armor'],
  [268242, 'Cloth Armor'],
  [268245, 'Plate Armor'],
  [268264, 'Dagger'],
  [268216, 'Mail Armor'],
  [268224, 'Plate Armor'],
  [270912, 'Junk'],
  [268255, 'Cloth Armor'],
  [268210, 'One-Handed Mace'],
  [268235, 'Leather Armor'],
  [268258, 'Mail Armor'],
  [268222, 'Plate Armor'],
  [270924, 'Junk'],
  [270929, 'Junk'],
  [270922, 'Junk'],
  [268218, 'Cloth Armor'],
  [268228, 'Cloth Armor'],
  [268261, 'Leather Armor'],
  [270917, 'Junk'],
  [270927, 'Junk'],
  [268240, 'Leather Armor'],
  [268256, 'Leather Armor'],
  [268260, 'Plate Armor'],
  [270913, 'Junk'],
  [270914, 'Junk'],
  [268223, 'Mail Armor'],
  [268227, 'Leather Armor'],
  [268236, 'Cloth Armor'],
  [268239, 'Plate Armor'],
  [270918, 'Junk'],
  [270925, 'Junk'],
  [270928, 'Junk'],
  [268233, 'Mail Armor'],
  [268234, 'Leather Armor'],
  [270916, 'Junk'],
  [270921, 'Junk'],
  [270926, 'Junk'],
  [268220, 'Plate Armor'],
  [270915, 'Junk'],
  [270919, 'Junk'],
  [270920, 'Junk'],
  [270923, 'Junk']
];

// Slot is deterministic for these types -- no API call needed
const SLOT_FROM_TYPE = {
  Trinket: 'Trinket',
  Amulet: 'Neck',
  Ring: 'Finger',
  Cloak: 'Back',
  'Two-Handed Axe': 'Two-Hand',
  'Two-Handed Sword': 'Two-Hand',
  'Two-Handed Mace': 'Two-Hand',
  Polearm: 'Two-Hand',
  Staff: 'Two-Hand',
  'One-Handed Axe': 'One-Hand',
  'One-Handed Sword': 'One-Hand',
  'One-Handed Mace': 'One-Hand',
  Dagger: 'One-Hand',
  Warglaive: 'One-Hand',
  'Fist Weapon': 'One-Hand',
  Bow: 'Ranged',
  Gun: 'Ranged',
  Shield: 'Off Hand',
  'Off-hand Frill': 'Off Hand'
};

// Tier token name parsing -- slot from keyword, armor type from suffix
const TOKEN_ARMOR_SUFFIXES = {
  cast: 'Mail',
  cured: 'Leather',
  forged: 'Plate',
  woven: 'Cloth'
};

function parseTokenFromName(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  let slot = null;
  for (const [keyword, s] of Object.entries(TOKEN_SLOT_KEYWORDS)) {
    if (lower.includes(keyword)) {
      slot = s;
      break;
    }
  }
  let armor_type = null;
  for (const [suffix, a] of Object.entries(TOKEN_ARMOR_SUFFIXES)) {
    if (lower.includes(suffix)) {
      armor_type = a;
      break;
    }
  }
  return slot && armor_type ? { slot, armor_type } : null;
}

function getArmorType(wowheadType) {
  return wowheadType.endsWith(' Armor') ? wowheadType.slice(0, -6) : null;
}

function parseNameFromXml(xml) {
  const match = xml.match(/<name><!\[CDATA\[([\s\S]*?)\]\]><\/name>/);
  return match ? match[1].trim() : '';
}

// Wowhead's <inventorySlot> is the item's equip location straight from the game
// data ("Feet", "Finger", "Trinket", "Two-Hand", "Held In Off-hand"), and is the
// same vocabulary items.slot and bis_items.slot now store. id="0" means the item
// has no equip slot at all -- tier tokens and the class-set trade tokens -- which
// returns null so the caller falls back to parsing the slot out of the name.
function parseSlotFromXml(xml) {
  const match = xml.match(/<inventorySlot id="(\d+)">([^<]*)<\/inventorySlot>/);
  if (!match || match[1] === '0') return null;
  const slot = match[2].trim();
  return slot === '' ? null : slot;
}

function parseBossFromPage(html) {
  // Wowhead embeds dropped-by NPC data in a Listview call
  const match = html.match(/id:\s*'dropped-by'[\s\S]*?data:\s*\[(\{[\s\S]*?\})\]/);
  if (!match) return null;
  const nameMatch = match[1].match(/"name":"([^"]+)"/);
  return nameMatch ? nameMatch[1] : null;
}

function csvEscape(val) {
  if (val == null || val === '') return '""';
  return `"${String(val).replace(/"/g, '""')}"`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const filtered = RAW_DATA.filter(([, type]) => !SKIP_TYPES.has(type));
  console.log(
    `Processing ${filtered.length} items (skipped ${RAW_DATA.length - filtered.length} Decor/Junk/Reagent)...\n`
  );

  const itemRows = [];
  const bossRows = [];

  for (const [id, wowheadType] of filtered) {
    try {
      const xmlRes = await fetch(`https://www.wowhead.com/item=${id}&xml`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wga-item-seeder/1.0)' }
      });
      if (!xmlRes.ok) throw new Error(`XML HTTP ${xmlRes.status}`);
      const xml = await xmlRes.text();

      const name = parseNameFromXml(xml);
      // Wowhead's own <inventorySlot> is authoritative and needs no per-tier
      // mapping, so it wins over SLOT_FROM_TYPE. It's empty for tier tokens
      // (they trade for a set piece rather than being equipped), which is
      // exactly the case parseTokenFromName() below exists to cover.
      const slot = parseSlotFromXml(xml) ?? SLOT_FROM_TYPE[wowheadType] ?? null;
      const armor_type = getArmorType(wowheadType);

      await sleep(200);

      const pageRes = await fetch(`https://www.wowhead.com/item=${id}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; wga-item-seeder/1.0)' }
      });
      const pageHtml = await pageRes.text();
      const boss = parseBossFromPage(pageHtml);

      if (wowheadType === 'Junk') {
        const token = parseTokenFromName(name);
        if (token) {
          itemRows.push({ wow_item_id: id, name, slot: token.slot, armor_type: token.armor_type });
          if (boss) bossRows.push({ wow_item_id: id, boss });
          console.log(
            `[OK]   ${id}: ${name} | slot: ${token.slot} | armor: ${token.armor_type} | boss: ${boss ?? '(not found)'}`
          );
        } else if (boss) {
          itemRows.push({ wow_item_id: id, name, slot: slot ?? '', armor_type });
          bossRows.push({ wow_item_id: id, boss });
          console.log(`[OK]   ${id}: ${name} | slot: ${slot ?? '??'} | boss: ${boss}`);
        } else {
          console.log(`[SKIP] ${id}: ${name} | Junk with no parseable token name or boss source, skipping`);
        }
      } else {
        itemRows.push({ wow_item_id: id, name, slot: slot ?? '', armor_type });
        if (boss) bossRows.push({ wow_item_id: id, boss });
        console.log(`[OK]   ${id}: ${name} | slot: ${slot ?? '??'} | boss: ${boss ?? '(not found)'}`);
      }
    } catch (err) {
      console.error(`[FAIL] ${id}: ${err.message}`);
      if (wowheadType !== 'Junk') {
        itemRows.push({ wow_item_id: id, name: '', slot: '', armor_type: getArmorType(wowheadType) });
      }
    }

    await sleep(300);
  }

  const itemsCsv = [
    'wow_item_id,name,slot,armor_type,sort_id',
    ...itemRows.map((r) => `${r.wow_item_id},${csvEscape(r.name)},${csvEscape(r.slot)},${csvEscape(r.armor_type)},`)
  ].join('\n');
  writeFileSync('items.csv', itemsCsv, 'utf8');

  // item_bosses uses wow_item_id as a placeholder.
  // After importing items.csv, replace wow_item_id with the DB-assigned `id`.
  const bossesCsv = ['wow_item_id,boss', ...bossRows.map((r) => `${r.wow_item_id},${csvEscape(r.boss)}`)].join('\n');
  writeFileSync('item_bosses_raw.csv', bossesCsv, 'utf8');

  console.log(`\nDone.`);
  console.log(`  items.csv          -- ${itemRows.length} rows`);
  console.log(`  item_bosses_raw.csv -- ${bossRows.length} rows`);
  if (itemRows.some((r) => !r.slot)) {
    console.log('\nWARNING: Some items have no slot. Check rows with empty slot in items.csv.');
  }
}

// Run only when executed directly, so tests can import the module without
// kicking off the Wowhead fetches.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
