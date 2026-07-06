// Scoring tab -> scoring (#320 step 5).
//
// Layout: rows 1-3 title/header (kat's #228 cleanup removed the old title and
// weights rows, leaving the header block), data from row 4.
// Cols: A first name, C Performance (the manually-set value this import must
// carry), D attendance score, E attendance pct, J recent score, K trend
// score. Recent/trend are best-effort: the WCL Edge Function re-syncs them
// after migration. Cols F-H (tier/flags) and the display area are skipped
// per #228.
//
// Tank/Heal rows carry the literal text "Excluded" in the score columns
// (gs/WCL.gs:116) -- imported as null.
//
// scoring.season is NOT NULL; the sheet only holds the current season, whose
// name is passed in by the operator (--season).

import { assertHeader } from '../lib/csv.js';
import { sqlString, sqlNumber, insertStatement } from '../lib/sql.js';
import { playerIdSql } from '../lib/registry.js';

const DATA_START = 3; // 0-based: row 4

function scoreOrNull(raw) {
  const s = String(raw || '').trim();
  if (!s || /^excluded$/i.test(s)) return 'null';
  return sqlNumber(s.replace(/%$/, ''));
}

export function parseScoring(rows, label = 'Scoring') {
  assertHeader(rows, 2, { 0: 'player' }, label);
  const entries = [];
  for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = String(row[0] || '').trim();
    if (!name) continue;
    entries.push({
      name,
      performance: row[2],
      attendanceScore: row[3],
      attendancePct: row[4],
      recent: row[9],
      trend: row[10]
    });
  }
  return entries;
}

export function scoringSql(teamId, entries, registry, season) {
  if (!season) throw new Error('scoring.season is required -- pass --season');
  const valueRows = entries.map((e) => {
    const nameRealm = registry.resolveOrStub(e.name);
    return [
      playerIdSql(teamId, nameRealm),
      sqlString(season),
      scoreOrNull(e.performance),
      scoreOrNull(e.attendanceScore),
      scoreOrNull(e.attendancePct),
      scoreOrNull(e.recent),
      scoreOrNull(e.trend)
    ];
  });
  const sql = insertStatement(
    'scoring',
    ['player_id', 'season', 'performance_score', 'attendance_score', 'attendance_pct', 'recent_score', 'trend_score'],
    valueRows,
    'on conflict (player_id, season) do nothing'
  );
  return { sql, count: valueRows.length };
}
