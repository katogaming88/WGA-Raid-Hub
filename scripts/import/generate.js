// One-time Sheets-to-Supabase import SQL generator (#320).
//
// Reads a team's tab CSV exports from data/<team>/ and writes one
// transactional, idempotent SQL file to data/sql/import-<team>.sql.
// Re-running the file inserts only rows that are new since the last apply
// (natural-key ON CONFLICT targets), which is the pre-cutover refresh #320
// calls for. Apply it with psql:
//
//   psql "<local or service= connection>" -f data/sql/import-<team>.sql
//
// --- How to run ---
//   node scripts/import/generate.js --team phoenix --season "Season 3"
//
// Options:
//   --team <slug>      phoenix | hellfire (maps to teams.id 1 | 2)
//   --season <name>    current season string for scoring rows (NOT NULL)
//   --data <dir>       CSV directory (default data/<team>)
//   --out <file>       output (default data/sql/import-<team>.sql)
//   --mplus-manual <a,b>  manual M+ exclusion overrides (Script Properties
//                         list; names as First-Realm)
//
// Expected CSV filenames in the data directory (missing tabs are skipped
// with a note so exports can arrive incrementally):
//   Roster.csv, Scoring.csv, Item Lookup.csv, M+ Exclusion Requests.csv,
//   Attendance.csv, BiS List.csv, Priority Order.csv

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadCsvIfPresent } from './lib/csv.js';
import { normName } from './lib/names.js';
import { buildPlayerRegistry } from './lib/registry.js';
import { parseItems, itemsSql, diffItemRegistries } from './tables/items.js';
import { parsePlayers, parseApprovedMplus, playersSql } from './tables/players.js';
import { parseScoring, scoringSql } from './tables/scoring.js';
import { parseAttendance, attendanceSql } from './tables/attendance.js';
import { parseBis, bisSql } from './tables/bis.js';
import { parsePriority, prioritySql } from './tables/priority.js';

const TEAM_IDS = { phoenix: 1, hellfire: 2 };

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const team = arg('team');
if (!TEAM_IDS[team]) {
  console.error(`--team must be one of: ${Object.keys(TEAM_IDS).join(', ')}`);
  process.exit(1);
}
const teamId = TEAM_IDS[team];
const dataDir = arg('data', join('data', team));
const outFile = arg('out', join('data', 'sql', `import-${team}.sql`));
const season = arg('season', '');
const mplusManual = (arg('mplus-manual', '') || '').split(',').filter(Boolean);

const sections = [];
const summary = [];
const notes = [];

function section(title, sql) {
  sections.push(`-- === ${title} ===\n${sql}`);
}

// --- Item Lookup -> items + item_bosses (global tables, idempotent both runs)
const itemRows = loadCsvIfPresent(join(dataDir, 'Item Lookup.csv'));
let itemCount = 0;
let knownItems = null; // normName(item) set for validating item references
if (itemRows) {
  const { items } = parseItems(itemRows, `${team} Item Lookup`);
  section('items + item_bosses', itemsSql(items));
  itemCount = items.length;
  knownItems = new Set(items.map((i) => normName(i.name)));
  summary.push(`items: ${items.length} (bosses on ${items.filter((i) => i.boss).length})`);

  const otherTeam = team === 'phoenix' ? 'hellfire' : 'phoenix';
  const otherRows = loadCsvIfPresent(join('data', otherTeam, 'Item Lookup.csv'));
  if (otherRows) {
    const other = parseItems(otherRows, `${otherTeam} Item Lookup`);
    for (const line of diffItemRegistries(items, team, other.items, otherTeam)) {
      notes.push(`item registry mismatch: ${line}`);
    }
  }
} else {
  notes.push('Item Lookup.csv missing -- items section skipped');
}

// --- Player-referencing tabs. Everything that can name a departed player is
// parsed BEFORE the players section is emitted, so the registry's archived
// stubs land in that insert; sections are then emitted in FK order.
const rosterRows = loadCsvIfPresent(join(dataDir, 'Roster.csv'));
if (rosterRows) {
  const players = parsePlayers(rosterRows, `${team} Roster`);
  const registry = buildPlayerRegistry(players.map((p) => p.nameRealm));

  let scoringResult = null;
  const scoringRows = loadCsvIfPresent(join(dataDir, 'Scoring.csv'));
  if (scoringRows) {
    scoringResult = scoringSql(teamId, parseScoring(scoringRows, `${team} Scoring`), registry, season);
  } else {
    notes.push('Scoring.csv missing -- scoring section skipped');
  }

  let attendanceResult = null;
  const attendanceRows = loadCsvIfPresent(join(dataDir, 'Attendance.csv'));
  if (attendanceRows) {
    const parsed = parseAttendance(attendanceRows, `${team} Attendance`);
    for (const w of parsed.warnings) notes.push(`attendance: ${w}`);
    attendanceResult = attendanceSql(teamId, parsed.entries, registry);
  } else {
    notes.push('Attendance.csv missing -- attendance section skipped');
  }

  let bisResult = null;
  const bisRows = loadCsvIfPresent(join(dataDir, 'BiS List.csv'));
  if (bisRows) {
    const { cells } = parseBis(bisRows, `${team} BiS List`);
    bisResult = bisSql(teamId, cells, registry, knownItems);
    for (const w of bisResult.warnings) notes.push(`bis_items: ${w}`);
  } else {
    notes.push('BiS List.csv missing -- bis_items section skipped');
  }

  let priorityResult = null;
  const priorityRows = loadCsvIfPresent(join(dataDir, 'Priority Order.csv'));
  if (priorityRows) {
    priorityResult = prioritySql(
      teamId,
      parsePriority(priorityRows, `${team} Priority Order`),
      registry,
      season,
      knownItems
    );
    for (const w of priorityResult.warnings) notes.push(`priority_order: ${w}`);
  } else {
    notes.push('Priority Order.csv missing -- priority_order section skipped');
  }

  const mplusRows = loadCsvIfPresent(join(dataDir, 'M+ Exclusion Requests.csv'));
  if (!mplusRows) notes.push('M+ Exclusion Requests.csv missing -- m_plus_excluded imports as false');
  const approved = parseApprovedMplus(mplusRows);

  const stubs = registry.stubNames();
  const playersResult = playersSql(teamId, players, approved, mplusManual, stubs);
  section('players', playersResult.sql);
  summary.push(`players: ${players.length} roster + ${stubs.length} archived stubs`);
  for (const w of playersResult.warnings) notes.push(`players: ${w}`);
  if (stubs.length) notes.push(`archived stubs for departed players: ${stubs.join(', ')}`);

  if (scoringResult) {
    section('scoring', scoringResult.sql);
    summary.push(`scoring: ${scoringResult.count} rows (season ${JSON.stringify(season)})`);
  }
  if (attendanceResult) {
    section('attendance', attendanceResult.sql);
    summary.push(`attendance: ${attendanceResult.count} rows`);
  }
  if (bisResult) {
    section('bis_items', bisResult.sql);
    summary.push(`bis_items: ${bisResult.count} rows (${bisResult.collapsed} duplicate cells collapsed)`);
  }
  if (priorityResult) {
    section('priority_order', priorityResult.sql);
    summary.push(`priority_order: ${priorityResult.count} rows (season ${JSON.stringify(season)})`);
  }
} else {
  notes.push('Roster.csv missing -- player-referencing sections skipped');
}

if (!sections.length) {
  console.error(`No CSVs found under ${dataDir} -- nothing to generate.`);
  process.exit(1);
}

const header =
  `-- Generated by scripts/import/generate.js for team ${team} (id ${teamId})\n` +
  `-- Source: ${dataDir}  (#320 one-time data migration)\n` +
  `-- Idempotent: re-applying inserts only new rows.\n`;
const sql = `${header}\nbegin;\n\n${sections.join('\n')}\ncommit;\n`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, sql, 'utf8');

console.log(`Wrote ${outFile}`);
for (const s of summary) console.log(`  ${s}`);
if (itemCount || summary.length) console.log('Verify counts after apply against the numbers above.');
for (const n of notes) console.log(`  NOTE: ${n}`);
