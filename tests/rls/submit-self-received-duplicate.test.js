// #757: a second Mark Received of the same item, slot and track is refused
// while the first is pending or approved. A raider who did not see the
// confirmation clicked again and both rows landed, and with auto-approval
// both were approved with no officer in between (8 exact duplicate rows
// across 4 players on prod, 2026-08-25). The key is character, item, slot
// and track: a placeholder item (M+, Crafted, Catalyst) repeats across slots
// and a dual-slot item sits in both sibling slots, so item alone would refuse
// those. A rejected row does not block (rejection means "not this one") and a
// deleted row is gone. direct_mark_received() carries the same guard, since
// an officer misclick makes the same pair; Delete on the Requests tab is the
// way to a second row when one is truly wanted. Source and note are not in
// the key: a resubmit that changes the note is still the same report.
//
// Uses the shared withTxn from helpers.js. Every case mints the character it
// reports for (#1123); item 1 is 'Seed Test Staff'. A report auto-approves
// only when the character is linked to the caller's team_members row, so the
// approved cases mint one linked to id 3 (RAIDER_T1's row) and the pending
// cases mint one with no link. Calls run one after another on the
// transaction, and a refusing case ends on the raise.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, RAIDER_T1, OFFICER_T1 } from './helpers.js';

afterAll(() => pool.end());

const TEAM_1 = 1;
const RAIDER_T1_MEMBER = 3;
const ITEM = 'Seed Test Staff';

// Fixed names, unique to this file (players has a unique name key).
const NAME = 'Duplicate-Illidan';
const OTHER_NAME = 'Duplicateother-Illidan';

// The sentences the functions raise; the frontend shows them verbatim.
const RAIDER_PENDING = 'You already reported this item. It is waiting for an officer to review it.';
const RAIDER_APPROVED = 'You already reported this item, and it is already approved.';
const OFFICER_PENDING =
  'A report for this item is already waiting for review. Approve or reject that one instead of marking it again.';
const OFFICER_APPROVED = 'This item is already marked received for this character.';

const linked = (q) => seedPlayer(q, { memberId: RAIDER_T1_MEMBER, nameRealm: NAME });
const unlinked = (q, nameRealm = NAME) => seedPlayer(q, { teamId: TEAM_1, nameRealm });

// A raider's report: Great Vault with no note auto-approves for a linked
// character and goes pending for an unlinked one.
const submit = (asUser, { name = NAME, track = 'Hero', slot = 'Two-Hand', source = 'Great Vault' } = {}) =>
  asUser(RAIDER_T1, 'select * from public.submit_self_received($1, $2, $3, $4, $5, null, $6)', [
    TEAM_1,
    name,
    ITEM,
    track,
    source,
    slot
  ]);

const mark = (asUser, { name = NAME, track = 'Hero', slot = 'Two-Hand' } = {}) =>
  asUser(OFFICER_T1, 'select public.direct_mark_received($1, $2, $3, $4, null, null, $5) as id', [
    TEAM_1,
    name,
    ITEM,
    track,
    slot
  ]);

const rowsFor = async (q, playerId) =>
  (await q('select status from public.self_received_requests where player_id = $1 order by id', [playerId])).rows.map(
    (r) => r.status
  );

describe('submit_self_received refuses a second identical report', () => {
  it('while the first is pending', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      const first = await submit(asUser);
      expect(first.rows[0].auto_approved).toBe(false);
      expect(await rowsFor(q, playerId)).toEqual(['pending']);
      await expect(submit(asUser)).rejects.toThrow(RAIDER_PENDING);
    });
  });

  it('after the first auto-approved', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await linked(q);
      const first = await submit(asUser);
      expect(first.rows[0].auto_approved).toBe(true);
      expect(await rowsFor(q, playerId)).toEqual(['approved']);
      await expect(submit(asUser)).rejects.toThrow(RAIDER_APPROVED);
    });
  });

  it('takes the report again after the first was rejected', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      const first = await submit(asUser);
      await q('update public.self_received_requests set status = $2 where id = $1', [first.rows[0].id, 'rejected']);
      await submit(asUser);
      expect(await rowsFor(q, playerId)).toEqual(['rejected', 'pending']);
    });
  });

  it('takes the report again after the first was deleted', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      const first = await submit(asUser);
      await asUser(OFFICER_T1, 'select public.delete_self_received_request($1)', [first.rows[0].id]);
      await submit(asUser);
      expect(await rowsFor(q, playerId)).toEqual(['pending']);
    });
  });

  it('takes the same item on another slot (a dual-slot item, or a placeholder)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      await submit(asUser, { slot: 'Finger 1' });
      await submit(asUser, { slot: 'Finger 2' });
      expect(await rowsFor(q, playerId)).toEqual(['pending', 'pending']);
    });
  });

  it('takes the same item and slot on another track', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      await submit(asUser, { track: 'Hero' });
      await submit(asUser, { track: 'Myth' });
      expect(await rowsFor(q, playerId)).toEqual(['pending', 'pending']);
    });
  });

  // Rows predating #386 carry no slot, and the form sends '' for a row that
  // never had one; the two read as the same key.
  it('a legacy row with no slot refuses a report sent with no slot', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      await q(
        `insert into public.self_received_requests (team_id, player_id, self_item_id, status, track, source)
         values ($1, $2, 1, 'approved', 'Hero', 'M+')`,
        [TEAM_1, playerId]
      );
      await expect(submit(asUser, { slot: '' })).rejects.toThrow(RAIDER_APPROVED);
    });
  });

  it('a legacy row with no slot takes a report sent with one (the key is exact)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      await q(
        `insert into public.self_received_requests (team_id, player_id, self_item_id, status, track, source)
         values ($1, $2, 1, 'approved', 'Hero', 'M+')`,
        [TEAM_1, playerId]
      );
      await submit(asUser, { slot: 'Two-Hand' });
      expect(await rowsFor(q, playerId)).toEqual(['approved', 'pending']);
    });
  });

  it('another character reporting the same item is unaffected', async () => {
    await withTxn(async ({ q, asUser }) => {
      await unlinked(q);
      const otherId = await unlinked(q, OTHER_NAME);
      await submit(asUser);
      await submit(asUser, { name: OTHER_NAME });
      expect(await rowsFor(q, otherId)).toEqual(['pending']);
    });
  });
});

describe('direct_mark_received carries the same guard', () => {
  it('is refused while a report is waiting for review', async () => {
    await withTxn(async ({ q, asUser }) => {
      await unlinked(q);
      await submit(asUser);
      await expect(mark(asUser)).rejects.toThrow(OFFICER_PENDING);
    });
  });

  it('is refused while an approved row exists', async () => {
    await withTxn(async ({ q, asUser }) => {
      await linked(q);
      await submit(asUser);
      await expect(mark(asUser)).rejects.toThrow(OFFICER_APPROVED);
    });
  });

  it('marks the item after the earlier report was rejected', async () => {
    await withTxn(async ({ q, asUser }) => {
      const playerId = await unlinked(q);
      const first = await submit(asUser);
      await q('update public.self_received_requests set status = $2 where id = $1', [first.rows[0].id, 'rejected']);
      await mark(asUser);
      expect(await rowsFor(q, playerId)).toEqual(['rejected', 'approved']);
    });
  });
});
