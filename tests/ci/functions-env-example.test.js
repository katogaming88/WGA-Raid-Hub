import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFunctionSources } from '../../scripts/ci/functions-to-deploy.js';

// supabase/functions/.env.example is the list a developer copies before
// `supabase functions serve`. A name a function reads that the list leaves out
// shows up only at the first local call (a timed function answers 401 with no
// secret set), and a name nothing reads any more sends someone looking for a
// value that does nothing. This keeps the list level with the code both ways:
// every name read with a literal env.get(...), and every webhook name in the
// Discord destination registry, which reads its names through a variable.
// The CLI injects the three Supabase names, so they never go in the file.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLE = 'supabase/functions/.env.example';
const REGISTRY = 'supabase/functions/_shared/discord-destination.ts';
const INJECTED = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);

const READ = /\benv\.get\(\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\)/g;
const REGISTRY_NAME = /['"]([A-Z][A-Z0-9_]*_URL)['"]/g;

function namesRead() {
  const names = new Set();
  for (const { path, source } of listFunctionSources(ROOT)) {
    for (const [, name] of source.matchAll(READ)) names.add(name);
    if (path === REGISTRY) for (const [, name] of source.matchAll(REGISTRY_NAME)) names.add(name);
  }
  for (const name of INJECTED) names.delete(name);
  return names;
}

function namesListed() {
  const text = readFileSync(join(ROOT, EXAMPLE), 'utf8');
  return new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, name]) => name));
}

describe(EXAMPLE, () => {
  it('reads the functions and the file, so the checks below cannot pass over nothing', () => {
    expect(namesRead().size).toBeGreaterThan(10);
    expect(namesListed().size).toBeGreaterThan(5);
  });

  it('lists every variable a function reads, but the three the CLI injects', () => {
    const listed = namesListed();
    expect([...namesRead()].filter((name) => !listed.has(name)).sort()).toEqual([]);
  });

  it('lists nothing a function no longer reads', () => {
    const read = namesRead();
    expect([...namesListed()].filter((name) => !read.has(name)).sort()).toEqual([]);
  });
});
