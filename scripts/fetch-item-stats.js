// fetch-item-stats.js
// Fetches each item's secondary stat types (Crit/Haste/Mastery/Vers) from
// Blizzard's Game Data API and writes a ready-to-paste UPDATE SQL file.
// Requires Node 18+ (uses native fetch). No external dependencies.
//
// --- Setup ---
// Requires BLIZZARD_CLIENT_ID/BLIZZARD_CLIENT_SECRET in .env (see #559 --
// register a client at develop.battle.net, client_credentials flow only).
//
// --- How to run ---
// 1. In the Supabase SQL Editor, run:
//      select wow_item_id from items where wow_item_id is not null
//    and export the result as item_ids.csv (single `wow_item_id` column).
// 2. node scripts/fetch-item-stats.js
// 3. Paste the generated item_stats_update.sql into the Supabase SQL Editor.
//
// --- Output ---
// item_stats_update.sql -- one `update items set secondary_stats = ...`
// statement per item that Blizzard's API returned data for. secondary_stats
// is `[]` (not null) when the API confirms the item rolls none of the four
// tracked types -- null stays reserved for items this script hasn't
// successfully fetched yet.
//
// Items that 404 (not yet in Blizzard's static item database -- seen live
// for an entire still-PTR tier during #560's initial run) are printed
// separately and left untouched. Re-run once the tier ships live.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SECONDARY_STAT_TYPES = new Set(['CRIT_RATING', 'HASTE_RATING', 'MASTERY_RATING', 'VERSATILITY']);

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function getAccessToken(clientId, clientSecret) {
  const res = await fetch('https://oauth.battle.net/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  if (!res.ok) throw new Error(`Token request HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function fetchSecondaryStats(wowItemId, token) {
  const res = await fetch(`https://us.api.blizzard.com/data/wow/item/${wowItemId}?namespace=static-us&locale=en_US`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const stats = (data.preview_item?.stats ?? [])
    .map((s) => s.type?.type)
    .filter((type) => SECONDARY_STAT_TYPES.has(type));
  return { stats };
}

function parseItemIds(csv) {
  const lines = csv.trim().split('\n');
  if (lines[0].trim() !== 'wow_item_id') {
    console.error(`Unexpected item_ids.csv header: ${lines[0]}`);
    process.exit(1);
  }
  return lines
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  loadEnv();
  const { BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET } = process.env;
  if (!BLIZZARD_CLIENT_ID || !BLIZZARD_CLIENT_SECRET) {
    console.error('BLIZZARD_CLIENT_ID/BLIZZARD_CLIENT_SECRET must be set in .env (see #559).');
    process.exit(1);
  }

  if (!existsSync('item_ids.csv')) {
    console.error(
      'item_ids.csv not found -- export `select wow_item_id from items` from the Supabase SQL Editor first.'
    );
    process.exit(1);
  }

  console.log('Requesting OAuth token...');
  const token = await getAccessToken(BLIZZARD_CLIENT_ID, BLIZZARD_CLIENT_SECRET);

  const ids = parseItemIds(readFileSync('item_ids.csv', 'utf8'));
  console.log(`Fetching secondary stats for ${ids.length} items...\n`);

  const updates = [];
  const notFound = [];

  for (const id of ids) {
    try {
      const result = await fetchSecondaryStats(id, token);
      if (result.notFound) {
        notFound.push(id);
        console.log(`[404]  ${id}: not in Blizzard's static item database yet`);
      } else {
        updates.push({ id, stats: result.stats });
        console.log(`[OK]   ${id}: ${result.stats.length ? result.stats.join(', ') : '(none)'}`);
      }
    } catch (err) {
      console.error(`[FAIL] ${id}: ${err.message}`);
    }
    await sleep(100);
  }

  const sql = updates
    .map((u) => `update items set secondary_stats = '${JSON.stringify(u.stats)}'::jsonb where wow_item_id = ${u.id};`)
    .join('\n');
  writeFileSync('item_stats_update.sql', sql + '\n', 'utf8');

  console.log(`\nDone.`);
  console.log(`  item_stats_update.sql -- ${updates.length} rows`);
  if (notFound.length) {
    console.log(`  ${notFound.length} items not found (still PTR-only?): ${notFound.join(', ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
