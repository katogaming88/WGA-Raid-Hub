// Cross-tab name resolution for the #320 import generators.
//
// The Roster export is the source of truth for who exists. Other tabs
// reference players by bare first name (Scoring, Attendance, Priority) or by
// "First-Realm (Nick)" (BiS headers). Resolution happens here, client-side,
// with the same normalization the Apps Script layer uses -- the generated SQL
// then matches players by their exact name_realm string, so the database
// never needs diacritic-aware matching.
//
// Names that appear in history tabs but not in the Roster export are departed
// players. They are collected here and emitted as archived stub rows (players
// with archived_at set and no class/spec), because attendance.player_id and
// scoring.player_id are NOT NULL and the history is worth keeping.

import { normName, stripNickname, firstName } from './names.js';
import { sqlString } from './sql.js';

export function buildPlayerRegistry(rosterNameRealms) {
  const byNorm = new Map(); // normName(first) -> name_realm
  const byFullNorm = new Map(); // normName(name_realm) -> name_realm
  for (const nameRealm of rosterNameRealms) {
    const nr = String(nameRealm || '').trim();
    if (!nr) continue;
    byFullNorm.set(normName(nr), nr);
    const first = normName(firstName(nr));
    if (byNorm.has(first) && byNorm.get(first) !== nr) {
      throw new Error(
        `Ambiguous first name ${JSON.stringify(first)}: ` +
          `${byNorm.get(first)} vs ${nr} -- first-name tabs cannot resolve this`
      );
    }
    byNorm.set(first, nr);
  }

  const stubs = new Map(); // normName -> display name as seen in the tab

  return {
    // Resolve any sheet spelling (first name, First-Realm, with nickname) to
    // the Roster's exact name_realm -- or to an already-registered departed
    // stub, so loot rows link to the same archived player their attendance
    // created. Null when unknown everywhere.
    resolve(rawName) {
      const cleaned = stripNickname(rawName).trim();
      if (!cleaned) return null;
      return (
        byFullNorm.get(normName(cleaned)) ||
        byNorm.get(normName(firstName(cleaned))) ||
        stubs.get(normName(cleaned)) ||
        stubs.get(normName(firstName(cleaned))) ||
        null
      );
    },

    // Resolve, registering a departed-player stub when unknown. The stub's
    // name_realm is the name exactly as the history tab spells it.
    resolveOrStub(rawName) {
      const found = this.resolve(rawName);
      if (found) return found;
      const cleaned = stripNickname(rawName).trim();
      if (!cleaned) return null;
      const key = normName(cleaned);
      if (!stubs.has(key)) stubs.set(key, cleaned);
      return stubs.get(key);
    },

    stubNames() {
      return [...stubs.values()];
    }
  };
}

// Subselect resolving a player row by natural key at apply time.
export function playerIdSql(teamId, nameRealm) {
  return `(select id from players where team_id = ${teamId} and name_realm = ${sqlString(nameRealm)})`;
}

// Subselect resolving an item by the case-insensitive name key
// (items_lower_name_key, migration 20260706220000).
export function itemIdSql(itemName) {
  return `(select id from items where lower(name) = lower(${sqlString(itemName)}))`;
}
