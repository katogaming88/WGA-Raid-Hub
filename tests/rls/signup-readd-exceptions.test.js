// #1616: a character brought back from the archive by add_signup_to_roster()
// starts without the wishlist and BiS exceptions an officer gave it last
// stint, as one coming back through the invite link does. A character already
// on the roster keeps them.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, seedPlayer, seedSignup, OFFICER_T1, OFFICER_T2, RAIDER_T1 } from './helpers.js';

afterAll(() => pool.end());

async function withExceptions(q, archived) {
  const nameRealm = `Readd${randomUUID().slice(0, 6)}-Illidan`;
  const id = await seedPlayer(q, { teamId: 1, nameRealm });
  await q(
    `update public.players set wishlist_allowed = true, bis_allowed = true,
            archived_at = case when $2 then now() end
      where id = $1`,
    [id, archived]
  );
  return { id, signup: await seedSignup(q, { teamId: 1, nameRealm }) };
}

const exceptions = async (q, id) =>
  (await q('select wishlist_allowed, bis_allowed, archived_at from public.players where id = $1', [id])).rows[0];

describe('add_signup_to_roster() and the officer exceptions', () => {
  it('turns both off for a character it brings back from the archive', async () => {
    await withTxn(async ({ q, asUser }) => {
      const p = await withExceptions(q, true);
      await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1)', [p.signup]);
      expect(await exceptions(q, p.id)).toEqual({ wishlist_allowed: false, bis_allowed: false, archived_at: null });
    });
  });

  it('leaves them on for a character already on the roster', async () => {
    await withTxn(async ({ q, asUser }) => {
      const p = await withExceptions(q, false);
      await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1)', [p.signup]);
      expect(await exceptions(q, p.id)).toEqual({ wishlist_allowed: true, bis_allowed: true, archived_at: null });
    });
  });

  // The matching refused cases (CodeRabbit on #1617): another team's officer,
  // a raider and a signed-out caller cannot add the signup, and the character
  // is left exactly as it was, archived or not.
  for (const archived of [true, false]) {
    it(`is refused to everyone but the team's officers, changing nothing (${archived ? 'archived' : 'on the roster'})`, async () => {
      await withTxn(async ({ q, asUser, asAnon }) => {
        const p = await withExceptions(q, archived);
        const before = await exceptions(q, p.id);
        const add = 'select public.add_signup_to_roster($1)';
        for (const call of [
          () => asUser(OFFICER_T2, add, [p.signup]),
          () => asUser(RAIDER_T1, add, [p.signup]),
          () => asAnon(add, [p.signup])
        ]) {
          await expect(call()).rejects.toThrow();
          expect(await exceptions(q, p.id)).toEqual(before);
        }
      });
    });
  }
});
