// Pasted Loot + legacy Loot Data -> rclc_loot (#320 step 11).
//
// Two sources merge into one table:
//
// - Pasted Loot (RCLC imports through the officer dashboard): header row 1,
//   cols Season, RCLC ID, Player, Date, Item Name, Instance. Items resolve by
//   name against the registry.
// - Legacy Loot Data (the external RCLootCouncil tracker export, full-width
//   A:V): columns located by header text (player, date, time, item, itemID,
//   instance, boss). Items resolve by wow item id; ids the Item Lookup does
//   not know (old-tier gear) are added as new items rows first, named from
//   the export's item column (brackets stripped, same as gs/wgaWebApp.gs:2025)
//   with equipLoc as the slot, so no loot history displays nameless.
//
// The track column derives from the instance string's difficulty suffix:
// for fresh raid drops the mapping is deterministic (Normal -> Champion,
// Heroic -> Hero, Mythic -> Myth, decided on #343; gs/wgaWebApp.gs:2004
// already translated Normal to champion). The ongoing Phase 5 import can
// read the RCLC itemString's bonus IDs as the authoritative track source.
//
// dedupe_key (unique) is team-prefixed: rclc ids can collide across the two
// team spreadsheets, and composite keys use normalized player/item/date.
// Legacy rows have no rclc id, so theirs is always the composite
// (player|itemID|date|time), per #228.
//
// Season: Pasted Loot carries it; legacy rows derive it from the award date
// against the --seasons ranges config. The export's response and note columns
// are dropped on import, decided on #322 (the raw CSV preserves them offline).

import { normName } from '../lib/names.js';
import { sqlString, sqlNumber, sqlBool, insertStatement } from '../lib/sql.js';
import { sqlTimestampAtZone, parseSheetTimestamp, seasonForDate } from '../lib/dates.js';
import { playerIdSql } from '../lib/registry.js';
import { assertHeader } from '../lib/csv.js';

function parseTrack(instanceStr) {
  const d = String(instanceStr || '')
    .split('-')
    .pop()
    .trim()
    .toLowerCase();
  if (d === 'mythic') return 'Myth';
  if (d === 'heroic') return 'Hero';
  if (d === 'normal') return 'Champion';
  return null;
}

const itemIdByWowId = (wowId) => `(select id from items where wow_item_id = ${wowId} order by id limit 1)`;
const itemIdByName = (name) => `(select id from items where lower(name) = lower(${sqlString(name)}))`;

// --- Pasted Loot ---

export function parsePastedLoot(rows, label = 'Pasted Loot') {
  assertHeader(rows, 0, { 1: 'rclc', 2: 'player' }, label);
  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const player = String(row[2] || '').trim();
    const item = String(row[4] || '').trim();
    if (!player || !item) continue;
    entries.push({
      source: 'pasted',
      season: String(row[0] || '').trim(),
      rclcId: String(row[1] || '').trim(),
      player,
      date: String(row[3] || '').trim(),
      itemName: item,
      instance: String(row[5] || '').trim()
    });
  }
  return entries;
}

// --- Legacy Loot Data (external tracker export, header-driven) ---

export function parseLegacyLoot(rows, label = 'Loot Data') {
  const header = (rows[0] || []).map((h) => String(h).toLowerCase().trim());
  const col = (names) => {
    for (const n of names) {
      const idx = header.indexOf(n);
      if (idx !== -1) return idx;
    }
    return -1;
  };
  const cols = {
    player: col(['player']),
    date: col(['date']),
    time: col(['time']),
    item: col(['item']),
    itemId: col(['itemid', 'item id']),
    instance: col(['instance']),
    boss: col(['boss']),
    equipLoc: col(['equiploc', 'slot'])
  };
  for (const key of ['player', 'date', 'itemId', 'instance']) {
    if (cols[key] === -1) {
      throw new Error(
        `${label}: no header column named ${JSON.stringify(key)} -- export the tab full-width (A:V) with its header row`
      );
    }
  }

  const entries = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const player = String(row[cols.player] || '').trim();
    const itemId = String(row[cols.itemId] || '').trim();
    if (!player || !itemId) continue;
    entries.push({
      source: 'legacy',
      player,
      date: String(row[cols.date] || '').trim(),
      time: cols.time !== -1 ? String(row[cols.time] || '').trim() : '',
      wowItemId: itemId,
      itemName: String(row[cols.item] || '')
        .trim()
        .replace(/^\[|\]$/g, ''),
      instance: String(row[cols.instance] || '').trim(),
      boss: cols.boss !== -1 ? String(row[cols.boss] || '').trim() : '',
      equipLoc: cols.equipLoc !== -1 ? String(row[cols.equipLoc] || '').trim() : ''
    });
  }
  return entries;
}

// --- SQL ---

export function lootSql(teamId, entries, registry, { knownItems, seasons, tz }) {
  const warnings = [];
  const counts = { pasted: 0, legacy: 0, unknownPlayers: 0, unknownSeason: 0, unknownTrack: 0 };

  // Old-tier items missing from the Item Lookup get created first, by name.
  const newItems = new Map(); // normName -> {name, wowItemId, slot}
  for (const e of entries) {
    if (e.source !== 'legacy') continue;
    if (knownItems && knownItems.has(normName(e.itemName))) continue;
    if (!e.itemName) continue;
    if (!newItems.has(normName(e.itemName))) {
      newItems.set(normName(e.itemName), {
        name: e.itemName,
        wowItemId: e.wowItemId,
        slot: e.equipLoc || 'Unknown'
      });
    }
  }

  let sql = '';
  if (newItems.size) {
    sql += insertStatement(
      'items',
      ['name', 'wow_item_id', 'slot', 'is_placeholder'],
      [...newItems.values()].map((it) => [
        sqlString(it.name),
        sqlNumber(it.wowItemId),
        sqlString(it.slot),
        sqlBool(false)
      ]),
      'on conflict ((lower(name))) do nothing'
    );
    sql += '\n';
  }

  const valueRows = entries.map((e) => {
    const nameRealm = registry.resolve(e.player);
    if (!nameRealm) counts.unknownPlayers++;

    const track = parseTrack(e.instance);
    if (!track && e.instance) counts.unknownTrack++;

    let season;
    let awardedAt;
    let dedupeKey;
    let itemRef;
    let rclcId = null;
    let boss = null;

    if (e.source === 'pasted') {
      counts.pasted++;
      season = e.season || null;
      awardedAt = sqlTimestampAtZone(e.date, tz);
      rclcId = e.rclcId || null;
      dedupeKey = rclcId
        ? `t${teamId}:rclc:${rclcId}`
        : `t${teamId}:${normName(e.player)}|${normName(e.itemName)}|${parseSheetTimestamp(e.date)}`;
      itemRef = itemIdByName(e.itemName);
    } else {
      counts.legacy++;
      const localDate = parseSheetTimestamp(e.date) || '';
      season = seasonForDate(localDate, seasons);
      if (!season) counts.unknownSeason++;
      awardedAt = sqlTimestampAtZone(e.time ? `${e.date} ${e.time}` : e.date, tz);
      dedupeKey = `t${teamId}:${normName(e.player)}|${e.wowItemId}|${e.date}|${e.time}`;
      itemRef = itemIdByWowId(sqlNumber(e.wowItemId));
      boss = e.boss || null;
    }

    return [
      String(teamId),
      nameRealm ? playerIdSql(teamId, nameRealm) : 'null',
      itemRef,
      sqlString(track),
      sqlString(season),
      awardedAt,
      sqlString(rclcId),
      sqlString(dedupeKey),
      sqlString(boss)
    ];
  });

  sql += insertStatement(
    'rclc_loot',
    ['team_id', 'player_id', 'item_id', 'track', 'season', 'awarded_at', 'rclc_id', 'dedupe_key', 'boss'],
    valueRows,
    'on conflict (dedupe_key) do nothing'
  );

  if (counts.unknownPlayers)
    warnings.push(`${counts.unknownPlayers} rows kept with player_id null (name not on Roster)`);
  if (counts.unknownSeason)
    warnings.push(`${counts.unknownSeason} legacy rows have no season (date outside --seasons ranges)`);
  if (counts.unknownTrack)
    warnings.push(`${counts.unknownTrack} rows whose instance suffix maps to no track (imported null)`);
  if (newItems.size) warnings.push(`${newItems.size} old-tier items added to items from the legacy export`);

  return { sql, counts, newItemCount: newItems.size, warnings };
}
