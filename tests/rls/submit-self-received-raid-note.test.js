// submit_self_received() sends a request to officer review (status
// 'pending', auto_approved = false) instead of auto-approving it, whenever
// the note mentions "raid" as its own word -- raiders kept using the
// 'Other' source to describe an actual team raid drop, which would have
// double-counted once the officer's RCLootCouncil import processed the same
// drop for real. #1025 replaced an earlier version of this guard that
// rejected the submission outright (regardless of source): a raider
// honestly describing a real non-raid pickup ("pugged this in a heroic
// raid, got it from my vault") got rejected too, even though their selected
// source already said the item wasn't an undeclared team raid drop. Routing
// to officer review instead of rejecting means a genuine report can still
// get through -- an officer decides case by case.
//
// Same withTxn harness as tests/rls/self-received-corrections.test.js.
// Seed player 1 is team 1 'Seedraider-Illidan'; item 1 is 'Seed Test Staff'.
// Player 1 has no team_member_id in the seed, so auto-approval is never
// otherwise reachable -- the "would auto-approve" tests below link it to
// team_members id 3 (RAIDER_T1's row) inside the transaction so it rolls
// back with everything else.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, RAIDER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRaider = async (text, params) => {
      await q('savepoint raid_note_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: RAIDER_T1, role: 'authenticated' })
      ]);
      await q('set local role authenticated');
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint raid_note_call');
        throw err;
      }
    };
    return await fn(q, asRaider);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

const submit = (asRaider, note, source = 'Other') =>
  asRaider("select * from public.submit_self_received(1, 'Seedraider-Illidan', 'Seed Test Staff', 'Hero', $2, $1)", [
    note,
    source
  ]);

// Links seed player 1 to team_members id 3 (RAIDER_T1), the condition
// submit_self_received() needs to consider this raider's own report
// auto-approval-eligible. Run as the privileged pool connection (q), not
// asRaider -- players has no raider-writable team_member_id column.
const linkPlayerToAuthUser = (q) => q('update public.players set team_member_id = 3 where id = 1');

describe('submit_self_received: self-reported raid loot', () => {
  it('sends a note mentioning "raid" to officer review, not auto-approve, even when otherwise eligible', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, 'got it in raid last night', 'Great Vault');
      expect(res.rows[0].auto_approved).toBe(false);
      const row = await q('select status from public.self_received_requests where id = $1', [res.rows[0].id]);
      expect(row.rows[0].status).toBe('pending');
    });
  });

  it('is case-insensitive and matches mid-sentence', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, 'Raid drop, boss killed it', 'Great Vault');
      expect(res.rows[0].auto_approved).toBe(false);
    });
  });

  it('does not false-positive on a word that merely contains "raid" as a substring', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, 'saw it on raidbots beforehand', 'Great Vault');
      expect(res.rows[0].auto_approved).toBe(true);
    });
  });

  it('still auto-approves a normal, eligible report with no mention of raid', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, 'got it from my weekly vault', 'Great Vault');
      expect(res.rows[0].auto_approved).toBe(true);
    });
  });

  it('accepts (does not reject) a note mentioning "raid" on source Other -- goes pending, same as any Other report', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, 'got it in raid last night', 'Other');
      expect(res.rows[0].id).toBeTypeOf('number');
      expect(res.rows[0].auto_approved).toBe(false);
    });
  });

  it('accepts a note mentioning "raid" when not otherwise auto-approval-eligible (no team_member_id link)', async () => {
    await withTxn(async (q, asRaider) => {
      const res = await submit(asRaider, 'got it in raid last night', 'Bonus Roll');
      expect(res.rows[0].id).toBeTypeOf('number');
      expect(res.rows[0].auto_approved).toBe(false);
    });
  });
});
