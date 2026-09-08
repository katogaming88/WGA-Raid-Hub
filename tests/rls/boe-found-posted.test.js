// boe_items.found_posted_at (#956): the one-post-per-row claim the found
// Discord post takes before it posts. boe-webhook used to post whatever its
// caller sent it, and its caller is a public unauthenticated form, so anyone
// holding the anon key could put any text in the guild's channel. It takes a
// row id now and posts what the row holds, which needs exactly one guarantee
// from the database: a given find is claimable once.
//
// The column is written by the service role alone, and nothing new enforces
// that. check_boe_status_transition() is an allow-list by subtraction -- it
// compares old and new with the metadata columns removed and raises on any
// other difference -- so a column added outside that list is refused for
// `authenticated` the day it exists, the same argument #889 made for
// finder_discord_id. Anon and a plain raider never reach the trigger at all:
// the UPDATE policy is is_boe_manager() or is_site_admin(), so their
// statement matches no row and succeeds with rowCount 0 rather than raising.
// Both shapes are asserted below, because they are different denials.
//
// Same withTxn harness as tests/rls/boe.test.js (unique savepoint name): a
// case here asserts a raise, and without a savepoint per call an expected
// failure aborts the shared transaction and masks the real error.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, OFFICER_T1, RAIDER_T1 } from './helpers.js';

async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint found_posted_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint found_posted_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    const asAnon = (text, params) => asRole('anon', null)(text, params);
    // The real role, not the bare postgres connection the older bot-table
    // tests use. Both bypass RLS, but only this one is what the Edge Function
    // actually connects as, and the transition trigger branches on
    // current_user, so the role under test has to be the role in production.
    const asService = (text, params) => asRole('service_role', null)(text, params);
    return await fn({ q, asUser, asAnon, asService });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

// The claim exactly as the function issues it: an id, and the column still
// null. Two callers racing on one id both run this, and Postgres serialises
// them, so the second sees a non-null column and matches nothing.
const CLAIM =
  'update public.boe_items set found_posted_at = now() where id = $1 and found_posted_at is null returning id';

afterAll(() => pool.end());

describe('found_posted_at exists and starts null (#956)', () => {
  // Green on both sides of the migration, deliberately: a red control means
  // the local stack is wrong rather than the change (the 2026-09-05 entry,
  // where a healthy container refused every connection and 21 cases blamed
  // themselves).
  it('control: a manager can still edit the note on a found row', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(OFFICER_T1, "update public.boe_items set note = 'control' where id = 1 returning id");
      expect(res.rowCount).toBe(1);
    });
  });

  it('a fresh find from the public form has no claim on it', async () => {
    await withTxn(async ({ asAnon }) => {
      const submitted = await asAnon(
        "select public.submit_boe_found(1, 'Seedraider-Illidan', 'Seed Test Staff', 'Hero', null, false, '2/6') as id"
      );
      const id = submitted.rows[0].id;
      expect(id).toBeGreaterThan(0);
      const row = await asAnon('select found_posted_at from public.boe_items where id = $1', [id]);
      // Anon cannot read boe_items, so the row it just created is invisible to
      // it; the read that matters is the service role's, below.
      expect(row.rowCount).toBe(0);
    });
  });

  it('a new find carries a null claim when the poster reads it', async () => {
    await withTxn(async ({ asAnon, asService }) => {
      const submitted = await asAnon(
        "select public.submit_boe_found(1, 'Seedraider-Illidan', 'Seed Test Staff', 'Hero', null, false, '2/6') as id"
      );
      const id = submitted.rows[0].id;
      const row = await asService('select found_posted_at from public.boe_items where id = $1', [id]);
      expect(row.rows[0].found_posted_at).toBeNull();
    });
  });
});

describe('the claim is takeable once (#956)', () => {
  it('the service role claims a row, and the same claim again matches nothing', async () => {
    await withTxn(async ({ asService }) => {
      const first = await asService(CLAIM, [1]);
      expect(first.rowCount).toBe(1);
      expect(first.rows[0].id).toBe(1);
      const second = await asService(CLAIM, [1]);
      expect(second.rowCount).toBe(0);
    });
  });

  it('releasing the claim makes the row postable again', async () => {
    // What the function does when Discord refuses the post: the find is
    // recorded either way, so a failed post must not cost the row its one
    // chance at a message.
    await withTxn(async ({ asService }) => {
      await asService(CLAIM, [1]);
      const released = await asService('update public.boe_items set found_posted_at = null where id = 1 returning id');
      expect(released.rowCount).toBe(1);
      const again = await asService(CLAIM, [1]);
      expect(again.rowCount).toBe(1);
    });
  });
});

describe('nobody but the service role writes the claim (#956)', () => {
  it('a BoE manager is refused by the transition trigger, with its own message', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(OFFICER_T1, 'update public.boe_items set found_posted_at = now() where id = 1')
      ).rejects.toThrow(/go through the BoE RPCs/);
    });
  });

  it('a plain raider matches no row rather than raising', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await asUser(RAIDER_T1, 'update public.boe_items set found_posted_at = now() where id = 1');
      expect(res.rowCount).toBe(0);
    });
  });

  it('anon matches no row rather than raising', async () => {
    await withTxn(async ({ asAnon }) => {
      const res = await asAnon('update public.boe_items set found_posted_at = now() where id = 1');
      expect(res.rowCount).toBe(0);
    });
  });
});
