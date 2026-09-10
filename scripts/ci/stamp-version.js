// stamp-version.js
// Rewrites the VERSION constant and every ?v= cache-bust asset tag in one pass.
//
// GitHub Pages serves every static asset with Cache-Control: max-age=600, so a
// deploy can run fresh HTML against stale cached JS/CSS unless each local tag
// carries ?v=<VERSION> (#431). VERSION is a runtime JS constant, so those query
// strings are hardcoded into the markup rather than injected -- which means a
// version bump is a mechanical sweep over six files and 56 tags, and missing
// one leaves a dead cache-bust that nothing notices until a user sees the
// mismatch. tests/ci/asset-version-check.test.js catches it, but only after the
// fact; this is the sweep itself.
//
// PAGES lives here rather than in that test so the registry cannot drift: the
// check imports it from this file, so a new page is registered once.
//
// No external dependencies, matching the other scripts/ci/ tools.
//
// Usage: node scripts/ci/stamp-version.js <x.y.z>

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { classifyPath, isRootPage, pageIsStampOnly } from './changelog-check.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The HTML entry points GitHub Pages serves. Adding a page here registers it
// with the stamper AND with tests/ci/asset-version-check.test.js, which imports
// this list. Both halves of that contract move together on purpose.
export const PAGES = ['index.html', 'officer.html', 'admin.html', 'guild.html', 'boe.html', 'calendar.html'];

// Local (relative) css/ and js/ assets only. External URLs -- Google Fonts and
// the jsDelivr supabase-js CDN -- are versioned or pinned upstream and are
// deliberately left untagged, so the pattern only matches paths beginning css/
// or js/, never https://... Built fresh per call: a shared /g regex carries
// lastIndex between .replace() and .matchAll() and would skip matches.
function localAssetPattern() {
  return /(?:href|src)="((?:css|js)\/[^"]*)"/g;
}

const VERSION_PATTERN = /var VERSION = '([^']+)';/;

export function isValidVersion(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version);
}

/** Every local css/js asset path in a page, query string included. */
export function localAssets(html) {
  return [...html.matchAll(localAssetPattern())].map((m) => m[1]);
}

export function readVersion(root = ROOT) {
  const common = readFileSync(join(root, 'js', 'common.js'), 'utf8');
  const match = common.match(VERSION_PATTERN);
  if (!match) throw new Error('Could not find the VERSION constant in js/common.js');
  return match[1];
}

export function stampCommonJs(source, version) {
  if (!VERSION_PATTERN.test(source)) {
    throw new Error('Could not find the VERSION constant to replace');
  }
  // Function replacement, not a string: a '$' in the replacement text is a
  // substitution token to String.replace and would be eaten silently.
  return source.replace(VERSION_PATTERN, () => `var VERSION = '${version}';`);
}

export function stampHtml(html, version) {
  let count = 0;
  const stamped = html.replace(localAssetPattern(), (whole, path) => {
    count += 1;
    const attr = whole.slice(0, whole.indexOf('='));
    return `${attr}="${path.split('?')[0]}?v=${version}"`;
  });
  // A page that matched nothing is a markup change or a wrong path, not a page
  // with no assets. Reporting "stamped 0 tags" would read as success.
  if (count === 0) throw new Error('Found no local css/ or js/ asset tags to stamp');
  return { html: stamped, count };
}

const REQUIRED_SCHEMA_PATTERN = /var REQUIRED_SCHEMA = '([^']*)';/;
const FOOTER_VERSION_PATTERN = /(<span id="versionNum">)([^<]*)(<\/span>)/;
const FUNCTION_VERSION_PATTERN = /(export const VERSION = ')([^']*)(';)/;
const MIGRATION_STAMP = /^(\d{14})_/;

/** The served manifest and the Jekyll-rendered build identity. */
export const MANIFEST_FILE = 'version.json';
export const BUILD_FILE = 'build.json';

/**
 * The build identity, rendered by Jekyll at deploy time rather than written
 * here. Only the deploy knows the commit it is publishing, and empty front
 * matter is what makes Jekyll process the file at all. It is a separate file
 * from the manifest on purpose: front matter would make version.json
 * unparseable, both to this script and to the CI invariant that reads it back.
 * Since #1050 Jekyll runs inside the Deploy workflow rather than as a Pages
 * branch build, which is why that workflow prints the rendered file: the
 * commit now arrives as an action input instead of from the Pages environment.
 */
export function buildJsonContent() {
  return [
    '---',
    '---',
    '{',
    '  "sha": "{{ site.github.build_revision }}",',
    '  "built": "{{ site.time | date_to_xmlschema }}"',
    '}',
    ''
  ].join('\n');
}

/** The highest migration stamp in the tree, which is the schema the code expects. */
export function readNewestMigration(root = ROOT) {
  const dir = join(root, 'supabase', 'migrations');
  if (!existsSync(dir)) return null;
  const stamps = readdirSync(dir)
    .map((name) => name.match(MIGRATION_STAMP))
    .filter(Boolean)
    .map((m) => m[1])
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

/**
 * The functions this stamp can write, meaning the ones that already carry a
 * version file. #971 is what creates them; until a function has one there is
 * nothing to stamp and nothing to put in the manifest, and an absent entry
 * reads as "not stamped yet" rather than as drift.
 */
export function readStampedFunctions(root = ROOT) {
  const dir = join(root, 'supabase', 'functions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .filter((name) => existsSync(join(dir, name, 'version.ts')))
    .sort();
}

export function stampRequiredSchema(source, stamp) {
  if (!REQUIRED_SCHEMA_PATTERN.test(source)) {
    throw new Error('Could not find the REQUIRED_SCHEMA constant to replace');
  }
  return source.replace(REQUIRED_SCHEMA_PATTERN, () => `var REQUIRED_SCHEMA = '${stamp}';`);
}

/**
 * Writes the version into the footer span in the markup.
 *
 * admin.html is the page that needs it: js/admin.js is standalone and never
 * loads js/common.js, so VERSION is not in scope there to fill the span at
 * runtime. Same reason the ?v= tags are hardcoded rather than injected.
 *
 * It runs over every page, so index.html, officer.html and calendar.html get
 * the number written into their markup as well, and then overwrite it from
 * VERSION on boot. That is harmless and it also means the footer reads right
 * before the scripts run. guild.html and boe.html name their spans
 * guildVersion and boeVersion and are left alone. A page without the span is
 * returned exactly as it came in.
 */
export function stampFooterVersion(html, version) {
  return html.replace(FOOTER_VERSION_PATTERN, (whole, open, _old, close) => `${open}${version}${close}`);
}

export function stampFunctionVersion(source, version) {
  if (!FUNCTION_VERSION_PATTERN.test(source)) {
    throw new Error('Could not find the exported VERSION constant to replace');
  }
  return source.replace(FUNCTION_VERSION_PATTERN, (whole, open, _old, close) => `${open}${version}${close}`);
}

/**
 * Which version each shipped piece carries after this stamp.
 *
 * The rule, and the one that is easy to get backwards: a piece carries the
 * version of the last release that TOUCHED it. A piece the branch did not
 * change keeps whatever it had, and a piece that has never been stamped stays
 * absent rather than being invented at the current version. So a chore PR,
 * which moves no shipped path, must come out of this with the manifest it
 * went in with.
 *
 * _shared/** counts as touching every function, because it is compiled into
 * each bundle and therefore ships in all of them.
 */
export function computePieces({ changed, previous = {}, version, functions = [] }) {
  const touched = new Set(changed.map((path) => classifyPath(path)).filter(Boolean));
  const pieces = {};

  for (const name of ['frontend', 'db', 'bot']) {
    if (touched.has(name)) {
      pieces[name] = version;
    } else if (previous[name]) {
      pieces[name] = previous[name];
    }
  }

  const sharedChanged = changed.some((path) => path.startsWith('supabase/functions/_shared/'));
  const previousFunctions = previous.functions ?? {};
  const nextFunctions = {};
  for (const name of new Set([...functions, ...Object.keys(previousFunctions)])) {
    const trackable = functions.includes(name) || previousFunctions[name] !== undefined;
    if (!trackable) continue;
    const ownChanged = changed.some((path) => path.startsWith(`supabase/functions/${name}/`));
    if ((ownChanged || sharedChanged) && functions.includes(name)) {
      nextFunctions[name] = version;
    } else if (previousFunctions[name] !== undefined) {
      nextFunctions[name] = previousFunctions[name];
    }
  }
  pieces.functions = nextFunctions;
  return pieces;
}

/**
 * The paths this branch changed against its base, committed or not. Diffing
 * the working tree against the merge base rather than HEAD, so the stamp sees
 * the same set whether it runs before or after the work is committed.
 */
export function changedPaths(baseRef = 'origin/main', cwd = ROOT) {
  const run = (args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  try {
    execFileSync('git', ['fetch', '--quiet', 'origin', 'main'], { cwd, stdio: 'ignore' });
  } catch {
    // Offline is survivable: the local ref is stale but usable, and the CI
    // invariant re-checks the manifest against the PR's real base anyway.
  }
  const base = run(['merge-base', baseRef, 'HEAD']);
  // Untracked files are listed separately because git diff cannot see them,
  // and the commonest db release is a migration file that exists and has not
  // been committed yet. Without this the stamp reads that release as touching
  // nothing and the manifest comes out with no db entry.
  const tracked = run(['diff', '--name-only', base]).split('\n');
  const untracked = run(['ls-files', '--others', '--exclude-standard']).split('\n');
  const files = [...new Set([...tracked, ...untracked])].filter(Boolean);
  // A second stamp on the same branch (a rebase, or a corrected number) sees
  // the first stamp's own page rewrites in this diff, and marking the frontend
  // from those would claim a release touched it when nothing did. Dropped
  // here rather than inside computePieces so the printed denominator and the
  // manifest agree about what changed.
  return { base, files: files.filter((path) => !isStampOnlyAgainst(path, base, cwd)) };
}

/** True when a root page differs from `base` only by a previous run of this stamper. */
function isStampOnlyAgainst(path, base, cwd) {
  if (!isRootPage(path)) return false;
  const full = join(cwd, path);
  if (!existsSync(full)) return false; // deleted, so a real change
  let baseSource;
  try {
    baseSource = execFileSync('git', ['show', `${base}:${path}`], { cwd, encoding: 'utf8' });
  } catch {
    return false; // new page, nothing to take the stamp back out of
  }
  return pageIsStampOnly(baseSource, readFileSync(full, 'utf8'));
}

/**
 * Stamps js/common.js and every page. Reads and rewrites everything in memory
 * first, so a failure on the last page cannot leave the first ones rewritten.
 */
export function stampAll({ root = ROOT, version, pages = PAGES, changed } = {}) {
  if (!isValidVersion(version)) {
    throw new Error(`Version must look like x.y.z, got: ${version}`);
  }

  // What the branch changed is an input, not a guess. Marking a piece as
  // shipped when it did not ship is the one failure this manifest cannot
  // detect later, so the caller either says or the stamp asks git.
  let base = null;
  let changedFiles = changed;
  if (!changedFiles) {
    const found = changedPaths('origin/main', root);
    base = found.base;
    changedFiles = found.files;
  }

  const commonPath = join(root, 'js', 'common.js');
  let commonSource = readFileSync(commonPath, 'utf8');
  const previous = commonSource.match(VERSION_PATTERN)[1];
  commonSource = stampCommonJs(commonSource, version);

  const schema = readNewestMigration(root);
  if (schema && REQUIRED_SCHEMA_PATTERN.test(commonSource)) {
    commonSource = stampRequiredSchema(commonSource, schema);
  }

  const writes = [{ path: commonPath, text: commonSource }];
  const counts = [];

  for (const page of pages) {
    const pagePath = join(root, page);
    const { html, count } = stampHtml(readFileSync(pagePath, 'utf8'), version);
    writes.push({ path: pagePath, text: stampFooterVersion(html, version) });
    counts.push({ page, count });
  }

  const manifestPath = join(root, MANIFEST_FILE);
  const previousManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  const functions = readStampedFunctions(root);
  const pieces = computePieces({
    changed: changedFiles,
    previous: previousManifest.pieces ?? {},
    version,
    functions
  });

  writes.push({ path: manifestPath, text: JSON.stringify({ version, pieces }, null, 2) + '\n' });
  writes.push({ path: join(root, BUILD_FILE), text: buildJsonContent() });

  for (const [name, pieceVersion] of Object.entries(pieces.functions ?? {})) {
    const versionPath = join(root, 'supabase', 'functions', name, 'version.ts');
    if (!existsSync(versionPath)) continue;
    writes.push({ path: versionPath, text: stampFunctionVersion(readFileSync(versionPath, 'utf8'), pieceVersion) });
  }

  const botManifest = join(root, 'bot', 'package.json');
  if (pieces.bot && existsSync(botManifest)) {
    const pkg = JSON.parse(readFileSync(botManifest, 'utf8'));
    pkg.version = pieces.bot;
    writes.push({ path: botManifest, text: JSON.stringify(pkg, null, 2) + '\n' });

    // npm records the root version twice, in the lockfile's own `version` and
    // again under packages[""]. Left behind, the next `npm install` under bot/
    // rewrites both from package.json inside whatever PR happens to run it.
    const botLock = join(root, 'bot', 'package-lock.json');
    if (existsSync(botLock)) {
      const lock = JSON.parse(readFileSync(botLock, 'utf8'));
      lock.version = pieces.bot;
      if (lock.packages && lock.packages['']) {
        lock.packages[''].version = pieces.bot;
      }
      writes.push({ path: botLock, text: JSON.stringify(lock, null, 2) + '\n' });
    }
  }

  for (const { path, text } of writes) {
    writeFileSync(path, text, 'utf8');
  }

  return { version, previous, pages: counts, pieces, schema, base };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = process.argv[2];
  if (!version) {
    console.error('Usage: node scripts/ci/stamp-version.js <x.y.z>');
    process.exit(2);
  }
  try {
    const result = stampAll({ version });
    console.log(`${result.previous} -> ${result.version}`);
    console.log('js/common.js: VERSION');
    for (const { page, count } of result.pages) {
      console.log(`${page}: ${count} asset tags`);
    }
    if (result.schema) console.log(`js/common.js: REQUIRED_SCHEMA ${result.schema}`);
    if (result.base) console.log(`pieces computed against ${result.base.slice(0, 7)}`);
    // Per piece, so a piece that should have moved and did not is visible here
    // rather than only in the CI invariant.
    for (const [name, value] of Object.entries(result.pieces)) {
      if (name === 'functions') {
        const entries = Object.entries(value);
        console.log(`functions: ${entries.length ? entries.map(([f, v]) => `${f} ${v}`).join(', ') : 'none stamped'}`);
      } else {
        console.log(`${name}: ${value}`);
      }
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
