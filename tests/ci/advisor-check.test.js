import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseReport, evaluate, formatReport, ALLOWLIST } from '../../scripts/ci/advisor-check.js';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'ci', 'advisor-check.js');

// The gate behind #1011. Supabase ships a security linter and nothing here has
// ever run it, so a second SECURITY DEFINER view, a table with RLS off or a
// function that loses its search_path pin would land with nothing to notice.
// The allowlist names every finding this project has accepted, each with its
// reason, and everything else fails the run.

const DEFINER_VIEW = {
  name: 'security_definer_view',
  title: 'Security Definer View',
  level: 'ERROR',
  facing: 'EXTERNAL',
  categories: ['SECURITY'],
  description: 'Detects views defined with the SECURITY DEFINER property',
  detail: 'View `public.incoming_roster` is defined with the SECURITY DEFINER property',
  remediation: 'https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view',
  metadata: { name: 'incoming_roster', schema: 'public', type: 'view' },
  cacheKey: 'security_definer_view_public_incoming_roster'
};

const AUTH_TOGGLE = {
  name: 'auth_leaked_password_protection',
  title: 'Leaked Password Protection Disabled',
  level: 'WARN',
  facing: 'EXTERNAL',
  categories: ['SECURITY'],
  description: 'Supabase Auth prevents the use of compromised passwords',
  detail: 'Enable this feature to enhance security.',
  remediation: 'https://supabase.com/docs/guides/database/database-linter?lint=0015_leaked_password_protection',
  metadata: { entity: 'Auth', type: 'auth' },
  cacheKey: 'auth_leaked_password_protection'
};

const RLS_OFF = {
  name: 'rls_disabled_in_public',
  title: 'RLS Disabled in Public',
  level: 'ERROR',
  facing: 'EXTERNAL',
  categories: ['SECURITY'],
  description: 'Detects cases where row level security has not been enabled',
  detail: 'Table `public.scratch_table` is public, but RLS has not been enabled.',
  remediation: 'https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public',
  metadata: { name: 'scratch_table', schema: 'public', type: 'table' },
  cacheKey: 'rls_disabled_in_public_public_scratch_table'
};

const OBJECT_ENTRY = { cacheKey: DEFINER_VIEW.cacheKey, reason: 'documented in docs/RLS.md, tracked as #503' };
const LINT_ENTRY = { name: AUTH_TOGGLE.name, reason: 'a dashboard toggle on a Discord-only login' };

function finding(overrides) {
  return { ...DEFINER_VIEW, ...overrides };
}

describe('parseReport', () => {
  it('reads the results array out of the CLI envelope', () => {
    const text = JSON.stringify({ results: [DEFINER_VIEW], message: 'db advisors' });
    expect(parseReport(text)).toHaveLength(1);
  });

  it('reads an empty run, which the CLI still writes as an envelope', () => {
    expect(parseReport(JSON.stringify({ results: [], message: 'db advisors' }))).toEqual([]);
  });

  it('throws on text that is not JSON at all, naming what it got', () => {
    expect(() => parseReport('Connecting to local database...')).toThrow(/not JSON/i);
  });

  it('throws on a document with no results array, which is what an error envelope looks like', () => {
    expect(() => parseReport(JSON.stringify({ error: 'failed to query lints' }))).toThrow(/results/);
  });
});

describe('evaluate', () => {
  it('passes a finding whose own object is allowlisted', () => {
    const out = evaluate([DEFINER_VIEW], [OBJECT_ENTRY]);
    expect(out.failing).toEqual([]);
    expect(out.allowlisted).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it('passes every finding of an allowlisted lint, whatever object each names', () => {
    const second = { ...AUTH_TOGGLE, cacheKey: 'auth_leaked_password_protection_other' };
    const out = evaluate([AUTH_TOGGLE, second], [LINT_ENTRY]);
    expect(out.failing).toEqual([]);
    expect(out.allowlisted).toHaveLength(2);
  });

  it('fails an unlisted WARN and keeps what the log has to print', () => {
    const warn = finding({ level: 'WARN', cacheKey: 'security_definer_view_public_other_view' });
    const out = evaluate([warn], [OBJECT_ENTRY]);
    expect(out.failing).toHaveLength(1);
    expect(out.failing[0].name).toBe('security_definer_view');
    expect(out.failing[0].detail).toContain('incoming_roster');
    expect(out.failing[0].remediation).toContain('database-linter');
  });

  it('fails a second definer view even though the first one is allowlisted', () => {
    const other = finding({
      detail: 'View `public.scratch_view` is defined with the SECURITY DEFINER property',
      metadata: { name: 'scratch_view', schema: 'public', type: 'view' },
      cacheKey: 'security_definer_view_public_scratch_view'
    });
    const out = evaluate([DEFINER_VIEW, other], [OBJECT_ENTRY]);
    expect(out.allowlisted).toHaveLength(1);
    expect(out.failing.map((f) => f.cacheKey)).toEqual(['security_definer_view_public_scratch_view']);
  });

  it('reports an unlisted INFO without failing on it', () => {
    const info = { ...RLS_OFF, level: 'INFO' };
    const out = evaluate([DEFINER_VIEW, info], [OBJECT_ENTRY]);
    expect(out.failing).toEqual([]);
    expect(out.informational).toHaveLength(1);
  });

  it('fails a level it does not know, rather than reading it as informational', () => {
    const odd = { ...RLS_OFF, level: 'CRITICAL' };
    const out = evaluate([DEFINER_VIEW, odd], [OBJECT_ENTRY]);
    expect(out.failing).toHaveLength(1);
    expect(out.failing[0].level).toBe('CRITICAL');
  });

  it('tolerates a finding with no metadata, which the text format omits', () => {
    const bare = { ...RLS_OFF };
    delete bare.metadata;
    const out = evaluate([bare], [{ cacheKey: RLS_OFF.cacheKey, reason: 'test fixture' }]);
    expect(out.failing).toEqual([]);
    expect(out.allowlisted).toHaveLength(1);
  });

  it('fails an object-scoped entry that matched nothing, since the object it names is gone', () => {
    const out = evaluate([], [OBJECT_ENTRY]);
    expect(out.unmatched).toHaveLength(1);
    expect(out.unmatched[0].cacheKey).toBe(DEFINER_VIEW.cacheKey);
  });

  it('passes a lint-wide entry that matched nothing, since the local target never emits the API lints', () => {
    const out = evaluate([], [LINT_ENTRY]);
    expect(out.unmatched).toEqual([]);
    expect(out.failing).toEqual([]);
  });

  it('passes an empty run when no object-scoped entry is waiting on one', () => {
    const out = evaluate([], [LINT_ENTRY]);
    expect(out.total).toBe(0);
    expect(formatReport(out)).toContain('0 findings, 0 allowlisted, 0 failing');
  });
});

describe('the committed allowlist', () => {
  // Each entry is a standing claim about production, so it carries the reason
  // in the file rather than in whoever added it.
  it('gives every entry a reason and exactly one key', () => {
    expect(ALLOWLIST.length).toBeGreaterThan(0);
    for (const entry of ALLOWLIST) {
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      expect([entry.name, entry.cacheKey].filter(Boolean)).toHaveLength(1);
    }
  });
});

describe('CLI', () => {
  function withReport(text, fn) {
    const dir = mkdtempSync(join(tmpdir(), 'advisor-check-'));
    try {
      const file = join(dir, 'advisors.json');
      writeFileSync(file, text);
      return fn(file);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  function run(file) {
    try {
      return { status: 0, stdout: execFileSync('node', [SCRIPT, file], { encoding: 'utf8' }) };
    } catch (err) {
      return { status: err.status, stdout: (err.stdout || '') + (err.stderr || '') };
    }
  }

  it('exits 0 on the report this repo actually produces, and prints all three counts', () => {
    const result = withReport(JSON.stringify({ results: [DEFINER_VIEW], message: 'db advisors' }), run);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1 findings, 1 allowlisted, 0 failing');
  });

  it('exits 1 on an unlisted finding and names the lint, the object and the remediation', () => {
    const result = withReport(JSON.stringify({ results: [DEFINER_VIEW, RLS_OFF], message: 'db advisors' }), run);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('rls_disabled_in_public');
    expect(result.stdout).toContain('scratch_table');
    expect(result.stdout).toContain('database-linter');
  });

  it('exits 1 on an empty report, because the entry naming incoming_roster matched nothing', () => {
    // The vacuous run: a CLI that returned nothing must not read as a clean
    // database, and the allowlist is what makes that detectable.
    const result = withReport(JSON.stringify({ results: [], message: 'db advisors' }), run);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('security_definer_view_public_incoming_roster');
  });

  it('exits 2 when the report file does not exist', () => {
    const result = run(join(tmpdir(), 'advisor-check-no-such-file.json'));
    expect(result.status).toBe(2);
  });

  it('exits 2 on a file that is not JSON', () => {
    const result = withReport('Connecting to local database...\n', run);
    expect(result.status).toBe(2);
  });

  it('exits 2 on an envelope carrying no results array', () => {
    const result = withReport(JSON.stringify({ error: 'failed to query lints' }), run);
    expect(result.status).toBe(2);
  });

  it('exits 2 with no file argument at all', () => {
    try {
      execFileSync('node', [SCRIPT], { encoding: 'utf8' });
      throw new Error('expected a non-zero exit');
    } catch (err) {
      expect(err.status).toBe(2);
    }
  });
});
