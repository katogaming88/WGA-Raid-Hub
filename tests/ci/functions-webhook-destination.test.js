import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFunctionSources } from '../../scripts/ci/functions-to-deploy.js';
import { DESTINATIONS, PRODUCTION_HOST, TEST_WEBHOOK } from '../../supabase/functions/_shared/discord-destination.ts';

// Where a Discord post goes is decided in one place (#1081):
// supabase/functions/_shared/discord-destination.ts reads the platform's
// SUPABASE_URL and the poster's env chain, and a poster names a registry key.
// The Deno tests pin the resolver; nothing there can see the call sites, and
// the rule only holds while the webhook names live in that one file. This is
// the pin for the sites, and for the one constant the rule turns on.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODULE = 'supabase/functions/_shared/discord-destination.ts';

const files = listFunctionSources(ROOT);
const outside = files.filter(({ path }) => path !== MODULE);

// Every name the resolver reads, taken from the registry so a new chain is
// policed the day it is added.
const WEBHOOK_NAMES = [...new Set([...Object.values(DESTINATIONS).flat(), TEST_WEBHOOK])];

const RESOLVE_CALL = /resolveDestination\(([^)]*)\)/g;
const KEY_ARG = /destination:\s*['"]([a-z-]+)['"]/;

describe('Discord destinations resolve through the shared module (#1081)', () => {
  it('reads the functions, so the checks below cannot pass over nothing', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(WEBHOOK_NAMES.length).toBeGreaterThan(0);
  });

  it('no webhook name appears anywhere in a function outside the module', () => {
    const hits = [];
    for (const { path, source } of outside) {
      source.split(/\r?\n/).forEach((line, i) => {
        for (const name of WEBHOOK_NAMES) {
          if (line.includes(name)) hits.push(`${path}:${i + 1} ${name}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('every resolve names a key the registry holds, and every key is named somewhere', () => {
    const named = [];
    const bad = [];
    for (const { path, source } of outside) {
      for (const match of source.matchAll(RESOLVE_CALL)) {
        const key = match[1].match(KEY_ARG);
        if (!key || !Object.hasOwn(DESTINATIONS, key[1])) bad.push(`${path}: resolveDestination(${match[1].trim()})`);
        else named.push(key[1]);
      }
    }
    expect(bad).toEqual([]);
    expect(named.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(named)].sort()).toEqual(Object.keys(DESTINATIONS).sort());
  });

  // deploy-workflow.test.js already pins deploy.yml's PROJECT_REF against the
  // same literal, so one pin here closes the triangle.
  it('PRODUCTION_HOST is the host js/common.js publishes', () => {
    const common = readFileSync(join(ROOT, 'js', 'common.js'), 'utf8');
    const published = common.match(/'https:\/\/([a-z0-9]+\.supabase\.co)'/);
    expect(published?.[1]).toBe(PRODUCTION_HOST);
  });
});
