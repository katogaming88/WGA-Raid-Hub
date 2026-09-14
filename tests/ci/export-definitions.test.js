// Unit tests for scripts/ci/export-definitions.js (#1107): file text, file
// naming, and the staleness comparison. The database read itself runs in the
// Schema docs workflow against the migrations it builds.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderDefinition, planFiles, compare } from '../../scripts/ci/export-definitions.js';

const fn = (
  name,
  body = 'CREATE OR REPLACE FUNCTION public.f()\n RETURNS integer\nAS $function$ select 1 $function$\n'
) => ({
  kind: 'functions',
  name,
  body,
  access: 'anon, authenticated'
});

let dirs = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe('renderDefinition', () => {
  it('adds the generated-file header, the access line and a closing semicolon', () => {
    const text = renderDefinition(fn('f'));
    expect(text.split('\n').slice(0, 3)).toEqual([
      '-- Function public.f: current definition, generated from the database.',
      '-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).',
      '-- execute (site roles): anon, authenticated'
    ]);
    expect(text.endsWith('$function$;\n')).toBe(true);
  });

  it('does not double a semicolon a view definition already ends with', () => {
    const text = renderDefinition({
      kind: 'views',
      name: 'v',
      body: 'create or replace view public.v as\n SELECT 1;',
      access: ''
    });
    expect(text).toContain('-- select (site roles): none');
    expect(text.endsWith('SELECT 1;\n')).toBe(true);
  });

  it('normalises Windows line endings', () => {
    expect(renderDefinition(fn('f', 'a\r\nb\r\n'))).not.toContain('\r');
  });
});

describe('planFiles', () => {
  it('maps each definition to <kind>/<name>.sql', () => {
    const files = planFiles([fn('a'), { kind: 'views', name: 'v', body: 'x;', access: '' }]);
    expect([...files.keys()]).toEqual(['functions/a.sql', 'views/v.sql']);
  });

  it('refuses two definitions with the same name rather than overwriting one', () => {
    expect(() => planFiles([fn('a'), fn('a')])).toThrow(/overloaded/);
  });
});

describe('compare', () => {
  it('reports changed, missing and no-longer-present files', () => {
    const root = mkdtempSync(join(tmpdir(), 'defs-'));
    dirs.push(root);
    const planned = planFiles([fn('same'), fn('edited'), fn('added')]);
    mkdirSync(join(root, 'functions'));
    writeFileSync(join(root, 'functions', 'same.sql'), planned.get('functions/same.sql').replace(/\n/g, '\r\n'));
    writeFileSync(join(root, 'functions', 'edited.sql'), 'old text\n');
    writeFileSync(join(root, 'functions', 'dropped.sql'), 'gone\n');
    expect(compare(planned, root)).toEqual({
      changed: ['functions/edited.sql'],
      missing: ['functions/added.sql'],
      extra: ['functions/dropped.sql']
    });
  });

  it('treats a missing output directory as everything missing', () => {
    const root = mkdtempSync(join(tmpdir(), 'defs-'));
    dirs.push(root);
    expect(compare(planFiles([fn('a')]), join(root, 'nope')).missing).toEqual(['functions/a.sql']);
  });
});
