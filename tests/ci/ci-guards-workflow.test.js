import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Most guards in this directory read a file outside it: a workflow, config.toml,
// a script under scripts/dev. A path list on the workflow that runs them has to
// name every one of those files, and it named three, so a PR that edited only
// deploy.yml or config.toml merged with no guard over either (#1128). The
// workflow is found by the step it runs rather than by its file name, and read
// as text the way app-workflow.test.js reads its own.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

const runners = readdirSync(WORKFLOWS)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), 'utf8').replace(/\r\n/g, '\n') }))
  .filter((workflow) => /^\s+run: npm run test:ci$/m.test(workflow.text));

const workflow = runners[0]?.text ?? '';

// The on: block's keys, comments and blank lines dropped. A comment at column
// 0 does not end the block in YAML, so it does not end it here either, or a
// filter written below one would go unread.
const triggerLines = (text) =>
  (text.match(/^on:\n((?:(?:[ #].*)?\n)+)/m)?.[1] ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

describe('the workflow that runs every guard in tests/ci (#1128)', () => {
  it('is one workflow', () => {
    expect(runners.map((runner) => runner.name)).toHaveLength(1);
  });

  // Any key under pull_request narrows it: paths and paths-ignore by file,
  // types to some events only (`types: [opened]` skips every later push, so a
  // deploy.yml edit pushed after the PR opens would go unguarded). A merge
  // runs them too, so a main that two green PRs turned red shows on the merge
  // that did it rather than on the next unrelated PR.
  it('starts on every pull request and every merge to main, with no paths, types or other filter', () => {
    expect(triggerLines(workflow)).toEqual(['  pull_request:', '  push:', '    branches:', '      - main']);
  });

  it('reads a filter written below a comment at column 0', () => {
    const narrowed = 'on:\n  pull_request:\n# keep this narrow\n    paths:\n      - tests/ci/**\n\njobs:\n';
    expect(triggerLines(narrowed)).toEqual(['  pull_request:', '    paths:', '      - tests/ci/**']);
  });

  it("gives a merge's run its own concurrency group, keyed on the commit, so one merge never cancels the one before it", () => {
    expect(workflow).toMatch(
      /^ {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.sha \}\}$/m
    );
  });

  // changelog.yml skips Dependabot with a job-level if:, and the same line here
  // would let a bump merge with the guards never run; continue-on-error would
  // run them and ignore the result.
  it('has no if: or continue-on-error that could skip or excuse the guards', () => {
    expect(workflow).not.toMatch(/^\s+if:/m);
    expect(workflow).not.toMatch(/^\s+continue-on-error:/m);
  });

  it('control: test:ci runs the whole directory', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:ci']).toBe('vitest run tests/ci');
  });
});
