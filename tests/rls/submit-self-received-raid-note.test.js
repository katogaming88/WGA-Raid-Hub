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
// Uses the shared withTxn from helpers.js. Item 1 is 'Seed Test Staff'.
// Auto-approval needs the named character linked to the caller's
// team_members row, so the "would auto-approve" tests below mint one linked
// to id 3 (RAIDER_T1's row) inside the transaction, where it rolls back
// with everything else; the seeded players are never written.
import { describe, it, expect, afterAll } from 'vitest';
import { withTxn as withSharedTxn, seedPlayer, RAIDER_T1 } from './helpers.js';

// Wraps the shared harness: asRaider runs one statement as the team 1
// raider, then restores postgres.
async function withTxn(fn) {
  return withSharedTxn(({ q, asUser }) => fn(q, (text, params) => asUser(RAIDER_T1, text, params)));
}

// The character every report here names, minted per case on team 1 (#1123)
// so the seeded players are never written; item 1 is 'Seed Test Staff'.
const NAME = 'Raidnote-Illidan';
const submit = (asRaider, note, source = 'Other') =>
  asRaider("select * from public.submit_self_received(1, $3, 'Seed Test Staff', 'Hero', $2, $1)", [note, source, NAME]);

// Mints the character linked to team_members id 3 (RAIDER_T1), the
// condition submit_self_received() needs to consider this raider's own
// report auto-approval-eligible. Run as the privileged pool connection (q),
// not asRaider -- players has no raider-writable team_member_id column.
const RAIDER_T1_MEMBER = 3;
const linkPlayerToAuthUser = (q) => seedPlayer(q, { memberId: RAIDER_T1_MEMBER, nameRealm: NAME });

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
      await seedPlayer(q, { nameRealm: NAME });
      const res = await submit(asRaider, 'got it in raid last night', 'Bonus Roll');
      expect(res.rows[0].id).toBeTypeOf('number');
      expect(res.rows[0].auto_approved).toBe(false);
    });
  });

  // #868: Pug raid is a Mark Received source, and its note will say "raid".
  it('auto-approves a Pug raid report whose note mentions "raid"', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, 'pugged a heroic raid last night', 'Pug raid');
      expect(res.rows[0].auto_approved).toBe(true);
    });
  });

  it('still sends an Other report to officer review with no mention of raid', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, 'timewalking vendor', 'Other');
      expect(res.rows[0].auto_approved).toBe(false);
    });
  });

  // #868: Other goes to an officer, who needs to know where it came from.
  it('refuses an Other report with no note, or only spaces', async () => {
    for (const note of ['', '   ', null]) {
      await withTxn(async (q, asRaider) => {
        await linkPlayerToAuthUser(q);
        await expect(submit(asRaider, note, 'Other')).rejects.toThrow('Say where the item came from');
      });
    }
  });

  it('still takes a report from any other source without a note', async () => {
    await withTxn(async (q, asRaider) => {
      await linkPlayerToAuthUser(q);
      const res = await submit(asRaider, null, 'Bonus Roll');
      expect(res.rows[0].auto_approved).toBe(true);
    });
  });
});
