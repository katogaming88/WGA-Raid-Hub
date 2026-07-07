// Roster tab -> players (#320 step 4).
//
// Layout (kat's cleaned export, 2026-07-06): header row 1, data from the
// next row. The hellfire export (2026-07-07) ships the sheet's two banner
// rows (title, description) above the header, so the header row is located
// by content within the first few rows rather than assumed at row 1.
// Cols: A "Is Trial", B "First-Realm", C nickname, D class, E spec, F role,
// G BiS link, H priority (numeric 1-6; 6 = bench), I join date (M/d/yyyy).
// Role (col F) is derivable from class/spec and skipped.
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

const HEADER_SCAN_ROWS = 5;

export function parsePlayers(rows, label = 'Roster') {
  let headerRow = 0;
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN_ROWS); i++) {
    const row = rows[i] || [];
    if (
      String(row[0] || '')
        .toLowerCase()
        .includes('trial') &&
      String(row[1] || '')
        .toLowerCase()
        .includes('player')
    ) {
      headerRow = i;
      break;
    }
  }
  assertHeader(rows, headerRow, { 0: 'trial', 1: 'player', 3: 'class', 4: 'spec' }, label);
  const players = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const nameRealm = String(row[1] || '').trim();
    if (!nameRealm) continue;
    players.push({
      nameRealm,
      isTrial: String(row[0] || '').toLowerCase() === 'true',
      nickname: String(row[2] || '').trim(),
      class: String(row[3] || '').trim(),
      spec: String(row[4] || '').trim(),
      bisLink: String(row[6] || '').trim(),
      isBench: String(row[7] || '').trim() === '6',
      joinDate: String(row[8] || '').trim()
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
