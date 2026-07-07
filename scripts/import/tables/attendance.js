// Attendance tab -> attendance (#320 step 6).
//
// The #228 cleanup deleted the section-header rows (report identity) and the
// Notes column, and the Source column is display-only, so the exported
// layout can differ from the live sheet. Columns are therefore located by
// header text instead of fixed positions: Raid Date, Player, Status, and
// Exclude (Report). report_id imports as null -- the header rows that carried
// it are gone (known limitation, recorded on #320).
//
// The real export carries an "Excluded Reports" trailer table after the data
// (report title / date / reason); its rows have no date in the date column
// and are skipped with a warning. Rows with an empty status (one officer-
// entered raid night in the phoenix data) carry no information and are also
// skipped with a warning rather than imported as an invented status.
//
// Two reports on the same date collapse under the (team_id, player_id,
// raid_date) unique key; duplicates are detected here and reported instead of
// silently relying on the ON CONFLICT skip.

import { sqlString, sqlDate, sqlBool, insertStatement } from '../lib/sql.js';
import { playerIdSql } from '../lib/registry.js';

// attendance.status CHECK, migration 20260704204411.
const STATUSES = new Set([
  'Present',
  'Bench',
  'Medical Leave',
  'Excused',
  'Extended Leave',
  'No Show',
  'Not on Roster'
]);

function findCol(header, needle) {
  const idx = header.findIndex((h) => String(h).toLowerCase().includes(needle));
  return idx;
}

export function parseAttendance(rows, label = 'Attendance') {
  const header = rows[0] || [];
  const cols = {
    date: findCol(header, 'date'),
    player: findCol(header, 'player'),
    status: findCol(header, 'status'),
    excluded: findCol(header, 'exclude')
  };
  for (const [k, idx] of Object.entries(cols)) {
    if (idx === -1 && k !== 'excluded') {
      throw new Error(`${label}: no header column matching ${JSON.stringify(k)} in row 1`);
    }
  }

  const entries = [];
  const warnings = [];
  const seen = new Set();
  const DATE_SHAPE = /^(\d{4}[/-]\d{2}[/-]\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const date = String(row[cols.date] || '').trim();
    const name = String(row[cols.player] || '').trim();
    if (!date || !name) continue; // stray header/divider remnants have no player
    if (!DATE_SHAPE.test(date)) {
      warnings.push(`row ${i + 1} skipped: ${JSON.stringify(date)} is not a date (excluded-reports trailer?)`);
      continue;
    }
    const status = String(row[cols.status] || '').trim();
    if (!status) {
      warnings.push(`row ${i + 1} skipped: ${name} ${date} has no status`);
      continue;
    }
    if (!STATUSES.has(status)) {
      throw new Error(`${label} row ${i + 1}: status ${JSON.stringify(status)} not in the schema CHECK list`);
    }
    const excluded = cols.excluded !== -1 && String(row[cols.excluded] || '').toLowerCase() === 'true';

    const key = `${name.toLowerCase()}|${date}`;
    if (seen.has(key)) {
      warnings.push(`duplicate (player, date) dropped by the unique key: ${name} ${date}`);
    }
    seen.add(key);
    entries.push({ date, name, status, excluded });
  }
  return { entries, warnings };
}

export function attendanceSql(teamId, entries, registry) {
  const valueRows = entries.map((e) => [
    String(teamId),
    playerIdSql(teamId, registry.resolveOrStub(e.name)),
    sqlDate(e.date),
    sqlString(e.status),
    sqlBool(e.excluded)
  ]);
  const sql = insertStatement(
    'attendance',
    ['team_id', 'player_id', 'raid_date', 'status', 'report_excluded'],
    valueRows,
    'on conflict (team_id, player_id, raid_date) do nothing'
  );
  return { sql, count: valueRows.length };
}
