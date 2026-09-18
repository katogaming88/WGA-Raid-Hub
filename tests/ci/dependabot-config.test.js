import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// app/ keeps its own package.json and lockfile, so Dependabot only sees it
// through an entry of its own (#1180). Nothing here runs Dependabot; this
// reads .github/dependabot.yml as text, the way migration-ledger-workflow
// .test.js reads its workflow, because js-yaml is only a transitive module
// and the shape under test is a handful of lines.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = readFileSync(join(ROOT, '.github', 'dependabot.yml'), 'utf8');
const testsWorkflow = readFileSync(join(ROOT, '.github', 'workflows', 'changelog-check-tests.yml'), 'utf8');

// The text of one `updates:` entry, from its `- package-ecosystem:` line to
// the next one. Throws rather than returning '' so a missing entry fails the
// case that asked for it instead of passing every `not.toMatch` vacuously.
function entryFor(directory) {
  const entries = config.split(/^\s+- package-ecosystem:/m).slice(1);
  const hit = entries.find((entry) => new RegExp(`^\\s+directory: ${directory}$`, 'm').test(entry));
  if (!hit) throw new Error(`no updates entry with directory: ${directory}`);
  return hit;
}

// The group names declared under an entry's `groups:` key, in order.
function groupNames(entry) {
  const block = entry.match(/^\s+groups:\n((?:\s{6,}.*\n?)+)/m);
  if (!block) return [];
  return [...block[1].matchAll(/^\s{6}([a-z-]+):$/gm)].map((m) => m[1]);
}

// A version as [major, minor, patch, release], where release is 1 for a bare
// version and 0 for one carrying a prerelease tag, so a tagged bound sorts
// just below the release it names and every operator compares the same way.
// `parts` says how many segments were written, which ^ and ~ need.
function parseVersion(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?$/.exec(text);
  if (!m) throw new Error(`cannot read version: ${text}`);
  const parts = m[3] !== undefined ? 3 : m[2] !== undefined ? 2 : 1;
  return { tuple: [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0), m[4] ? 0 : 1], parts };
}

function compare(a, b) {
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

// The exclusive upper bound of a ^ or ~ range, as node-semver draws it:
// ^ bumps the leftmost non-zero segment that was written, ~ bumps the minor
// when one was written and the major otherwise. The bound carries release 0
// so the prerelease of the next version is out as well.
function upperBound(op, { tuple: [major, minor, patch], parts }) {
  if (op === '~') return parts >= 2 ? [major, minor + 1, 0, 0] : [major + 1, 0, 0, 0];
  if (major > 0 || parts === 1) return [major + 1, 0, 0, 0];
  if (minor > 0 || parts === 2) return [0, minor + 1, 0, 0];
  return [0, 0, patch + 1, 0];
}

// One comparator (`^9`, `>=4.8.4`, `<6.1.0`, `5.0.0`, `*`) as a predicate on
// a parsed version. A bare partial version is an x-range in node-semver, and
// x-ranges and hyphen ranges are not read here: nothing in app/ uses them,
// and a throw is a red test that says so rather than a silent pass.
function comparator(token) {
  if (token === '*' || token === '') return () => true;
  const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
  const op = m[1] ?? '';
  if (/^[^-]*[xX*]/.test(m[2])) throw new Error(`cannot read range: ${token} (an x-range)`);
  const bound = parseVersion(m[2]);
  if (op === '' && bound.parts < 3)
    throw new Error(`cannot read range: ${token} (a bare partial version is an x-range)`);
  const lower = bound.tuple;
  if (op === '^' || op === '~') {
    const upper = upperBound(op, bound);
    return (v) => compare(v, lower) >= 0 && compare(v, upper) < 0;
  }
  if (op === '>=') return (v) => compare(v, lower) >= 0;
  if (op === '>') return (v) => compare(v, lower) > 0;
  if (op === '<') return (v) => compare(v, lower) < 0;
  if (op === '<=') return (v) => compare(v, lower) <= 0;
  return (v) => compare(v, lower) === 0;
}

// Whether a peer range admits a version: any `||` alternative whose
// comparators all pass. An operator may be followed by a space in the wild
// (`>= 4.21.0`), so that is folded before the split on whitespace.
function admits(range, version) {
  const v = parseVersion(version).tuple;
  return range.split('||').some((alternative) => {
    const text = alternative.trim().replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1');
    if (/\s-\s/.test(text)) throw new Error(`cannot read range: ${text} (a hyphen range)`);
    return text.split(/\s+/).every((token) => comparator(token)(v));
  });
}

// Every package in a lockfile that declares a peer range on `name`, by the
// name of the package (the segment after its last node_modules/), with the
// range. Nested copies count: npm resolves them against the tree above.
function peersOn(lock, name) {
  return Object.entries(lock.packages)
    .filter(([key, pkg]) => key !== '' && pkg.peerDependencies?.[name] !== undefined)
    .map(([key, pkg]) => ({
      name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length),
      version: pkg.version,
      range: pkg.peerDependencies[name]
    }));
}

// The names of the packages whose peer range on `name` excludes `version`.
function holders(lock, name, version) {
  return peersOn(lock, name)
    .filter((peer) => !admits(peer.range, version))
    .map((peer) => peer.name);
}

// The majors the /app entry holds back, each because a package beside it in
// app/ declares a peer range the major falls outside of, so a bundled bump
// fails npm ci rather than installing. The first weekly run (#1233) found
// the eslint pair that way. `yamlName` is the token as it sits in the file
// (an @-scoped name is quoted in YAML); `judgedBy` is the name whose peer
// ranges say whether the hold still stands, which for @eslint/js is eslint,
// since the two move in lockstep. A hold with a reason that is not a peer
// range would carry null there and the tripwire would leave it alone.
const heldMajors = [
  { yamlName: 'typescript', reason: 'typescript-eslint has no 7', judgedBy: 'typescript' },
  { yamlName: 'eslint', reason: 'eslint-plugin-jsx-a11y caps eslint at 9 (#1238)', judgedBy: 'eslint' },
  { yamlName: "'@eslint/js'", reason: 'its 10 peers on eslint 10, which is held (#1238)', judgedBy: 'eslint' }
];

describe('the Dependabot entry for app/ (#1180)', () => {
  it('app/ has its own weekly npm entry labelled chore', () => {
    const app = entryFor('/app');
    expect(app).toMatch(/^ npm$/m);
    expect(app).toMatch(/^\s+interval: weekly$/m);
    expect(app).toMatch(/^\s+labels:\n\s+- chore$/m);
  });

  it('its dev dependencies are grouped and its runtime dependencies are not', () => {
    const app = entryFor('/app');
    expect(groupNames(app)).toEqual(['app-dev-dependencies']);
    expect(app).toMatch(/^\s+app-dev-dependencies:\n\s+dependency-type: development\n\s+patterns:\n\s+- '\*'$/m);
  });

  it.each(heldMajors)('$yamlName majors are ignored there, since $reason', ({ yamlName }) => {
    const app = entryFor('/app');
    const name = yamlName.replace(/[/.]/g, '\\$&');
    expect(app).toMatch(
      new RegExp(`^\\s+- dependency-name: ${name}\\n\\s+update-types: \\['version-update:semver-major'\\]$`, 'm')
    );
  });

  it('control: the bot/ entry keeps its bot-dev-dependencies group', () => {
    const bot = entryFor('/bot');
    expect(groupNames(bot)).toEqual(['bot-dev-dependencies']);
    expect(bot).toMatch(/^\s+bot-dev-dependencies:\n\s+dependency-type: development$/m);
  });

  // The only workflow that runs this file is keyed on scripts/ci and tests/ci,
  // so without this line a PR that edits only dependabot.yml would merge
  // without the cases above ever running (the gap #1128 records for
  // deploy.yml and config.toml).
  it('runs on a pull request that edits only dependabot.yml', () => {
    expect(testsWorkflow).toMatch(/^\s+- '\.github\/dependabot\.yml'$/m);
  });
});

// Each held major above is held because some package in app/ declares a peer
// range the next major falls outside of. Those ranges sit in the lockfile,
// and nothing read them back: when the holding package takes the next major
// its bump merges green and the ignore stays (#1241). The reader below is
// hand-rolled over the range shapes the lockfile actually uses, the way
// deploy-workflow.test.js splits YAML on indentation rather than taking a
// dependency, and it throws on a shape it does not know rather than guessing.
describe('the held majors tripwire (#1241)', () => {
  const jsxA11y = '^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9';

  // One row per comparator shape in app/package-lock.json today, plus the
  // ranges that hold the three majors against the version that lifts them.
  it.each([
    [jsxA11y, '9.0.0', true],
    [jsxA11y, '10.0.0', false],
    ['>=4.8.4 <6.1.0', '6.0.0', true],
    ['>=4.8.4 <6.1.0', '7.0.0', false],
    ['^8.57.0 || ^9.0.0 || ^10.0.0', '10.0.0', true],
    ['^8.0.0-0', '8.0.0', true],
    ['^8.0.0-0', '9.0.0', false],
    ['^7.0.0', '7.0.0', true],
    ['^7.0.0', '8.0.0', false],
    ['^0.2.0', '0.2.5', true],
    ['^0.2.0', '1.0.0', false],
    ['~6.0.3', '6.0.3', true],
    ['~6.0.3', '7.0.0', false],
    ['5.0.0', '5.0.0', true],
    ['5.0.0', '6.0.0', false],
    ['*', '99.0.0', true],
    ['>=10 <11', '10.0.0', true],
    ['>=10 <11', '11.0.0', false],
    ['>= 4.21.0', '5.0.0', true],
    ['>= 0.32', '1.0.0', true],
    ['>1.0.0', '1.0.0', false],
    ['<=1.0.0', '1.0.0', true],
    ['=1.0.0', '1.0.0', true]
  ])('admits(%j, %s) is %s', (range, version, expected) => {
    expect(admits(range, version)).toBe(expected);
  });

  it.each([['1.x'], ['1.2.3 - 2.3.4'], ['1.2'], ['latest']])('admits(%j) throws rather than guessing', (range) => {
    expect(() => admits(range, '1.0.0')).toThrow(/cannot read/);
  });

  // A lockfile shape: the root entry, the held package, one holder, one peer
  // that already admits the next major, and optionally a nested optional peer
  // (npm enforces an optional peer once the peer is installed, and a nested
  // copy is resolved against the tree above it, so both count).
  const lock = (jsxRange, extra = {}) => ({
    packages: {
      '': { devDependencies: { eslint: '^9.39.5' } },
      'node_modules/eslint': { version: '9.39.5' },
      'node_modules/eslint-plugin-jsx-a11y': { version: '6.10.2', peerDependencies: { eslint: jsxRange } },
      'node_modules/typescript-eslint': {
        version: '8.70.0',
        peerDependencies: { eslint: '^8.57.0 || ^9.0.0 || ^10.0.0', typescript: '>=4.8.4 <6.1.0' }
      },
      ...extra
    }
  });
  const nested = {
    'node_modules/a/node_modules/old-plugin': {
      version: '1.0.0',
      peerDependencies: { eslint: '^9', jiti: '*' },
      peerDependenciesMeta: { eslint: { optional: true } }
    }
  };

  it('holders() names the packages whose peer range excludes the version, nested and optional included', () => {
    expect(holders(lock(jsxA11y), 'eslint', '10.0.0')).toEqual(['eslint-plugin-jsx-a11y']);
    expect(holders(lock(jsxA11y, nested), 'eslint', '10.0.0')).toEqual(['eslint-plugin-jsx-a11y', 'old-plugin']);
    expect(holders(lock(jsxA11y), 'typescript', '7.0.0')).toEqual(['typescript-eslint']);
  });

  it('holders() is empty once the last holder widens, which is the red the tripwire fires on', () => {
    expect(holders(lock(`${jsxA11y} || ^10`), 'eslint', '10.0.0')).toEqual([]);
  });

  // Lifting a hold is two edits, the config line and the table row, and this
  // is what keeps them from drifting apart in either direction.
  it('the config holds exactly the names the table judges', () => {
    expect(heldNames(entryFor('/app')).sort()).toEqual(heldMajors.map((row) => unquote(row.yamlName)).sort());
  });

  // The tripwire itself, against the real lockfile. The major comes from the
  // held package's own installed version, not the judging name's, so a hold
  // left on @eslint/js after eslint has moved to 10 still reads as stale.
  it.each(heldMajors.filter((row) => row.judgedBy !== null))(
    '$yamlName is still held by a peer range in app/ (judged on $judgedBy)',
    ({ yamlName, judgedBy }) => {
      const name = unquote(yamlName);
      const installed = appLock.packages[`node_modules/${name}`];
      if (!installed) throw new Error(`${name} is ignored in dependabot.yml but is not in app/package-lock.json`);
      const next = parseVersion(installed.version).tuple[0] + 1;
      const peers = peersOn(appLock, judgedBy);
      const why =
        peers.length === 0
          ? `nothing in app/package-lock.json peers on ${judgedBy}`
          : `every package peering on ${judgedBy} admits ${next}: ` +
            peers.map((peer) => `${peer.name}@${peer.version} (${peer.range})`).join(', ');
      expect(
        holders(appLock, judgedBy, `${next}.0.0`),
        `lift the ${name} ignore in .github/dependabot.yml and its heldMajors row: ${why}`
      ).not.toHaveLength(0);
    }
  );

  it('control: today jsx-a11y is the one holder of eslint and typescript-eslint holds typescript', () => {
    expect(holders(appLock, 'eslint', '10.0.0')).toEqual(['eslint-plugin-jsx-a11y']);
    expect(holders(appLock, 'typescript', '7.0.0')).toContain('typescript-eslint');
  });
});
