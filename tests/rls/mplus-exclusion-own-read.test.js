// A raider reads their own M+ exclusion requests, and nobody else's (#868).
// Kat decided on 2026-09-14 that a raider sees their own rejected request and
// the officer's note on their profile.
//
// Each case mints a team 1 character and a request for it inside its
// transaction (helpers.js withTxn); linking the character to team_members
// id 3 (RAIDER_T1's row) makes the request that raider's own. The seed's
// request belongs to player 1, which stays unlinked, so it is never theirs.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedPlayer, RAIDER_T1 } from './helpers.js';

afterAll(() => pool.end());

const request = async (q, playerId) =>
  (
    await q(
      `insert into public.mplus_exclusion_requests (team_id, player_id, reason, status)
       values (1, $1, 'fixture reason', 'pending') returning id`,
      [playerId]
    )
  ).rows[0].id;

const countAsRaider = async (asUser) =>
  (await asUser(RAIDER_T1, 'select count(*)::int as n from public.mplus_exclusion_requests')).rows[0].n;

describe('mplus_exclusion_requests: raiders read their own', () => {
  it('shows a raider the request for their own character', async () => {
    await withTxn(async ({ q, asUser }) => {
      await request(q, await seedPlayer(q, { memberId: 3 }));
      expect(await countAsRaider(asUser)).toBe(1);
    });
  });

  it('hides a request for a character that is not theirs', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await request(q, await seedPlayer(q, { teamId: 1 }));
      // The row is there as postgres, so the zero below is the rule and not a missing fixture.
      expect(
        (await q('select count(*)::int as n from public.mplus_exclusion_requests where id = $1', [id])).rows[0].n
      ).toBe(1);
      expect(await countAsRaider(asUser)).toBe(0);
    });
  });
});
