import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLD } from '../../scripts/ci/functions-to-deploy.js';

// The Deploy workflow (#1050). A frontend PR used to reach the site about forty
// seconds after merging while `supabase db push` stayed a separate step someone
// ran afterwards, so the deployed site could call RPCs the database did not
// have yet. This workflow applies the migrations first and deploys the site
// only if that succeeded.
//
// What is asserted here is the ordering, because that is the entire point and
// it is invisible from the outside: a workflow that pushes and deploys in
// parallel looks almost identical and reintroduces the window. There is no YAML
// parser in this repo (nothing else needs one), so the jobs are split on
// indentation, the same way tests/ci/functions-config.test.js reads bare-key
// TOML rather than taking a dependency.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

const read = (name) => readFileSync(join(WORKFLOWS, name), 'utf8');

// Comments are stripped first. Two of these assertions look for a flag or a
// key, and the workflow explains itself in prose above each step, so a match on
// a comment would let a removed step keep passing.
function stripComments(yaml) {
  return yaml
    .split(/\r?\n/)
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** Job name to its block, split on the two-space indent under `jobs:`. */
function readJobs(yaml) {
  const jobs = new Map();
  const lines = stripComments(yaml).split(/\r?\n/);
  const start = lines.findIndex((line) => /^jobs:\s*$/.test(line));
  let current = null;
  for (const line of lines.slice(start + 1)) {
    const header = line.match(/^ {2}([A-Za-z][\w-]*):\s*$/);
    if (header) {
      current = header[1];
      jobs.set(current, []);
      continue;
    }
    if (current) jobs.get(current).push(line);
  }
  return new Map([...jobs].map(([name, body]) => [name, body.join('\n')]));
}

const deploy = read('deploy.yml');
const jobs = readJobs(deploy);

describe('the Deploy workflow (#1050)', () => {
  it('runs on a merge to main', () => {
    const on = stripComments(deploy).split(/^jobs:/m)[0];
    expect(on).toMatch(/push:/);
    expect(on).toMatch(/branches:\s*\[main\]/);
  });

  it('queues two merges instead of cancelling the first', () => {
    // A cancelled run is a half-applied deploy: the migrations of the first
    // merge may already be on prod with its site build discarded.
    expect(stripComments(deploy)).toMatch(/concurrency:[\s\S]*?cancel-in-progress:\s*false/);
  });

  it('pushes the migrations over the existing secret, without prompting', () => {
    const migrate = jobs.get('migrate');
    expect(migrate).toBeDefined();
    expect(migrate).toMatch(/supabase db push/);
    expect(migrate).toMatch(/--db-url/);
    expect(migrate).toMatch(/SUPABASE_DB_URL/);
    // The runner has no TTY, so an unanswered confirmation prompt is a hang
    // rather than a refusal.
    expect(migrate).toMatch(/--yes/);
  });

  it('checks the ledger after pushing, not before', () => {
    const migrate = jobs.get('migrate');
    const pushAt = migrate.indexOf('supabase db push');
    const checkAt = migrate.indexOf('migration-ledger-check.js');
    expect(pushAt).toBeGreaterThanOrEqual(0);
    expect(checkAt).toBeGreaterThan(pushAt);
  });

  it('deploys only after the migrations applied', () => {
    // The dependency this whole workflow exists for. Without it the two jobs
    // race and the site can still win.
    const needs = jobs.get('deploy').match(/needs:\s*(.+)/);
    expect(needs).not.toBeNull();
    expect(needs[1]).toContain('migrate');
  });

  it('carries the permissions Pages deployment requires', () => {
    const deployJob = jobs.get('deploy');
    expect(deployJob).toMatch(/pages:\s*write/);
    expect(deployJob).toMatch(/id-token:\s*write/);
    expect(deployJob).toMatch(/environment:/);
  });

  it('skips deploying while Pages still builds from the branch', () => {
    // The workflow lands before the publishing source is switched, which is a
    // repository setting only the owner can change. Until then the branch build
    // still serves the site and this job must not fight it.
    const deployJob = jobs.get('deploy');
    expect(deployJob).toMatch(/if:/);
    expect(deployJob).toMatch(/build_type/);
    expect(deployJob).toMatch(/workflow/);
  });
});

describe('the ledger check moves to pending-ok on pull requests (#1050)', () => {
  const ledger = read('migration-ledger-check.yml');

  it('passes --pending-ok on a pull request', () => {
    // A migration PR is now committed-but-unapplied by design: the Deploy
    // workflow applies it at merge.
    expect(stripComments(ledger)).toMatch(/--pending-ok/);
  });

  it('no longer runs on a push to main, because Deploy checks that itself', () => {
    const on = stripComments(ledger).split(/^jobs:/m)[0];
    expect(on).not.toMatch(/push:/);
  });

  it('still sweeps on a schedule', () => {
    expect(stripComments(ledger)).toMatch(/schedule:/);
  });
});

// The functions half (#1083): a merge deploys the Edge Functions the push
// changed, from a job that sits between the migrations and the site, so a
// function is never behind its schema and the site is never ahead of its
// functions. The token is a classic personal access token on a dedicated
// Developer account (scoped tokens were not on the account yet); its secret
// name says what it may do. CLI 2.117.0 is the first release that accepts
// the sbp_v0 token format Supabase issues now, so the pin cannot sit below it.
function atLeast(version, floor) {
  const a = version.split('.').map(Number);
  const b = floor.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

describe('the functions half of Deploy (#1083)', () => {
  const functionsJob = jobs.get('functions');
  const migrate = jobs.get('migrate');

  it('has a functions job that runs after the migrations', () => {
    expect(functionsJob).toBeDefined();
    const needs = functionsJob.match(/needs:\s*(.+)/);
    expect(needs).not.toBeNull();
    expect(needs[1]).toContain('migrate');
  });

  it('deploys the site only after the functions did, and still after the migrations', () => {
    const needs = jobs.get('deploy').match(/needs:\s*(.+)/)[1];
    expect(needs).toContain('functions');
    expect(needs).toContain('migrate');
  });

  it('is never skipped at the job level, so the site job can need it', () => {
    // A job-level if: that reads false skips every job that needs it; the
    // decision has to be made inside the steps instead.
    const head = functionsJob.split(/\n\s+steps:/)[0];
    expect(head).not.toMatch(/^\s+if:/m);
  });

  it('pins the CLI to one version in both jobs, at or above the release that accepts sbp_v0 tokens', () => {
    const pin = (job) => (job.match(/version:\s*(\d+\.\d+\.\d+)/) || [])[1];
    expect(pin(migrate)).toBeDefined();
    expect(pin(functionsJob)).toBe(pin(migrate));
    expect(atLeast(pin(functionsJob), '2.117.0')).toBe(true);
  });

  it('reads the deploy token under its own name and hands it to the CLI as SUPABASE_ACCESS_TOKEN', () => {
    expect(functionsJob).toMatch(
      /SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_EDGE_FUNCTIONS_DEPLOY_TOKEN\s*\}\}/
    );
    expect(deploy).not.toMatch(/secrets\.SUPABASE_ACCESS_TOKEN\b/);
  });

  it('diffs the push with git over a full clone, not the compare API', () => {
    expect(functionsJob).toMatch(/fetch-depth:\s*0/);
    expect(functionsJob).toMatch(/git diff --name-only/);
    expect(functionsJob).toMatch(/functions-to-deploy\.js/);
    expect(functionsJob).not.toMatch(/\/compare\//);
  });

  it('deploys by name and never prunes or turns the JWT gate off', () => {
    expect(functionsJob).toMatch(/supabase functions deploy/);
    expect(deploy).not.toMatch(/--prune/);
    expect(deploy).not.toMatch(/--no-verify-jwt/);
  });

  it('targets the project the site talks to', () => {
    const ref = (functionsJob.match(/PROJECT_REF:\s*([a-z]{20})/) || [])[1];
    expect(ref).toBeDefined();
    const common = readFileSync(join(ROOT, 'js', 'common.js'), 'utf8');
    expect(common).toContain(`https://${ref}.supabase.co`);
  });

  it('offers a functions input for a catch-up by hand', () => {
    const on = stripComments(deploy).split(/^jobs:/m)[0];
    expect(on).toMatch(/workflow_dispatch:/);
    expect(on).toMatch(/^\s+functions:\s*$/m);
  });

  it('holds only functions that exist', () => {
    expect(HOLD.length).toBeGreaterThan(0);
    for (const held of HOLD) {
      expect(existsSync(join(ROOT, 'supabase', 'functions', held.name, 'index.ts'))).toBe(true);
    }
  });
});
