// Behavior tests for write_audit_log() (#214, Phase 4): the only insert path
// onto audit_log (tests/rls/write-policies.test.js asserts a raw insert is
// denied to every role). Same single-transaction-plus-savepoint harness as
// tests/rls/claim.test.js: the write and its verification must share one
// transaction so the insert is visible before the whole thing rolls back.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1, SITE_ADMIN, OFFICER_T2 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint audit_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint audit_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    const asAnon = (text, params) => asRole('anon', null)(text, params);
    return await fn({ q, asUser, asAnon });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const write = (asUser, uid, teamId, action, targetType, targetId, detail) =>
  asUser(uid, 'select public.write_audit_log($1, $2, $3, $4, $5) as id', [
    teamId,
    action,
    targetType ?? null,
    targetId ?? null,
    detail ? JSON.stringify(detail) : null
  ]);

describe('write_audit_log rejects unauthorized callers', () => {
  it('anon cannot execute the function', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select public.write_audit_log(1, $1)', ['test-action'])).rejects.toThrow();
    });
  });

  it('a raider (not officer/team_leader, not site admin) is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(write(asUser, RAIDER_T1, 1, 'test-action')).rejects.toThrow(/not authorized/i);
    });
  });

  it('an officer on another team is rejected for team 1', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(write(asUser, OFFICER_T2, 1, 'test-action')).rejects.toThrow(/not authorized/i);
    });
  });
});

describe('write_audit_log records the caller and writes a row', () => {
  it("an officer's call inserts a row with actor_id set to their own uid and returns its id", async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await write(asUser, OFFICER_T1, 1, 'test-action');
      const id = res.rows[0].id;
      expect(id).toBeGreaterThan(0);

      const row = (await q('select team_id, actor_id, action from public.audit_log where id = $1', [id])).rows[0];
      expect(row.team_id).toBe(1);
      expect(row.actor_id).toBe(OFFICER_T1);
      expect(row.action).toBe('test-action');
    });
  });

  it('a team leader can also write', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await write(asUser, TEAM_LEADER_T1, 1, 'test-action');
      expect(res.rows[0].id).toBeGreaterThan(0);
    });
  });

  it("a site admin can write for a team they don't belong to", async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await write(asUser, SITE_ADMIN, 1, 'test-action');
      const id = res.rows[0].id;
      const row = (await q('select actor_id from public.audit_log where id = $1', [id])).rows[0];
      expect(row.actor_id).toBe(SITE_ADMIN);
    });
  });

  it('target_type/target_id/detail default to null when omitted', async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await write(asUser, OFFICER_T1, 1, 'test-action');
      const id = res.rows[0].id;
      const row = (await q('select target_type, target_id, detail from public.audit_log where id = $1', [id])).rows[0];
      expect(row.target_type).toBeNull();
      expect(row.target_id).toBeNull();
      expect(row.detail).toBeNull();
    });
  });

  it('target_type/target_id/detail round-trip when supplied', async () => {
    await withTxn(async ({ q, asUser }) => {
      const detail = { before: { role: 'raider' }, after: { role: 'officer' } };
      const res = await write(asUser, OFFICER_T1, 1, 'promote', 'team_members', 3, detail);
      const id = res.rows[0].id;
      const row = (await q('select target_type, target_id, detail from public.audit_log where id = $1', [id])).rows[0];
      expect(row.target_type).toBe('team_members');
      expect(row.target_id).toBe(3);
      expect(row.detail).toEqual(detail);
    });
  });
});

afterAll(() => pool.end());
