import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFunctionSources } from '../../scripts/ci/functions-to-deploy.js';
import { DESTINATIONS, TEST_WEBHOOK } from '../../supabase/functions/_shared/discord-destination.ts';

// supabase/functions/.env.example is the list a developer copies before
// `supabase functions serve`. A name a function reads that the list leaves out
// shows up only when a local call fails, and a name nothing reads any more
// sends someone looking for a value that does nothing. This keeps the list
// level with the code both ways: every name read with a literal env.get(...)
// outside a comment line, and every name in the Discord destination registry,
// which reads its names through a variable. Left out: the three Supabase names
// the CLI injects, and the registry's dashed fallback name, which exists only
// among production's secrets.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXAMPLE = 'supabase/functions/.env.example';
const INJECTED = new Set(['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const READ = /\benv\.get\(\s*['"`]([A-Z][A-Z0-9_]*)['"`]\s*\)/g;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

function namesRead() {
  const names = new Set();
  for (const { source } of listFunctionSources(ROOT)) {
    const code = source
      .split(/\r?\n/)
      .filter((line) => !COMMENT_LINE.test(line))
      .join('\n');
    for (const [, name] of code.matchAll(READ)) names.add(name);
  }
  for (const name of [...Object.values(DESTINATIONS).flat(), TEST_WEBHOOK]) {
    if (ENV_NAME.test(name)) names.add(name);
  }
  for (const name of INJECTED) names.delete(name);
  return names;
}

function namesListed() {
  const text = readFileSync(join(ROOT, EXAMPLE), 'utf8');
  return new Set([...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(([, name]) => name));
}

const read = namesRead();
const listed = namesListed();

describe(EXAMPLE, () => {
  it('reads the functions and the file, so the checks below cannot pass over nothing', () => {
    expect(read.size).toBeGreaterThan(10);
    expect(listed.size).toBeGreaterThan(5);
  });

  it('lists every variable a function reads, but the three the CLI injects', () => {
    expect([...read].filter((name) => !listed.has(name)).sort()).toEqual([]);
  });

  it('lists nothing a function no longer reads', () => {
    expect([...listed].filter((name) => !read.has(name)).sort()).toEqual([]);
  });
});
