// changelog-check.js
// Classifies a PR diff for the Changelog Check workflow (#353, extended by
// #966): which shipped pieces changed, whether the VERSION in js/common.js
// was bumped, which CHANGELOG.md sections gained entries, and whether the
// version heading a PR adds is legal. Also reports whether news.json was
// touched, reused by the needs-news-entry nudge in the same workflow (#525)
// so it doesn't need its own diff classification.
//
// Four shipped pieces, one version line. A change to any of them requires
// that piece's CHANGELOG section AND the bump (#965): the number names the
// release, not the frontend. Before #966 only frontend paths drove VERSION,
// so migrations, Edge Functions and the bot all moved without it.
//
// The js/common.js VERSION line itself does not count as a frontend change,
// so complying with "bump VERSION" cannot itself mark a PR functional (the
// circularity #353 describes).
//
// No external dependencies, so the workflow can run it without npm ci.
//
// Usage: node scripts/ci/changelog-check.js <base-ref>
// Compares <base-ref>...HEAD (merge-base diff, same as the old inline bash).
// Prints key=value lines to stdout and appends them to $GITHUB_OUTPUT when set.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The shipped pieces, in the order their sections appear in CHANGELOG.md.
// A path outside all four is chore territory: supabase/config.toml, seed.sql
// and roles.sql change how a piece deploys or seeds rather than what it does,
// and docs, tests and scripts/ci are not shipped at all.
//
// css/ counts as frontend -- missed in the original #353 rules, caught by
// #361 tripping the reverse (bump without a frontend change) check on a
// CSS-only fix. gs/ was dropped in #966: kat deleted that directory on
// 2026-09-04 (#912, #913), so the rule only stood to misclassify anything
// later recreated at the path.
export const SHIPPED_CLASSES = [
  { name: 'frontend', section: 'Frontend', pattern: /^js\/.+\.(js|html)$|^css\/.+\.css$|^[^/]+\.html$/ },
  { name: 'db', section: 'Backend', pattern: /^(supabase\/migrations|scripts\/import)\// },
  { name: 'functions', section: 'Functions', pattern: /^supabase\/functions\// },
  { name: 'bot', section: 'Bot', pattern: /^bot\// }
];

const VERSION_LINE = /^[+-]var VERSION\b/;
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/;

// Which shipped class a path belongs to, or null for chore territory.
// js/common.js is excluded here and decided by its diff content instead.
export function classifyPath(path) {
  if (path === 'js/common.js') return null;
  const hit = SHIPPED_CLASSES.find((c) => c.pattern.test(path));
  return hit ? hit.name : null;
}

export function isFrontendPath(path) {
  return classifyPath(path) === 'frontend';
}

// Kept under its #353 name: "backend" is what the CHANGELOG section and the
// workflow output have always been called, and renaming the output would
// break the nudge and every existing reader.
export function isBackendPath(path) {
  return classifyPath(path) === 'db';
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

// Numeric field-by-field, because string order puts 3.10.0 below 3.9.0 and
// this file is deep enough into 3.x for that to matter every day.
export function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}

function versionHeadings(content) {
  return content
    .split('\n')
    .map((line) => line.match(VERSION_HEADING))
    .filter(Boolean)
    .map((m) => m[1]);
}

// Versions whose heading count went up. A multiset difference rather than a
// set one, so a PR that adds a second block for a number already present is
// seen as adding it, which is exactly the collision being caught.
export function addedHeadings(baseContent, newContent) {
  const before = new Map();
  for (const v of versionHeadings(baseContent)) before.set(v, (before.get(v) ?? 0) + 1);
  const added = [];
  const seen = new Map();
  for (const v of versionHeadings(newContent)) {
    seen.set(v, (seen.get(v) ?? 0) + 1);
    if (seen.get(v) > (before.get(v) ?? 0)) added.push(v);
  }
  return added;
}

// Reads only what the PR adds, so the three collisions already on main
// (3.77.23, 3.60.32 and 3.60.6) stay legal and nothing has to be renumbered:
// a released number is never reissued (#965).
export function headingProblems(baseContent, newContent) {
  const existing = versionHeadings(baseContent);
  const highest = existing.length ? existing.reduce((a, b) => (compareVersions(a, b) > 0 ? a : b)) : null;
  const problems = [];
  for (const version of addedHeadings(baseContent, newContent)) {
    if (existing.includes(version)) {
      problems.push(`${version} already has a heading in CHANGELOG.md on the base branch`);
      continue;
    }
    if (highest && compareVersions(version, highest) <= 0) {
      problems.push(`${version} does not sort above ${highest}, the newest heading on the base branch`);
    }
  }
  return problems;
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

  const byHeading = new Map(SHIPPED_CLASSES.map((c) => [`### ${c.section}`, c.name]));
  const result = Object.fromEntries(SHIPPED_CLASSES.map((c) => [c.name === 'db' ? 'backend' : c.name, false]));
  for (const lineNo of addedLineNos) {
    const text = (fileLines[lineNo - 1] ?? '').trim();
    if (text === '' || text === '---' || text.startsWith('#')) continue;
    for (let i = lineNo - 2; i >= 0; i--) {
      const heading = fileLines[i].trim();
      const cls = byHeading.get(heading);
      if (cls) {
        result[cls === 'db' ? 'backend' : cls] = true;
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

function gitOrEmpty(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return ''; // the file does not exist on that side of the range
  }
}

// The output key a class reports under. "db" answers to "backend" for the
// same reason isBackendPath does: the name is load bearing in the workflow.
function outputKey(name) {
  return name === 'db' ? 'backend' : name;
}

export function classify(baseRef, cwd = process.cwd()) {
  const range = `${baseRef}...HEAD`;
  const files = git(['diff', '--name-only', range], cwd).split('\n').filter(Boolean);

  const commonDiff = files.includes('js/common.js') ? git(['diff', range, '--', 'js/common.js'], cwd) : '';
  const commonIsFunctional = commonDiff !== '' && commonJsIsFunctional(commonDiff);
  const versionBump = commonDiff !== '' && hasVersionBump(commonDiff);

  const changed = {};
  for (const c of SHIPPED_CLASSES) {
    changed[c.name] = files.some((f) => classifyPath(f) === c.name);
  }
  changed.frontend = changed.frontend || commonIsFunctional;

  let sections = Object.fromEntries(SHIPPED_CLASSES.map((c) => [outputKey(c.name), false]));
  let headingError = '';
  if (files.includes('CHANGELOG.md')) {
    const diff = git(['diff', range, '--', 'CHANGELOG.md'], cwd);
    const newContent = git(['show', 'HEAD:CHANGELOG.md'], cwd);
    const baseContent = gitOrEmpty(['show', `${baseRef}:CHANGELOG.md`], cwd);
    sections = changelogSections(diff, newContent);
    headingError = headingProblems(baseContent, newContent).join('; ');
  }

  // Every shipped class that changed without gaining its own section. One
  // comma-joined list rather than four booleans the workflow would have to
  // test separately, so the error message can name all of them at once.
  const missing = SHIPPED_CLASSES.filter((c) => changed[c.name] && !sections[outputKey(c.name)]).map((c) => c.name);

  return {
    frontend: changed.frontend,
    backend: changed.db,
    functions: changed.functions,
    bot: changed.bot,
    shipped: SHIPPED_CLASSES.some((c) => changed[c.name]),
    version_bump: versionBump,
    frontend_entry: sections.frontend,
    backend_entry: sections.backend,
    functions_entry: sections.functions,
    bot_entry: sections.bot,
    missing_entry: missing.join(','),
    heading_error: headingError,
    news_touched: files.includes('news.json')
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
