import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESTINATIONS, PRODUCTION_HOST } from '../../supabase/functions/_shared/discord-destination.ts';

// Where a Discord post goes is decided in one place (#1081):
// supabase/functions/_shared/discord-destination.ts reads the platform's
// SUPABASE_URL and the poster's env chain, and a poster names a registry key.
// The Deno tests pin the resolver; nothing there can see the call sites, and
// the rule only holds while no poster reads a webhook name on its own. This
// is the pin for the sites, and for the one constant the rule turns on.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions');
const MODULE = 'supabase/functions/_shared/discord-destination.ts';

// The relay forwards to a bot process over its own protocol, not a Discord
// webhook, so it is outside the rule. #960 retires the variable; its
// re-audit deletes this entry.
const EXCEPTIONS = { 'supabase/functions/discord-bot-webhook/index.ts': ['BOT_WEBHOOK_URL'] };

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

// A literal env read of a webhook name: .get('X_WEBHOOK_URL') or the
// dashboard's hyphenated name.
const WEBHOOK_READ = /\.get\(\s*['"]([A-Za-z_-]+_WEBHOOK_URL|BOE-Found-Webhook)['"]\s*\)/g;
const RESOLVE_CALL = /resolveDestination\(([^)]*)\)/g;
const KEY_ARG = /destination:\s*['"]([a-z-]+)['"]/;

describe('Discord destinations resolve through the shared module (#1081)', () => {
  it('reads the functions, so the checks below cannot pass over nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no poster reads a webhook URL from env on its own', () => {
    const direct = [];
    for (const { path, source } of files) {
      if (path === MODULE) continue;
      source.split(/\r?\n/).forEach((line, i) => {
        for (const match of line.matchAll(WEBHOOK_READ)) {
          if ((EXCEPTIONS[path] || []).includes(match[1])) continue;
          direct.push(`${path}:${i + 1} ${match[1]}`);
        }
      });
    }
    expect(direct).toEqual([]);
  });

  it('every resolve names a key the registry holds, and every key is named somewhere', () => {
    const named = [];
    const bad = [];
    for (const { path, source } of files) {
      if (path === MODULE) continue;
      for (const match of source.matchAll(RESOLVE_CALL)) {
        const key = match[1].match(KEY_ARG);
        if (!key || !(key[1] in DESTINATIONS)) bad.push(`${path}: resolveDestination(${match[1].trim()})`);
        else named.push(key[1]);
      }
    }
    expect(bad).toEqual([]);
    expect(named.length).toBeGreaterThanOrEqual(3);
    expect([...new Set(named)].sort()).toEqual(Object.keys(DESTINATIONS).sort());
  });

  it('PRODUCTION_HOST is the host js/common.js publishes and the ref deploy.yml deploys to', () => {
    const common = readFileSync(join(ROOT, 'js', 'common.js'), 'utf8');
    const published = common.match(/'https:\/\/([a-z0-9]+\.supabase\.co)'/);
    expect(published?.[1]).toBe(PRODUCTION_HOST);
    const deploy = readFileSync(join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
    const ref = deploy.match(/^\s*PROJECT_REF:\s*([a-z0-9]+)\s*$/m);
    expect(`${ref?.[1]}.supabase.co`).toBe(PRODUCTION_HOST);
  });
});
