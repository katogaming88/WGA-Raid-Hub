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

const onBlock = (text) => text.match(/^on:\n((?:(?: .*)?\n)+)/m)?.[1] ?? '';

describe('the workflow that runs every guard in tests/ci (#1128)', () => {
  it('is one workflow', () => {
    expect(runners.map((workflow) => workflow.name)).toHaveLength(1);
  });

  it('starts on every pull request, with no path filter', () => {
    const trigger = onBlock(runners[0]?.text ?? '');
    expect(trigger).toMatch(/^ {2}pull_request:/m);
    expect(trigger).not.toMatch(/^\s+paths(-ignore)?:/m);
  });

  it('control: test:ci runs the whole directory', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['test:ci']).toBe('vitest run tests/ci');
  });
});
