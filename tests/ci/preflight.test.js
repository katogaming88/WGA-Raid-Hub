import { describe, it, expect } from 'vitest';
import { CHECKS, selectChecks } from '../../scripts/dev/preflight.js';

const names = (files) => selectChecks(files).map((c) => c.name);

describe('preflight job selection', () => {
  it('always runs the version check', () => {
    expect(names(['README.md'])).toEqual(['version']);
  });

  it('runs the app job before the browser job that serves its build', () => {
    const all = CHECKS.map((c) => c.name);
    expect(all.indexOf('app')).toBeLessThan(all.indexOf('browser'));
    expect(names(['app/src/routes.tsx'])).toEqual(['version', 'app', 'browser']);
  });

  it('adds the schema, rls and ledger jobs for a migration', () => {
    expect(names(['supabase/migrations/20260924000000_x.sql'])).toEqual(['version', 'rls', 'schema', 'ledger']);
  });

  it('adds the page checks for a root page or shared script', () => {
    expect(names(['index.html'])).toContain('pages');
    expect(names(['js/common.js'])).toEqual(expect.arrayContaining(['lint', 'frontend', 'pages', 'functions']));
  });

  it('names every job once', () => {
    const all = CHECKS.map((c) => c.name);
    expect(new Set(all).size).toBe(all.length);
  });
});
