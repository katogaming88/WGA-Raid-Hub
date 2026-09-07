// release-notes.js
// Pulls one version's block out of CHANGELOG.md, to be the body of its GitHub
// Release (#968).
//
// The heading line is dropped: a release is already named by its tag, so
// repeating the number in the body reads as a mistake. Everything below the
// heading up to the next one is kept, minus the horizontal rule the file uses
// between some blocks and not others, which belongs to the layout rather than
// to the notes.
//
// Refusing a duplicate is the point of the count. Three numbers on main are
// used twice (3.77.23, 3.60.32, 3.60.6) because nothing checked uniqueness
// before #966, and a tag names exactly one commit, so a release cannot pick
// between two blocks. #966 stops new ones at PR time; this is the backstop for
// a collision that got through, which it can, because nothing requires a
// branch to be up to date before merge.
//
// No external dependencies, so the workflow can run it without npm ci.
//
// Usage: node scripts/ci/release-notes.js <x.y.z>
// Prints the block on stdout, or exits 1 with the reason on stderr.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const ANY_HEADING = /^## \[\d+\.\d+\.\d+\]/;

// Escaped, and anchored to the closing bracket, so "3.9" cannot match the
// heading for 3.9.1 and a release never picks up a neighbour's notes.
function headingFor(version) {
  return new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`);
}

/** How many blocks the changelog carries for this version. More than one is a collision. */
export function headingCount(changelog, version) {
  const heading = headingFor(version);
  return changelog.split('\n').filter((line) => heading.test(line)).length;
}

/**
 * The block below this version's heading, or null when there is none.
 * Trailing rules and blank lines are trimmed; the caller gets notes it can
 * post as they are.
 */
export function releaseBlock(changelog, version) {
  const lines = changelog.split('\n');
  const heading = headingFor(version);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;

  const rest = lines.slice(start + 1);
  const nextHeading = rest.findIndex((line) => ANY_HEADING.test(line));
  const block = nextHeading === -1 ? rest : rest.slice(0, nextHeading);

  while (block.length && (block[block.length - 1].trim() === '' || block[block.length - 1].trim() === '---')) {
    block.pop();
  }
  while (block.length && block[0].trim() === '') {
    block.shift();
  }
  return block.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/ci/release-notes.js <x.y.z>');
    process.exit(2);
  }
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const count = headingCount(changelog, version);
  if (count === 0) {
    console.error(`CHANGELOG.md carries no block for ${version}. A release needs its notes.`);
    process.exit(1);
  }
  if (count > 1) {
    console.error(
      `CHANGELOG.md carries the heading for ${version} twice, so a release cannot pick between them. Fix it with a follow-up stamp PR to the next free number, never by retagging a released one.`
    );
    process.exit(1);
  }
  process.stdout.write(releaseBlock(changelog, version) + '\n');
}
