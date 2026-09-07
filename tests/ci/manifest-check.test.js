import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkManifest } from '../../scripts/ci/manifest-check.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ci', 'manifest-check.js');

// The stamp computes the pieces map from the paths the branch changed, on the
// author's machine, against whatever their origin/main happened to be. Nothing
// re-derived it afterwards: tests/ci/asset-version-check.test.js reads the
// manifest against the tree it ships with and cannot see the diff, so a piece
// marked as moving when it did not, or a stale local base, reached main
// unchallenged (#967 shipped without this half). This is that check, run
// against the PR's real merge base.
describe('checkManifest', () => {
  let repo;

  function git(...args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  }

  function write(rel, text) {
    const full = join(repo, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }

  function manifest(version, pieces) {
    return JSON.stringify({ version, pieces }, null, 2) + '\n';
  }

  function page(version) {
    return [
      '<html><head>',
      `<link rel="stylesheet" href="css/styles.css?v=${version}">`,
      '</head><body>',
      '<h1>Roster</h1>',
      `<footer>v<span id="versionNum">${version}</span></footer>`,
      '</body></html>',
      ''
    ].join('\n');
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'manifest-repo-'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write('js/common.js', "var VERSION = '3.16.0';\n");
    write('index.html', page('3.16.0'));
    write('supabase/migrations/20260101000000_base.sql', 'select 1;\n');
    write('version.json', manifest('3.16.0', { frontend: '3.16.0', functions: {} }));
    git('add', '.');
    git('commit', '-m', 'base');
  });

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
  });

  function onBranch(name, mutate) {
    git('checkout', '-b', name, 'main');
    mutate();
    git('add', '.');
    git('commit', '-m', name);
    return checkManifest('main', repo);
  }

  // A PR that ships nothing writes no manifest, and then there is nothing to
  // re-derive. This is the chore case, and it is why the check needs no chore
  // exemption of its own: an unchanged manifest is always correct.
  it('passes when the manifest did not change', () => {
    const result = onBranch('docs-only', () => {
      write('docs/RLS.md', '# policies\n');
    });
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it('passes when a db release marks the db piece and leaves the rest alone', () => {
    const result = onBranch('db-release', () => {
      write('supabase/migrations/20260907120000_add_column.sql', 'alter table players add column x int;\n');
      write('js/common.js', "var VERSION = '3.17.0';\n");
      write('index.html', page('3.17.0'));
      write('version.json', manifest('3.17.0', { frontend: '3.16.0', db: '3.17.0', functions: {} }));
    });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  // The failure the stamp cannot detect on its own: a stale local origin/main
  // makes the diff look wider than it is, and the frontend gets the new number
  // for a release that never touched it.
  it('fails when an untouched piece was moved to the new version', () => {
    const result = onBranch('frontend-overmarked', () => {
      write('supabase/migrations/20260907130000_add_index.sql', 'create index on players (id);\n');
      write('js/common.js', "var VERSION = '3.18.0';\n");
      write('index.html', page('3.18.0'));
      write('version.json', manifest('3.18.0', { frontend: '3.18.0', db: '3.18.0', functions: {} }));
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('frontend');
  });

  it('fails when a piece that shipped was left at its old version', () => {
    const result = onBranch('db-undermarked', () => {
      write('supabase/migrations/20260907140000_add_view.sql', 'create view v as select 1;\n');
      write('js/common.js', "var VERSION = '3.19.0';\n");
      write('index.html', page('3.19.0'));
      write('version.json', manifest('3.19.0', { frontend: '3.16.0', functions: {} }));
    });
    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('db');
  });

  // The whole reason the frontend case above is not simply "the pages changed":
  // a real frontend release restamps the same tags AND edits the markup, and
  // then the frontend piece has to move.
  it('passes when the frontend really changed and carries the new version', () => {
    const result = onBranch('frontend-release', () => {
      write('js/roster.js', '// roster v2\n');
      write('js/common.js', "var VERSION = '3.20.0';\n");
      write('index.html', page('3.20.0').replace('<h1>Roster</h1>', '<h1>The Roster</h1>'));
      write('version.json', manifest('3.20.0', { frontend: '3.20.0', functions: {} }));
    });
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('exits non-zero from the CLI when the manifest disagrees', () => {
    git('checkout', 'frontend-overmarked');
    let code = 0;
    try {
      execFileSync('node', [SCRIPT, 'main'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' });
    } catch (err) {
      code = err.status;
    }
    expect(code).toBe(1);
  });

  it('exits zero from the CLI when the manifest agrees', () => {
    git('checkout', 'db-release');
    const out = execFileSync('node', [SCRIPT, 'main'], { cwd: repo, encoding: 'utf8' });
    expect(out).toContain('db');
  });
});
