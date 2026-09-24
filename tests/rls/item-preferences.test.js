// RLS assertions for item_preferences (#515 Phase 1, the raider wishlist):
// no public read (unlike bis_items), a raider manages only their own rows
// via is_own_player(), and only in a season their team has opened (#936),
// and officers can read but not write directly. Uses the shared withTxn from
// helpers.js.
import { randomUUID } from 'node:crypto';
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedPlayer,
  seedSeason,
  OFFICER_T1,
  RAIDER_T1,
  OFFICER_T2,
  SITE_ADMIN,
  GUILD_OFFICER,
  RLS_DENIED
} from './helpers.js';

// Every case mints the player its rows belong to (#1123): ownPlayer is a
// character of RAIDER_T1's (linked to team_members 3, the team 1 raider),
// otherPlayer one nobody has claimed. The seeded players are never written.
// ownPlayer carries the per-raider wishlist override, because every case
// outside the gate's own block is about who may write, not when (#936); the
// gate's cases use gatedPlayer, the same character without it.
const RAIDER_T1_MEMBER = 3;
const OFFICER_T1_MEMBER = 1;
const gatedPlayer = (q, memberId = RAIDER_T1_MEMBER) => seedPlayer(q, { memberId });
const ownPlayer = async (q) => {
  const pid = await gatedPlayer(q);
  await q('update public.players set wishlist_allowed = true where id = $1', [pid]);
  return pid;
};
const otherPlayer = (q) => seedPlayer(q);

describe('anon has no read access to item_preferences', () => {
  it('anon sees no rows even once one exists', async () => {
    await withTxn(async ({ q, asAnon }) => {
      const pid = await otherPlayer(q);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')", [
        pid
      ]);
      const res = await asAnon('select id from public.item_preferences');
      expect(res.rows.length).toBe(0);
    });
  });
});

describe('a raider manages only their own item_preferences', () => {
  it('an unlinked raider cannot see a row for a player they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await otherPlayer(q);
      await q("insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')", [
        pid
      ]);
      const res = await asUser(RAIDER_T1, 'select id from public.item_preferences where player_id = $1', [pid]);
      expect(res.rows.length).toBe(0);
    });
  });

  it('a linked raider can insert, read, update, and delete their own row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);

      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, $1, 1, 'bis', 'my first pick') returning id",
        [pid]
      );
      const id = inserted.rows[0].id;

      const seen = await asUser(RAIDER_T1, 'select status, note from public.item_preferences where id = $1', [id]);
      expect(seen.rows[0]).toMatchObject({ status: 'bis', note: 'my first pick' });

      await asUser(RAIDER_T1, "update public.item_preferences set status = 'pass' where id = $1", [id]);
      const afterUpdate = (await q('select status from public.item_preferences where id = $1', [id])).rows[0];
      expect(afterUpdate.status).toBe('pass');

      await asUser(RAIDER_T1, 'delete from public.item_preferences where id = $1', [id]);
      const afterDelete = (await q('select id from public.item_preferences where id = $1', [id])).rows;
      expect(afterDelete.length).toBe(0);
    });
  });

  it('a raider cannot insert a row for a player they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await otherPlayer(q);
      await expect(
        asUser(
          RAIDER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')",
          [pid]
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it('the status CHECK constraint rejects an unrecognised tier', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await expect(
        asUser(
          RAIDER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'major_upgrade')",
          [pid]
        )
      ).rejects.toThrow();
    });
  });
});

describe('officers can read but not directly write item_preferences', () => {
  it('a team 1 officer sees a row a raider owns', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')",
        [pid]
      );
      const res = await asUser(OFFICER_T1, 'select id from public.item_preferences where player_id = $1', [pid]);
      expect(res.rows.length).toBe(1);
    });
  });

  it("a team 2 officer cannot see a team 1 raider's row", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')",
        [pid]
      );
      const res = await asUser(OFFICER_T2, 'select id from public.item_preferences where player_id = $1', [pid]);
      expect(res.rows.length).toBe(0);
    });
  });

  it('an officer cannot insert a row for a raider directly (no officer write policy)', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await expect(
        asUser(
          OFFICER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')",
          [pid]
        )
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });

  it("a site admin sees a team 1 raider's row (cross-team view access)", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')",
        [pid]
      );
      const res = await asUser(SITE_ADMIN, 'select id from public.item_preferences where player_id = $1', [pid]);
      expect(res.rows.length).toBe(1);
    });
  });

  it("a guild officer sees a team 1 raider's row (cross-team view access)", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status) values (1, $1, 1, 'bis')",
        [pid]
      );
      const res = await asUser(GUILD_OFFICER, 'select id from public.item_preferences where player_id = $1', [pid]);
      expect(res.rows.length).toBe(1);
    });
  });
});

describe('officers can clear (but not otherwise edit) a raider note', () => {
  it('a team 1 officer can null out a note on a team 1 raider row', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, $1, 1, 'bis', 'redundant note') returning id",
        [pid]
      );
      const id = inserted.rows[0].id;

      await asUser(OFFICER_T1, 'update public.item_preferences set note = null where id = $1', [id]);
      const after = (await q('select note from public.item_preferences where id = $1', [id])).rows[0];
      expect(after.note).toBeNull();
    });
  });

  it('an officer cannot set a note to a non-null value', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, $1, 1, 'bis', 'original note') returning id",
        [pid]
      );
      const id = inserted.rows[0].id;

      await expect(
        asUser(OFFICER_T1, "update public.item_preferences set note = 'rewritten' where id = $1", [id])
      ).rejects.toThrow();
    });
  });

  it('an officer cannot change status/item_id/slot via this path', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, $1, 1, 'bis', 'a note') returning id",
        [pid]
      );
      const id = inserted.rows[0].id;

      await expect(
        asUser(OFFICER_T1, "update public.item_preferences set status = 'pass' where id = $1", [id])
      ).rejects.toThrow();
      await expect(
        asUser(OFFICER_T1, "update public.item_preferences set slot = 'Neck' where id = $1", [id])
      ).rejects.toThrow();
    });
  });

  it("a team 2 officer cannot clear a team 1 raider's note", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, $1, 1, 'bis', 'a note') returning id",
        [pid]
      );
      const id = inserted.rows[0].id;

      const res = await asUser(
        OFFICER_T2,
        'update public.item_preferences set note = null where id = $1 returning id',
        [id]
      );
      expect(res.rows.length).toBe(0);
      const after = (await q('select note from public.item_preferences where id = $1', [id])).rows[0];
      expect(after.note).toBe('a note');
    });
  });

  it("a raider's own unrestricted self-update still works (owner exemption regression guard)", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, note) values (1, $1, 1, 'bis', 'a note') returning id",
        [pid]
      );
      const id = inserted.rows[0].id;

      await asUser(
        RAIDER_T1,
        "update public.item_preferences set status = 'good', note = 'edited by me' where id = $1",
        [id]
      );
      const after = (await q('select status, note from public.item_preferences where id = $1', [id])).rows[0];
      expect(after).toMatchObject({ status: 'good', note: 'edited by me' });
    });
  });
});

describe('the slot-override unique index allows the same placeholder item once per slot', () => {
  it('a raider can tag the same item_id with two different slots but not the same slot twice', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, $1, 1, 'bis', 'Neck')",
        [pid]
      );
      await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, $1, 1, 'good', 'Ring')",
        [pid]
      );
      const rows = (
        await q('select slot, status from public.item_preferences where player_id = $1 order by slot', [pid])
      ).rows;
      expect(rows).toEqual([
        { slot: 'Neck', status: 'bis' },
        { slot: 'Ring', status: 'good' }
      ]);

      await expect(
        asUser(
          RAIDER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status, slot) values (1, $1, 1, 'ok', 'Neck')",
          [pid]
        )
      ).rejects.toThrow();
    });
  });
});

// #936: the last season column holding a display name. Every other season
// column references seasons(code); this one referenced seasons(display_name),
// so both writers resolved a code and converted it to a name for this column
// alone. The foreign key is the assertion: with it on code, a name has nowhere
// to land and the conversion cannot half-happen.
describe('item_preferences.season holds a season code', () => {
  it('a raider can stamp their row with a season code', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await asUser(
        RAIDER_T1,
        "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, $1, 1, 'bis', 'MID2') returning id",
        [pid]
      );
      const after = (await q('select season from public.item_preferences where id = $1', [inserted.rows[0].id]))
        .rows[0];
      expect(after.season).toBe('MID2');
    });
  });

  it('a display name is refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      await expect(
        asUser(
          RAIDER_T1,
          "insert into public.item_preferences (team_id, player_id, item_id, status, season) values (1, $1, 1, 'bis', 'Midnight Season 2')",
          [pid]
        )
      ).rejects.toMatchObject({ code: '23503' });
    });
  });
});

// #936's second half: the Wishlist page closes when the team has not opened
// wishlist editing for the season, and the database now refuses the same
// writes, so a closed switch holds for a stale page or a direct call too. The
// test is the team_seasons row for the row's own season, or the raider's
// per-raider override. Each case mints its tier so no two files share a
// team_seasons key.
const PICK =
  "insert into public.item_preferences (team_id, player_id, item_id, status, note, season) values (1, $1, 1, 'bis', 'a note', $2) returning id";
const CLOSED = /wishlist editing is not open/;

async function tier(q, wishlistOpen) {
  const code = `T${randomUUID().slice(0, 7)}`;
  await seedSeason(q, code);
  if (wishlistOpen !== undefined) {
    await q('insert into public.team_seasons (team_id, season_code, wishlist_open) values (1, $1, $2)', [
      code,
      wishlistOpen
    ]);
  }
  return code;
}

describe('a raider writes to their wishlist only in a season the team has opened', () => {
  it('refuses an insert when the team has no row for the season', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const season = await tier(q);
      await expect(asUser(RAIDER_T1, PICK, [pid, season])).rejects.toThrow(CLOSED);
    });
  });

  it('refuses an insert when the season is there with wishlist editing off', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const season = await tier(q, false);
      await expect(asUser(RAIDER_T1, PICK, [pid, season])).rejects.toThrow(CLOSED);
    });
  });

  it('accepts an insert in an opened season, and the row keeps that code', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const season = await tier(q, true);
      const inserted = await asUser(RAIDER_T1, PICK, [pid, season]);
      const row = (await q('select season from public.item_preferences where id = $1', [inserted.rows[0].id])).rows[0];
      expect(row.season).toBe(season);
    });
  });

  it('refuses an insert filed under a different season from the one the team opened', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      await tier(q, true);
      const other = await tier(q);
      await expect(asUser(RAIDER_T1, PICK, [pid, other])).rejects.toThrow(CLOSED);
    });
  });

  it('refuses a row with no season unless the raider has the override', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      await tier(q, true);
      await expect(asUser(RAIDER_T1, PICK, [pid, null])).rejects.toThrow(CLOSED);
    });
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await asUser(RAIDER_T1, PICK, [pid, null]);
      expect(inserted.rows.length).toBe(1);
    });
  });

  it('the per-raider override opens a closed season, as the Wishlist page does', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const season = await tier(q, false);
      const inserted = await asUser(RAIDER_T1, PICK, [pid, season]);
      expect(inserted.rows.length).toBe(1);
    });
  });

  it('refuses an update and a delete once the season closes, and reads stay open', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const season = await tier(q, true);
      const id = (await asUser(RAIDER_T1, PICK, [pid, season])).rows[0].id;
      await q('update public.team_seasons set wishlist_open = false where team_id = 1 and season_code = $1', [season]);

      await expect(
        asUser(RAIDER_T1, "update public.item_preferences set status = 'pass' where id = $1", [id])
      ).rejects.toThrow(CLOSED);
      await expect(asUser(RAIDER_T1, 'delete from public.item_preferences where id = $1', [id])).rejects.toThrow(
        CLOSED
      );

      const seen = await asUser(RAIDER_T1, 'select status from public.item_preferences where id = $1', [id]);
      expect(seen.rows).toEqual([{ status: 'bis' }]);
    });
  });

  it('refuses moving a row from an opened season into a closed one', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const open = await tier(q, true);
      const closed = await tier(q, false);
      const id = (await asUser(RAIDER_T1, PICK, [pid, open])).rows[0].id;
      await expect(
        asUser(RAIDER_T1, 'update public.item_preferences set season = $2 where id = $1', [id, closed])
      ).rejects.toThrow(CLOSED);
    });
  });

  it("an officer still clears a raider's note while the season is closed", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const season = await tier(q, true);
      const id = (await asUser(RAIDER_T1, PICK, [pid, season])).rows[0].id;
      await q('update public.team_seasons set wishlist_open = false where team_id = 1 and season_code = $1', [season]);

      await asUser(OFFICER_T1, 'update public.item_preferences set note = null where id = $1', [id]);
      const after = (await q('select note from public.item_preferences where id = $1', [id])).rows[0];
      expect(after.note).toBeNull();
    });
  });

  // The officers' note-clearing policy lets an officer update any row on their
  // team, and the note-only trigger steps aside for a row that is their own,
  // so an officer's own character is where a gate written into the policies
  // alone would leak.
  it("an officer's own character is held by the switch like anyone else's", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q, OFFICER_T1_MEMBER);
      const season = await tier(q, true);
      const id = (await asUser(OFFICER_T1, PICK, [pid, season])).rows[0].id;
      await q('update public.team_seasons set wishlist_open = false where team_id = 1 and season_code = $1', [season]);

      await expect(
        asUser(OFFICER_T1, "update public.item_preferences set status = 'pass' where id = $1", [id])
      ).rejects.toThrow(CLOSED);
    });
  });

  // The gate asks about the season on the row, where the page asks about the
  // season it plans for. A row from another season is held by that season's
  // switch whatever else the team has open, and so is a row with no season.
  it("refuses editing a row filed under another season, whatever the team's open season", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      await tier(q, true);
      const earlier = await tier(q, false);
      const id = (await q(PICK, [pid, earlier])).rows[0].id;
      await expect(
        asUser(RAIDER_T1, "update public.item_preferences set status = 'pass' where id = $1", [id])
      ).rejects.toThrow(CLOSED);
    });
  });

  it('refuses editing a row with no season while a season is open, without the override', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      await tier(q, true);
      const id = (await q(PICK, [pid, null])).rows[0].id;
      await expect(asUser(RAIDER_T1, 'delete from public.item_preferences where id = $1', [id])).rejects.toThrow(
        CLOSED
      );
    });
  });
});

// #936: the wishlist key carries the season, so the same item in the same slot
// is a separate pick in each tier. Before this the key was (player_id,
// item_id, coalesce(slot, '')) and a raider's second tier of picks collided
// with their first, which is why the page and the gate had to agree that every
// pick sat in one season. The tripwire that held that order is gone with it.
describe('the wishlist key carries the season (#936)', () => {
  it('the key is on the season as well as the player, item and slot', async () => {
    await withTxn(async ({ q }) => {
      const key = await q("select indexdef from pg_indexes where indexname = 'item_preferences_no_dupe_item_key'");
      expect(key.rows[0].indexdef).toMatch(/season/);
    });
  });

  it('a raider holds the same item and slot in two seasons', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const first = await tier(q, true);
      const second = await tier(q, true);

      await asUser(RAIDER_T1, PICK, [pid, first]);
      const later = await asUser(RAIDER_T1, PICK, [pid, second]);
      expect(later.rows.length).toBe(1);

      const held = await q('select season from public.item_preferences where player_id = $1 order by season', [pid]);
      expect(held.rows.map((r) => r.season).sort()).toEqual([first, second].sort());
    });
  });

  it('a second pick for the same item, slot and season is still a duplicate', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await gatedPlayer(q);
      const season = await tier(q, true);
      await asUser(RAIDER_T1, PICK, [pid, season]);
      await expect(asUser(RAIDER_T1, PICK, [pid, season])).rejects.toMatchObject({ code: '23505' });
    });
  });

  // The 9 rows on production with no season belong to archived characters, and
  // the column stays nullable until #945. Two of them for one item would be a
  // duplicate, since the key reads a missing season as one value.
  it('two rows with no season for the same item are still a duplicate', async () => {
    await withTxn(async ({ q }) => {
      const pid = await gatedPlayer(q);
      await q(PICK, [pid, null]);
      await expect(q(PICK, [pid, null])).rejects.toMatchObject({ code: '23505' });
    });
  });
});

// A tripwire, not a behaviour, replacing the one this change retires. The key
// used to be what kept every officer-side reader of item_preferences correct
// without any of them naming a season: a raider could hold one row per item and
// slot, so a read of "their rows for this item" could only ever be the tier in
// play. Widening the key ends that, and two readers still take every row a
// raider holds:
//
//   generate_priority_order() picks the strongest status across them, so a BiS
//   mark left in another tier makes a raider a candidate for this one even when
//   their row here says pass, at the top of the order.
//   wishlist_setup_status() counts them, so a slot filled in another tier reads
//   as filled here and the raider is not chased for it.
//
// Reaching that no longer needs a tier after MID2: an officer can pin Season
// View to MID1 and open that tier's wishlist switch, which set_team_season()
// still allows for an ended tier. The seasons check below is the coarse half of
// the guard, kept because a new tier is how this arrives in the ordinary course.
// #936's remaining piece puts the season on both readers, and deletes this.
describe('the priority readers still ignore the season (#936)', () => {
  it('generate_priority_order() reads a raider picks from every season', async () => {
    await withTxn(async ({ q }) => {
      const def = await q(
        "select pg_get_functiondef(oid) as def from pg_proc where proname = 'generate_priority_order'"
      );
      expect(
        def.rows[0].def,
        'generate_priority_order() filters picks by season now: delete this tripwire'
      ).not.toMatch(/ip\.season/);
    });
  });

  it('wishlist_setup_status() counts picks from every season', async () => {
    await withTxn(async ({ q }) => {
      const def = await q("select pg_get_functiondef(oid) as def from pg_proc where proname = 'wishlist_setup_status'");
      expect(def.rows[0].def, 'wishlist_setup_status() filters picks by season now: delete this tripwire').not.toMatch(
        /ip\.season/
      );
    });
  });

  it('no tier starts after MID2 while they do', async () => {
    await withTxn(async ({ q }) => {
      const later = await q(
        "select code from public.seasons where starts_at > (select starts_at from public.seasons where code = 'MID2')"
      );
      expect(
        later.rows.map((r) => r.code),
        "a tier after MID2 needs #936's season filter on the priority readers first"
      ).toEqual([]);
    });
  });
});

afterAll(() => pool.end());
