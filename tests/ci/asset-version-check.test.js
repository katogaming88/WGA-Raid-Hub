import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub Pages serves every static asset with Cache-Control: max-age=600, so
// for up to 10 minutes after a deploy a browser can run fresh HTML/JS against a
// stale cached CSS/JS (or vice versa) -- the visible styling/layout mismatch in
// #431. Each local stylesheet/script tag carries a ?v=<VERSION> query string so
// a version bump forces a fresh fetch of every asset. VERSION is a runtime JS
// constant (only known after common.js loads), so the query string is hardcoded
// into each static tag rather than injected; this check keeps those ~30 tags in
// sync with js/common.js's VERSION so a bump can't silently leave them stale.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The three HTML entry points GitHub Pages serves.
const PAGES = ['index.html', 'officer.html', 'admin.html'];

// Local (relative) css/ and js/ assets only. External URLs -- Google Fonts and
// the jsDelivr supabase-js CDN -- are versioned/pinned upstream and are
// deliberately left untagged, so the pattern only matches paths beginning
// css/ or js/, never https://... The [^"?]* stops the match before any
// existing query string so a tag without ?v= is caught as untagged.
const LOCAL_ASSET = /(?:href|src)="((?:css|js)\/[^"]*)"/g;

function readVersion() {
  const common = readFileSync(join(ROOT, 'js', 'common.js'), 'utf8');
  const match = common.match(/var VERSION = '([^']+)';/);
  if (!match) throw new Error('Could not find the VERSION constant in js/common.js');
  return match[1];
}

describe('asset cache-busting version tags (#431)', () => {
  const version = readVersion();

  for (const page of PAGES) {
    it(`every local css/js asset in ${page} is tagged ?v=${version}`, () => {
      const html = readFileSync(join(ROOT, page), 'utf8');
      const assets = [...html.matchAll(LOCAL_ASSET)].map((m) => m[1]);
      // Guard against the regex silently matching nothing (e.g. a markup
      // change) and the check passing vacuously.
      expect(assets.length).toBeGreaterThan(0);
      const untagged = assets.filter((href) => !href.endsWith(`?v=${version}`));
      expect(untagged).toEqual([]);
    });
  }
});
