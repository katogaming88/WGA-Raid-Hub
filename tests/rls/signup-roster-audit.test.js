// #1136: add_signup_to_roster() writes audit_log rows for the character it adds
// and, on a main swap, the one it archives.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn), and
// mints the signup it adds and the character it swaps out (#1123); the
// seeded signups and players are never written. class_spec 1 is Mage Frost
// Ranged (supabase/seed.sql).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, seedSignup, OFFICER_T1 } from './helpers.js';

afterAll(() => pool.end());

const APPROVED_NAME = 'Audited-Illidan';
const OLD_NAME = 'Auditedoldmain-Illidan';
const approvedSignup = (q) => seedSignup(q, { teamId: 1, nameRealm: APPROVED_NAME });

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
      const signup = await approvedSignup(q);
      const id = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [signup])).rows[0].id;
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
      const signup = await approvedSignup(q);
      const oldId = await seedPlayer(q, { teamId: 1, nameRealm: OLD_NAME });
      const id = (
        await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1, $2, $3) as id', [signup, true, oldId])
      ).rows[0].id;
      const rows = await auditRows(q);
      expect(rows.map((r) => [r.action, r.target_id, r.detail])).toEqual([
        ['Player Added', id, `Mage Frost Ranged, from signup, main swap from ${OLD_NAME}`],
        ['Main Swap: Old Character Removed', oldId, `Replaced by ${APPROVED_NAME}`]
      ]);
    });
  });

  it('still adds without a signed-in caller, and logs nothing', async () => {
    await withTxn(async ({ q }) => {
      const signup = await approvedSignup(q);
      await q('select public.add_signup_to_roster($1)', [signup]);
      expect(await auditRows(q)).toEqual([]);
      const status = (await q('select status from public.season_signups where id = $1', [signup])).rows[0];
      expect(status.status).toBe('added');
    });
  });
});
