import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  PAGES,
  isValidVersion,
  readVersion,
  readNewestMigration,
  stampCommonJs,
  stampRequiredSchema,
  stampHtml,
  stampFooterVersion,
  computePieces,
  buildJsonContent,
  stampAll
} from '../../scripts/ci/stamp-version.js';

// Every version bump has to re-stamp the ?v= cache-bust tag on every local
// css/js asset across every page (#431), and there are 39 of them. Doing that
// by hand is the kind of mechanical sweep that misses one, and
// tests/ci/asset-version-check.test.js only tells you afterwards. This is the
// sweep as a script; these tests are what stop it from eating a file.

const FIXTURE_HTML = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700" rel="stylesheet">',
  '<link rel="stylesheet" href="css/styles.css?v=1.0.0">',
  '</head>',
  '<body>',
  '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>',
  '<script src="js/common.js?v=1.0.0"></script>',
  '<script src="js/guild.js"></script>',
  '</body>',
  '</html>'
].join('\n');

const FIXTURE_COMMON = [
  '// @ts-check',
  "var TEAM_SLUG = 'phoenix';",
  "var VERSION = '1.0.0';",
  'var DATA = null;'
].join('\n');

describe('isValidVersion', () => {
  it('accepts x.y.z', () => {
    expect(isValidVersion('3.66.0')).toBe(true);
    expect(isValidVersion('10.0.12')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const bad of ['3.66', 'v3.66.0', '3.66.0-rc1', '3.66.0 ', '', 'latest', '3.66.0.1']) {
      expect(isValidVersion(bad)).toBe(false);
    }
  });
});

describe('stampCommonJs', () => {
  it('rewrites the VERSION line and nothing else', () => {
    const out = stampCommonJs(FIXTURE_COMMON, '2.1.3');
    expect(out).toContain("var VERSION = '2.1.3';");
    expect(out).not.toContain("'1.0.0'");
    expect(out.split('\n').length).toBe(FIXTURE_COMMON.split('\n').length);
    // Every other line survives byte for byte.
    const before = FIXTURE_COMMON.split('\n');
    const after = out.split('\n');
    before.forEach((line, i) => {
      if (line.startsWith('var VERSION')) return;
      expect(after[i]).toBe(line);
    });
  });

  it('throws when there is no VERSION line to replace', () => {
    expect(() => stampCommonJs('var DATA = null;', '2.1.3')).toThrow(/VERSION/);
  });

  it('is a no-op when the version already matches', () => {
    expect(stampCommonJs(FIXTURE_COMMON, '1.0.0')).toBe(FIXTURE_COMMON);
  });
});

describe('stampHtml', () => {
  it('rewrites every local css/js tag', () => {
    const { html, count } = stampHtml(FIXTURE_HTML, '2.1.3');
    expect(html).toContain('href="css/styles.css?v=2.1.3"');
    expect(html).toContain('src="js/common.js?v=2.1.3"');
    expect(count).toBe(3);
  });

  it('adds a tag to a local asset that has none', () => {
    const { html } = stampHtml(FIXTURE_HTML, '2.1.3');
    expect(html).toContain('src="js/guild.js?v=2.1.3"');
  });

  it('leaves external URLs alone', () => {
    const { html } = stampHtml(FIXTURE_HTML, '2.1.3');
    expect(html).toContain('href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700"');
    expect(html).toContain('src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"');
    expect(html).toContain('href="https://fonts.googleapis.com"');
  });

  it('changes nothing but the tags: same line count, same non-asset lines', () => {
    const { html } = stampHtml(FIXTURE_HTML, '2.1.3');
    const before = FIXTURE_HTML.split('\n');
    const after = html.split('\n');
    expect(after.length).toBe(before.length);
    before.forEach((line, i) => {
      if (/(?:href|src)="(?:css|js)\//.test(line)) return;
      expect(after[i]).toBe(line);
    });
  });

  it('throws on a page with no local assets, rather than reporting a silent success', () => {
    expect(() => stampHtml('<html><body>nothing here</body></html>', '2.1.3')).toThrow(/no local/i);
  });

  it('is idempotent', () => {
    const once = stampHtml(FIXTURE_HTML, '2.1.3').html;
    expect(stampHtml(once, '2.1.3').html).toBe(once);
  });
});

describe('PAGES', () => {
  it('is the shared registry the asset version check also reads', () => {
    expect(PAGES).toContain('index.html');
    expect(PAGES).toContain('officer.html');
    expect(PAGES).toContain('admin.html');
  });

  it('names pages that actually exist in the repo', () => {
    const root = join(import.meta.dirname, '..', '..');
    for (const page of PAGES) {
      expect(() => readFileSync(join(root, page), 'utf8')).not.toThrow();
    }
  });
});

describe('stampAll', () => {
  let dir;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wga-stamp-'));
    mkdirSync(join(dir, 'js'));
    mkdirSync(join(dir, 'css'));
    writeFileSync(join(dir, 'js', 'common.js'), FIXTURE_COMMON, 'utf8');
    writeFileSync(join(dir, 'css', 'styles.css'), 'body{}', 'utf8');
    writeFileSync(join(dir, 'index.html'), FIXTURE_HTML, 'utf8');
    writeFileSync(join(dir, 'officer.html'), FIXTURE_HTML, 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('rewrites VERSION and every page, and reports the per-page counts', () => {
    const result = stampAll({ root: dir, version: '2.1.3', pages: ['index.html', 'officer.html'], changed: [] });

    expect(result.version).toBe('2.1.3');
    expect(result.previous).toBe('1.0.0');
    expect(result.pages).toEqual([
      { page: 'index.html', count: 3 },
      { page: 'officer.html', count: 3 }
    ]);

    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).toContain("var VERSION = '2.1.3';");
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('src="js/guild.js?v=2.1.3"');
    expect(readFileSync(join(dir, 'officer.html'), 'utf8')).toContain('href="css/styles.css?v=2.1.3"');
  });

  it('writes LF only, never CRLF', () => {
    stampAll({ root: dir, version: '2.1.3', pages: ['index.html'], changed: [] });
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).not.toContain('\r\n');
    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).not.toContain('\r\n');
  });

  it('rejects a malformed version before touching anything', () => {
    expect(() => stampAll({ root: dir, version: 'v2.1.3', pages: ['index.html'], changed: [] })).toThrow(/x\.y\.z/);
    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).toBe(FIXTURE_COMMON);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(FIXTURE_HTML);
  });

  it('leaves every file untouched when one page would fail', () => {
    writeFileSync(join(dir, 'officer.html'), '<html><body>no assets</body></html>', 'utf8');

    expect(() => stampAll({ root: dir, version: '2.1.3', pages: ['index.html', 'officer.html'], changed: [] })).toThrow(/no local/i);

    expect(readFileSync(join(dir, 'js', 'common.js'), 'utf8')).toBe(FIXTURE_COMMON);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toBe(FIXTURE_HTML);
  });
});

describe('readVersion', () => {
  it('reads the live VERSION out of js/common.js', () => {
    const version = readVersion(join(import.meta.dirname, '..', '..'));
    expect(isValidVersion(version)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #967: the stamp stopped being a frontend-only sweep. One version line covers
// the whole project (#965), so the stamp also writes the served manifest, the
// schema stamp the boot check compares against, and the per-piece files. The
// hard rule underneath computePieces: a piece carries the version of the last
// release that TOUCHED it, so an untouched piece must come out unchanged.
// ---------------------------------------------------------------------------

describe('computePieces', () => {
  it('marks only the classes the branch actually changed', () => {
    const pieces = computePieces({
      changed: ['js/roster.js'],
      previous: { frontend: '3.90.0', db: '3.80.0', bot: '3.70.0' },
      version: '3.92.0'
    });
    expect(pieces.frontend).toBe('3.92.0');
    expect(pieces.db).toBe('3.80.0');
    expect(pieces.bot).toBe('3.70.0');
  });

  it('marks db for migrations and for the import tooling', () => {
    expect(computePieces({ changed: ['supabase/migrations/20260101000000_x.sql'], version: '3.92.0' }).db).toBe(
      '3.92.0'
    );
    expect(computePieces({ changed: ['scripts/import/tables/players.js'], version: '3.92.0' }).db).toBe('3.92.0');
  });

  it('leaves a piece absent when it has never been stamped', () => {
    const pieces = computePieces({ changed: ['js/roster.js'], version: '3.92.0' });
    expect(pieces.frontend).toBe('3.92.0');
    expect('db' in pieces).toBe(false);
    expect('bot' in pieces).toBe(false);
  });

  it('stamps only the function whose own paths changed', () => {
    const pieces = computePieces({
      changed: ['supabase/functions/boe-webhook/index.ts'],
      previous: { functions: { 'boe-webhook': '3.80.0', 'contact-webhook': '3.70.0' } },
      version: '3.92.0',
      functions: ['boe-webhook', 'contact-webhook']
    });
    expect(pieces.functions).toEqual({ 'boe-webhook': '3.92.0', 'contact-webhook': '3.70.0' });
  });

  // _shared is compiled into every function's bundle, so a change there ships
  // in all of them and every one of their stamps has to move.
  it('stamps every function when _shared changes', () => {
    const pieces = computePieces({
      changed: ['supabase/functions/_shared/cors.ts'],
      previous: { functions: { 'boe-webhook': '3.80.0', 'contact-webhook': '3.70.0' } },
      version: '3.92.0',
      functions: ['boe-webhook', 'contact-webhook']
    });
    expect(pieces.functions).toEqual({ 'boe-webhook': '3.92.0', 'contact-webhook': '3.92.0' });
  });

  it('does not invent an entry for a function that never had one', () => {
    const pieces = computePieces({
      changed: ['js/roster.js'],
      version: '3.92.0',
      functions: ['boe-webhook']
    });
    expect(pieces.functions).toEqual({});
  });

  // A chore PR moves no piece, so a chore-exempt release must not silently
  // restamp everything (#967).
  it('changes nothing when no shipped path moved', () => {
    const previous = { frontend: '3.90.0', db: '3.80.0', functions: { 'boe-webhook': '3.70.0' } };
    const pieces = computePieces({
      changed: ['docs/RLS.md', 'supabase/config.toml'],
      previous,
      version: '3.92.0',
      functions: ['boe-webhook']
    });
    expect(pieces).toEqual(previous);
  });
});

describe('stampRequiredSchema', () => {
  const source = ["var VERSION = '1.0.0';", "var REQUIRED_SCHEMA = '20260101000000';"].join('\n');

  it('rewrites the schema stamp and nothing else', () => {
    const out = stampRequiredSchema(source, '20260905154234');
    expect(out).toContain("var REQUIRED_SCHEMA = '20260905154234';");
    expect(out).toContain("var VERSION = '1.0.0';");
  });

  it('throws when the line is missing rather than appending one', () => {
    expect(() => stampRequiredSchema("var VERSION = '1.0.0';", '20260905154234')).toThrow(/REQUIRED_SCHEMA/);
  });
});

describe('stampFooterVersion', () => {
  // admin.html cannot read VERSION: js/admin.js is standalone and does not load
  // common.js. So the stamp writes the number into the markup there, the same
  // reason the ?v= tags are hardcoded rather than injected.
  it('fills the versionNum span in the markup', () => {
    const html = '<footer>v<span id="versionNum">3.90.0</span></footer>';
    expect(stampFooterVersion(html, '3.92.0')).toBe('<footer>v<span id="versionNum">3.92.0</span></footer>');
  });

  it('fills an empty span', () => {
    const html = '<footer>v<span id="versionNum"></span></footer>';
    expect(stampFooterVersion(html, '3.92.0')).toContain('>3.92.0<');
  });

  it('leaves a page with no such span alone', () => {
    const html = '<footer>nothing here</footer>';
    expect(stampFooterVersion(html, '3.92.0')).toBe(html);
  });
});

describe('buildJsonContent', () => {
  // Jekyll only processes a file that carries front matter, and the Pages build
  // is the only thing that knows the deployed SHA. Empty front matter is what
  // turns this from a static file into a rendered one.
  it('opens with empty front matter so Jekyll renders it', () => {
    expect(buildJsonContent().startsWith('---\n---\n')).toBe(true);
  });

  it('carries the Liquid tags for the build revision and time', () => {
    const out = buildJsonContent();
    expect(out).toContain('site.github.build_revision');
    expect(out).toContain('site.time');
  });

  it('is valid JSON once the front matter and the Liquid tags are resolved', () => {
    const body = buildJsonContent().replace(/^---\n---\n/, '');
    expect(() => JSON.parse(body.replace(/\{\{[^}]*\}\}/g, 'x'))).not.toThrow();
  });
});

describe('stampAll writes the manifest and the piece stamps', () => {
  let dir;

  function read(rel) {
    return readFileSync(join(dir, rel), 'utf8');
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wga-stamp-pieces-'));
    mkdirSync(join(dir, 'js'));
    mkdirSync(join(dir, 'css'));
    mkdirSync(join(dir, 'supabase', 'migrations'), { recursive: true });
    mkdirSync(join(dir, 'supabase', 'functions', 'boe-webhook'), { recursive: true });
    mkdirSync(join(dir, 'supabase', 'functions', '_shared'), { recursive: true });
    mkdirSync(join(dir, 'bot'), { recursive: true });
    writeFileSync(
      join(dir, 'js', 'common.js'),
      ["var VERSION = '1.0.0';", "var REQUIRED_SCHEMA = '20260101000000';"].join('\n'),
      'utf8'
    );
    writeFileSync(join(dir, 'css', 'styles.css'), 'body{}', 'utf8');
    writeFileSync(join(dir, 'index.html'), FIXTURE_HTML, 'utf8');
    writeFileSync(join(dir, 'supabase', 'migrations', '20260101000000_first.sql'), '-- x', 'utf8');
    writeFileSync(join(dir, 'supabase', 'migrations', '20260905154234_latest.sql'), '-- y', 'utf8');
    writeFileSync(join(dir, 'supabase', 'functions', 'boe-webhook', 'index.ts'), '// fn', 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function stamp(changed, version = '2.1.3') {
    return stampAll({ root: dir, version, pages: ['index.html'], changed });
  }

  it('writes version.json as pure JSON, with no front matter', () => {
    stamp(['js/roster.js']);
    const raw = read('version.json');
    expect(raw.startsWith('---')).toBe(false);
    const manifest = JSON.parse(raw);
    expect(manifest.version).toBe('2.1.3');
    expect(manifest.pieces.frontend).toBe('2.1.3');
  });

  it('writes build.json with the front matter Jekyll needs', () => {
    stamp(['js/roster.js']);
    expect(read('build.json').startsWith('---\n---\n')).toBe(true);
  });

  it('carries an untouched piece forward at its old version', () => {
    writeFileSync(
      join(dir, 'version.json'),
      JSON.stringify({ version: '1.0.0', pieces: { frontend: '1.0.0', db: '0.9.0' } }, null, 2) + '\n',
      'utf8'
    );
    stamp(['js/roster.js']);
    const manifest = JSON.parse(read('version.json'));
    expect(manifest.pieces.frontend).toBe('2.1.3');
    expect(manifest.pieces.db).toBe('0.9.0');
  });

  it('stamps REQUIRED_SCHEMA from the newest migration in the tree', () => {
    stamp(['js/roster.js']);
    expect(read('js/common.js')).toContain("var REQUIRED_SCHEMA = '20260905154234';");
  });

  it('rewrites a function version file only when that function changed', () => {
    writeFileSync(join(dir, 'supabase', 'functions', 'boe-webhook', 'version.ts'), "export const VERSION = '1.0.0';\n");
    stamp(['js/roster.js']);
    expect(read('supabase/functions/boe-webhook/version.ts')).toContain("'1.0.0'");
    stamp(['supabase/functions/boe-webhook/index.ts'], '2.2.0');
    expect(read('supabase/functions/boe-webhook/version.ts')).toContain("'2.2.0'");
  });

  it('skips a function that has no version file yet', () => {
    expect(() => stamp(['supabase/functions/boe-webhook/index.ts'])).not.toThrow();
    const manifest = JSON.parse(read('version.json'));
    expect(manifest.pieces.functions).toEqual({});
  });

  it('rewrites bot/package.json only when bot/ changed', () => {
    writeFileSync(join(dir, 'bot', 'package.json'), JSON.stringify({ name: 'b', version: '1.0.0' }, null, 2) + '\n');
    stamp(['js/roster.js']);
    expect(JSON.parse(read('bot/package.json')).version).toBe('1.0.0');
    stamp(['bot/src/index.ts'], '2.2.0');
    expect(JSON.parse(read('bot/package.json')).version).toBe('2.2.0');
  });

  it('reports what it wrote beyond the pages', () => {
    const result = stamp(['js/roster.js']);
    expect(result.pieces.frontend).toBe('2.1.3');
    expect(result.schema).toBe('20260905154234');
  });

  it('still writes nothing at all when one page would fail', () => {
    writeFileSync(join(dir, 'officer.html'), '<html><body>no assets</body></html>', 'utf8');
    expect(() =>
      stampAll({ root: dir, version: '2.1.3', pages: ['index.html', 'officer.html'], changed: ['js/roster.js'] })
    ).toThrow(/no local/i);
    expect(existsSync(join(dir, 'version.json'))).toBe(false);
    expect(read('js/common.js')).toContain("var VERSION = '1.0.0';");
  });
});

describe('readNewestMigration', () => {
  it('reads the highest stamp in the live repo', () => {
    const stamp = readNewestMigration(join(import.meta.dirname, '..', '..'));
    expect(stamp).toMatch(/^\d{14}$/);
  });
});
