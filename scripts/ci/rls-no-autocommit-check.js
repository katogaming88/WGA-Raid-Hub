// rls-no-autocommit-check.js
// Fails a fixture in the RLS suite written with autocommit `pool.query` (#1021).
//
// Every file in tests/rls/ runs as its own vitest worker against one database.
// A fixture written through the pool commits immediately, so between that
// insert and whatever deletes it, every other worker's transaction can read it.
// That is not theoretical: a Thursday raid_schedule row committed by
// raid-signup-sheets.test.js made rotator-week-assignment.test.js fail on a
// different case each run, either with a phantom raid night or with a duplicate
// key on the row both files insert. The window is a few milliseconds and the
// cleanup closes it, so the table is clean by the time anyone queries it and
// the failure reads as a bug in the file that failed.
//
// The invariant is that a fixture is visible only to the test that wrote it,
// which is what withTxn in tests/rls/helpers.js gives: one connection, one
// transaction, rolled back at the end, with impersonation on that same client
// so a role-scoped read sees the uncommitted rows. countAs and queryAs open
// their own connection and cannot, which is the reason autocommit gets reached
// for in the first place.
//
// A call is exempt when it writes nothing and says so:
//   - a `// rls-pool-read-only: <reason>` comment on the call or just above it
// tests/rls/function-invariants.test.js reads the pg_proc catalog that way on
// purpose, and is the case the hatch exists for.
//
// What this cannot see: a hand-rolled `pool.connect()` that commits rather than
// rolling back. Twenty-two files legitimately call `pool.connect()` for their
// own withTxn copy, so the call itself carries no signal and only the missing
// rollback would, which needs dataflow this check does not do.
//
// Usage: node scripts/ci/rls-no-autocommit-check.js [file ...]
// With no arguments it walks tests/rls/. Prints one line per finding, exits 1.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'acorn';

const POOL = 'pool';
const METHOD = 'query';
const ANNOTATION = /rls-pool-read-only:/;
// How far above a call its annotation may sit. Enough for a wrapped call or a
// short reason, not so far that it silently covers the next call too.
const ANNOTATION_REACH = 3;

function isChildNode(value) {
  return value && typeof value === 'object' && typeof value.type === 'string';
}

function isPoolQuery(node) {
  if (node.type !== 'CallExpression') return false;
  const callee = node.callee;
  if (!callee || callee.type !== 'MemberExpression') return false;
  const { object, property } = callee;
  return (
    object.type === 'Identifier' && object.name === POOL && property.type === 'Identifier' && property.name === METHOD
  );
}

/**
 * Every `pool.query` in `source` that has not declared itself read-only.
 * Parsed as a module: every file in tests/rls/ opens with an import, which
 * acorn's default script mode rejects outright.
 * @returns {{line: number, reason: string}[]}
 */
export function findAutocommitQueries(source, filename = '<source>') {
  const comments = [];
  let ast;
  try {
    ast = parse(source, { ecmaVersion: 2022, sourceType: 'module', locations: true, onComment: comments });
  } catch (err) {
    throw new Error('Could not parse ' + filename + ': ' + err.message);
  }

  const annotationLines = new Set();
  for (const c of comments) {
    if (ANNOTATION.test(c.value)) annotationLines.add(c.loc.start.line);
  }

  const findings = [];

  function visit(node) {
    if (!isChildNode(node)) return;

    if (isPoolQuery(node)) {
      const startLine = node.loc.start.line;
      const endLine = node.loc.end.line;
      let annotated = false;
      for (let line = startLine - ANNOTATION_REACH; line <= endLine; line++) {
        if (annotationLines.has(line)) annotated = true;
      }
      if (!annotated) {
        findings.push({
          line: startLine,
          reason: 'pool.query commits immediately, so every other worker can read it'
        });
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
      } else if (isChildNode(value)) {
        visit(value);
      }
    }
  }

  visit(ast);
  findings.sort((a, b) => a.line - b.line);
  return findings;
}

/** Every .js under `dir`, helpers included: a shared seed helper would leak too. */
export function listRlsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listRlsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out.sort();
}

export function checkFiles(files) {
  const all = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const finding of findAutocommitQueries(source, file)) {
      all.push({ ...finding, file });
    }
  }
  return all;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const files = args.length ? args : listRlsFiles('tests/rls');
  const findings = checkFiles(files);
  for (const f of findings) {
    console.log(f.file + ':' + f.line + ': ' + f.reason);
  }
  if (findings.length) {
    console.log('');
    console.log(findings.length + ' autocommit fixture write(s) in the RLS suite.');
    console.log('Move them inside withTxn from tests/rls/helpers.js, which rolls back,');
    console.log('or annotate with `// rls-pool-read-only: <why this writes nothing>`.');
    process.exit(1);
  }
  console.log('Every pool.query in the RLS suite rolls back or declares it writes nothing.');
}
