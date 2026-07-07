// Scoring tab -> scoring (#320 step 5).
//
// Layout (kat's cleaned export, 2026-07-06): header row 1, data from row 2.
// Cols: A "First-Realm - Nick" (nickname optional), B Performance (the
// manually-set value this import must carry), C attendance score (1-10),
// D weighted total. The weighted total is derived (not stored), and the old
// sheet's attendance pct / recent / trend columns are not exported: they
// import as null and the WCL Edge Function re-syncs them after migration.
//
// Tank/Heal rows carry the literal text "Excluded" in the score columns
// (gs/WCL.gs:116) -- imported as null.
//
// scoring.season is NOT NULL; the sheet only holds the current season, whose
// name is passed in by the operator (--season).

import { assertHeader } from '../lib/csv.js';
import { sqlString, sqlNumber, insertStatement } from '../lib/sql.js';
import { playerIdSql } from '../lib/registry.js';

const DATA_START = 1; // 0-based: row 2

function scoreOrNull(raw) {
  const s = String(raw || '').trim();
  if (!s || /^excluded$/i.test(s)) return 'null';
  return sqlNumber(s.replace(/%$/, ''));
}

export function parseScoring(rows, label = 'Scoring') {
  assertHeader(rows, 0, { 0: 'player', 1: 'performance', 2: 'attendance' }, label);
  const entries = [];
  for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i] || [];
    const name = String(row[0] || '').trim();
    if (!name) continue;
    entries.push({
      name,
      performance: row[1],
      attendanceScore: row[2],
      attendancePct: '',
      recent: '',
      trend: ''
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
