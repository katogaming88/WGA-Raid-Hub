// Roster tab -> players (#320 step 4).
//
// Layout: rows 1-3 title/header, data from row 4.
// Cols: B trial flag, D "First-Realm", E nickname, F class, G spec,
// I BiS link, K priority (numeric 1-6; 6 = bench), M join date.
// Col C (attendance pct) is display-only (lives in scoring); col H (role) is
// derivable from class/spec; cols J/L/N are sort key / reserved / legend.
//
// m_plus_excluded and m_plus_note are NOT roster columns: the app derives
// them from Approved rows on the M+ Exclusion Requests tab
// (gs/wgaWebApp.gs:1319 getApprovedMPlusExcludedSet -- status col E, officer
// note col F), plus a manual-overrides list from Script Properties. Both
// inputs are optional here; missing means false/null.
//
// Departed players seen only in history tabs (scoring here; attendance in a
// later stage) are appended as archived stubs: name only, archived_at set.

import { assertHeader } from '../lib/csv.js';
import { normName } from '../lib/names.js';
import { sqlString, sqlBool, sqlDate, insertStatement } from '../lib/sql.js';

const DATA_START = 3; // 0-based: row 4

export function parsePlayers(rows, label = 'Roster') {
  assertHeader(rows, 2, { 3: 'player' }, label);
  const players = [];
  for (let i = DATA_START; i < rows.length; i++) {
    const row = rows[i] || [];
    const nameRealm = String(row[3] || '').trim();
    if (!nameRealm) continue;
    players.push({
      nameRealm,
      isTrial: String(row[1] || '').toLowerCase() === 'true',
      nickname: String(row[4] || '').trim(),
      class: String(row[5] || '').trim(),
      spec: String(row[6] || '').trim(),
      bisLink: String(row[8] || '').trim(),
      isBench: String(row[10] || '').trim() === '6',
      joinDate: String(row[12] || '').trim()
    });
  }
  return players;
}

// Approved M+ exclusions keyed by normName(name_realm) -> officer note.
// Rows: header row 1; cols B name_realm, E status, F officer note.
export function parseApprovedMplus(rows) {
  const approved = new Map();
  if (!rows) return approved;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const nameRealm = String(row[1] || '').trim();
    if (!nameRealm) continue;
    if (String(row[4] || '').trim() === 'Approved') {
      approved.set(normName(nameRealm), String(row[5] || '').trim());
    }
  }
  return approved;
}

export function playersSql(teamId, players, approvedMplus, manualExcluded, stubNames) {
  const warnings = [];
  const manual = new Set((manualExcluded || []).map(normName));
  const valueRows = players.map((p) => {
    const key = normName(p.nameRealm);
    const excluded = approvedMplus.has(key) || manual.has(key);
    const note = approvedMplus.get(key) || '';
    const classSpec =
      p.class && p.spec
        ? `(select id from classes_specs where class = ${sqlString(p.class)} and spec = ${sqlString(p.spec)})`
        : 'null';
    if (!p.class || !p.spec) warnings.push(`${p.nameRealm}: missing class/spec, class_spec_id will be null`);
    return [
      String(teamId),
      sqlString(p.nameRealm),
      classSpec,
      sqlBool(p.isTrial),
      sqlBool(p.isBench),
      sqlString(p.nickname),
      sqlString(p.bisLink),
      sqlDate(p.joinDate),
      sqlBool(excluded),
      sqlString(note),
      'null'
    ];
  });

  for (const stub of stubNames || []) {
    valueRows.push([
      String(teamId),
      sqlString(stub),
      'null',
      'false',
      'false',
      'null',
      'null',
      'null',
      'false',
      'null',
      'now()' // archived_at: departed player kept for history FKs
    ]);
  }

  const sql = insertStatement(
    'players',
    [
      'team_id',
      'name_realm',
      'class_spec_id',
      'is_trial',
      'is_bench',
      'nickname',
      'bis_link',
      'join_date',
      'm_plus_excluded',
      'm_plus_note',
      'archived_at'
    ],
    valueRows,
    'on conflict (team_id, name_realm) do nothing'
  );
  return { sql, warnings, count: valueRows.length };
}
