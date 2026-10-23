// #1609: someone signed up on a character that is not on the roster yet (a new
// main, a swap, a first main) fills in next season's wishlist on the signup,
// and add_signup_to_roster() moves it onto the roster character, whoever adds
// the signup: the team leader closing signups, an officer's single add, or the
// automatic close (#1608).
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, seedMember, seedPlayer, OFFICER_T1, RAIDER_T1, RLS_DENIED } from './helpers.js';

afterAll(() => pool.end());

const SEASON = 'wish-season';

// A tier that has not started, with the team's wishlist switch for it.
async function nextSeason(q, { wishlistOpen = true } = {}) {
  await q("update public.seasons set ends_at = '2098-12-31' where ends_at is null");
  await q(
    "insert into public.seasons (code, display_name, starts_at, ends_at) values ($1, $1, '2099-01-01', '2099-03-01')",
    [SEASON]
  );
  await q(
    'insert into public.team_seasons (team_id, season_code, signups_open, wishlist_open) values (1, $1, true, $2)',
    [SEASON, wishlistOpen]
  );
}

// A raider on Phoenix with no character on the roster, signed up on one.
async function signedUp(q, { nameRealm = 'Newmain-Illidan', status = 'pending' } = {}) {
  const member = await seedMember(q);
  const { rows } = await q(
    `insert into public.season_signups (team_id, season, person_id, auth_user_id, signup_name_realm, class_spec_id, status)
     values (1, $1, (select person_id from public.team_members where id = $2), $3, $4, 1, $5) returning id`,
    [SEASON, member.memberId, member.uid, nameRealm, status]
  );
  return { ...member, signupId: rows[0].id };
}

const anItem = async (q, offset = 0) =>
  (await q('select id from public.items order by id offset $1 limit 1', [offset])).rows[0].id;

const mark = (asUser, uid, signupId, itemId, status = 'bis', slot = 'Head') =>
  asUser(
    uid,
    'insert into public.signup_item_preferences (signup_id, item_id, status, slot) values ($1, $2, $3, $4) returning id',
    [signupId, itemId, status, slot]
  );

const rowsOf = async (q, signupId) =>
  (await q('select * from public.signup_item_preferences where signup_id = $1', [signupId])).rows;

describe('signup wishlist (#1609)', () => {
  it('lets the signer read and edit their own while the season is open, and nobody else', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const me = await signedUp(q);
      const item = await anItem(q);
      const id = (await mark(asUser, me.uid, me.signupId, item)).rows[0].id;

      await asUser(me.uid, "update public.signup_item_preferences set status = 'pass', note = 'Meh' where id = $1", [
        id
      ]);
      const mine = await asUser(me.uid, 'select status, note from public.signup_item_preferences');
      expect(mine.rows).toEqual([{ status: 'pass', note: 'Meh' }]);

      // Another raider, and an officer, neither read it nor write to it.
      expect((await asUser(RAIDER_T1, 'select * from public.signup_item_preferences')).rows).toEqual([]);
      expect((await asUser(OFFICER_T1, 'select * from public.signup_item_preferences')).rows).toEqual([]);
      await expect(mark(asUser, RAIDER_T1, me.signupId, await anItem(q, 1))).rejects.toMatchObject({
        code: RLS_DENIED
      });

      await asUser(me.uid, 'delete from public.signup_item_preferences where id = $1', [id]);
      expect(await rowsOf(q, me.signupId)).toEqual([]);
    });
  });

  it('refuses a write while the season wishlist is closed', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q, { wishlistOpen: false });
      const me = await signedUp(q);
      await expect(mark(asUser, me.uid, me.signupId, await anItem(q))).rejects.toThrow(/wishlist editing is not open/);
    });
  });

  it('is not offered for a character already on the roster, which has its own wishlist', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const me = await signedUp(q, { nameRealm: 'Staying-Illidan' });
      await seedPlayer(q, { memberId: me.memberId, nameRealm: 'Staying-Illidan' });
      await expect(mark(asUser, me.uid, me.signupId, await anItem(q))).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('holds one row per item and slot on a signup', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const me = await signedUp(q);
      const item = await anItem(q);
      await mark(asUser, me.uid, me.signupId, item);
      await expect(mark(asUser, me.uid, me.signupId, item, 'pass')).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('moves onto the roster character when the signup is added', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const me = await signedUp(q, { status: 'approved' });
      const item = await anItem(q);
      await mark(asUser, me.uid, me.signupId, item, 'bis', 'Head');
      await asUser(me.uid, "update public.signup_item_preferences set note = 'First boss'");

      const playerId = (await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1) as id', [me.signupId])).rows[0]
        .id;
      const moved = await q(
        'select team_id, item_id, status, slot, note, season from public.item_preferences where player_id = $1',
        [playerId]
      );
      expect(moved.rows).toEqual([
        { team_id: 1, item_id: item, status: 'bis', slot: 'Head', note: 'First boss', season: SEASON }
      ]);
      expect(await rowsOf(q, me.signupId)).toEqual([]);
    });
  });

  // Review on PR #1612: the character can join the roster before signups
  // close (an approved main swap, the invite link, an officer's add), and the
  // raider then edits its own wishlist. The older signup picks never replace it.
  it('keeps the wishlist a character already on the roster holds, and drops the signup picks', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const me = await signedUp(q, { status: 'approved' });
      const [signupItem, rosterItem] = [await anItem(q), await anItem(q, 1)];
      await mark(asUser, me.uid, me.signupId, signupItem);
      const playerId = await seedPlayer(q, { memberId: me.memberId, nameRealm: 'Newmain-Illidan' });
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, $1, $2, 'bis', $3)",
        [playerId, rosterItem, SEASON]
      );

      await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1)', [me.signupId]);
      const items = await q('select item_id from public.item_preferences where player_id = $1', [playerId]);
      expect(items.rows.map((r) => r.item_id)).toEqual([rosterItem]);
      expect(await rowsOf(q, me.signupId)).toEqual([]);
    });
  });

  // Review on PR #1612: an officer may update any signup column, so marking
  // one added against another raider must not rewrite that raider's wishlist.
  it("moves only onto the signup's own character", async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const me = await signedUp(q, { status: 'approved' });
      const otherId = await seedPlayer(q, { nameRealm: 'Someoneelse-Illidan' });
      const [signupItem, otherItem] = [await anItem(q), await anItem(q, 1)];
      await mark(asUser, me.uid, me.signupId, signupItem);
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, $1, $2, 'bis', $3)",
        [otherId, otherItem, SEASON]
      );

      await asUser(
        OFFICER_T1,
        "update public.season_signups set status = 'added', approved_player_id = $2 where id = $1",
        [me.signupId, otherId]
      );
      const items = await q('select item_id from public.item_preferences where player_id = $1', [otherId]);
      expect(items.rows.map((r) => r.item_id)).toEqual([otherItem]);
    });
  });

  it("leaves a swap's old character its own wishlist", async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const me = await signedUp(q, { status: 'approved' });
      const oldId = await seedPlayer(q, { memberId: me.memberId, nameRealm: 'Oldmain-Illidan' });
      const [oldItem, newItem] = [await anItem(q), await anItem(q, 1)];
      await q(
        "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, $1, $2, 'bis', $3)",
        [oldId, oldItem, SEASON]
      );
      await mark(asUser, me.uid, me.signupId, newItem);

      const newId = (
        await asUser(OFFICER_T1, 'select public.add_signup_to_roster($1, true, $2) as id', [me.signupId, oldId])
      ).rows[0].id;
      const items = async (playerId) =>
        (await q('select item_id from public.item_preferences where player_id = $1', [playerId])).rows.map(
          (r) => r.item_id
        );
      expect(await items(oldId)).toEqual([oldItem]);
      expect(await items(newId)).toEqual([newItem]);
    });
  });

  it('drops the rows when the signup is turned down, moves to another character, or is deleted', async () => {
    await withTxn(async ({ q, asUser }) => {
      await nextSeason(q);
      const item = await anItem(q);

      const rejected = await signedUp(q);
      await mark(asUser, rejected.uid, rejected.signupId, item);
      await asUser(OFFICER_T1, "update public.season_signups set status = 'rejected' where id = $1", [
        rejected.signupId
      ]);
      expect(await rowsOf(q, rejected.signupId)).toEqual([]);

      const redeclared = await signedUp(q, { nameRealm: 'Firstpick-Illidan' });
      await mark(asUser, redeclared.uid, redeclared.signupId, item);
      await q("update public.season_signups set signup_name_realm = 'First Pick-Illidan' where id = $1", [
        redeclared.signupId
      ]);
      expect(await rowsOf(q, redeclared.signupId)).toHaveLength(1);
      await q("update public.season_signups set signup_name_realm = 'Otherpick-Illidan' where id = $1", [
        redeclared.signupId
      ]);
      expect(await rowsOf(q, redeclared.signupId)).toEqual([]);

      const deleted = await signedUp(q);
      await mark(asUser, deleted.uid, deleted.signupId, item);
      await q('delete from public.season_signups where id = $1', [deleted.signupId]);
      expect(await rowsOf(q, deleted.signupId)).toEqual([]);
    });
  });
});
