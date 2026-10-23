// new-table-grants-check.js
// Fails a migration that creates a table in `public` without granting its own
// access in the same file.
//
// From 2026-10-30 Supabase stops granting the Data API roles on a new table in
// `public`: a table created without explicit grants answers "permission denied"
// to supabase-js, PostgREST and the Edge Functions. This repo has leaned on
// default privileges since 20260706190427_anon_authenticated_base_grants.sql,
// and those still re-run on every `supabase db reset`, so a local stack can
// keep granting what production no longer does. A migration that revokes
// everything first and then grants what each role needs means the same thing
// on both, whichever defaults are in force.
//
// For every `create table public.<name>` in a migration stamped after
// CHECKED_AFTER, the same file must hold:
//   - a `revoke ... on [table] public.<name> from ...` (start from nothing)
//   - a `grant ... on [table] public.<name> to ...` (at least one role)
// 20261007145043_team_raid_reports.sql is the shape. `claude_readers` is this
// repo's own role with its own default grant, which the change does not name,
// so it is not required here.
//
// Older files are left alone: they ran under the old defaults and are already
// on production. What this cannot see: a grant made in a later migration (put
// it in the same file), and a statement inside a function body that happens to
// begin with `grant`, since files are split on `;` without parsing quotes.
//
// No external dependencies, so the workflow runs it without npm ci.
//
// Usage: node scripts/ci/new-table-grants-check.js [migrations-dir]
// Exit codes: 0 clean, 1 findings, 2 unreadable path.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHECKED_AFTER = '20261020123059';

// An unqualified name lands in public through the pinned search path.
const CREATE = /^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/;
const GRANT = /^grant\s+.+?\s+on\s+(?:table\s+)?(.+?)\s+to\s+/;
const REVOKE = /^revoke\s+.+?\s+on\s+(?:table\s+)?(.+?)\s+from\s+/;

const statements = (sql) =>
  sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);

const tableNames = (list) =>
  list.split(',').map((t) =>
    t
      .trim()
      .replace(/"/g, '')
      .replace(/^public\./, '')
  );

/**
 * Findings for one migration's SQL: each table it creates in `public` that is
 * missing a revoke or a grant.
 * @returns {{table: string, reason: string}[]}
 */
export function checkMigration(sql) {
  const created = [];
  const revoked = new Set();
  const granted = new Set();
  for (const s of statements(sql)) {
    const c = s.match(CREATE);
    if (c && (c[1] ?? 'public') === 'public') created.push(c[2]);
    const r = s.match(REVOKE);
    if (r) tableNames(r[1]).forEach((t) => revoked.add(t));
    const g = s.match(GRANT);
    if (g && !/^grant\s+.+?\s+on\s+(?:function|sequence|schema|all)\b/.test(s))
      tableNames(g[1]).forEach((t) => granted.add(t));
  }
  const findings = [];
  for (const table of [...new Set(created)]) {
    if (!revoked.has(table)) findings.push({ table, reason: 'has no revoke (start from nothing, then grant)' });
    if (!granted.has(table)) findings.push({ table, reason: 'grants no role any access' });
  }
  return findings;
}

/** The migration filenames this check covers, in order. */
export const checkedFiles = (filenames) =>
  filenames.filter((f) => /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) > CHECKED_AFTER).sort();

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'supabase/migrations';
  let filenames;
  try {
    filenames = readdirSync(dir);
  } catch {
    console.error(`Cannot read the migrations directory: ${dir}`);
    process.exit(2);
  }
  const files = checkedFiles(filenames);
  let count = 0;
  for (const file of files) {
    for (const f of checkMigration(readFileSync(join(dir, file), 'utf8'))) {
      console.log(`${dir}/${file}: public.${f.table} ${f.reason}`);
      count++;
    }
  }
  if (count > 0) console.log('');
  console.log(`Checked ${files.length} migration(s) stamped after ${CHECKED_AFTER}.`);
  if (count > 0) {
    console.log(`${count} finding(s). A new table revokes all, then grants each role what it needs,`);
    console.log('in the migration that creates it. See 20261007145043_team_raid_reports.sql.');
  }
  process.exit(count > 0 ? 1 : 0);
}
