// M+ Exclusion Requests tab -> mplus_exclusion_requests (#320 step 9).
//
// Sheet layout: header row 1; Timestamp, Name-Realm, Raider.io URL, Notes,
// Status, Officer Note. Status is Title Case on the sheet and lowercase in
// the schema CHECK. The players generator separately derives
// players.m_plus_excluded from this same tab's Approved rows; this module
// imports the request history itself.
//
// The schema enforces at most one pending request per player (partial unique
// index), so pending duplicates fail generation here rather than blowing up
// half-applied at psql time. No unique key otherwise: idempotency via
// NOT EXISTS on (team_id, player_id, submitted_at).

import { assertHeader } from '../lib/csv.js';
import { normName } from '../lib/names.js';
import { sqlString, insertWhereNotExists } from '../lib/sql.js';
import { sqlTimestampAtZone } from '../lib/dates.js';
import { playerIdSql } from '../lib/registry.js';

const STATUS_MAP = { pending: 'pending', approved: 'approved', rejected: 'rejected' };

export function parseMplusRequests(rows, label = 'M+ Exclusion Requests') {
  assertHeader(rows, 0, { 1: 'name', 4: 'status' }, label);
  const entries = [];
  const pendingSeen = new Set();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const nameRealm = String(row[1] || '').trim();
    if (!nameRealm) continue;
    const status =
      STATUS_MAP[
        String(row[4] || '')
          .trim()
          .toLowerCase()
      ];
    if (!status) {
      throw new Error(`${label} row ${i + 1}: status ${JSON.stringify(row[4])} not in pending/approved/rejected`);
    }
    if (status === 'pending') {
      const key = normName(nameRealm);
      if (pendingSeen.has(key)) {
        throw new Error(
          `${label}: two pending requests for ${nameRealm} -- the schema allows one; resolve on the sheet first`
        );
      }
      pendingSeen.add(key);
    }
    entries.push({
      timestamp: String(row[0] || '').trim(),
      nameRealm,
      raiderioUrl: String(row[2] || '').trim(),
      reason: String(row[3] || '').trim(),
      status,
      officerNotes: String(row[5] || '').trim()
    });
  }
  return entries;
}

export function mplusSql(teamId, entries, registry, tz) {
  const valueRows = entries.map((e) => [
    String(teamId),
    playerIdSql(teamId, registry.resolveOrStub(e.nameRealm)),
    sqlString(e.reason),
    sqlTimestampAtZone(e.timestamp, tz),
    sqlString(e.status),
    sqlString(e.raiderioUrl),
    sqlString(e.officerNotes)
  ]);
  const sql = insertWhereNotExists(
    'mplus_exclusion_requests',
    ['team_id', 'player_id', 'reason', 'submitted_at', 'status', 'raiderio_url', 'officer_notes'],
    valueRows,
    't.team_id = v.team_id and t.player_id = v.player_id and t.submitted_at = v.submitted_at'
  );
  return { sql, count: valueRows.length };
}
