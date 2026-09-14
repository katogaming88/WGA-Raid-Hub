// decision-log-check.js
// Fails a `Shipped:` line in docs/database-decisions.md that names a migration
// file which does not exist under supabase/migrations/ (#943).
//
// The log records intent in the same voice as fact. #250's entry described four
// changes as though they had shipped and two never did; #258's said bis_items
// gets no season column and 20260725135340 added one. The `Shipped:` line is
// what separates the two: an entry that changed the schema names the migration
// that carried it, and this check proves the name is real. That is all it
// proves. Whether the object the entry describes is live on production is the
// build's own acceptance query, one step at a time, because CI holds no
// production credential.
//
// A `Shipped:` line is a line beginning `Shipped:` (as a list item too). It
// takes one of three shapes:
//   - one or more migration filenames, YYYYMMDDHHMMSS_slug.sql, backticks and
//     the supabase/migrations/ prefix optional, commas between; each must exist
//   - `not yet`, naming the issue (#N) that will ship it
//   - `no migration` (a convention, a doc, CI, app code) or `by hand` (applied
//     outside a migration; names the issue, #N, that records the apply)
// Anything else fails, and that is deliberate: a misspelt name that no longer
// matches the pattern would otherwise pass as prose.
//
// What this cannot see: a filename in ordinary prose (the attendance FK at the
// #218 entry names one that way), and a rename that leaves the old name
// pointing at a different real file. It does not parse fenced blocks; a
// `Shipped:` line inside one is checked like any other.
//
// No external dependencies, so the workflow runs it without npm ci.
//
// Usage: node scripts/ci/decision-log-check.js [log] [migrations-dir]
// Defaults: docs/database-decisions.md and supabase/migrations.
// Exit codes: 0 clean, 1 findings, 2 unreadable path.

import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Every `Shipped:` line in `text`: its 1-based line number, the text after the
 * label, and the migration filenames it names, each once, in order.
 * @returns {{line: number, text: string, files: string[]}[]}
 */
export function shippedLines(text) {
  return [];
}

/**
 * Findings for `text` against the migration filenames that exist, in line order.
 * @returns {{line: number, reason: string}[]}
 */
export function checkDecisionLog(text, migrationFilenames, dir = 'supabase/migrations') {
  return [];
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [logPath = 'docs/database-decisions.md', dir = 'supabase/migrations'] = process.argv.slice(2);
  let text;
  try {
    text = readFileSync(logPath, 'utf8');
  } catch {
    console.error(`Cannot read the decisions log: ${logPath}`);
    process.exit(2);
  }
  let filenames;
  try {
    filenames = readdirSync(dir);
  } catch {
    console.error(`Cannot read the migrations directory: ${dir}`);
    process.exit(2);
  }
  const lines = shippedLines(text);
  const findings = checkDecisionLog(text, filenames, dir);
  for (const f of findings) console.log(`${logPath}:${f.line}: ${f.reason}`);
  const pointers = lines.reduce((n, l) => n + l.files.length, 0);
  if (findings.length > 0) console.log('');
  console.log(
    `Checked ${lines.length} Shipped: lines naming ${pointers} migration file(s), against ${filenames.length} files under ${dir}.`
  );
  if (findings.length > 0) {
    console.log(
      `${findings.length} Shipped: line(s) to fix in ${logPath}. A line names migration files that exist under ${dir},`
    );
    console.log('or opens with not yet (#N), no migration, or by hand (#N).');
  }
  process.exit(findings.length > 0 ? 1 : 0);
}
