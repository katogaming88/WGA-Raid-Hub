'use strict';

// Generates item_bosses INSERT SQL from Wowhead loot table data.
//
// --- Setup (do once per tier) ---
// Update ENCOUNTER_MAP below with any multi-boss encounter name corrections
// for the new tier before running the script.
//
// --- How to run ---
// 1. Go to the Wowhead zone page and open the Items tab.
// 2. Select all rows in the table.
// 3. Run the script with the zone name exactly as it appears in the Source column:
//      node scripts/item-bosses-sql.js "The Venomous Abyss"
// 4. When prompted, paste the comma-separated ID column values, then Enter.
// 5. When prompted, paste the comma-separated Source column values, then Enter.
//
// --- Output ---
// Ready-to-paste INSERT SQL is printed for all items with a known boss.
// Items tagged "Drop" or "Zone Drop" are printed separately -- look each one
// up on Wowhead to find the boss, then add them to the SQL manually.
//
// --- ENCOUNTER_MAP ---
// Wowhead tags loot with the individual boss name, but RCLootCouncil records
// the encounter name shown on the pull timer. For multi-boss encounters these
// differ (e.g. Wowhead says "Vexhul", RCLC records "The Twin Fangs").
// Add a mapping here for each mismatch. Bosses not listed are used as-is.

import readline from 'readline';

// Wowhead boss name -> RCLC encounter name
// Only add entries where the name differs between Wowhead and RCLootCouncil.
// Update each tier.
const ENCOUNTER_MAP = {
  // The Venomous Abyss -- Midnight Season 1
  'Gore Rattle': "Ula'tek",
  "Mor'zahi": 'The Lost Explorers',
  Vexhul: 'The Twin Fangs',
  "Breath of Ula'tek": 'Entombed Sentinels',
  Vashnik: 'Vashnik the Malignant'
};

const zoneName = process.argv[2];
if (!zoneName) {
  console.error('Usage: node scripts/item-bosses-sql.js "<zone name>"');
  console.error('Example: node scripts/item-bosses-sql.js "The Venomous Abyss"');
  process.exit(1);
}

const isTTY = process.stdin.isTTY;
const rl = readline.createInterface({ input: process.stdin, output: isTTY ? process.stdout : null });

if (isTTY) {
  process.stdout.write('Paste IDs:     ');
}

const lines = [];

rl.on('line', (line) => {
  lines.push(line.trim());
  if (isTTY && lines.length === 1) process.stdout.write('Paste sources: ');
  if (lines.length === 2) rl.close();
});

rl.on('close', () => {
  if (lines.length < 2) {
    console.error('Expected two lines: IDs then Sources.');
    process.exit(1);
  }

  const ids = lines[0]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sources = lines[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length !== sources.length) {
    console.error(`Count mismatch: ${ids.length} IDs vs ${sources.length} sources.`);
    process.exit(1);
  }

  const rows = [];
  const manual = [];

  for (let i = 0; i < ids.length; i++) {
    const wowId = ids[i];
    const raw = sources[i];
    const boss = raw.endsWith(' ' + zoneName) ? raw.slice(0, -(zoneName.length + 1)).trim() : raw;

    if (boss === 'Drop' || boss === 'Zone Drop') {
      manual.push(`  wow_item_id ${wowId}  (source: "${raw}")`);
    } else {
      const encounter = ENCOUNTER_MAP[boss] ?? boss;
      rows.push(`  ((select id from items where wow_item_id = ${wowId}), '${encounter.replace(/'/g, "''")}' )`);
    }
  }

  if (rows.length > 0) {
    console.log('\n-- Paste into Supabase SQL Editor:');
    console.log('insert into item_bosses (item_id, boss)');
    console.log('values');
    console.log(rows.join(',\n') + ';');
  }

  if (manual.length > 0) {
    console.log('\n-- Manual lookup needed (check each on Wowhead to find the correct boss):');
    manual.forEach((m) => console.log(m));
  }
});
