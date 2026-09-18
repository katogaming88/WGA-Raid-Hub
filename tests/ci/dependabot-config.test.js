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
