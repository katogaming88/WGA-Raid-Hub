import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES, localAssets, readVersion, readNewestMigration, MANIFEST_FILE } from '../../scripts/ci/stamp-version.js';

// GitHub Pages serves every static asset with Cache-Control: max-age=600, so
// for up to 10 minutes after a deploy a browser can run fresh HTML/JS against a
// stale cached CSS/JS (or vice versa) -- the visible styling/layout mismatch in
// #431. Each local stylesheet/script tag carries a ?v=<VERSION> query string so
// a version bump forces a fresh fetch of every asset. VERSION is a runtime JS
// constant (only known after common.js loads), so the query string is hardcoded
// into each static tag rather than injected; this check keeps those ~40 tags in
// sync with js/common.js's VERSION so a bump can't silently leave them stale.
//
// PAGES, the asset pattern and readVersion come from scripts/ci/stamp-version.js,
// which is what does the stamping. They were duplicated here before (#776) and a
// new page had to be registered in two places, either of which failing open.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('asset cache-busting version tags (#431)', () => {
  const version = readVersion(ROOT);

  for (const page of PAGES) {
    it(`every local css/js asset in ${page} is tagged ?v=${version}`, () => {
      const html = readFileSync(join(ROOT, page), 'utf8');
      const assets = localAssets(html);
      // Guard against the pattern silently matching nothing (e.g. a markup
      // change) and the check passing vacuously.
      expect(assets.length).toBeGreaterThan(0);
      const untagged = assets.filter((href) => !href.endsWith(`?v=${version}`));
      expect(untagged).toEqual([]);
    });
  }
});

// The manifest is the served answer to "what version is each piece" (#967), so
// it has to agree with the tree it was written from. These are the invariants a
// stamp cannot violate without the mistake reaching the site: a manifest naming
// a version the code is not at, a piece stamped ahead of the product, or a
// REQUIRED_SCHEMA that does not match the migrations actually in the repo.
describe('version manifest (#967)', () => {
  const version = readVersion(ROOT);
  const manifest = JSON.parse(readFileSync(join(ROOT, MANIFEST_FILE), 'utf8'));

  it('is pure JSON, with no front matter for Jekyll to render', () => {
    const raw = readFileSync(join(ROOT, MANIFEST_FILE), 'utf8');
    expect(raw.trimStart().startsWith('{')).toBe(true);
  });

  it('names the version js/common.js is at', () => {
    expect(manifest.version).toBe(version);
  });

  it('carries no piece at a version above the product', () => {
    const pieceVersions = [
      manifest.pieces.frontend,
      manifest.pieces.db,
      manifest.pieces.bot,
      ...Object.values(manifest.pieces.functions ?? {})
    ].filter(Boolean);
    // Every piece carries the version of the release that last touched it, so
    // it is at or behind the product number and never ahead of it.
    for (const piece of pieceVersions) {
      expect(compare(piece, version)).toBeLessThanOrEqual(0);
    }
  });

  it('has a frontend entry, because the frontend has shipped', () => {
    expect(manifest.pieces.frontend).toBeTruthy();
  });

  it('REQUIRED_SCHEMA matches the newest migration in the tree', () => {
    const common = readFileSync(join(ROOT, 'js', 'common.js'), 'utf8');
    const match = common.match(/var REQUIRED_SCHEMA = '([^']*)';/);
    expect(match).not.toBeNull();
    expect(match[1]).toBe(readNewestMigration(ROOT));
  });
});

function compare(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return 0;
}
