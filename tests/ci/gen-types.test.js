// Unit tests for scripts/ci/gen-types.js (#1181): the generator command, the
// output validation that stands between the generator and the tracked file,
// and the staleness comparison. The generator itself runs in the Schema docs
// workflow against the migrations it builds.
import { describe, it, expect } from 'vitest';
import {
  IMAGE,
  compare,
  countTables,
  generatorArgs,
  normalise,
  parseArgs,
  readProjectId,
  stabilise,
  validate
} from '../../scripts/ci/gen-types.js';

const table = (name) => `      ${name}: {\n        Row: {\n          id: number\n        }\n      }\n`;
const file = (...names) =>
  `export type Json = string\n\nexport type Database = {\n  public: {\n    Tables: {\n${names.map(table).join('')}    }\n    Views: {\n    }\n  }\n}\n`;

describe('generatorArgs', () => {
  it('runs the pinned pg-meta image on the local stack network, typescript over public only', () => {
    const args = generatorArgs('WGA-Raid-Hub');
    expect(args.slice(0, 4)).toEqual(['run', '--rm', '--network', 'supabase_network_WGA-Raid-Hub']);
    expect(args).toContain('PG_META_DB_URL=postgresql://postgres:postgres@supabase_db_WGA-Raid-Hub:5432/postgres');
    expect(args).toContain('PG_META_GENERATE_TYPES=typescript');
    expect(args).toContain('PG_META_GENERATE_TYPES_INCLUDED_SCHEMAS=public');
    expect(args).toContain('PG_META_GENERATE_TYPES_DETECT_ONE_TO_ONE_RELATIONSHIPS=true');
    expect(args.slice(-3)).toEqual([IMAGE, 'node', 'dist/server/server.js']);
    expect(IMAGE).toMatch(/^public\.ecr\.aws\/supabase\/postgres-meta:v\d+\.\d+\.\d+$/);
  });
});

describe('readProjectId', () => {
  it('reads project_id from config.toml', () => {
    expect(readProjectId('# comment\nproject_id = "WGA-Raid-Hub"\n\n[api]\n')).toBe('WGA-Raid-Hub');
  });

  it('refuses a config with no project_id rather than guessing a network name', () => {
    expect(() => readProjectId('[api]\nport = 54321\n')).toThrow(/project_id/);
  });
});

describe('parseArgs', () => {
  it('reads the two flags', () => {
    expect(parseArgs([])).toEqual({ check: false, allowFewer: false });
    expect(parseArgs(['--check'])).toEqual({ check: true, allowFewer: false });
    expect(parseArgs(['--allow-fewer-tables'])).toEqual({ check: false, allowFewer: true });
  });

  it('refuses anything else, so a mistyped --check cannot become a write', () => {
    expect(() => parseArgs(['--chekc'])).toThrow(/unknown argument --chekc/);
    expect(() => parseArgs(['--help'])).toThrow(/usage/);
  });
});

describe('normalise', () => {
  it('strips carriage returns so a Windows-generated file compares equal to the LF one committed', () => {
    expect(normalise('a\r\nb\r\n')).toBe('a\nb\n');
  });
});

const rel = (key, columns, relation = 'items', referenced = '["id"]') =>
  `          {\n            foreignKeyName: "${key}"\n            columns: ["${columns}"]\n            isOneToOne: false\n            referencedRelation: "${relation}"\n            referencedColumns: ${referenced}\n          },\n`;
const block = (...entries) => `        Relationships: [\n${entries.join('')}        ]\n`;
const around = (inner) => `      priority_order: {\n        Row: {\n          id: number\n        }\n${inner}      }\n`;

describe('stabilise', () => {
  it('orders two relationships on one foreign key by their columns, which the generator leaves to the catalog', () => {
    const unstable = around(
      block(rel('priority_order_item_id_fkey', 'other_item_id'), rel('priority_order_item_id_fkey', 'item_id'))
    );
    const stable = around(
      block(rel('priority_order_item_id_fkey', 'item_id'), rel('priority_order_item_id_fkey', 'other_item_id'))
    );
    expect(stabilise(unstable)).toBe(stable);
  });

  it('keeps the generator order where the keys already differ, and leaves everything else alone', () => {
    const text = around(
      block(
        rel('priority_order_item_id_fkey', 'item_id'),
        rel('priority_order_player_id_fkey', 'player_id', 'players'),
        rel('priority_order_player_id_fkey', 'player_id', 'priority_order_gaps', '["player_id"]')
      )
    );
    expect(stabilise(text)).toBe(text);
    expect(stabilise(around('        Relationships: []\n'))).toBe(around('        Relationships: []\n'));
  });
});

describe('countTables', () => {
  it('counts the tables in the public schema and nothing else', () => {
    expect(countTables(file('players', 'teams'))).toBe(2);
    expect(countTables('')).toBe(0);
  });
});

describe('validate', () => {
  it('accepts a well-formed output with at least as many tables as the committed file', () => {
    expect(validate(file('players', 'teams'), 2)).toEqual({ ok: true });
    expect(validate(file('players', 'teams', 'items'), 2)).toEqual({ ok: true });
  });

  it('refuses an empty output', () => {
    expect(validate('', 2).ok).toBe(false);
  });

  it('refuses the error JSON the CLI once wrote over the tracked file', () => {
    const result = validate('{"_tag":"Error","message":"toomanyrequests: Rate exceeded"}\n', 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/export type Json/);
  });

  it('refuses an output with fewer tables than the floor, and names the way through for a real drop', () => {
    const result = validate(file('players'), 2);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/1 table where the committed file has 2/);
    expect(result.reason).toMatch(/--allow-fewer-tables/);
  });

  it('applies no floor when none is given, so a check and an allowed drop still refuse an empty schema only', () => {
    expect(validate(file('players'))).toEqual({ ok: true });
    expect(validate(file('players'), 0)).toEqual({ ok: true });
    const empty = validate(file(), 0);
    expect(empty.ok).toBe(false);
    expect(empty.reason).toMatch(/no tables/);
  });
});

describe('compare', () => {
  it('reports an identical file as up to date', () => {
    expect(compare(file('players'), file('players'))).toEqual({ stale: false, added: 0, removed: 0 });
  });

  it('reports the lines a regeneration would add and remove', () => {
    const result = compare(file('players', 'teams'), file('players'));
    expect(result.stale).toBe(true);
    expect(result.added).toBe(5);
    expect(result.removed).toBe(0);
  });

  it('treats a missing committed file as wholly stale', () => {
    const result = compare(file('players'), '');
    expect(result.stale).toBe(true);
    expect(result.removed).toBe(0);
  });
});
