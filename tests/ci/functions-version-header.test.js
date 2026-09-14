import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLD, listFunctions, listFunctionSources } from '../../scripts/ci/functions-to-deploy.js';
import { stampFunctionVersion } from '../../scripts/ci/stamp-version.js';

// Every function answers its own version (#971). Two halves have to hold
// together for the deploy's read-back to mean anything: the file the stamper
// writes has to be there in the shape the stamper can rewrite, and the header
// has to be on the responses. Neither is visible from the other end, so this
// pins both from the tree.
//
// Keyed on HOLD rather than on a list: discord-bot-webhook never deploys while
// the hold stands, so a version for it would be a manifest entry production
// does not run. When #959 deletes the hold entry these cases start demanding
// its file and its header, which is the point of reading the hold rather than
// naming the exception here.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const held = new Set(HOLD.map((entry) => entry.name));
const deployed = listFunctions(ROOT).filter((name) => !held.has(name));
const sources = listFunctionSources(ROOT);

/** The `const CORS_HEADERS = { ... }` literal in a function's own sources. */
function corsLiteral(name) {
  const own = sources.filter(({ path }) => path.startsWith(`supabase/functions/${name}/`));
  for (const { source } of own) {
    const at = source.indexOf('const CORS_HEADERS = {');
    if (at < 0) continue;
    const open = source.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) return source.slice(open, i + 1);
      }
    }
  }
  return null;
}

describe('every deployed function carries a version (#971)', () => {
  it('reads the functions, so the checks below cannot pass over nothing', () => {
    expect(deployed.length).toBeGreaterThan(0);
    expect(sources.length).toBeGreaterThan(0);
  });

  it('has a version.ts the stamper can rewrite', () => {
    const missing = [];
    const unstampable = [];
    for (const name of deployed) {
      const path = join(ROOT, 'supabase', 'functions', name, 'version.ts');
      if (!existsSync(path)) {
        missing.push(name);
        continue;
      }
      const source = readFileSync(path, 'utf8');
      try {
        expect(stampFunctionVersion(source, '9.9.9')).toContain("export const VERSION = '9.9.9';");
      } catch {
        unstampable.push(name);
      }
    }
    expect(missing).toEqual([]);
    expect(unstampable).toEqual([]);
  });

  // A held function must not carry one: readStampedFunctions keys the manifest
  // on this file existing, so the entry would claim a version nothing serves.
  it('does not give a held function a version.ts', () => {
    const wrong = [...held].filter((name) => existsSync(join(ROOT, 'supabase', 'functions', name, 'version.ts')));
    expect(wrong).toEqual([]);
  });

  it('sets X-WGA-Version on CORS_HEADERS from that file', () => {
    const problems = [];
    for (const name of deployed) {
      const literal = corsLiteral(name);
      if (!literal) {
        problems.push(`${name}: no CORS_HEADERS literal found`);
        continue;
      }
      if (!/'X-WGA-Version':\s*VERSION\b/.test(literal))
        problems.push(`${name}: CORS_HEADERS does not set X-WGA-Version`);
      if (!/'Access-Control-Expose-Headers':\s*'X-WGA-Version'/.test(literal)) {
        problems.push(`${name}: CORS_HEADERS does not expose X-WGA-Version`);
      }
    }
    expect(problems).toEqual([]);
  });

  // The deploy compares the header against version.json, so the two have to
  // agree here first. This is also what says the stamp actually ran: a
  // hand-edited or unstamped file shows up as a mismatch rather than as a
  // green PR that fails the read-back after it has merged.
  it('carries the version the manifest claims for it', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'version.json'), 'utf8'));
    const entries = manifest.pieces?.functions ?? {};
    const problems = [];
    for (const name of deployed) {
      const path = join(ROOT, 'supabase', 'functions', name, 'version.ts');
      if (!existsSync(path)) continue;
      const stamped = readFileSync(path, 'utf8').match(/export const VERSION = '([^']*)';/)?.[1];
      if (stamped !== entries[name]) {
        problems.push(`${name}: version.ts says ${stamped}, the manifest says ${entries[name] ?? 'nothing'}`);
      }
    }
    expect(problems).toEqual([]);
  });

  // The header is only that function's version if it comes from that
  // function's own file. An import from anywhere else would still pass the
  // case above and report somebody else's number.
  it('imports VERSION from its own version.ts, in the file that builds the headers', () => {
    const problems = [];
    for (const name of deployed) {
      const own = sources.filter(({ path }) => path.startsWith(`supabase/functions/${name}/`));
      const builder = own.find(({ source }) => source.includes('const CORS_HEADERS = {'));
      if (!builder) {
        problems.push(`${name}: no file builds CORS_HEADERS`);
        continue;
      }
      if (!/import\s*\{\s*VERSION\s*\}\s*from\s*'\.\/version\.ts'/.test(builder.source)) {
        problems.push(`${name}: ${builder.path} does not import VERSION from './version.ts'`);
      }
    }
    expect(problems).toEqual([]);
  });
});
