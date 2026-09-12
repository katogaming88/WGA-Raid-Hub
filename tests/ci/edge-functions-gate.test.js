import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Edge Functions gate (#928 Stage 1, tests in #1006) is four files that
// have to agree on two paths: the workflow that runs deno check, deno lint
// and deno task test, the Deno config it reads, the Lint workflow whose
// Prettier step covers the functions and their tests, and the package.json
// globs that Prettier step runs. Each is internally consistent on its own;
// this is the diff between them. Read as text, the way the other checks in
// this directory read the pages and the workflows.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(path) {
  const full = join(ROOT, path);
  return existsSync(full) ? readFileSync(full, 'utf8') : '';
}

// deno.jsonc is JSON with // comment lines; Node has no JSONC parser.
function parseJsonc(text) {
  return JSON.parse(
    text
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n')
  );
}

describe('the Edge Functions workflow', () => {
  const workflow = read('.github/workflows/edge-functions.yml');

  it('runs on every change under supabase/functions, tests/edge and its own config', () => {
    expect(workflow).toMatch(/^\s+- 'supabase\/functions\/\*\*'$/m);
    expect(workflow).toMatch(/^\s+- 'tests\/edge\/\*\*'$/m);
    expect(workflow).toMatch(/^\s+- 'deno\.jsonc'$/m);
    expect(workflow).toMatch(/^\s+- '\.github\/workflows\/edge-functions\.yml'$/m);
  });

  it('pins Deno to an exact release, so CI cannot float away from the local install', () => {
    expect(workflow).toMatch(/^\s+deno-version: \d+\.\d+\.\d+$/m);
  });

  it('type-checks every entry point, lints the directory and runs the tests', () => {
    expect(workflow).toContain('deno check supabase/functions/*/index.ts');
    expect(workflow).toMatch(/^\s+run: deno lint$/m);
    expect(workflow).toMatch(/^\s+run: deno task test$/m);
  });
});

describe('the Deno config', () => {
  const config = parseJsonc(read('deno.jsonc') || '{}');

  it('starts at the typing stance tsconfig.json already holds', () => {
    expect(config.compilerOptions?.strict).toBe(false);
  });

  it('lints the functions and their tests with any allowed, as the frontend allows it', () => {
    expect(config.lint?.include).toEqual(['supabase/functions/', 'tests/edge/']);
    expect(config.lint?.rules?.exclude).toContain('no-explicit-any');
  });

  // No --allow-* flag, so a test that reaches the network or the environment
  // fails on permissions; --no-prompt so it fails on a developer's terminal
  // too, rather than asking. Hermeticity is checked, not intended.
  it('runs the tests with no permission granted and no prompt to grant one', () => {
    expect(config.tasks?.test).toContain('deno test');
    expect(config.tasks?.test).toContain('--no-prompt');
    expect(config.tasks?.test).toContain('tests/edge/');
    expect(config.tasks?.test).not.toMatch(/--allow-| -A\b/);
  });

  it('keeps no lockfile, so the check resolves jsr the way a deploy does', () => {
    expect(config.lock).toBe(false);
  });
});

describe('Prettier over the functions', () => {
  const pkg = JSON.parse(read('package.json'));
  const lint = read('.github/workflows/lint.yml');

  it('is run by both format scripts, over the functions and their tests', () => {
    expect(pkg.scripts.format).toContain('"supabase/functions/**/*.ts"');
    expect(pkg.scripts['format:check']).toContain('"supabase/functions/**/*.ts"');
    expect(pkg.scripts.format).toContain('"tests/edge/**/*.ts"');
    expect(pkg.scripts['format:check']).toContain('"tests/edge/**/*.ts"');
  });

  it('is triggered by the Lint workflow on a functions change', () => {
    expect(lint).toMatch(/^\s+- 'supabase\/functions\/\*\*'$/m);
  });
});
