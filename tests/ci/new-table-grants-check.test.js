import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMigration, checkedFiles, CHECKED_AFTER } from '../../scripts/ci/new-table-grants-check.js';

// From 2026-10-30 Supabase stops granting the API roles on a new public table,
// so a migration that creates one has to grant its own access. These pin the
// shape that passes (team_raid_reports) against two older tables that leaned
// on default privileges and would fail today.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const read = (f) => readFileSync(join(MIGRATIONS, f), 'utf8');

const reasons = (sql) => checkMigration(sql).map((f) => `${f.table}: ${f.reason}`);

describe('checkMigration', () => {
  it('passes team_raid_reports, the shape to copy', () => {
    expect(reasons(read('20261007145043_team_raid_reports.sql'))).toEqual([]);
  });

  it('fails names and team_raid_kills, which leaned on default privileges', () => {
    expect(reasons(read('20261003232012_names_table.sql'))).toEqual([
      'names: has no revoke (start from nothing, then grant)',
      'names: grants no role any access'
    ]);
    expect(reasons(read('20261002181943_team_raid_kills.sql'))).toContain('team_raid_kills: grants no role any access');
  });

  it('reads multi-line statements, unqualified names, a grant naming several tables, and skips comments', () => {
    const sql = `-- create table public.ignored (id int);
      create table if not exists a (id int);
      create table public."b" (
        id int
      );
      revoke all
        on public.a, public.b
        from public, anon;
      grant select on a, public.b to anon;`;
    expect(reasons(sql)).toEqual([]);
  });

  it('leaves tables outside public and grants on functions alone', () => {
    const sql = `create table private.x (id int);
      create table public.y (id int);
      revoke all on table public.y from public;
      grant execute on function public.y() to anon;`;
    expect(reasons(sql)).toEqual(['y: grants no role any access']);
  });
});

describe('checkedFiles', () => {
  it('covers only migrations stamped after the cutoff', () => {
    expect(checkedFiles([`${CHECKED_AFTER}_last_old.sql`, '20261101090000_new.sql', 'README.md'])).toEqual([
      '20261101090000_new.sql'
    ]);
  });

  it('passes every migration in the repo that it covers', () => {
    const findings = checkedFiles(readdirSync(MIGRATIONS)).flatMap((f) => reasons(read(f)).map((r) => `${f}: ${r}`));
    expect(findings).toEqual([]);
  });
});
