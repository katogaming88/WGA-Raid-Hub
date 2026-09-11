import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Edge Functions gate (#928 Stage 1) is four files that have to agree on
// one path: the workflow that runs deno check and deno lint, the Deno config
// it reads, the Lint workflow whose Prettier step now covers the functions,
// and the package.json globs that Prettier step runs. Each is internally
// consistent on its own; this is the diff between them. Read as text, the way
// the other checks in this directory read the pages and the workflows.

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

  it('runs on every change under supabase/functions and to its own config', () => {
    expect(workflow).toMatch(/^\s+- 'supabase\/functions\/\*\*'$/m);
    expect(workflow).toMatch(/^\s+- 'deno\.jsonc'$/m);
    expect(workflow).toMatch(/^\s+- '\.github\/workflows\/edge-functions\.yml'$/m);
  });

  it('pins Deno to an exact release, so CI cannot float away from the local install', () => {
    expect(workflow).toMatch(/^\s+deno-version: \d+\.\d+\.\d+$/m);
  });

  it('type-checks every entry point and lints the directory', () => {
    expect(workflow).toContain('deno check supabase/functions/*/index.ts');
    expect(workflow).toMatch(/^\s+run: deno lint$/m);
  });
});

describe('the Deno config', () => {
  const config = parseJsonc(read('deno.jsonc') || '{}');

  it('starts at the typing stance tsconfig.json already holds', () => {
    expect(config.compilerOptions?.strict).toBe(false);
  });

  it('lints the functions directory with any allowed, as the frontend allows it', () => {
    expect(config.lint?.include).toEqual(['supabase/functions/']);
    expect(config.lint?.rules?.exclude).toContain('no-explicit-any');
  });

  it('keeps no lockfile, so the check resolves jsr the way a deploy does', () => {
    expect(config.lock).toBe(false);
  });
});

describe('Prettier over the functions', () => {
  const pkg = JSON.parse(read('package.json'));
  const lint = read('.github/workflows/lint.yml');

  it('is run by both format scripts', () => {
    expect(pkg.scripts.format).toContain('"supabase/functions/**/*.ts"');
    expect(pkg.scripts['format:check']).toContain('"supabase/functions/**/*.ts"');
  });

  it('is triggered by the Lint workflow on a functions change', () => {
    expect(lint).toMatch(/^\s+- 'supabase\/functions\/\*\*'$/m);
  });
});
