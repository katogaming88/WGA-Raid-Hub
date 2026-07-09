// Behavior test for the audit_log.detail backfill migration (#377, split
// from #215). Runs the actual migration file's UPDATE statement (not a
// reimplementation of its CASE logic, to avoid drift) against synthetic rows
// inserted in the same rolled-back transaction, one per action group, and
// asserts the converted detail value.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, it, expect, afterAll } from 'vitest';
import { pool } from './helpers.js';

const migrationSql = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../supabase/migrations/20260709140000_backfill_audit_log_detail.sql'
  ),
  'utf8'
);

async function backfill(rows) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ids = [];
    for (const { action, detail } of rows) {
      const res = await client.query(
        'insert into public.audit_log (team_id, action, detail) values (1, $1, $2) returning id',
        [action, JSON.stringify(detail)]
      );
      ids.push(res.rows[0].id);
    }
    await client.query(migrationSql);
    const result = await client.query('select id, detail from public.audit_log where id = any($1) order by id', [ids]);
    return result.rows.map((r) => r.detail);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

describe('audit_log.detail backfill: both FROM and TO drive the summary', () => {
  it('Trial Status Changed', async () => {
    const [added, removed] = await backfill([
      { action: 'Trial Status Changed', detail: { target: 'A-Realm', from: 'FALSE', to: 'TRUE' } },
      { action: 'Trial Status Changed', detail: { target: 'A-Realm', from: 'TRUE', to: 'FALSE' } }
    ]);
    expect(added).toBe('Trial added');
    expect(removed).toBe('Trial removed');
  });

  it('Bench Status Changed', async () => {
    const [benched, unbenched] = await backfill([
      { action: 'Bench Status Changed', detail: { target: 'A-Realm', from: 'FALSE', to: 'TRUE' } },
      { action: 'Bench Status Changed', detail: { target: 'A-Realm', from: 'TRUE', to: 'FALSE' } }
    ]);
    expect(benched).toBe('Moved to bench');
    expect(unbenched).toBe('Removed from bench');
  });

  it('Spec/Class/Role/Join Date Changed use "Changed to {to}"', async () => {
    const [spec, cls, role, joinDate] = await backfill([
      { action: 'Spec Changed', detail: { target: 'A-Realm', from: 'Retribution', to: 'Restoration' } },
      { action: 'Class Changed', detail: { target: 'A-Realm', from: 'Paladin', to: 'Hunter' } },
      { action: 'Role Changed', detail: { target: 'A-Realm', from: 'Melee', to: 'Heal' } },
      { action: 'Join Date Changed', detail: { target: 'A-Realm', from: '2026-06-18', to: '2026-06-05' } }
    ]);
    expect(spec).toBe('Changed to Restoration');
    expect(cls).toBe('Changed to Hunter');
    expect(role).toBe('Changed to Heal');
    expect(joinDate).toBe('Changed to 2026-06-05');
  });

  it('Attendance Status Set uses "{from} -> {to}"', async () => {
    const [result] = await backfill([
      { action: 'Attendance Status Set', detail: { target: 'A-Realm', from: 'Bench', to: 'Present' } }
    ]);
    expect(result).toBe('Bench -> Present');
  });

  it('Player Renamed uses "Renamed to {to}"', async () => {
    const [result] = await backfill([
      { action: 'Player Renamed', detail: { target: 'Old-Realm', from: 'Old-Realm', to: 'New-Realm' } }
    ]);
    expect(result).toBe('Renamed to New-Realm');
  });

  it('Officer Note Changed never stores the note verbatim', async () => {
    const [result] = await backfill([
      { action: 'Officer Note Changed', detail: { target: 'A-Realm', from: 'old note text', to: 'new note text' } }
    ]);
    expect(result).toBe('Note updated');
  });

  it('BiS Approved / BiS Link Updated ignore the actual URLs', async () => {
    const [approved, linkUpdated] = await backfill([
      { action: 'BiS Approved', detail: { target: 'A-Realm', from: 'https://old', to: 'https://new' } },
      { action: 'BiS Link Updated', detail: { target: 'A-Realm', from: 'https://old', to: 'https://new' } }
    ]);
    expect(approved).toBe('Approved');
    expect(linkUpdated).toBe('Link updated');
  });
});

describe('audit_log.detail backfill: literal fallback when the optional note is blank', () => {
  it('M+ Exclusion Approved/Rejected use the note when present', async () => {
    const [approved, rejected] = await backfill([
      { action: 'M+ Exclusion Approved', detail: { target: 'A-Realm', to: 'has a good reason' } },
      { action: 'M+ Exclusion Rejected', detail: { target: 'A-Realm', to: 'not a good enough reason' } }
    ]);
    expect(approved).toBe('has a good reason');
    expect(rejected).toBe('not a good enough reason');
  });

  it('M+ Exclusion Approved/Rejected fall back to a literal summary when there is no note', async () => {
    const [approved, rejected] = await backfill([
      { action: 'M+ Exclusion Approved', detail: { target: 'A-Realm' } },
      { action: 'M+ Exclusion Rejected', detail: { target: 'A-Realm' } }
    ]);
    expect(approved).toBe('Approved');
    expect(rejected).toBe('Rejected');
  });
});

describe('audit_log.detail backfill: TO used directly as the summary', () => {
  it('a representative sample of only-TO actions', async () => {
    const [attendanceWcl, manualScore, priorityMythic, mainSwap] = await backfill([
      { action: 'Attendance Refreshed (WCL)', detail: { to: '30 nights, 1 excluded' } },
      { action: 'Manual Score Set', detail: { target: 'A-Realm', to: '6.2' } },
      { action: 'Priority Order Saved (Mythic)', detail: { target: 'Some Item', to: 'Player A, Player B' } },
      { action: 'Main Swap: Old Character Removed', detail: { target: 'Old-Realm', to: 'New-Realm' } }
    ]);
    expect(attendanceWcl).toBe('30 nights, 1 excluded');
    expect(manualScore).toBe('6.2');
    expect(priorityMythic).toBe('Player A, Player B');
    expect(mainSwap).toBe('New-Realm');
  });

  it('an empty TO becomes null, not an empty string', async () => {
    const [result] = await backfill([{ action: 'Priority Order Saved (Heroic)', detail: { target: 'Some Item' } }]);
    expect(result).toBeNull();
  });
});

describe('audit_log.detail backfill: nothing meaningful to add, detail becomes null', () => {
  it('actions with no FROM/TO/TARGET at all', async () => {
    const [exportString, pastedLoot] = await backfill([
      { action: 'Export String Generated', detail: { changed_by: 'kato_gaming' } },
      { action: 'Pasted Loot Cleared', detail: {} }
    ]);
    expect(exportString).toBeNull();
    expect(pastedLoot).toBeNull();
  });

  it('actions with a TARGET but no FROM/TO (not covered by the original map, found during reconciliation)', async () => {
    const [reportExcluded, playerRemoved, signupApproved] = await backfill([
      { action: 'Report Excluded', detail: { target: '2026-06-22', changed_by: 'kato_gaming' } },
      { action: 'Player Removed', detail: { target: 'A-Realm' } },
      { action: 'Signup Approved', detail: { target: 'A-Realm', changed_by: 'pbruh' } }
    ]);
    expect(reportExcluded).toBeNull();
    expect(playerRemoved).toBeNull();
    expect(signupApproved).toBeNull();
  });

  it('Officer Granted/Revoked are reclassified to empty since TO is a raw Discord id', async () => {
    const [granted, revoked] = await backfill([
      { action: 'Officer Granted', detail: { target: 'someuser', to: '174568935310491648' } },
      { action: 'Officer Revoked', detail: { target: 'someuser', to: '174568935310491648' } }
    ]);
    expect(granted).toBeNull();
    expect(revoked).toBeNull();
  });
});

describe('audit_log.detail backfill: rerun safety', () => {
  it('is a no-op on a row already converted to a plain string', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const res = await client.query(
        "insert into public.audit_log (team_id, action, detail) values (1, 'Trial Status Changed', to_jsonb('Trial added'::text)) returning id"
      );
      await client.query(migrationSql);
      const after = await client.query('select detail from public.audit_log where id = $1', [res.rows[0].id]);
      expect(after.rows[0].detail).toBe('Trial added');
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('leaves an already-null detail (e.g. a write_audit_log() call with no detail) untouched', async () => {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const res = await client.query(
        "insert into public.audit_log (team_id, action, detail) values (1, 'manual-test', null) returning id"
      );
      await client.query(migrationSql);
      const after = await client.query('select detail from public.audit_log where id = $1', [res.rows[0].id]);
      expect(after.rows[0].detail).toBeNull();
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});

afterAll(() => pool.end());
