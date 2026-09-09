import { describe, it, expect } from 'vitest';
import { findAutocommitQueries, checkFiles, listRlsFiles } from '../../scripts/ci/rls-no-autocommit-check.js';

// The guard behind the #1021 defect class: a fixture written with autocommit
// pool.query is visible to every other worker in the suite until its cleanup
// lands, so an unrelated file fails at random and the table is clean by the
// time anyone looks.

describe('findAutocommitQueries', () => {
  it('flags a bare pool.query', () => {
    const src = `
      await pool.query("insert into public.raid_schedule (team_id, weekday) values (1, 4)");
    `;
    const found = findAutocommitQueries(src);
    expect(found).toHaveLength(1);
    expect(found[0].line).toBe(2);
  });

  it('passes a call that declares why it does not write', () => {
    const src = `
      // rls-pool-read-only: reads pg_proc, writes nothing.
      const { rows } = await pool.query('select proname from pg_proc');
    `;
    expect(findAutocommitQueries(src)).toEqual([]);
  });

  it('passes a call annotated on the same line', () => {
    const src = `
      const { rows } = await pool.query('select 1'); // rls-pool-read-only: catalog read.
    `;
    expect(findAutocommitQueries(src)).toEqual([]);
  });

  it('does not let one annotation cover a second call further down', () => {
    const src = `
      // rls-pool-read-only: catalog read.
      await pool.query('select proname from pg_proc');
      const a = 1;
      const b = 2;
      const c = 3;
      const d = 4;
      await pool.query("insert into public.raid_schedule (team_id) values (1)");
    `;
    expect(findAutocommitQueries(src)).toHaveLength(1);
  });

  it('ignores the same call shape written inside a comment or a string', () => {
    const src = `
      // await pool.query('insert into public.raid_schedule values (1)');
      const doc = "await pool.query('insert into public.raid_schedule values (1)')";
    `;
    expect(findAutocommitQueries(src)).toEqual([]);
  });

  it('ignores a query on a transaction client, which is what the harness hands out', () => {
    const src = `
      const client = await pool.connect();
      await client.query('begin');
      await q("insert into public.raid_schedule (team_id) values (1)");
      await client.query('rollback');
    `;
    expect(findAutocommitQueries(src)).toEqual([]);
  });

  it('reports each call once and in line order', () => {
    const src = `
      await pool.query('insert into a values (1)');
      await pool.query('insert into b values (2)');
    `;
    const found = findAutocommitQueries(src);
    expect(found).toHaveLength(2);
    expect(found[0].line).toBeLessThan(found[1].line);
  });

  it('names the file it could not parse rather than failing opaquely', () => {
    expect(() => findAutocommitQueries('function (', 'broken.js')).toThrow(/broken\.js/);
  });

  it('parses a test file as a module, since every file in the suite imports', () => {
    const src = `
      import { pool } from './helpers.js';
      await pool.query('insert into a values (1)');
    `;
    expect(findAutocommitQueries(src)).toHaveLength(1);
  });
});

describe('the suite itself', () => {
  // The point of the guard. If this fails, a fixture landed on autocommit and
  // the next flake is already in the suite.
  it('has no unannotated pool.query in tests/rls/', () => {
    const files = listRlsFiles('tests/rls');
    // Without this the case passes on an empty walk, which is the failure it
    // exists to catch.
    expect(files.length).toBeGreaterThan(30);
    const findings = checkFiles(files);
    expect(findings.map((f) => f.file + ':' + f.line)).toEqual([]);
  });
});
