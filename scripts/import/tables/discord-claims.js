// Discord Claims tab -> team_members (#338).
//
// The sheet tab records which Discord user has claimed which character:
// cols A "Discord ID", B "Discord Username", C "Name-Realm", D "Claimed At".
// Backfilling these rows is what lets link_auth_user_to_member() match a
// raider's discord_id on their first Supabase Auth login, so existing claims
// carry over instead of everyone re-claiming (#338).
//
// Only discord_id and name_realm are imported. The username is display text
// that Discord OAuth provides fresh at login, and Claimed At has no column
// (the audit_log's "Discord Claim Created" entries keep the history).
//
// Rows whose ID is not a plausible Discord snowflake (17-20 digits) are
// skipped with a warning: Sheets renders a numeric-formatted ID cell in
// scientific notation (e.g. 8.84227E+16), which loses digits, and a
// truncated ID would silently never match at login. Recovery is re-adding
// the true ID at the source, or the raider re-claiming after login ships.
//
// Conflict handling: team_members already holds hand-seeded officer and
// team_leader rows (#203) whose name_realm is null. A claim for a seeded
// discord_id keeps the existing role and only fills the missing name_realm,
// so re-applying converges and never overwrites a value already set.

import { assertHeader } from '../lib/csv.js';
import { sqlString } from '../lib/sql.js';

const SNOWFLAKE = /^\d{17,20}$/;

export function parseDiscordClaims(rows, label = 'Discord Claims') {
  assertHeader(rows, 0, { 0: 'discord id', 2: 'name' }, label);
  const claims = [];
  const warnings = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const discordId = String(row[0] || '').trim();
    const nameRealm = String(row[2] || '').trim();
    if (!discordId && !nameRealm) continue;
    if (!SNOWFLAKE.test(discordId)) {
      warnings.push(
        `row ${i + 1} (${nameRealm || 'no name'}): Discord ID ${JSON.stringify(discordId)} ` +
          'is not a 17-20 digit snowflake, skipped (sheet number formatting loses digits)'
      );
      continue;
    }
    if (!nameRealm) {
      warnings.push(`row ${i + 1}: Discord ID ${discordId} has no Name-Realm, skipped`);
      continue;
    }
    claims.push({ discordId, nameRealm });
  }
  return { claims, warnings };
}

export function discordClaimsSql(teamId, claims, registry) {
  const warnings = [];
  const valueRows = claims.map((c) => {
    if (registry && !registry.resolve(c.nameRealm)) {
      warnings.push(`${c.nameRealm}: not on the roster, claim imports with the name as typed`);
    }
    return [String(teamId), sqlString(c.discordId), "'raider'", sqlString(c.nameRealm)];
  });
  const sql =
    valueRows.length === 0
      ? '-- team_members: no rows\n'
      : `insert into team_members (team_id, discord_id, role, name_realm)\n` +
        `values\n` +
        valueRows.map((r) => `  (${r.join(', ')})`).join(',\n') +
        `\non conflict (team_id, discord_id) do update set name_realm = excluded.name_realm\n` +
        `  where team_members.name_realm is null;\n`;
  return { sql, warnings, count: valueRows.length };
}
