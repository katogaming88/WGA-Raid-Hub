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

  // The majors the entry holds back, each because a package beside it in
  // app/ declares a peer range the major falls outside of, so a bundled
  // bump fails npm ci rather than installing. The first weekly run (#1233)
  // found the eslint pair that way. The name is the token as it sits in the
  // file: an @-scoped name is quoted in YAML.
  const heldMajors = [
    ['typescript', 'typescript-eslint has no 7'],
    ['eslint', 'eslint-plugin-jsx-a11y caps eslint at 9 (#1238)'],
    ["'@eslint/js'", 'its 10 peers on eslint 10, which is held (#1238)']
  ];

  it.each(heldMajors)('%s majors are ignored there, since %s', (yamlName) => {
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
});
