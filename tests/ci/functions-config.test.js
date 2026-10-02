import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Five Edge Functions take no signed-in caller and are deployed with Supabase's
// JWT gate off (#958). `supabase functions deploy` with no name deploys every
// function and reads verify_jwt from supabase/config.toml, so with no
// [functions.*] block there a bare deploy turns the gate back on for all five
// and every cron curl and relay call starts answering 401.
//
// The block is the fix; this keeps it honest. A [functions.<name>] table whose
// name is misspelt applies to nothing and reads as correct, which is the same
// silent miss the block exists to prevent. The five are pinned here rather than
// read from each function's header comment, which narrowed the check to two
// when three headers were reworded (#1128). A function joins or leaves the list
// by an edit here and in config.toml together.

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

// The functions deployed with the gate off, each checking its own caller (a
// cron secret, the bot's webhook secret, a forwarded JWT) instead.
const GATE_OFF = [
  'blizzard-gear-sync',
  'discord-bot-webhook',
  'optional-rsvp-reminders',
  'twitch-live-check',
  'wcl-progression-sync'
];

// A directory is a function only when its name fits the CLI's slug rule; a
// leading underscore (supabase/functions/_shared/) is shared code the CLI
// neither serves nor deploys.
const FUNCTION_SLUG = /^[A-Za-z][A-Za-z0-9_-]*$/;

const functionDirs = readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && FUNCTION_SLUG.test(entry.name))
  .map((entry) => entry.name);

describe('config.toml [functions.*] deploy flags (#958)', () => {
  it('declares at least one function, so the checks below cannot pass vacuously', () => {
    expect(tables.size).toBeGreaterThan(0);
  });

  it('names only functions that exist', () => {
    const unknown = [...tables.keys()].filter((name) => !functionDirs.includes(name));
    expect(unknown).toEqual([]);
  });

  it('turns verify_jwt off for exactly the functions pinned above (#1128)', () => {
    const off = [...tables]
      .filter(([, table]) => table.verify_jwt === 'false')
      .map(([name]) => name)
      .sort();
    expect(off).toEqual(GATE_OFF);
  });
});
