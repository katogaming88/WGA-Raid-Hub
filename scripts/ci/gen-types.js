// gen-types.js
// Generates js/database.types.ts from the local stack, and with --check fails
// when the committed file no longer matches what the migrations build (#1181).
//
// Both sites typecheck against this file: tsconfig.json includes it for the
// current site's JSDoc, and app/src/lib/supabase.ts imports it. It was
// generated once in July 2026 (PR #602, against production) and then edited by
// hand on every migration PR, with nothing checking the result; by September it
// lacked four tables and seven functions the migrations build. Same contract
// as supabase/definitions/: the file is a generated mirror of the database, a
// PR that changes the schema regenerates it, and the Schema docs workflow fails
// when that did not happen.
//
// The generator is pinned by image, not by CLI version. `supabase gen types
// --local` runs the postgres-meta image the CLI carries, and different CLI
// releases carry different ones: 2.115.0 runs v0.98.0 and 2.117.0 runs v0.99.0,
// and their output differs on this schema (a relationship pair swaps order,
// the helper types at the foot gain parentheses). So a byte comparison is only
// stable when the generator is the same everywhere, and this pins it once for
// every machine and for CI, whichever CLI each runs. Bumping the pin is a
// one-line change plus a regeneration in the same PR. The env values are the
// ones the CLI sets; the docker route and `supabase gen types --local` on the
// matching CLI produce identical bytes.
//
// Nothing is written until the output passes validation. On 2026-08-25 a
// shell redirect of the CLI's output wrote an image-pull error as the whole
// tracked file, because the shell truncates the target before the tool fails.
// The generator here runs through execFileSync (a bash line would let MSYS
// rewrite the connection URL), its output is held in memory, checked for shape
// and, when writing, for a table count no lower than the committed file's
// (the sign of a local stack behind the migrations), and only then replaces
// the file. A migration that drops a table passes --allow-fewer-tables. The
// CLI emits CRLF on Windows and the repo pins eol=lf, so carriage returns are
// stripped on the way in.
//
// One thing the pinned generator does not know: a stored generated column
// (players.name_realm_key, characters.name_realm and name_realm_key) is typed
// as writable in Insert and Update, because postgrest-typegen 0.2.0 writes
// `never` only for an identity column. A write naming one of those columns
// typechecks and is refused by Postgres. The hand-edited file carried `never`
// for one of them; the generated file cannot, so a pin bump is the place to
// check whether the generator has learned the difference.
//
// Usage:
//   node scripts/ci/gen-types.js                       write js/database.types.ts
//   node scripts/ci/gen-types.js --allow-fewer-tables  write it although a table went away
//   node scripts/ci/gen-types.js --check               exit 1 if it differs
//
// Needs docker and a running local stack (`supabase start`). Exit codes: 0
// written or up to date, 1 stale, 2 usage, generator or validation error.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const IMAGE = 'public.ecr.aws/supabase/postgres-meta:v0.99.0';
export const TYPES_PATH = 'js/database.types.ts';
const CONFIG_PATH = 'supabase/config.toml';

// The docker invocation, as the CLI builds it for a local database: joined to
// the stack's network so the database container resolves by name.
export function generatorArgs(projectId) {
  return [
    'run',
    '--rm',
    '--network',
    `supabase_network_${projectId}`,
    '-e',
    `PG_META_DB_URL=postgresql://postgres:postgres@supabase_db_${projectId}:5432/postgres`,
    '-e',
    'PG_META_GENERATE_TYPES=typescript',
    '-e',
    'PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public',
    '-e',
    'PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true',
    IMAGE,
    'node',
    'dist/server/server.js'
  ];
}

export function readProjectId(configText) {
  const match = configText.match(/^project_id\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error(`${CONFIG_PATH} has no project_id line, so the stack's network name is unknown`);
  return match[1];
}

export function normalise(text) {
  return text.replace(/\r\n/g, '\n');
}

const FLAGS = ['--check', '--allow-fewer-tables'];

// Anything but the two flags is refused, so a mistyped --check cannot fall
// through to a write.
export function parseArgs(argv) {
  const unknown = argv.filter((arg) => !FLAGS.includes(arg));
  if (unknown.length)
    throw new Error(
      `unknown argument ${unknown[0]}; usage: node scripts/ci/gen-types.js [--check | --allow-fewer-tables]`
    );
  return { check: argv.includes('--check'), allowFewer: argv.includes('--allow-fewer-tables') };
}

// Tables in the public schema: the entries nested directly under `Tables: {`.
export function countTables(text) {
  const section = text.match(/^ {4}Tables: \{\n([\s\S]*?)^ {4}\}\n/m);
  if (!section) return 0;
  return (section[1].match(/^ {6}\w+: \{$/gm) || []).length;
}

// What has to be true of the generator's output before it may replace the
// tracked file. A pull failure or a database error arrives on stdout as JSON
// or as nothing, and a schema with no tables, or with fewer than the file
// already has (`floor`, 0 to skip), is a stack that is not the one the
// migrations build.
export function validate(text, floor = 0) {
  if (!text.trim()) return { ok: false, reason: 'the generator produced no output' };
  if (!text.startsWith('export type Json')) {
    return { ok: false, reason: 'the output does not begin with `export type Json`, so it is not a types file' };
  }
  if (!/^ {2}public: \{$/m.test(text)) return { ok: false, reason: 'the output has no public schema' };
  const tables = countTables(text);
  if (tables === 0) return { ok: false, reason: 'the output has no tables' };
  if (tables < floor) {
    return {
      ok: false,
      reason:
        `the output has ${tables} table${tables === 1 ? '' : 's'} where the committed file has ${floor}. ` +
        'If a migration drops a table, run with --allow-fewer-tables; otherwise the local stack is behind the migrations (`supabase db reset`)'
    };
  }
  return { ok: true };
}

// Lines a regeneration would add and remove, counted as multisets, which is
// what a diff of the two files shows at minimum.
export function compare(generated, committed) {
  const counts = new Map();
  for (const line of generated.split('\n')) counts.set(line, (counts.get(line) || 0) + 1);
  for (const line of committed.split('\n')) counts.set(line, (counts.get(line) || 0) - 1);
  let added = 0;
  let removed = 0;
  for (const n of counts.values()) {
    if (n > 0) added += n;
    else if (n < 0) removed -= n;
  }
  return { stale: generated !== committed, added, removed };
}

function generate() {
  const projectId = readProjectId(readFileSync(CONFIG_PATH, 'utf8'));
  return execFileSync('docker', generatorArgs(projectId), {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024
  });
}

function main(argv) {
  let check;
  let allowFewer;
  try {
    ({ check, allowFewer } = parseArgs(argv));
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  const committed = existsSync(TYPES_PATH) ? normalise(readFileSync(TYPES_PATH, 'utf8')) : '';

  let generated;
  try {
    generated = normalise(generate());
  } catch (err) {
    console.error(`Could not generate types: ${err.message}`);
    return 2;
  }

  // The floor guards a write against a stack that is behind; a check writes
  // nothing and reports staleness on its own.
  const verdict = validate(generated, check || allowFewer ? 0 : countTables(committed));
  if (!verdict.ok) {
    console.error(`Refusing to use the generator's output: ${verdict.reason}. ${TYPES_PATH} is unchanged.`);
    return 2;
  }

  const { stale, added, removed } = compare(generated, committed);
  const tables = countTables(generated);
  if (check) {
    if (!stale) {
      console.log(`${TYPES_PATH} is up to date (${tables} tables).`);
      return 0;
    }
    console.error(`${TYPES_PATH} does not match the database the migrations build (+${added} / -${removed} lines).`);
    console.error(
      'Run `npm run db:types` against the local stack (`supabase db reset` first if it is behind), and commit the result.'
    );
    return 1;
  }

  writeFileSync(TYPES_PATH, generated);
  console.log(
    stale
      ? `Wrote ${TYPES_PATH} (${tables} tables, +${added} / -${removed} lines).`
      : `${TYPES_PATH} was already up to date (${tables} tables).`
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
