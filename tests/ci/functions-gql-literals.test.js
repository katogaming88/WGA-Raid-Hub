import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// wcl-sync and wcl-progression-sync build GraphQL text by interpolation, and
// #1013 routed the values that come from a request, a row or a WCL payload
// through the two builders in supabase/functions/_shared/gql.ts. The Deno
// tests pin the builders; nothing there can see the call sites, because the
// functions that hold them run on the platform fetch. This is the pin for
// the sites: the three names those sites interpolate never appear bare in a
// template again. It is keyed on names, so it guards the fixed sites and any
// new site that reuses their vocabulary, not every interpolation there is.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

function listTs(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listTs(full, out);
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = listTs(FUNCTIONS_DIR).map((full) => ({
  path: relative(ROOT, full).replace(/\\/g, '/'),
  source: readFileSync(full, 'utf8')
}));

const BARE = /\$\{\s*(reportCode|zoneId|guildId)\s*\}/g;
const GUARDED = /\bgql(String|Int)\(/g;

describe('GraphQL literals in the Edge Functions (#1013)', () => {
  it('reads the functions, so the checks below cannot pass over nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('never interpolates a report code, zone id or guild id bare into query text', () => {
    const bare = [];
    for (const { path, source } of files) {
      source.split(/\r?\n/).forEach((line, i) => {
        if (BARE.test(line)) bare.push(`${path}:${i + 1}`);
        BARE.lastIndex = 0;
      });
    }
    expect(bare).toEqual([]);
  });

  it('routes those values through the shared builders at more than zero sites', () => {
    // The module defines both names, so it is left out of the count.
    const guarded = files
      .filter(({ path }) => path !== 'supabase/functions/_shared/gql.ts')
      .reduce((n, { source }) => n + (source.match(GUARDED) || []).length, 0);
    expect(guarded).toBeGreaterThan(0);
  });
});
