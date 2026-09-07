// manifest-check.js
// Re-derives version.json's pieces map from the paths a PR actually changed,
// against the PR's real merge base, and fails when the committed manifest
// disagrees.
//
// #967 shipped the manifest with no check of this kind. The stamper computes
// the pieces map on the author's machine, from their origin/main, which can be
// behind: a stale base widens the diff and a release claims to have moved a
// piece it never touched. tests/ci/asset-version-check.test.js reads the
// manifest against the tree it ships with, so it can see a piece stamped ahead
// of the product but never a piece stamped for the wrong reason.
//
// The rule is one line: a piece carries the version of the last release that
// touched it. So the manifest is checkable, not just readable, and this is the
// check. It needs no chore exemption, because a PR that writes no manifest
// change is passed without any further question -- an unchanged manifest is
// always correct, whatever the branch is called.
//
// No external dependencies, so the workflow can run it without npm ci.
//
// Usage: node scripts/ci/manifest-check.js <base-ref>

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { isRootPage, pageIsStampOnly, mergeBaseOf } from './changelog-check.js';
import { computePieces, MANIFEST_FILE } from './stamp-version.js';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function gitOrEmpty(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return '';
  }
}

/** The function names carrying a version.ts at a given commit. */
function stampedFunctionsAt(ref, cwd) {
  const listed = gitOrEmpty(['ls-tree', '-r', '--name-only', ref, '--', 'supabase/functions'], cwd);
  return listed
    .split('\n')
    .map((path) => path.match(/^supabase\/functions\/([^/]+)\/version\.ts$/))
    .filter(Boolean)
    .map((match) => match[1])
    .sort();
}

function parseManifest(raw) {
  if (raw === '') return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${MANIFEST_FILE} is not valid JSON: ${err.message}`);
  }
}

/**
 * Compares the committed pieces map with the one the changed paths imply.
 * Returns { ok, problems, expected, actual }; problems name the piece, so the
 * workflow's error message says which one and in which direction.
 */
export function checkManifest(baseRef, cwd = process.cwd()) {
  const base = mergeBaseOf(baseRef, cwd);
  const headRaw = gitOrEmpty(['show', `HEAD:${MANIFEST_FILE}`], cwd);
  const baseRaw = gitOrEmpty(['show', `${base}:${MANIFEST_FILE}`], cwd);

  // No manifest, or a manifest this PR did not touch. Nothing was claimed, so
  // there is nothing to re-derive: this is every chore and docs PR.
  if (headRaw === '' || headRaw === baseRaw) {
    return { ok: true, problems: [], expected: null, actual: null, unchanged: true };
  }

  const head = parseManifest(headRaw);
  const previous = parseManifest(baseRaw)?.pieces ?? {};

  const changed = git(['diff', '--name-only', `${base}..HEAD`], cwd)
    .split('\n')
    .filter(Boolean)
    // The stamp rewrites every root page on every release, so those rewrites
    // are not what makes a piece count as shipped. Same rule the changelog
    // gate applies, from the same function, so the two cannot drift.
    .filter(
      (path) =>
        !isRootPage(path) ||
        !pageIsStampOnly(gitOrEmpty(['show', `${base}:${path}`], cwd), gitOrEmpty(['show', `HEAD:${path}`], cwd))
    );

  const expected = computePieces({
    changed,
    previous,
    version: head.version,
    functions: stampedFunctionsAt('HEAD', cwd)
  });

  const actual = head.pieces ?? {};
  const problems = [];
  const names = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const name of names) {
    if (name === 'functions') continue;
    if (expected[name] !== actual[name]) {
      problems.push(
        `${name}: manifest says ${actual[name] ?? 'absent'}, the changed paths say ${expected[name] ?? 'absent'}`
      );
    }
  }

  const expectedFns = expected.functions ?? {};
  const actualFns = actual.functions ?? {};
  for (const name of new Set([...Object.keys(expectedFns), ...Object.keys(actualFns)])) {
    if (expectedFns[name] !== actualFns[name]) {
      problems.push(
        `functions.${name}: manifest says ${actualFns[name] ?? 'absent'}, the changed paths say ${expectedFns[name] ?? 'absent'}`
      );
    }
  }

  return { ok: problems.length === 0, problems, expected, actual, unchanged: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error('Usage: node scripts/ci/manifest-check.js <base-ref>');
    process.exit(2);
  }
  let result;
  try {
    result = checkManifest(baseRef);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (result.unchanged) {
    console.log(`${MANIFEST_FILE} unchanged against ${baseRef}, nothing to re-derive`);
    process.exit(0);
  }
  if (result.ok) {
    console.log(`${MANIFEST_FILE} agrees with the changed paths:`);
    console.log(JSON.stringify(result.actual, null, 2));
    process.exit(0);
  }
  for (const problem of result.problems) {
    console.error(`::error::${MANIFEST_FILE} disagrees with what this PR changed. ${problem}`);
  }
  console.error(
    'Every piece carries the version of the last release that touched it. Re-run "npm run stamp -- <x.y.z>" on a branch rebased onto the base, which recomputes the map, rather than editing version.json by hand.'
  );
  process.exit(1);
}
