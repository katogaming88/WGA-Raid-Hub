// Behavior tests for notify_player() (#151) and the notifications table's RLS:
// no direct INSERT policy for anyone (tests/rls/write-policies.test.js doesn't
// cover this new table, so that's asserted here instead), notify_player() is
// the only insert path, and a raider can only read/mark-read their own rows
// via is_own_player(). Same single-transaction-plus-savepoint harness as
// tests/rls/write-audit-log.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1, SITE_ADMIN, OFFICER_T2, RLS_DENIED } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint notif_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint notif_call');
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

const notify = (asUser, uid, playerId, message) =>
  asUser(uid, 'select public.notify_player($1, $2) as id', [playerId, message]);

// Seed player 1 (Seedraider-Illidan, team 1) has no team_member_id link
// (supabase/seed.sql) -- claim.test.js relies on that same starting state, so
// this links it ephemerally within the test's own rolled-back transaction
// rather than touching the seed data.
const linkPlayer1ToRaider = (q) => q('update public.players set team_member_id = 3 where id = 1');

describe('notify_player rejects unauthorized callers', () => {
  it('anon cannot execute the function', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select public.notify_player(1, $1)', ['test'])).rejects.toThrow();
    });
  });

  it('a raider (not officer/team_leader, not site admin) is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(notify(asUser, RAIDER_T1, 1, 'test')).rejects.toThrow(/not authorized/i);
    });
  });

  it('an officer on another team is rejected for a team 1 player', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(notify(asUser, OFFICER_T2, 1, 'test')).rejects.toThrow(/not authorized/i);
    });
  });

  it('an unknown player_id raises', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(notify(asUser, OFFICER_T1, 999999, 'test')).rejects.toThrow(/unknown player_id/i);
    });
  });
});

describe('notify_player inserts a row for an authorized caller', () => {
  it("an officer's call inserts a row and returns its id", async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await notify(asUser, OFFICER_T1, 1, 'Your BiS link was approved.');
      const id = res.rows[0].id;
      expect(id).toBeGreaterThan(0);

      const row = (await q('select team_id, player_id, message, read from public.notifications where id = $1', [id]))
        .rows[0];
      expect(row.team_id).toBe(1);
      expect(row.player_id).toBe(1);
      expect(row.message).toBe('Your BiS link was approved.');
      expect(row.read).toBe(false);
    });
  });

  it('a team leader can also notify', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await notify(asUser, TEAM_LEADER_T1, 1, 'test');
      expect(res.rows[0].id).toBeGreaterThan(0);
    });
  });

  it("a site admin can notify a player on a team they don't belong to", async () => {
    await withTxn(async ({ asUser }) => {
      const res = await notify(asUser, SITE_ADMIN, 1, 'test');
      expect(res.rows[0].id).toBeGreaterThan(0);
    });
  });
});

describe('no direct table INSERT policy exists', () => {
  it('an officer cannot insert directly into notifications, only via notify_player()', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(OFFICER_T1, 'insert into public.notifications (team_id, player_id, message) values (1, 1, $1)', [
          'forged'
        ])
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});

describe('a raider can only read/mark-read their own notifications', () => {
  it('an unlinked raider sees no rows for a player they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      await notify(asUser, OFFICER_T1, 1, 'test');
      const res = await asUser(RAIDER_T1, 'select id from public.notifications where player_id = 1');
      expect(res.rows.length).toBe(0);
    });
  });

  it('a raider sees and can mark read their own notification once linked', async () => {
    await withTxn(async ({ q, asUser }) => {
      const inserted = await notify(asUser, OFFICER_T1, 1, 'Your self-received item was approved.');
      const id = inserted.rows[0].id;
      await linkPlayer1ToRaider(q);

      const seen = await asUser(RAIDER_T1, 'select id, read from public.notifications where id = $1', [id]);
      expect(seen.rows.length).toBe(1);
      expect(seen.rows[0].read).toBe(false);

      await asUser(RAIDER_T1, 'update public.notifications set read = true where id = $1', [id]);
      const after = (await q('select read from public.notifications where id = $1', [id])).rows[0];
      expect(after.read).toBe(true);
    });
  });

  it("a raider cannot mark another player's notification read", async () => {
    await withTxn(async ({ q, asUser }) => {
      const inserted = await notify(asUser, OFFICER_T1, 2, 'not yours');
      const id = inserted.rows[0].id;
      await linkPlayer1ToRaider(q);

      await asUser(RAIDER_T1, 'update public.notifications set read = true where id = $1', [id]);
      const after = (await q('select read from public.notifications where id = $1', [id])).rows[0];
      expect(after.read).toBe(false);
    });
  });
});

afterAll(() => pool.end());
