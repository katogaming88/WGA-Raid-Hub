import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Five Edge Functions take no signed-in caller and are deployed with Supabase's
// JWT gate off (#958). `supabase functions deploy` with no name deploys all ten
// and reads verify_jwt from supabase/config.toml, so with no [functions.*] block
// there a bare deploy turns the gate back on for all five and every cron curl
// and relay call starts answering 401.
//
// The block is the fix; this keeps it honest. A [functions.<name>] table whose
// name is misspelt applies to nothing and reads as correct, which is the same
// silent miss the block exists to prevent. The flag side is checked against each
// function's own header comment, which is where the requirement was recorded
// before there was a config block to hold it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');

// Bare-key TOML: section headers plus `key = value` lines, which is all this
// block uses. Anything outside a [functions.*] table is ignored.
function readFunctionTables(toml) {
  const tables = new Map();
  let current = null;
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      const fn = header[1].match(/^functions\.(.+)$/);
      current = fn ? fn[1].replace(/^"|"$/g, '') : null;
      if (current) tables.set(current, {});
      continue;
    }
    if (!current || line === '' || line.startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*=\s*(\S+)/);
    if (kv) tables.get(current)[kv[1]] = kv[2];
  }
  return tables;
}

const tables = readFunctionTables(readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8'));

const functionDirs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

// Only the leading comment block counts. The flag is named in a file's opening
// lines, and two headers also name another function's verify_jwt in passing, so
// a whole-file search would read those as claims about the wrong function.
const headerNamesTheFlag = functionDirs.filter((name) => {
  const source = readFileSync(join(FUNCTIONS_DIR, name, 'index.ts'), 'utf8');
  return source.split(/\r?\n/).slice(0, 40).join('\n').includes('--no-verify-jwt');
});

describe('config.toml [functions.*] deploy flags (#958)', () => {
  it('declares at least one function, so the checks below cannot pass vacuously', () => {
    expect(tables.size).toBeGreaterThan(0);
  });

  it('names only functions that exist', () => {
    const unknown = [...tables.keys()].filter((name) => !functionDirs.includes(name));
    expect(unknown).toEqual([]);
  });

  it('turns verify_jwt off for every function whose header says to deploy without it', () => {
    expect(headerNamesTheFlag.length).toBeGreaterThan(0);
    const missing = headerNamesTheFlag.filter((name) => tables.get(name)?.verify_jwt !== 'false');
    expect(missing).toEqual([]);
  });
});
