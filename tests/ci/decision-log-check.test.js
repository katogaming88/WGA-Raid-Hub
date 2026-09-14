import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { shippedLines, checkDecisionLog } from '../../scripts/ci/decision-log-check.js';

// The check behind #943: docs/database-decisions.md records intent in the
// same voice as fact, and the Shipped: line is what tells them apart. These
// pin what counts as a Shipped: line, the three shapes it may take, and that
// the repo's own log passes with enough lines for the pass to mean something.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'ci', 'decision-log-check.js');

const ATTENDANCE = '20260709170000_attendance_player_id_set_null.sql';
const BIS_SEASON = '20260725135340_bis_items_item_preferences_season.sql';
const HYPHENATED = '20260828122825_backfill_mainswap_attendance_2026-08-28.sql';
const MIGRATIONS = [ATTENDANCE, BIS_SEASON, HYPHENATED];

describe('shippedLines', () => {
  it('finds a line at column 0 and one written as a list item, with line numbers, and nothing else', () => {
    const text = [
      '## 2026-09-14 -- An entry',
      '',
      'Shipped: `' + ATTENDANCE + '`',
      '- Shipped: not yet. Lands with #932.',
      'Tracking issue: #752. Shipped in `' + ATTENDANCE + '`.',
      'The migration shipped 2026-07-20 and nothing read it.'
    ].join('\n');
    expect(shippedLines(text).map((l) => l.line)).toEqual([3, 4]);
  });

  it('extracts a backticked name, a bare one, a prefixed one and two on one line, as bare filenames', () => {
    const text = [
      'Shipped: `' + ATTENDANCE + '`',
      'Shipped: ' + ATTENDANCE,
      'Shipped: `supabase/migrations/' + ATTENDANCE + '`.',
      'Shipped: `' + ATTENDANCE + '`, `' + HYPHENATED + '`'
    ].join('\n');
    expect(shippedLines(text).map((l) => l.files)).toEqual([
      [ATTENDANCE],
      [ATTENDANCE],
      [ATTENDANCE],
      [ATTENDANCE, HYPHENATED]
    ]);
  });

  it('names no file for a line with none, and a file named twice once', () => {
    const text = 'Shipped: not yet. Lands with #932.\nShipped: `' + ATTENDANCE + '` (and again `' + ATTENDANCE + '`)';
    expect(shippedLines(text).map((l) => l.files)).toEqual([[], [ATTENDANCE]]);
  });

  it('strips a carriage return before matching', () => {
    expect(shippedLines('Shipped: not yet. #932\r\n')).toEqual([{ line: 1, text: 'not yet. #932', files: [] }]);
  });
});

describe('checkDecisionLog', () => {
  it('fails a pointer to a file that is not under the migrations directory, naming the line and the file', () => {
    const text = '## Entry\n\nShipped: `20260709170001_attendance_player_id_set_null.sql`\n';
    const findings = checkDecisionLog(text, MIGRATIONS);
    expect(findings).toHaveLength(1);
    expect(findings[0].line).toBe(3);
    expect(findings[0].reason).toContain('20260709170001_attendance_player_id_set_null.sql');
  });

  it('fails a line that names no migration and does not open with one of the three forms', () => {
    // A 13-digit stamp is the case: it matches no filename and reads as prose.
    const text =
      'Shipped: 2026070917000_attendance_player_id_set_null.sql\nShipped: the editor, in the new app only (#868 part 3).\n';
    const findings = checkDecisionLog(text, MIGRATIONS);
    expect(findings.map((f) => f.line)).toEqual([1, 2]);
    expect(findings[0].reason).toMatch(/not yet.*no migration.*by hand/);
  });

  it('fails not yet and by hand with no issue named, and passes no migration alone', () => {
    const text = 'Shipped: not yet.\nShipped: by hand, no migration.\nShipped: no migration.\n';
    expect(checkDecisionLog(text, MIGRATIONS).map((f) => f.line)).toEqual([1, 2]);
  });

  it('passes the three shapes written as the log writes them', () => {
    const text = [
      'Shipped: `' + ATTENDANCE + '`, `' + BIS_SEASON + '`',
      'Shipped: not yet. Decision only; the table arrives with #932.',
      'Shipped: no migration. Convention and repo shape only.',
      'Shipped: by hand, no migration. The role grant is recorded on #1084.',
      '- Shipped: `supabase/migrations/' + HYPHENATED + '`.'
    ].join('\n');
    expect(checkDecisionLog(text, MIGRATIONS)).toEqual([]);
  });

  it('reports findings in line order and names only the bad file among two on one line', () => {
    const text = [
      'Shipped: `' + ATTENDANCE + '`, `20260709170000_attendance_player_id_set_nul.sql`',
      'Shipped: `' + BIS_SEASON + '`',
      'Shipped: soon.'
    ].join('\n');
    const findings = checkDecisionLog(text, MIGRATIONS);
    expect(findings.map((f) => f.line)).toEqual([1, 3]);
    expect(findings[0].reason).toContain('20260709170000_attendance_player_id_set_nul.sql');
    expect(findings[0].reason).not.toContain('set_null.sql');
  });
});

describe('the CLI', () => {
  function run(args) {
    try {
      const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      return { status: 0, stdout };
    } catch (err) {
      return { status: err.status, stdout: err.stdout };
    }
  }

  function fixture(logText) {
    const dir = mkdtempSync(join(tmpdir(), 'decision-log-'));
    mkdirSync(join(dir, 'migrations'));
    for (const name of MIGRATIONS) writeFileSync(join(dir, 'migrations', name), '-- fixture\n', 'utf8');
    writeFileSync(join(dir, 'log.md'), logText, 'utf8');
    return dir;
  }

  it('exits 1 and prints the finding for a broken pointer', () => {
    const dir = fixture('## Entry\n\nShipped: `20260709170000_attendance_player_id_set_nul.sql`\n');
    try {
      const result = run([join(dir, 'log.md'), join(dir, 'migrations')]);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('log.md:3: ');
      expect(result.stdout).toContain('20260709170000_attendance_player_id_set_nul.sql');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 and prints the counts for a clean log', () => {
    const dir = fixture('Shipped: `' + ATTENDANCE + '`\n\nShipped: not yet. #932\n');
    try {
      const result = run([join(dir, 'log.md'), join(dir, 'migrations')]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('2 Shipped: lines');
      expect(result.stdout).toContain('naming 1 migration file');
      expect(result.stdout).toContain('3 files under');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits 2 when the log or the migrations directory cannot be read', () => {
    expect(run([join(ROOT, 'no-such-log.md')]).status).toBe(2);
    expect(run([join(ROOT, 'docs', 'database-decisions.md'), join(ROOT, 'no-such-dir')]).status).toBe(2);
  });
});

describe('the log itself', () => {
  // The point of the check. The denominators keep an empty parse from passing.
  it('has no Shipped: line pointing at a migration that does not exist', () => {
    const text = readFileSync(join(ROOT, 'docs', 'database-decisions.md'), 'utf8');
    const lines = shippedLines(text);
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(lines.reduce((n, l) => n + l.files.length, 0)).toBeGreaterThanOrEqual(14);
    const filenames = readdirSync(join(ROOT, 'supabase', 'migrations'));
    expect(filenames.length).toBeGreaterThan(150);
    expect(checkDecisionLog(text, filenames).map((f) => f.line + ': ' + f.reason)).toEqual([]);
  });
});
