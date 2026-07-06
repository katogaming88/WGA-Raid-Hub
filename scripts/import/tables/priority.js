// Priority Order tab -> priority_order (#320 step 8).
//
// Wide format: one row per (difficulty, item), ranked player names in the
// rank columns. After the #228 cleanup row 1 is the true header
// (Difficulty | Item | 1st..10th); data starts row 2. Player cells hold first
// names (realm suffix tolerated -- the app strips it the same way,
// gs/wgaWebApp.gs:1508). A blank difficulty defaults to Heroic, mirroring
// getPriorityOrder (gs/wgaWebApp.gs:1503).
//
// priority_order.season is NOT NULL; the sheet holds only the current
// season, passed in as --season.

import { assertHeader } from '../lib/csv.js';
import { normName } from '../lib/names.js';
import { sqlString, insertStatement } from '../lib/sql.js';
import { playerIdSql, itemIdSql } from '../lib/registry.js';

const ITEM_COL = 1; // col B
const RANK_START_COL = 2; // col C = rank 1

export function parsePriority(rows, label = 'Priority Order') {
  assertHeader(rows, 0, { 1: 'item' }, label);
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const item = String(row[ITEM_COL] || '').trim();
    if (!item) continue;
    const rawDiff = String(row[0] || '').trim();
    const difficulty = rawDiff ? rawDiff[0].toUpperCase() + rawDiff.slice(1).toLowerCase() : 'Heroic';
    if (difficulty !== 'Heroic' && difficulty !== 'Mythic') {
      throw new Error(`${label} row ${i + 1}: difficulty ${JSON.stringify(rawDiff)} (schema allows Heroic/Mythic)`);
    }
    for (let c = RANK_START_COL; c < row.length; c++) {
      const name = String(row[c] || '').trim();
      if (!name) continue;
      entries.push({ item, difficulty, rank: c - RANK_START_COL + 1, name });
    }
  }
  return entries;
}

export function prioritySql(teamId, entries, registry, season, knownItems) {
  if (!season) throw new Error('priority_order.season is required -- pass --season');
  const warnings = [];
  const valueRows = entries.map((e) => {
    if (knownItems && !knownItems.has(normName(e.item))) {
      warnings.push(
        `item not in the Item Lookup export: ${JSON.stringify(e.item)} (priority_order.item_id is required)`
      );
    }
    return [
      String(teamId),
      sqlString(season),
      itemIdSql(e.item),
      sqlString(e.difficulty),
      String(e.rank),
      playerIdSql(teamId, registry.resolveOrStub(e.name))
    ];
  });
  const sql = insertStatement(
    'priority_order',
    ['team_id', 'season', 'item_id', 'difficulty', 'rank', 'player_id'],
    valueRows,
    'on conflict (team_id, season, item_id, difficulty, player_id) do nothing'
  );
  return { sql, count: valueRows.length, warnings };
}
