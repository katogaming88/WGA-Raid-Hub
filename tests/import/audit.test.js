import { describe, it, expect } from 'vitest';
import { parseAudit, auditSql } from '../../scripts/import/tables/audit.js';
import { parseMplusRequests, mplusSql } from '../../scripts/import/tables/mplus.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';

function auditRows() {
  return [
    ['Timestamp', 'Changed By', 'Action', 'Target', 'Old Value', 'New Value'],
    ['1/3/2026 19:00:00', 'rex#123', 'Player Renamed', "Kael'thas-Thrall", "Kael'thas-Thrall", 'Kael-Thrall'],
    ['1/4/2026 20:00:00', '', 'Signups Opened', '', '', '']
  ];
}

describe('parseAudit + auditSql', () => {
  it('keeps actions verbatim and folds the rest into detail jsonb', () => {
    const { sql, count } = auditSql(1, parseAudit(auditRows()), 'America/New_York');
    expect(count).toBe(2);
    expect(sql).toContain("'Player Renamed'");
    expect(sql).toContain("Kael''thas-Thrall"); // escaped inside the jsonb literal
    expect(sql).toContain('changed_by');
    expect(sql).toContain("at time zone 'America/New_York'");
  });
  it('guards idempotency with NOT EXISTS instead of a conflict clause', () => {
    const { sql } = auditSql(1, parseAudit(auditRows()), 'UTC');
    expect(sql).toContain('where not exists');
    expect(sql).toContain('t.created_at = v.created_at');
    expect(sql).not.toContain('on conflict');
  });
  it('drops empty detail values (no changed_by key for early rows)', () => {
    const { sql } = auditSql(1, parseAudit(auditRows()), 'UTC');
    const opened = sql.split('\n').find((l) => l.includes('Signups Opened'));
    expect(opened).toContain('{}');
  });
});

function mplusRows() {
  return [
    ['Timestamp', 'Name-Realm', 'Raider.io URL', 'Notes', 'Status', 'Officer Note'],
    ['Jan 3, 2026 19:00', 'Hinda-Thrall', 'https://rio', 'busy tier', 'Approved', 'ok'],
    ['Jan 5, 2026 19:00', 'Departed-Thrall', '', '', 'Pending', '']
  ];
}

describe('parseMplusRequests + mplusSql', () => {
  it('lowercases statuses and emits player subselects', () => {
    const registry = buildPlayerRegistry(['Hinda-Thrall']);
    const { sql, count } = mplusSql(1, parseMplusRequests(mplusRows()), registry, 'America/New_York');
    expect(count).toBe(2);
    expect(sql).toContain("'approved'");
    expect(sql).toContain("'pending'");
    expect(sql).toContain('where not exists');
    expect(registry.stubNames()).toEqual(['Departed-Thrall']);
  });
  it('rejects unknown statuses', () => {
    const rows = mplusRows();
    rows[1][4] = 'Maybe';
    expect(() => parseMplusRequests(rows)).toThrow(/status/);
  });
  it('rejects two pending requests for one player', () => {
    const rows = mplusRows();
    rows.push(['Jan 6, 2026 19:00', 'Departed-Thrall', '', '', 'Pending', '']);
    expect(() => parseMplusRequests(rows)).toThrow(/two pending/);
  });
});
