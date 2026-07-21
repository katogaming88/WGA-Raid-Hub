import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  isFrontendPath,
  isBackendPath,
  commonJsIsFunctional,
  hasVersionBump,
  changelogSections,
  classify
} from '../../scripts/ci/changelog-check.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ci', 'changelog-check.js');

// Real unified diffs beat hand-crafted hunks: git diff --no-index exits 1
// when the files differ, so the output rides on the error object.
function makeDiff(dir, oldText, newText) {
  const a = join(dir, 'a.txt');
  const b = join(dir, 'b.txt');
  writeFileSync(a, oldText);
  writeFileSync(b, newText);
  try {
    return execFileSync('git', ['diff', '--no-index', '--', a, b], { encoding: 'utf8' });
  } catch (err) {
    return err.stdout;
  }
}

describe('path classification', () => {
  it('counts js/, gs/, css/, and root pages as frontend', () => {
    expect(isFrontendPath('js/index.js')).toBe(true);
    expect(isFrontendPath('gs/include.html')).toBe(true);
    expect(isFrontendPath('css/styles.css')).toBe(true);
    expect(isFrontendPath('index.html')).toBe(true);
    expect(isFrontendPath('officer.html')).toBe(true);
  });

  it('excludes js/common.js from the path rule (its diff decides instead)', () => {
    expect(isFrontendPath('js/common.js')).toBe(false);
  });

  it('does not count docs, tests, or nested html outside js/gs', () => {
    expect(isFrontendPath('docs/RLS.md')).toBe(false);
    expect(isFrontendPath('tests/frontend/roster.test.js')).toBe(false);
    expect(isFrontendPath('dbdoc/players.html')).toBe(false);
  });

  it('counts migrations and import tooling as backend', () => {
    expect(isBackendPath('supabase/migrations/20260707221243_track_vocabulary.sql')).toBe(true);
    expect(isBackendPath('scripts/import/tables/players.js')).toBe(true);
  });

  it('does not count other scripts or supabase config as backend', () => {
    expect(isBackendPath('scripts/ci/changelog-check.js')).toBe(false);
    expect(isBackendPath('scripts/fetch-items.js')).toBe(false);
    expect(isBackendPath('supabase/config.toml')).toBe(false);
  });
});

describe('js/common.js diff classification', () => {
  const versionOnly = ["-var VERSION = '3.16.0';", "+var VERSION = '3.16.1';"].join('\n');
  const versionPlusLogic = [versionOnly, '+function newHelper() {}'].join('\n');

  it('a VERSION-only diff is not functional', () => {
    expect(commonJsIsFunctional(versionOnly)).toBe(false);
  });

  it('a diff beyond the VERSION line is functional', () => {
    expect(commonJsIsFunctional(versionPlusLogic)).toBe(true);
    expect(commonJsIsFunctional('+// a comment counts too')).toBe(true);
  });

  it('detects the bump either way', () => {
    expect(hasVersionBump(versionOnly)).toBe(true);
    expect(hasVersionBump('+function newHelper() {}')).toBe(false);
  });
});

describe('changelogSections', () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'changelog-diff-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const base = ['# Changelog', '', '---', '', '## [3.15.0] - 2026-07-01', '', '### Changed', '- Old entry', ''].join(
    '\n'
  );

  it('sees a new version block with both sections', () => {
    const next = [
      '# Changelog',
      '',
      '---',
      '',
      '## [3.16.0] - 2026-07-07',
      '',
      '### Frontend',
      '- New page behavior',
      '',
      '### Backend',
      '- New importer behavior',
      '',
      '---',
      '',
      '## [3.15.0] - 2026-07-01',
      '',
      '### Changed',
      '- Old entry',
      ''
    ].join('\n');
    const sections = changelogSections(makeDiff(dir, base, next), next);
    expect(sections).toEqual({ frontend: true, backend: true });
  });

  it('sees a bullet appended to an existing Backend section', () => {
    const withBackend = base.replace('### Changed', '### Backend');
    const next = withBackend.replace('- Old entry', '- Old entry\n- Second backend entry');
    const sections = changelogSections(makeDiff(dir, withBackend, next), next);
    expect(sections).toEqual({ frontend: false, backend: true });
  });

  it('ignores entries under the pre-#353 headings', () => {
    const next = base.replace('- Old entry', '- Old entry\n- Another entry under Changed');
    const sections = changelogSections(makeDiff(dir, base, next), next);
    expect(sections).toEqual({ frontend: false, backend: false });
  });

  it('a bare heading with no content does not count', () => {
    const next = base.replace('### Changed', '### Frontend\n\n### Changed');
    const sections = changelogSections(makeDiff(dir, base, next), next);
    expect(sections).toEqual({ frontend: false, backend: false });
  });

  it('separators and blank lines do not count as content', () => {
    const withBackend = base.replace('### Changed', '### Backend');
    const next = withBackend.replace('- Old entry\n', '- Old entry\n\n---\n');
    const sections = changelogSections(makeDiff(dir, withBackend, next), next);
    expect(sections).toEqual({ frontend: false, backend: false });
  });
});

// End-to-end: real repos, real branches, the script invoked the way the
// workflow invokes it.
describe('classify against a git repo', () => {
  let repo;

  function git(...args) {
    return execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  }

  function write(relPath, content) {
    const abs = join(repo, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  const baseChangelog = [
    '# Changelog',
    '',
    '---',
    '',
    '## [3.16.0] - 2026-07-07',
    '',
    '### Frontend',
    '- Roster reads from Supabase',
    '',
    '### Backend',
    '- Roster re-imports reconcile',
    ''
  ].join('\n');

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'changelog-repo-'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write('js/common.js', "var VERSION = '3.16.0';\nvar WEB_APP_URL = 'x';\n");
    write('CHANGELOG.md', baseChangelog);
    write('scripts/import/generate.js', '// generator\n');
    write('index.html', '<html></html>\n');
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
    const out = execFileSync('node', [SCRIPT, 'main'], { cwd: repo, encoding: 'utf8' });
    return Object.fromEntries(
      out
        .trim()
        .split('\n')
        .map((line) => line.split('='))
    );
  }

  it('backend-only PR with a Backend entry', () => {
    const result = onBranch('backend-only', () => {
      write('scripts/import/generate.js', '// generator v2\n');
      write(
        'CHANGELOG.md',
        baseChangelog.replace(
          '- Roster re-imports reconcile',
          '- Roster re-imports reconcile\n- Importer handles renames'
        )
      );
    });
    expect(result).toEqual({
      frontend: 'false',
      backend: 'true',
      version_bump: 'false',
      frontend_entry: 'false',
      backend_entry: 'true',
      news_touched: 'false'
    });
  });

  it('a VERSION-only bump is not a frontend change (the #353 circularity)', () => {
    const result = onBranch('bump-only', () => {
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
    });
    expect(result).toEqual({
      frontend: 'false',
      backend: 'false',
      version_bump: 'true',
      frontend_entry: 'false',
      backend_entry: 'false',
      news_touched: 'false'
    });
  });

  it('a frontend PR done right passes every axis', () => {
    const result = onBranch('frontend-full', () => {
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\nfunction newHelper() {}\n");
      write(
        'CHANGELOG.md',
        baseChangelog.replace(
          '## [3.16.0] - 2026-07-07',
          '## [3.16.1] - 2026-07-08\n\n### Frontend\n- New helper behavior\n\n---\n\n## [3.16.0] - 2026-07-07'
        )
      );
      write('news.json', '[]\n');
    });
    expect(result).toEqual({
      frontend: 'true',
      backend: 'false',
      version_bump: 'true',
      frontend_entry: 'true',
      backend_entry: 'false',
      news_touched: 'true'
    });
  });

  it('a frontend PR with no news.json touch reports news_touched=false (#525)', () => {
    const result = onBranch('frontend-no-news', () => {
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\nfunction anotherHelper() {}\n");
      write(
        'CHANGELOG.md',
        baseChangelog.replace(
          '## [3.16.0] - 2026-07-07',
          '## [3.16.1] - 2026-07-08\n\n### Frontend\n- Another behavior\n\n---\n\n## [3.16.0] - 2026-07-07'
        )
      );
    });
    expect(result).toEqual({
      frontend: 'true',
      backend: 'false',
      version_bump: 'true',
      frontend_entry: 'true',
      backend_entry: 'false',
      news_touched: 'false'
    });
  });

  it('classify() is callable directly with a cwd', () => {
    git('checkout', 'backend-only');
    expect(classify('main', repo)).toEqual({
      frontend: false,
      backend: true,
      version_bump: false,
      frontend_entry: false,
      backend_entry: true,
      news_touched: false
    });
  });
});
