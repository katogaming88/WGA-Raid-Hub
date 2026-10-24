// #1616: a character brought back from the archive by add_signup_to_roster()
// starts without the wishlist and BiS exceptions an officer gave it last
// stint, as one coming back through the invite link does. A character already
// on the roster keeps them.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { pool, withTxn, seedPlayer, seedSignup, OFFICER_T1 } from './helpers.js';

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
});
