import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyPath } from '../../scripts/ci/changelog-check.js';
import { computePieces } from '../../scripts/ci/stamp-version.js';
import { importersOf, selectFunctions } from '../../scripts/ci/functions-to-deploy.js';

// Three rules decide what a path under supabase/functions/ is: classifyPath
// (which CHANGELOG section a PR owes), computePieces (which function version
// the stamp moves) and selectFunctions (what the deploy uploads). They were
// written separately and one of them disagreed with the other two on the env
// template (#1223), so this reads every representative path through all
// three at once. Named functions-*.test.js on purpose: edge-functions.yml
// runs that glob on any PR that touches supabase/functions/**, which is where
// the disagreement would next be introduced.

const VERSION = '9.9.9';
const FUNCTIONS = ['alpha', 'beta'];
const previous = { frontend: '1.0.0', db: '1.0.0', bot: '1.0.0', functions: { alpha: '1.0.0', beta: '1.0.0' } };

let fixture;

function writeFile(rel, source) {
  const full = join(fixture, ...rel.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

// Two functions, one importing a _shared module, so the _shared row has one
// importer and the other function is the control that stays put.
beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'functions-path-rules-'));
  writeFile('supabase/functions/_shared/gql.ts', 'export const x = 1;\n');
  writeFile(
    'supabase/functions/alpha/index.ts',
    "import { x } from '../_shared/gql.ts';\nDeno.serve(() => new Response(String(x)));\n"
  );
  writeFile('supabase/functions/beta/index.ts', 'Deno.serve(() => new Response("beta"));\n');
  writeFile('supabase/functions/.env.example', 'ALPHA_URL=http://127.0.0.1:8899/alpha\n');
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

// The functions the stamp would move for one changed path.
function stamped(path) {
  const pieces = computePieces({
    changed: [path],
    previous,
    version: VERSION,
    functions: FUNCTIONS,
    importersOf: (modulePath) => importersOf(modulePath, fixture)
  });
  return Object.keys(pieces.functions).filter((name) => pieces.functions[name] === VERSION);
}

function deployed(path) {
  return selectFunctions({ changed: [path], root: fixture }).deploy;
}

// path, the CHANGELOG class, the function versions that move, the deploy set.
const table = [
  ["a function's own file", 'supabase/functions/alpha/index.ts', 'functions', ['alpha'], ['alpha']],
  ['a _shared module', 'supabase/functions/_shared/gql.ts', 'functions', ['alpha'], ['alpha']],
  ['the env template', 'supabase/functions/.env.example', null, [], []],
  // config.toml carries the per-function verify_jwt flags, so a change to it
  // redeploys every function while moving no version and logging under
  // Project. That is today's behaviour, pinned rather than endorsed; #1223
  // names it as a decision still to make.
  ['config.toml', 'supabase/config.toml', null, [], ['alpha', 'beta']],
  ['a migration', 'supabase/migrations/20260917000000_x.sql', 'db', [], []],
  ['a frontend file', 'js/roster.js', 'frontend', [], []]
];

describe('the three rules over supabase/functions/ agree (#1223)', () => {
  it.each(table)('%s', (_label, path, changelogClass, moves, deploy) => {
    expect.soft(classifyPath(path), 'classifyPath').toBe(changelogClass);
    expect.soft(stamped(path), 'computePieces').toEqual(moves);
    expect.soft(deployed(path), 'selectFunctions').toEqual(deploy);
  });
});
