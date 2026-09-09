// advisor-check.js
// Fails a Supabase security advisor finding this project has not accepted (#1011).
//
// `supabase db advisors` has existed on the pinned CLI for months and has
// never run here, so the linter's whole catalogue was unenforced: a second
// SECURITY DEFINER view, a table shipped with RLS off, a function that loses
// its search_path pin, `auth.users` exposed through a view. #1010 put four
// invariants over the function catalogue into the RLS suite; this is the same
// argument one layer out, against a linter someone else maintains.
//
// The two targets do not read the same linter, which matters for what a green
// run means. `--local` and `--db-url` run one embedded multi-CTE query inside
// a transaction the CLI always rolls back: 23 lints, 16 of them SECURITY.
// `--linked` never touches the database, it GETs the Management API, which is
// the only source of the definer-function-executable findings and the auth
// toggle. So a CI run can only ever produce the SQL set, and three of the four
// entries below exist for a maintainer's own `--linked` run rather than for
// the gate. Nothing here filters by target: the check reads whatever report it
// is given.
//
// The report arrives as a file rather than a pipe, because a pipeline exits
// with the last command's status, so a failed advisor run would feed an empty
// document to a green check. The workflow runs the CLI and this script as two
// commands for that reason, the way migration-ledger-check.yml splits its psql
// from its comparison.
//
// An allowlist entry is keyed one of two ways. `cacheKey` accepts one object
// (the lint SQL builds it from schema and name), `name` accepts a whole lint.
// An entry with a `cacheKey` that matches nothing FAILS the run: the object it
// names is gone, so the entry is dead and should come out, and it doubles as
// the check on the check, since an empty report then cannot pass as a clean
// schema. An entry keyed on `name` that matches nothing passes, because the
// local target never emits the API-only lints.
//
// Two ways out of a failure. Fix what the finding names, which is the point.
// Or add an entry here with the reason and, where one exists, the issue that
// retires it, in the same PR as whatever introduced the finding.
//
// No external dependencies, so a workflow can run it without npm ci.
//
// Usage:
//   supabase db advisors --local --type security --level warn --fail-on none --output-format json > advisors.json
//   node scripts/ci/advisor-check.js advisors.json
//
// Exit codes: 0 everything accepted, 1 a finding or a dead entry, 2 usage.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Ordered, so anything at or above WARN fails. A level absent from this list
// is failed rather than ignored: the linter can add one, and a level nobody
// here has seen is not evidence that it is harmless.
const LEVELS = ['INFO', 'WARN', 'ERROR'];
const FAIL_FROM = LEVELS.indexOf('WARN');

export const ALLOWLIST = [
  {
    cacheKey: 'security_definer_view_public_incoming_roster',
    reason:
      'Deliberate and documented (docs/RLS.md, the migration comment): the view surfaces approved signups to anon and raiders, so its narrow column list is the safety boundary rather than RLS. Tracked as #503, which refactors it to a definer function; delete this entry when that lands.'
  },
  {
    name: 'anon_security_definer_function_executable',
    reason:
      'Describes the architecture: every public submit path here is a SECURITY DEFINER RPC that anon may call, because reporting a BoE and submitting a signup happen without a session. The real gate on this surface is the set equality in tests/rls/function-invariants.test.js, which fails an accidental grant and an accidental revoke alike. API-only lint.'
  },
  {
    name: 'authenticated_security_definer_function_executable',
    reason:
      'The same architecture from the signed-in side: every write path in this schema is a definer RPC callable by authenticated, which is what lets RLS stay deny-by-default on the tables underneath. API-only lint.'
  },
  {
    name: 'auth_leaked_password_protection',
    reason:
      'A dashboard toggle on password sign-in, and this project has none: Discord OAuth is the only route in, so there is no password for HaveIBeenPwned to check. API-only lint.'
  }
];

/** The results array out of the CLI's JSON envelope. Throws on anything else. */
export function parseReport(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (err) {
    throw new Error(`The advisor report is not JSON: ${err.message}`);
  }
  if (!document || !Array.isArray(document.results)) {
    throw new Error('The advisor report carries no results array, which is what an error envelope looks like.');
  }
  return document.results;
}

function matches(entry, result) {
  if (entry.cacheKey) return entry.cacheKey === result.cacheKey;
  return entry.name === result.name;
}

/** Sorts every finding into accepted, informational and failing, and names dead entries. */
export function evaluate(results, allowlist) {
  const allowlisted = [];
  const informational = [];
  const failing = [];

  for (const result of results) {
    if (allowlist.some((entry) => matches(entry, result))) {
      allowlisted.push(result);
      continue;
    }
    const level = LEVELS.indexOf(result.level);
    if (level >= 0 && level < FAIL_FROM) informational.push(result);
    else failing.push(result);
  }

  const unmatched = allowlist.filter((entry) => entry.cacheKey && !results.some((result) => matches(entry, result)));

  return { total: results.length, allowlisted, informational, failing, unmatched };
}

function describe(result) {
  const lines = [`  ${result.level} ${result.name}`, `    ${result.detail}`];
  if (result.remediation) lines.push(`    ${result.remediation}`);
  return lines.join('\n');
}

export function formatReport(outcome) {
  const lines = [];
  if (outcome.informational.length > 0) {
    lines.push('Below the failing level, reported so nobody has to run the linter to see them:');
    for (const result of outcome.informational) lines.push(describe(result));
  }
  if (outcome.failing.length > 0) {
    lines.push('Not on the allowlist. Fix it, or add an entry with its reason in scripts/ci/advisor-check.js:');
    for (const result of outcome.failing) lines.push(describe(result));
  }
  if (outcome.unmatched.length > 0) {
    lines.push('Allowlist entries that matched nothing, so what they accept no longer exists:');
    for (const entry of outcome.unmatched) lines.push(`  ${entry.cacheKey}`);
  }
  lines.push(
    `${outcome.total} findings, ${outcome.allowlisted.length} allowlisted, ${outcome.failing.length} failing.`
  );
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/ci/advisor-check.js <advisors.json>');
    process.exit(2);
  }

  let results;
  try {
    results = parseReport(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`${file}: ${err.message}`);
    process.exit(2);
  }

  const outcome = evaluate(results, ALLOWLIST);
  console.log(formatReport(outcome));
  process.exit(outcome.failing.length > 0 || outcome.unmatched.length > 0 ? 1 : 0);
}
