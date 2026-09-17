import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Migration ledger check workflow runs the same script on three events
// and the script has two modes. On a pull request a committed, unapplied
// migration is the normal state (#1050), so that run passes --pending-ok. The
// weekly sweep and a manual run exist to catch a merged migration the deploy
// never applied, which only shows up as a failure in strict mode, so the flag
// has to be conditional on the event (#1130). The script's two modes are
// covered in migration-ledger-check.test.js; this reads the workflow as text,
// the way edge-functions-gate.test.js reads its workflows, because the
// behaviour itself only shows up once a week.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'migration-ledger-check.yml'), 'utf8');

describe('the Migration ledger check workflow (#1130)', () => {
  it('passes --pending-ok on a pull request only', () => {
    expect(workflow).toMatch(
      /^\s+PENDING_OK: \$\{\{ github\.event_name == 'pull_request' && '--pending-ok' \|\| '' \}\}$/m
    );
  });

  it('takes the flag from that variable and never as a literal on the run line', () => {
    expect(workflow).toMatch(
      /^\s+node scripts\/ci\/migration-ledger-check\.js \$PENDING_OK \$NEW_ARGS < ledger\.txt$/m
    );
    expect(workflow).not.toMatch(/migration-ledger-check\.js[^\n]*--pending-ok/);
  });

  it('control: the weekly sweep exists and its failure reaches Discord', () => {
    expect(workflow).toMatch(/^\s+- cron: '30 10 \* \* 1'$/m);
    expect(workflow).toMatch(/^\s+if: failure\(\) && github\.event_name == 'schedule'$/m);
  });
});
