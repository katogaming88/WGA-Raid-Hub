import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The App workflow is the only thing that typechecks, lints and tests the new
// app, and main has no required checks and no up-to-date rule, so two green
// PRs can land a red main between them. The workflow has to run on every
// merge as well as on every PR, and a merge's run has to finish: the
// concurrency group that lets a PR's pushes supersede each other must not
// put every push to main in one bucket (#1182). Read as text, the way
// migration-ledger-workflow.test.js reads its workflow, because the behaviour
// only shows on a merge.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'app.yml'), 'utf8');

function pathsUnder(event) {
  const block = workflow.match(new RegExp(`^  ${event}:\\n((?:    .*\\n)+)`, 'm'));
  return block ? [...block[1].matchAll(/^ {6}- '([^']+)'$/gm)].map((m) => m[1]) : null;
}

describe('the App workflow (#1182)', () => {
  it('runs on a push to main with the pull request path list', () => {
    expect(workflow).toMatch(/^ {2}push:\n {4}branches:\n {6}- main\n {4}paths:\n/m);
    expect(pathsUnder('push')).toEqual(pathsUnder('pull_request'));
  });

  it("gives a merge's run its own concurrency group, keyed on the commit, so one merge never cancels the one before it", () => {
    expect(workflow).toMatch(
      /^ {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.sha \}\}$/m
    );
  });

  it('control: a pull request still groups by its number, and the types file is still in the path list', () => {
    expect(workflow).toMatch(/^ {2}group: \$\{\{ github\.workflow \}\}-\$\{\{ github\.event\.pull_request\.number/m);
    expect(workflow).toMatch(/^ {2}cancel-in-progress: true$/m);
    expect(pathsUnder('pull_request')).toContain('js/database.types.ts');
    expect(pathsUnder('pull_request')).toContain('app/**');
  });
});
