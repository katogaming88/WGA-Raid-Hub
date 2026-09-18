// Officer corrections for self-received decisions (#756):
// delete_self_received_request() plus the revert-to-pending UPDATE path.
//
// Delete is a SECURITY DEFINER RPC because self_received_requests has no
// DELETE policy for any role (the docs/RLS.md write contract). Revert needs
// no RPC at all: the existing "Officers update self_received_requests"
// policy carries a plain status UPDATE, which is why half of this file
// asserts behavior that exists before the migration lands. The delete tests
// also pin the audit entry the RPC writes (action, actor, target, and the
// #377 summary-string detail), and the sync tests pin that reverting an
// approval never unticks bis_items.obtained (the one-way decision in
// 20260725100000) while a later re-approve re-fires the sync.
//
// Uses the shared withTxn from helpers.js, since these tests mix privileged
// fixture writes with impersonated calls and expected raises. Each test mints
// the request it acts on, for a player of its own (#1123); the seeded
// requests, players and bis_items rows are never written here.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedPlayer,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  OFFICER_T2,
  GUILD_OFFICER,
  RLS_DENIED
} from './helpers.js';

// Seeded rows this file leans on (supabase/seed.sql): team_members 3 is the
// team 1 raider (auth_user_id = RAIDER_T1); item 1 is 'Seed Test Staff'.
const RAIDER_T1_MEMBER = 3;
const SEED_ITEM = 1;

// A request in the given status for a freshly minted player (unlinked, like
// the seed's player 1, unless a member is given). Returns both ids. Inserted
// as postgres, so an approved row fires the bis sync with no bis_items row
// to fill, the same order the seed uses.
async function seedRequest(q, { teamId = 1, memberId = null, status = 'approved' } = {}) {
  const playerId = await seedPlayer(q, { teamId, memberId });
  const { rows } = await q(
    `insert into public.self_received_requests (team_id, player_id, self_item_id, status, track, source)
     values ($1, $2, $3, $4, 'Hero', 'M+') returning id`,
    [teamId, playerId, SEED_ITEM, status]
  );
  return { requestId: rows[0].id, playerId };
}

const seedBis = (q, playerId, obtained) =>
  q('insert into public.bis_items (player_id, item_id, obtained) values ($1, $2, $3)', [playerId, SEED_ITEM, obtained]);

const del = (id) => `select public.delete_self_received_request(${id})`;

describe('delete_self_received_request', () => {
  it('team officer deletes an approved row and the RPC writes the audit entry', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId, playerId } = await seedRequest(q);
      await asUser(OFFICER_T1, del(requestId));
      const gone = await q('select id from public.self_received_requests where id = $1', [requestId]);
      expect(gone.rows.length).toBe(0);
      const audit = await q(
        "select actor_id, target_type, target_id, detail from public.audit_log where action = 'Self-Received Deleted'"
      );
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].actor_id).toBe(OFFICER_T1);
      expect(audit.rows[0].target_type).toBe('players');
      expect(audit.rows[0].target_id).toBe(playerId);
      // #377 summary-string convention: detail is a JSON string, not an object.
      expect(typeof audit.rows[0].detail).toBe('string');
      expect(audit.rows[0].detail).toContain('Seed Test Staff');
      expect(audit.rows[0].detail).toContain('approved');
    });
  });

  it('team leader deletes a rejected row (any status is deletable)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q, { status: 'rejected' });
      await asUser(TEAM_LEADER_T1, del(requestId));
      expect((await q('select id from public.self_received_requests where id = $1', [requestId])).rows.length).toBe(0);
    });
  });

  it('site admin deletes a team 2 row despite holding no team role anywhere', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q, { teamId: 2 });
      await asUser(SITE_ADMIN, del(requestId));
      expect((await q('select id from public.self_received_requests where id = $1', [requestId])).rows.length).toBe(0);
    });
  });

  it('a pending row is deletable too, without a reject-then-delete two-step', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q, { status: 'pending' });
      await asUser(OFFICER_T1, del(requestId));
      expect((await q('select id from public.self_received_requests where id = $1', [requestId])).rows.length).toBe(0);
    });
  });

  it('an officer of another team is refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q);
      await expect(asUser(OFFICER_T2, del(requestId))).rejects.toThrow(/Not authorized/);
    });
  });

  it('a guild officer is refused (deliberately excluded, like every approval surface)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q);
      await expect(asUser(GUILD_OFFICER, del(requestId))).rejects.toThrow(/Not authorized/);
    });
  });

  it('a raider is refused, including on their own row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q, { memberId: RAIDER_T1_MEMBER });
      await expect(asUser(RAIDER_T1, del(requestId))).rejects.toThrow(/Not authorized/);
    });
  });

  it('anon cannot execute the function at all (no grant)', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const { requestId } = await seedRequest(q);
      await expect(asAnon(del(requestId))).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('an unknown id raises not found', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(asUser(OFFICER_T1, del(999))).rejects.toThrow(/Self-received request not found/);
    });
  });

  it('a row whose player is gone (FK SET NULL) still deletes, with the audit marker', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q);
      await q('update public.self_received_requests set player_id = null where id = $1', [requestId]);
      await asUser(OFFICER_T1, del(requestId));
      const audit = await q("select target_id, detail from public.audit_log where action = 'Self-Received Deleted'");
      expect(audit.rows.length).toBe(1);
      expect(audit.rows[0].target_id).toBeNull();
      expect(audit.rows[0].detail).toContain('player no longer on roster');
    });
  });

  it('direct DELETE stays a dead end for officers and site admins alike', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q);
      const asOfficer = await asUser(OFFICER_T1, 'delete from public.self_received_requests where id = $1', [
        requestId
      ]);
      expect(asOfficer.rowCount).toBe(0);
      const asAdmin = await asUser(SITE_ADMIN, 'delete from public.self_received_requests where id = $1', [requestId]);
      expect(asAdmin.rowCount).toBe(0);
      expect((await q('select id from public.self_received_requests where id = $1', [requestId])).rows.length).toBe(1);
    });
  });
});

describe('revert to pending rides the existing officer UPDATE policy', () => {
  const setStatus = (asUser, uid, requestId, status) =>
    asUser(uid, 'update public.self_received_requests set status = $2 where id = $1 and team_id = 1', [
      requestId,
      status
    ]);
  const revert = (asUser, uid, requestId) => setStatus(asUser, uid, requestId, 'pending');
  const statusOf = async (q, requestId) =>
    (await q('select status from public.self_received_requests where id = $1', [requestId])).rows[0].status;
  const obtainedOf = async (q, playerId) =>
    (await q('select obtained from public.bis_items where player_id = $1 and item_id = $2', [playerId, SEED_ITEM]))
      .rows[0].obtained;

  it('team officer reverts an approved row to pending', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q);
      const res = await revert(asUser, OFFICER_T1, requestId);
      expect(res.rowCount).toBe(1);
      expect(await statusOf(q, requestId)).toBe('pending');
    });
  });

  it('an officer of another team updates zero rows', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId } = await seedRequest(q);
      const res = await revert(asUser, OFFICER_T2, requestId);
      expect(res.rowCount).toBe(0);
      expect(await statusOf(q, requestId)).toBe('approved');
    });
  });

  it('a row whose player changed teams refuses to revert (team-check trigger re-fires)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId, playerId } = await seedRequest(q);
      await q('update public.players set team_id = 2 where id = $1', [playerId]);
      await expect(revert(asUser, OFFICER_T1, requestId)).rejects.toThrow(/does not match players\.team_id/);
    });
  });

  it('reverting an approval never unticks bis_items.obtained (one-way sync)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId, playerId } = await seedRequest(q);
      await seedBis(q, playerId, true);
      const res = await revert(asUser, OFFICER_T1, requestId);
      expect(res.rowCount).toBe(1);
      expect(await obtainedOf(q, playerId)).toBe(true);
    });
  });

  it('a later re-approve re-fires the sync and flips an unobtained row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { requestId, playerId } = await seedRequest(q);
      await seedBis(q, playerId, false);
      await revert(asUser, OFFICER_T1, requestId);
      expect(await obtainedOf(q, playerId)).toBe(false);
      await setStatus(asUser, OFFICER_T1, requestId, 'approved');
      expect(await obtainedOf(q, playerId)).toBe(true);
    });
  });
});

afterAll(() => pool.end());
