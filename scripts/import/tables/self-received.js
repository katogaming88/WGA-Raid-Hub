// Self Received Requests tab -> self_received_requests (#320 step 10).
//
// Sheet layout: header row 1; Timestamp, Player, Item, Slot, Source, Notes,
// Status. Slot is derivable from the item, so it isn't imported.
//
// The Source cell mixes a difficulty prefix with the actual source
// ("Mythic: Bonus Roll" vs bare "Bonus Roll"); columns for the split values
// were added by migration 20260706234500 per the decision on #322. The split
// mirrors the app's parsing (gs/wgaWebApp.gs:2046-2048): a recognized prefix
// wins and a bare non-empty value defaults to the Myth track. The sheet's
// difficulty words map to track names (Normal -> Champion, Heroic -> Hero,
// Mythic -> Myth, decided on #343). An empty cell imports as null/null.
//
// No unique key on this table: idempotency via NOT EXISTS on
// (team_id, submitted_at, self_item_id).

import { assertHeader } from '../lib/csv.js';
import { normName } from '../lib/names.js';
import { sqlString, insertWhereNotExists } from '../lib/sql.js';
import { sqlTimestampAtZone } from '../lib/dates.js';
import { playerIdSql, itemIdSql } from '../lib/registry.js';

const STATUS_MAP = { pending: 'pending', approved: 'approved', rejected: 'rejected' };
const TRACK = { normal: 'Champion', champion: 'Champion', heroic: 'Hero', mythic: 'Myth' };

export function splitSource(raw) {
  const s = String(raw || '').trim();
  if (!s) return { track: null, source: null };
  const m = s.match(/^(normal|champion|heroic|mythic)\s*:\s*(.*)$/i);
  if (m) return { track: TRACK[m[1].toLowerCase()], source: m[2].trim() || null };
  return { track: 'Myth', source: s }; // legacy format: no prefix defaults to the Myth track
}

export function parseSelfReceived(rows, label = 'Self Received Requests') {
  assertHeader(rows, 0, { 1: 'player', 4: 'source' }, label);
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const player = String(row[1] || '').trim();
    const item = String(row[2] || '').trim();
    if (!player || !item) continue;
    const status =
      STATUS_MAP[
        String(row[6] || '')
          .trim()
          .toLowerCase()
      ];
    if (!status) {
      throw new Error(`${label} row ${i + 1}: status ${JSON.stringify(row[6])} not in pending/approved/rejected`);
    }
    entries.push({
      timestamp: String(row[0] || '').trim(),
      player,
      item,
      ...splitSource(row[4]),
      note: String(row[5] || '').trim(),
      status
    });
  }
  return entries;
}

export function selfReceivedSql(teamId, entries, registry, tz, knownItems) {
  const warnings = [];
  const valueRows = entries.map((e) => {
    if (knownItems && !knownItems.has(normName(e.item))) {
      warnings.push(`item not in the Item Lookup export: ${JSON.stringify(e.item)} (self_item_id is required)`);
    }
    return [
      String(teamId),
      playerIdSql(teamId, registry.resolveOrStub(e.player)),
      itemIdSql(e.item),
      sqlTimestampAtZone(e.timestamp, tz),
      sqlString(e.status),
      sqlString(e.track),
      sqlString(e.source),
      sqlString(e.note)
    ];
  });
  const sql = insertWhereNotExists(
    'self_received_requests',
    ['team_id', 'player_id', 'self_item_id', 'submitted_at', 'status', 'track', 'source', 'note'],
    valueRows,
    't.team_id = v.team_id and t.submitted_at = v.submitted_at and t.self_item_id = v.self_item_id'
  );
  return { sql, count: valueRows.length, warnings };
}
