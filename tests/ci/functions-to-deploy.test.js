import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOLD, importersOf, listFunctions, selectFunctions } from '../../scripts/ci/functions-to-deploy.js';

// The rule the `functions` job in deploy.yml applies to a push (#1083): a
// changed function deploys, a change under _shared/ deploys its importers, a
// config.toml change deploys everything, anything else deploys nothing, and
// a held name never deploys whatever the input. Pinned against a fixture
// tree so the cases do not move when the repo's own functions do, plus one
// pass over the real tree for the hold list.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let fixture;

function writeFile(rel, source) {
  const full = join(fixture, ...rel.split('/'));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, source);
}

function writeFunction(name, source) {
  writeFile(`supabase/functions/${name}/index.ts`, source);
}

// Two shared modules, one importing the other, and two importers, one of
// them importing from a subdirectory. The single-module, single-importer
// fixture this replaces could not tell "imports _shared" from "imports this
// module", which is the question the selector has to answer after #971.
beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), 'functions-to-deploy-'));
  writeFile('supabase/functions/_shared/gql.ts', 'export const x = 1;\n');
  writeFile('supabase/functions/_shared/discord.ts', "import { x } from './gql.ts';\nexport const post = x;\n");
  writeFunction('alpha', "import { x } from '../_shared/gql.ts';\nDeno.serve(() => new Response(String(x)));\n");
  writeFunction('beta', "import { send } from './lib/post.ts';\nDeno.serve(() => new Response(send()));\n");
  writeFile(
    'supabase/functions/beta/lib/post.ts',
    "import { post } from '../../_shared/discord.ts';\nexport const send = () => String(post);\n"
  );
  writeFunction('gamma', "Deno.serve(() => new Response('gamma'));\n");
  // The held name, present in the fixture so the hold can be seen removing it.
  writeFunction('discord-bot-webhook', "Deno.serve(() => new Response('relay'));\n");
  writeFileSync(join(fixture, 'supabase', 'config.toml'), 'project_id = "fixture"\n');
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe('listing the functions', () => {
  it('names every slug-shaped directory and never _shared', () => {
    expect(listFunctions(fixture)).toEqual(['alpha', 'beta', 'discord-bot-webhook', 'gamma']);
  });

  // #971: which functions a shared module reaches, not which functions
  // mention the string _shared/ in a top-level file.
  it('names the functions that import a shared module directly', () => {
    expect(importersOf('supabase/functions/_shared/discord.ts', fixture)).toEqual(['beta']);
  });

  it('follows a chain through another shared module', () => {
    expect(importersOf('supabase/functions/_shared/gql.ts', fixture)).toEqual(['alpha', 'beta']);
  });

  it('never names a function that imports a different shared module', () => {
    expect(importersOf('supabase/functions/_shared/discord.ts', fixture)).not.toContain('alpha');
    expect(importersOf('supabase/functions/_shared/gql.ts', fixture)).not.toContain('gamma');
  });
});

describe('selecting from a push', () => {
  const select = (changed) => selectFunctions({ changed, root: fixture });

  it('deploys the function a changed file belongs to, once', () => {
    const result = select(['supabase/functions/beta/index.ts', 'supabase/functions/beta/format.ts']);
    expect(result).toEqual({ deploy: ['beta'], held: [] });
  });

  it('deploys each changed function, sorted', () => {
    expect(select(['supabase/functions/gamma/index.ts', 'supabase/functions/beta/index.ts']).deploy).toEqual([
      'beta',
      'gamma'
    ]);
  });

  it('deploys only the importers when a shared file changes', () => {
    expect(select(['supabase/functions/_shared/gql.ts']).deploy).toEqual(['alpha', 'beta']);
  });

  // The nested import is the half readdirSync could not see (#1126 defect 4).
  it('deploys the importers of the module that changed, not every _shared/ importer', () => {
    expect(select(['supabase/functions/_shared/discord.ts']).deploy).toEqual(['beta']);
  });

  it('deploys everything not held when config.toml changes', () => {
    expect(select(['supabase/config.toml'])).toEqual({
      deploy: ['alpha', 'beta', 'gamma'],
      held: [{ name: 'discord-bot-webhook', reason: HOLD[0].reason }]
    });
  });

  it('deploys nothing for paths outside the functions', () => {
    const changed = [
      'supabase/functions/.env.example',
      'deno.jsonc',
      'tests/edge/wcl-sync/handler.test.ts',
      'supabase/migrations/20260912000000_x.sql',
      'js/common.js'
    ];
    expect(select(changed)).toEqual({ deploy: [], held: [] });
  });

  it('ignores a changed path whose function directory no longer exists', () => {
    expect(select(['supabase/functions/retired/index.ts'])).toEqual({ deploy: [], held: [] });
  });

  it('removes a held function from a push that changed it, and says so', () => {
    expect(select(['supabase/functions/discord-bot-webhook/index.ts'])).toEqual({
      deploy: [],
      held: [{ name: 'discord-bot-webhook', reason: HOLD[0].reason }]
    });
  });

  it('never names _shared itself', () => {
    expect(select(['supabase/functions/_shared/gql.ts']).deploy).not.toContain('_shared');
  });
});

describe('selecting by name for a workflow_dispatch', () => {
  it('"all" is every function not held', () => {
    expect(selectFunctions({ names: 'all', root: fixture })).toEqual({
      deploy: ['alpha', 'beta', 'gamma'],
      held: [{ name: 'discord-bot-webhook', reason: HOLD[0].reason }]
    });
  });

  it('a list is those functions, sorted, with a held one reported', () => {
    expect(selectFunctions({ names: ['gamma', 'alpha', 'discord-bot-webhook'], root: fixture })).toEqual({
      deploy: ['alpha', 'gamma'],
      held: [{ name: 'discord-bot-webhook', reason: HOLD[0].reason }]
    });
  });

  it('a name that is not a function is an error, not a silent skip', () => {
    expect(() => selectFunctions({ names: ['alpha', 'nope'], root: fixture })).toThrow('Unknown function: nope');
  });

  it('names win over changed paths when both are given', () => {
    expect(selectFunctions({ names: ['beta'], changed: ['supabase/config.toml'], root: fixture }).deploy).toEqual([
      'beta'
    ]);
  });
});

describe('the hold list against the real tree', () => {
  it('names only functions that exist, each with a reason', () => {
    const real = listFunctions(ROOT);
    expect(real.length).toBeGreaterThan(0);
    for (const held of HOLD) {
      expect(real).toContain(held.name);
      expect(held.reason).toMatch(/#\d+/);
    }
  });
});
