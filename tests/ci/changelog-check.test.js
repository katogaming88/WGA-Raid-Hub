import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  isFrontendPath,
  isBackendPath,
  classifyPath,
  commonJsIsFunctional,
  hasVersionBump,
  compareVersions,
  addedHeadings,
  headingProblems,
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
  it('counts js/, css/, and root pages as frontend', () => {
    expect(isFrontendPath('js/index.js')).toBe(true);
    expect(isFrontendPath('css/styles.css')).toBe(true);
    expect(isFrontendPath('index.html')).toBe(true);
    expect(isFrontendPath('officer.html')).toBe(true);
  });

  // gs/ was the Apps Script era. kat deleted the directory in #912/#913 on
  // 2026-09-04, so the rule that reached into it is dead weight that would
  // silently re-classify anything recreated at that path (#966).
  it('no longer counts the retired gs/ directory as frontend', () => {
    expect(isFrontendPath('gs/include.html')).toBe(false);
    expect(classifyPath('gs/include.html')).toBe(null);
  });

  it('excludes js/common.js from the path rule (its diff decides instead)', () => {
    expect(isFrontendPath('js/common.js')).toBe(false);
  });

  it('does not count docs, tests, or nested html outside js/', () => {
    expect(isFrontendPath('docs/RLS.md')).toBe(false);
    expect(isFrontendPath('tests/frontend/roster.test.js')).toBe(false);
    expect(isFrontendPath('dbdoc/players.html')).toBe(false);
  });

  it('counts migrations and import tooling as the db class', () => {
    expect(isBackendPath('supabase/migrations/20260707221243_track_vocabulary.sql')).toBe(true);
    expect(isBackendPath('scripts/import/tables/players.js')).toBe(true);
    expect(classifyPath('supabase/migrations/20260707221243_track_vocabulary.sql')).toBe('db');
    expect(classifyPath('scripts/import/tables/players.js')).toBe('db');
  });

  it('counts supabase/functions/ as the functions class', () => {
    expect(classifyPath('supabase/functions/boe-webhook/index.ts')).toBe('functions');
    expect(classifyPath('supabase/functions/_shared/cors.ts')).toBe('functions');
  });

  it('counts bot/ as the bot class', () => {
    expect(classifyPath('bot/src/index.ts')).toBe('bot');
    expect(classifyPath('bot/package.json')).toBe('bot');
  });

  // Config and seed data are chore territory: they change how a piece is
  // deployed or seeded, not what it does for anyone (#966).
  it('leaves supabase config, seed and roles outside every shipped class', () => {
    expect(classifyPath('supabase/config.toml')).toBe(null);
    expect(classifyPath('supabase/seed.sql')).toBe(null);
    expect(classifyPath('supabase/roles.sql')).toBe(null);
    expect(isBackendPath('supabase/config.toml')).toBe(false);
  });

  it('does not count other scripts as any shipped class', () => {
    expect(classifyPath('scripts/ci/changelog-check.js')).toBe(null);
    expect(classifyPath('scripts/fetch-items.js')).toBe(null);
    expect(classifyPath('docs/RLS.md')).toBe(null);
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

describe('compareVersions', () => {
  it('orders by each field numerically, not as strings', () => {
    expect(compareVersions('3.9.0', '3.10.0')).toBeLessThan(0);
    expect(compareVersions('3.91.3', '3.91.10')).toBeLessThan(0);
    expect(compareVersions('4.0.0', '3.99.99')).toBeGreaterThan(0);
  });

  it('reports equality', () => {
    expect(compareVersions('3.91.3', '3.91.3')).toBe(0);
  });
});

describe('heading checks', () => {
  const base = [
    '# Changelog',
    '',
    '## [3.16.0] - 2026-07-07',
    '',
    '### Frontend',
    '- One',
    '',
    '## [3.15.0] - 2026-07-01',
    '',
    '### Frontend',
    '- Zero',
    ''
  ].join('\n');

  function withHeading(heading) {
    return base.replace('## [3.16.0] - 2026-07-07', `${heading}\n\n### Frontend\n- New\n\n## [3.16.0] - 2026-07-07`);
  }

  it('finds the heading a PR added', () => {
    expect(addedHeadings(base, withHeading('## [3.17.0] - 2026-07-08'))).toEqual(['3.17.0']);
  });

  it('finds nothing when the changelog gained no heading', () => {
    expect(addedHeadings(base, base.replace('- One', '- One\n- One and a half'))).toEqual([]);
    expect(headingProblems(base, base.replace('- One', '- One\n- One and a half'))).toEqual([]);
  });

  it('passes a heading above everything already there', () => {
    expect(headingProblems(base, withHeading('## [3.17.0] - 2026-07-08'))).toEqual([]);
  });

  it('refuses a heading that already exists', () => {
    const problems = headingProblems(base, withHeading('## [3.16.0] - 2026-07-08'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('3.16.0');
    expect(problems[0]).toMatch(/already/i);
  });

  it('refuses a heading at or below the newest one', () => {
    const problems = headingProblems(base, withHeading('## [3.15.5] - 2026-07-08'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('3.15.5');
    expect(problems[0]).toContain('3.16.0');
  });

  // The three collisions already on main (3.77.23, 3.60.32, 3.60.6) predate
  // this check. It looks only at what a PR adds, so history stays legal and
  // nothing has to be renumbered (#965).
  it('tolerates duplicates that were already in the base', () => {
    const dupBase = base.replace(
      '## [3.15.0] - 2026-07-01',
      '## [3.16.0] - 2026-07-02\n\n### Backend\n- Dup\n\n## [3.15.0] - 2026-07-01'
    );
    expect(headingProblems(dupBase, dupBase)).toEqual([]);
    const next = dupBase.replace(
      '## [3.16.0] - 2026-07-07',
      '## [3.17.0] - 2026-07-08\n\n### Frontend\n- New\n\n## [3.16.0] - 2026-07-07'
    );
    expect(headingProblems(dupBase, next)).toEqual([]);
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

  const none = { frontend: false, backend: false, functions: false, bot: false };

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
    expect(sections).toEqual({ ...none, frontend: true, backend: true });
  });

  it('sees the new Functions and Bot sections', () => {
    const next = [
      '# Changelog',
      '',
      '---',
      '',
      '## [3.16.0] - 2026-07-07',
      '',
      '### Functions',
      '- The found post reads the row',
      '',
      '### Bot',
      '- Every send names its mentions',
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
    expect(sections).toEqual({ ...none, functions: true, bot: true });
  });

  it('sees a bullet appended to an existing Backend section', () => {
    const withBackend = base.replace('### Changed', '### Backend');
    const next = withBackend.replace('- Old entry', '- Old entry\n- Second backend entry');
    const sections = changelogSections(makeDiff(dir, withBackend, next), next);
    expect(sections).toEqual({ ...none, backend: true });
  });

  it('ignores entries under the pre-#353 headings', () => {
    const next = base.replace('- Old entry', '- Old entry\n- Another entry under Changed');
    const sections = changelogSections(makeDiff(dir, base, next), next);
    expect(sections).toEqual(none);
  });

  it('a bare heading with no content does not count', () => {
    const next = base.replace('### Changed', '### Frontend\n\n### Changed');
    const sections = changelogSections(makeDiff(dir, base, next), next);
    expect(sections).toEqual(none);
  });

  it('separators and blank lines do not count as content', () => {
    const withBackend = base.replace('### Changed', '### Backend');
    const next = withBackend.replace('- Old entry\n', '- Old entry\n\n---\n');
    const sections = changelogSections(makeDiff(dir, withBackend, next), next);
    expect(sections).toEqual(none);
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

  // A new version block above the existing one, carrying whatever sections
  // the case under test needs.
  function bumpedChangelog(version, sections) {
    const body = Object.entries(sections)
      .map(([heading, entry]) => `### ${heading}\n${entry}\n`)
      .join('\n');
    return baseChangelog.replace(
      '## [3.16.0] - 2026-07-07',
      `## [${version}] - 2026-07-08\n\n${body}\n---\n\n## [3.16.0] - 2026-07-07`
    );
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'changelog-repo-'));
    git('init', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    write('js/common.js', "var VERSION = '3.16.0';\nvar WEB_APP_URL = 'x';\n");
    write('CHANGELOG.md', baseChangelog);
    write('scripts/import/generate.js', '// generator\n');
    write('supabase/functions/boe-webhook/index.ts', '// found post\n');
    write('supabase/config.toml', '[api]\n');
    write('bot/src/index.ts', '// bot\n');
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
        .map((line) => {
          const at = line.indexOf('=');
          return [line.slice(0, at), line.slice(at + 1)];
        })
    );
  }

  const clean = {
    frontend: 'false',
    backend: 'false',
    functions: 'false',
    bot: 'false',
    shipped: 'false',
    version_bump: 'false',
    frontend_entry: 'false',
    backend_entry: 'false',
    functions_entry: 'false',
    bot_entry: 'false',
    missing_entry: '',
    heading_error: '',
    news_touched: 'false'
  };

  it('a db-only PR with an entry and a bump passes every axis', () => {
    const result = onBranch('db-full', () => {
      write('scripts/import/generate.js', '// generator v2\n');
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Backend: '- Importer handles renames' }));
    });
    expect(result).toEqual({
      ...clean,
      backend: 'true',
      shipped: 'true',
      version_bump: 'true',
      backend_entry: 'true'
    });
  });

  it('a db-only PR with no bump reports the shipped change (the workflow fails it)', () => {
    const result = onBranch('db-no-bump', () => {
      write('scripts/import/generate.js', '// generator v3\n');
      write(
        'CHANGELOG.md',
        baseChangelog.replace('- Roster re-imports reconcile', '- Roster re-imports reconcile\n- Handles renames')
      );
    });
    expect(result.shipped).toBe('true');
    expect(result.version_bump).toBe('false');
    expect(result.backend_entry).toBe('true');
  });

  it('a functions-only PR with no Functions entry reports it missing', () => {
    const result = onBranch('functions-no-entry', () => {
      write('supabase/functions/boe-webhook/index.ts', '// found post v2\n');
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Backend: '- Wrong section' }));
    });
    expect(result.functions).toBe('true');
    expect(result.shipped).toBe('true');
    expect(result.functions_entry).toBe('false');
    expect(result.missing_entry).toBe('functions');
  });

  it('a functions-only PR done right passes', () => {
    const result = onBranch('functions-full', () => {
      write('supabase/functions/boe-webhook/index.ts', '// found post v3\n');
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Functions: '- The found post reads the row' }));
    });
    expect(result).toEqual({
      ...clean,
      functions: 'true',
      shipped: 'true',
      version_bump: 'true',
      functions_entry: 'true'
    });
  });

  it('a bot-only PR with no Bot entry reports it missing', () => {
    const result = onBranch('bot-no-entry', () => {
      write('bot/src/index.ts', '// bot v2\n');
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Frontend: '- Wrong section' }));
    });
    expect(result.bot).toBe('true');
    expect(result.bot_entry).toBe('false');
    expect(result.missing_entry).toBe('bot');
  });

  it('a PR touching bot/ and js/ needs both sections and one bump', () => {
    const result = onBranch('bot-and-frontend', () => {
      write('bot/src/index.ts', '// bot v3\n');
      write('js/roster.js', '// roster v2\n');
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Frontend: '- Roster tweak', Bot: '- Bot tweak' }));
    });
    expect(result).toEqual({
      ...clean,
      frontend: 'true',
      bot: 'true',
      shipped: 'true',
      version_bump: 'true',
      frontend_entry: 'true',
      bot_entry: 'true'
    });
  });

  it('reports every missing section, not just the first', () => {
    const result = onBranch('two-missing', () => {
      write('bot/src/index.ts', '// bot v4\n');
      write('supabase/functions/boe-webhook/index.ts', '// found post v4\n');
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Frontend: '- Nothing to do with either' }));
    });
    expect(result.missing_entry).toBe('functions,bot');
  });

  it('a docs-only PR is no shipped class at all', () => {
    const result = onBranch('docs-only', () => {
      write('docs/RLS.md', '# policies v2\n');
    });
    expect(result).toEqual(clean);
  });

  it('supabase/config.toml alone is chore territory, not a shipped change', () => {
    const result = onBranch('config-only', () => {
      write('supabase/config.toml', '[api]\n[functions.boe-webhook]\nverify_jwt = false\n');
    });
    expect(result).toEqual(clean);
  });

  it('a VERSION-only bump is not a frontend change (the #353 circularity)', () => {
    const result = onBranch('bump-only', () => {
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\n");
    });
    expect(result).toEqual({ ...clean, version_bump: 'true' });
  });

  it('a frontend PR done right passes every axis', () => {
    const result = onBranch('frontend-full', () => {
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\nfunction newHelper() {}\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Frontend: '- New helper behavior' }));
      write('news.json', '[]\n');
    });
    expect(result).toEqual({
      ...clean,
      frontend: 'true',
      shipped: 'true',
      version_bump: 'true',
      frontend_entry: 'true',
      news_touched: 'true'
    });
  });

  it('a frontend PR with no news.json touch reports news_touched=false (#525)', () => {
    const result = onBranch('frontend-no-news', () => {
      write('js/common.js', "var VERSION = '3.16.1';\nvar WEB_APP_URL = 'x';\nfunction anotherHelper() {}\n");
      write('CHANGELOG.md', bumpedChangelog('3.16.1', { Frontend: '- Another behavior' }));
    });
    expect(result.frontend_entry).toBe('true');
    expect(result.news_touched).toBe('false');
  });

  it('refuses a heading that repeats one already on the base branch', () => {
    const result = onBranch('heading-duplicate', () => {
      write('js/roster.js', '// roster v3\n');
      write('js/common.js', "var VERSION = '3.16.0';\nvar WEB_APP_URL = 'x';\n");
      write(
        'CHANGELOG.md',
        baseChangelog.replace(
          '## [3.16.0] - 2026-07-07',
          '## [3.16.0] - 2026-07-08\n\n### Frontend\n- Second block, same number\n\n---\n\n## [3.16.0] - 2026-07-07'
        )
      );
    });
    expect(result.heading_error).toContain('3.16.0');
  });

  it('refuses a heading that sorts below the newest on the base branch', () => {
    const result = onBranch('heading-backwards', () => {
      write('js/roster.js', '// roster v4\n');
      write('js/common.js', "var VERSION = '3.15.9';\nvar WEB_APP_URL = 'x';\n");
      write('CHANGELOG.md', bumpedChangelog('3.15.9', { Frontend: '- Going backwards' }));
    });
    expect(result.heading_error).toContain('3.15.9');
  });

  it('classify() is callable directly with a cwd', () => {
    git('checkout', 'db-full');
    expect(classify('main', repo)).toEqual({
      frontend: false,
      backend: true,
      functions: false,
      bot: false,
      shipped: true,
      version_bump: true,
      frontend_entry: false,
      backend_entry: true,
      functions_entry: false,
      bot_entry: false,
      missing_entry: '',
      heading_error: '',
      news_touched: false
    });
  });
});
