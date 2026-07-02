'use strict';

// Generates item_bosses INSERT SQL from Wowhead ID and Source column data.
//
// Usage:
//   node scripts/item-bosses-sql.js "<zone name>"
//
// Then paste two lines when prompted:
//   Line 1: comma-separated wow_item_ids  (copied from Wowhead)
//   Line 2: comma-separated Source values (copied from Wowhead)
//
// Items with a clear boss name generate SQL rows.
// Items showing "Drop" or "Zone Drop" are listed for manual lookup.
//
// ENCOUNTER_MAP translates Wowhead's per-boss attribution to the encounter
// name that RCLootCouncil records. Update this table each tier.
// Bosses not in the map are used as-is (single-boss encounters).

import readline from 'readline';

// Wowhead source name -> RCLC encounter name
// Only needed when Wowhead attributes loot to an individual boss inside a
// multi-boss encounter (e.g. "Vexhul" is one of The Twin Fangs).
const ENCOUNTER_MAP = {
  // The Venomous Abyss -- Midnight Season 1
  "Gore Rattle":      "Ula'tek",
  "Mor'zahi":         'The Lost Explorers',
  "Vexhul":           'The Twin Fangs',
  "Breath of Ula'tek":'Entombed Sentinels',
  "Vashnik":          'Vashnik the Malignant',
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

rl.on('line', line => {
  lines.push(line.trim());
  if (isTTY && lines.length === 1) process.stdout.write('Paste sources: ');
  if (lines.length === 2) rl.close();
});

rl.on('close', () => {
  if (lines.length < 2) {
    console.error('Expected two lines: IDs then Sources.');
    process.exit(1);
  }

  const ids     = lines[0].split(',').map(s => s.trim()).filter(Boolean);
  const sources = lines[1].split(',').map(s => s.trim()).filter(Boolean);

  if (ids.length !== sources.length) {
    console.error(`Count mismatch: ${ids.length} IDs vs ${sources.length} sources.`);
    process.exit(1);
  }

  const rows   = [];
  const manual = [];

  for (let i = 0; i < ids.length; i++) {
    const wowId = ids[i];
    const raw   = sources[i];
    const boss  = raw.endsWith(' ' + zoneName)
      ? raw.slice(0, -(zoneName.length + 1)).trim()
      : raw;

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
    manual.forEach(m => console.log(m));
  }
});
