// submit_bis_link() (#404) previously had no guard against a second
// submission while one is already pending, letting a raider pile up
// duplicate pending rows in the officer review queue for the same
// character. 20260810224022_submit_bis_link_block_duplicate_pending.sql
// adds that guard. SECURITY DEFINER, granted to anon (submitBiSForm runs
// unauthenticated on the public roster page), so these run as anon,
// matching real usage.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn } from './helpers.js';

// Seed team 1 has no bisSubmissionsOpen set (defaults closed) -- open it for
// these tests so the pending-request check is what's actually exercised,
// not the submissions-closed gate.
const openSubmissions = (q) =>
  q('update public.team_settings set config = config || \'{"bisSubmissionsOpen": true}\'::jsonb where team_id = 1');

describe('submit_bis_link duplicate-pending guard', () => {
  it('rejects a new submission while one is already pending', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await openSubmissions(q);
      // Seed player 1 (Seedraider-Illidan) already has a pending bis_requests
      // row (id 1) from supabase/seed.sql.
      await expect(
        asAnon("select public.submit_bis_link(1, 'Seedraider-Illidan', 'https://example.com/new-link', null)")
      ).rejects.toThrow(/already have a BiS submission pending/);
    });
  });

  it('succeeds for a character with no pending request', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await openSubmissions(q);
      // Seed player 2 (Seedplayertwo-Illidan) has no bis_requests row at all.
      const res = await asAnon(
        "select public.submit_bis_link(1, 'Seedplayertwo-Illidan', 'https://example.com/first-link', null) as id"
      );
      expect(res.rows[0].id).toBeTruthy();

      const after = await q('select status from public.bis_requests where player_id = 2');
      expect(after.rows).toEqual([{ status: 'pending' }]);
    });
  });

  it('allows a new submission once the prior pending request is resolved', async () => {
    await withTxn(async ({ q, asAnon }) => {
      await openSubmissions(q);
      await q("update public.bis_requests set status = 'approved' where id = 1");

      const res = await asAnon(
        "select public.submit_bis_link(1, 'Seedraider-Illidan', 'https://example.com/resubmitted', null) as id"
      );
      expect(res.rows[0].id).toBeTruthy();
    });
  });
});

afterAll(() => pool.end());
