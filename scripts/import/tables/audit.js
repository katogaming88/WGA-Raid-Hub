// Officer Audit Log tab -> audit_log (#320 step 12).
//
// Sheet layout (gs/wgaWebApp.gs:2734 appendAuditLog): Timestamp, Changed By,
// Action, Target, Old Value, New Value. All 52 call sites funnel through that
// one writer, so the conversion is generic rather than per-action:
//
//   action     <- Action, verbatim
//   created_at <- Timestamp (sheet-local, converted at the given tz)
//   detail     <- jsonb {target, from, to, changed_by}, empties omitted
//   actor_id / target_type / target_id <- null
//
// actor_id is a FK to auth.users; the sheet's Changed By is a Discord
// username string with no account link (and empty on early rows), so it
// lives inside detail instead. Legacy rows are identifiable by
// detail ? 'changed_by' or actor_id is null.
//
// audit_log has no unique key, so idempotency uses a NOT EXISTS guard on
// (team_id, created_at, action).

import { assertHeader } from '../lib/csv.js';
import { sqlString, sqlJsonb, insertWhereNotExists } from '../lib/sql.js';
import { sqlTimestampAtZone } from '../lib/dates.js';

export function parseAudit(rows, label = 'Officer Audit Log') {
  assertHeader(rows, 0, { 0: 'timestamp', 2: 'action' }, label);
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const timestamp = String(row[0] || '').trim();
    const action = String(row[2] || '').trim();
    if (!timestamp || !action) continue;
    entries.push({
      timestamp,
      changedBy: String(row[1] || '').trim(),
      action,
      target: String(row[3] || '').trim(),
      from: String(row[4] || '').trim(),
      to: String(row[5] || '').trim()
    });
  }
  return entries;
}

export function auditSql(teamId, entries, tz) {
  const valueRows = entries.map((e) => [
    String(teamId),
    sqlString(e.action),
    sqlJsonb({ target: e.target, from: e.from, to: e.to, changed_by: e.changedBy }),
    sqlTimestampAtZone(e.timestamp, tz)
  ]);
  const sql = insertWhereNotExists(
    'audit_log',
    ['team_id', 'action', 'detail', 'created_at'],
    valueRows,
    't.team_id = v.team_id and t.created_at = v.created_at and t.action = v.action'
  );
  return { sql, count: valueRows.length };
}
