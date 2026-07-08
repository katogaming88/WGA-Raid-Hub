// changelog-check.js
// Classifies a PR diff for the Changelog Check workflow (#353): which side
// of the app changed (frontend/backend), whether the VERSION in js/common.js
// was bumped, and which CHANGELOG.md sections gained entries.
//
// Frontend paths drive VERSION. The js/common.js VERSION line itself does
// not count as a frontend change, so complying with "bump VERSION" cannot
// itself mark a PR functional (the circularity #353 describes).
//
// No external dependencies, so the workflow can run it without npm ci.
//
// Usage: node scripts/ci/changelog-check.js <base-ref>
// Compares <base-ref>...HEAD (merge-base diff, same as the old inline bash).
// Prints key=value lines to stdout and appends them to $GITHUB_OUTPUT when set.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Same path rules the workflow used inline before #353, minus js/common.js
// (handled separately via its diff content). css/ counts as frontend too --
// missed in the original #353 rules, caught by #361 tripping the reverse
// (bump without a frontend change) check on a CSS-only fix.
const FRONTEND_PATH = /^(js|gs)\/.+\.(js|html)$|^css\/.+\.css$|^[^/]+\.html$/;
const BACKEND_PATH = /^(supabase\/migrations|scripts\/import)\//;
const VERSION_LINE = /^[+-]var VERSION\b/;

export function isFrontendPath(path) {
  return path !== 'js/common.js' && FRONTEND_PATH.test(path);
}

export function isBackendPath(path) {
  return BACKEND_PATH.test(path);
}

// True when js/common.js changed beyond its VERSION line.
export function commonJsIsFunctional(diff) {
  return diff
    .split('\n')
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
    .some((line) => !VERSION_LINE.test(line));
}

export function hasVersionBump(diff) {
  return diff.split('\n').some((line) => /^\+var VERSION\b/.test(line));
}

// Reports which CHANGELOG.md sections gained content. Each added line counts
// toward the nearest ### heading above its position in the new file; added
// headings, blank lines, and --- separators do not count on their own, and
// the walk stops at a ## version heading or a foreign ### heading (the
// pre-#353 Added/Changed/Fixed vocabulary stays uncounted).
export function changelogSections(diff, newContent) {
  const fileLines = newContent.split('\n');
  const addedLineNos = [];
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    if (line.startsWith('-')) continue; // removed lines have no new-file position
    if (line.startsWith('+')) {
      addedLineNos.push(newLine);
      newLine++;
      continue;
    }
    newLine++; // context line
  }

  const result = { frontend: false, backend: false };
  for (const lineNo of addedLineNos) {
    const text = (fileLines[lineNo - 1] ?? '').trim();
    if (text === '' || text === '---' || text.startsWith('#')) continue;
    for (let i = lineNo - 2; i >= 0; i--) {
      const heading = fileLines[i].trim();
      if (heading === '### Frontend') {
        result.frontend = true;
        break;
      }
      if (heading === '### Backend') {
        result.backend = true;
        break;
      }
      if (/^##[#]? /.test(heading)) break; // version block or foreign section
    }
  }
  return result;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function classify(baseRef, cwd = process.cwd()) {
  const range = `${baseRef}...HEAD`;
  const files = git(['diff', '--name-only', range], cwd).split('\n').filter(Boolean);

  const commonDiff = files.includes('js/common.js') ? git(['diff', range, '--', 'js/common.js'], cwd) : '';
  const frontend = files.some(isFrontendPath) || (commonDiff !== '' && commonJsIsFunctional(commonDiff));
  const backend = files.some(isBackendPath);
  const versionBump = commonDiff !== '' && hasVersionBump(commonDiff);

  let sections = { frontend: false, backend: false };
  if (files.includes('CHANGELOG.md')) {
    const diff = git(['diff', range, '--', 'CHANGELOG.md'], cwd);
    const newContent = git(['show', 'HEAD:CHANGELOG.md'], cwd);
    sections = changelogSections(diff, newContent);
  }

  return {
    frontend,
    backend,
    version_bump: versionBump,
    frontend_entry: sections.frontend,
    backend_entry: sections.backend
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const baseRef = process.argv[2];
  if (!baseRef) {
    console.error('Usage: node scripts/ci/changelog-check.js <base-ref>');
    process.exit(2);
  }
  let out = '';
  for (const [key, value] of Object.entries(classify(baseRef))) {
    out += `${key}=${value}\n`;
  }
  process.stdout.write(out);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, out);
  }
}
