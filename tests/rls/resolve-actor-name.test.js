// Behavior tests for resolve_actor_name() (#376, split from #215): resolves
// audit_log.actor_id to a display name for the Audit Log tab's CHANGED BY
// column. Same single-transaction-plus-savepoint harness as
// tests/rls/write-audit-log.test.js -- fixture writes and the resolve call
// share one transaction so setup is visible before the whole thing rolls
// back.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, RAIDER_T1, SITE_ADMIN, OFFICER_T2 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint resolve_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint resolve_call');
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

const resolve = (asUser, callerUid, actorId, teamId) =>
  asUser(callerUid, 'select public.resolve_actor_name($1, $2) as name', [actorId, teamId]);

describe('resolve_actor_name rejects unauthorized callers', () => {
  it('anon cannot execute the function', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select public.resolve_actor_name($1, 1)', [OFFICER_T1])).rejects.toThrow();
    });
  });

  it('a raider (not officer/team_leader, not site admin) is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(resolve(asUser, RAIDER_T1, OFFICER_T1, 1)).rejects.toThrow(/not authorized/i);
    });
  });

  it("an officer on another team is rejected for team 1's audit log", async () => {
    await withTxn(async ({ asUser }) => {
      await expect(resolve(asUser, OFFICER_T2, OFFICER_T1, 1)).rejects.toThrow(/not authorized/i);
    });
  });
});

describe('resolve_actor_name resolves the linked character', () => {
  it('prefers the nickname when set', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("update public.players set team_member_id = 3, nickname = 'Kato' where id = 1");
      const res = await resolve(asUser, OFFICER_T1, RAIDER_T1, 1);
      expect(res.rows[0].name).toBe('Kato');
    });
  });

  it('falls back to the character-name part of name_realm when no nickname is set', async () => {
    await withTxn(async ({ q, asUser }) => {
      await q('update public.players set team_member_id = 3 where id = 1');
      const res = await resolve(asUser, OFFICER_T1, RAIDER_T1, 1);
      expect(res.rows[0].name).toBe('Seedraider');
    });
  });

  it('falls back to the team_members.name_realm bridge column when no player is linked', async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await resolve(asUser, OFFICER_T1, RAIDER_T1, 1);
      expect(res.rows[0].name).toBe('Seedraider');
    });
  });

  it("a site admin can resolve a normal member's name too", async () => {
    await withTxn(async ({ q, asUser }) => {
      await q("update public.players set team_member_id = 3, nickname = 'Kato' where id = 1");
      const res = await resolve(asUser, SITE_ADMIN, RAIDER_T1, 1);
      expect(res.rows[0].name).toBe('Kato');
    });
  });
});

describe('resolve_actor_name falls back to the Discord display name', () => {
  it("a site admin acting on a team they don't belong to resolves via auth.users metadata", async () => {
    await withTxn(async ({ q, asUser }) => {
      const uid = '00000000-0000-0000-0000-0000000000ee';
      await q('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [
        uid,
        JSON.stringify({ full_name: 'Some Admin' })
      ]);
      const res = await resolve(asUser, SITE_ADMIN, uid, 1);
      expect(res.rows[0].name).toBe('Some Admin');
    });
  });

  it('falls back to the metadata "name" key when full_name is absent', async () => {
    await withTxn(async ({ q, asUser }) => {
      const uid = '00000000-0000-0000-0000-0000000000ff';
      await q('insert into auth.users (id, raw_user_meta_data) values ($1, $2)', [
        uid,
        JSON.stringify({ name: 'Fallback Name' })
      ]);
      const res = await resolve(asUser, SITE_ADMIN, uid, 1);
      expect(res.rows[0].name).toBe('Fallback Name');
    });
  });

  it('returns null for an actor uuid not found anywhere', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await resolve(asUser, SITE_ADMIN, '00000000-0000-0000-0000-000000009999', 1);
      expect(res.rows[0].name).toBeNull();
    });
  });
});

afterAll(() => pool.end());
