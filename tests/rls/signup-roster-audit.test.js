// #1136: add_signup_to_roster() writes audit_log rows for the character it adds
// and, on a main swap, the one it archives.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1 } from './helpers.js';

afterAll(() => pool.end());

// Seeded (supabase/seed.sql): signup 2 is team 1 'Seedapproved-Illidan',
// approved, class_spec 1 (Mage Frost Ranged). Player 2 is team 1
// 'Seedplayertwo-Illidan'.
const APPROVED_SIGNUP = 2;

const auditRows = (q) =>
  q(
    `select action, target_type, target_id, detail, actor_id
       from public.audit_log
      where action in ('Player Added', 'Main Swap: Old Character Removed')
      order by id`
  ).then((r) => r.rows);

describe('add_signup_to_roster() audit entries', () => {
  it('logs the added character, with the officer as actor', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [APPROVED_SIGNUP])).rows[0]
        .id;
      const rows = await auditRows(q);
      expect(rows).toEqual([
        {
          action: 'Player Added',
          target_type: 'players',
          target_id: id,
          detail: 'Mage Frost Ranged, from signup',
          actor_id: OFFICER_T1
        }
      ]);
    });
  });

  it('on a main swap, also logs the archived character and what replaced it', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = (
        await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1, $2, $3) as id', [APPROVED_SIGNUP, true, 2])
      ).rows[0].id;
      const rows = await auditRows(q);
      expect(rows.map((r) => [r.action, r.target_id, r.detail])).toEqual([
        ['Player Added', id, 'Mage Frost Ranged, from signup, main swap from Seedplayertwo-Illidan'],
        ['Main Swap: Old Character Removed', 2, 'Replaced by Seedapproved-Illidan']
      ]);
    });
  });

  it('still adds without a signed-in caller, and logs nothing', async () => {
    await withTxn(async ({ q }) => {
      await q('select public.add_signup_to_roster($1)', [APPROVED_SIGNUP]);
      expect(await auditRows(q)).toEqual([]);
      const status = (await q('select status from public.season_signups where id = $1', [APPROVED_SIGNUP])).rows[0];
      expect(status.status).toBe('added');
    });
  });
});
