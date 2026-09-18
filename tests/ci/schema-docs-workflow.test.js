import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Schema docs workflow boots the migrations on every migration PR and
// fails the PR when a generated mirror of the database was not regenerated:
// dbdoc/, docs/rls_policies.csv, supabase/definitions/. js/database.types.ts
// is the fourth such mirror, read by both sites, and was hand-edited from
// July to September with no check behind it (#1181). This reads the workflow
// as text, the way migration-ledger-workflow.test.js does, because the step
// only runs on a PR against a stack CI builds.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'schema-docs.yml'), 'utf8');

describe('the Schema docs workflow (#1181)', () => {
  it('fails the PR when js/database.types.ts is stale', () => {
    expect(workflow).toMatch(
      /^\s+- name: Fail if js\/database\.types\.ts is stale\n\s+run: node scripts\/ci\/gen-types\.js --check$/m
    );
  });

  it('runs on a PR that edits the types file or its generator, not only on a migration', () => {
    expect(workflow).toMatch(/^\s+- 'js\/database\.types\.ts'$/m);
    expect(workflow).toMatch(/^\s+- 'scripts\/ci\/gen-types\.js'$/m);
  });

  it('control: the definitions mirror is still checked the same way', () => {
    expect(workflow).toMatch(
      /^\s+- name: Fail if supabase\/definitions\/ is stale\n\s+run: node scripts\/ci\/export-definitions\.js --check$/m
    );
  });
});
