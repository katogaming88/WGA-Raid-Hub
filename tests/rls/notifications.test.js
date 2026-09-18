// Behavior tests for notify_player() (#151) and the notifications table's RLS:
// no direct INSERT policy for anyone (tests/rls/write-policies.test.js doesn't
// cover this new table, so that's asserted here instead), notify_player() is
// the only insert path, and a raider can only read/mark-read their own rows:
// every character their person holds, archived ones included (#942 step 4).
// Uses the shared withTxn from helpers.js.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  seedPlayer,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  SITE_ADMIN,
  OFFICER_T2,
  RLS_DENIED
} from './helpers.js';

const notify = (asUser, uid, playerId, message) =>
  asUser(uid, 'select public.notify_player($1, $2) as id', [playerId, message]);

// Seed player 1 (Seedraider-Illidan, team 1) has no team_member_id link
// (supabase/seed.sql) and is only ever notified here, never written. A case
// that needs the raider to hold a character mints one linked to
// team_members 3 (RAIDER_T1's row), archived where the case is about an old
// main (#1123).
const RAIDER_T1_MEMBER = 3;
const ownPlayer = (q, { archived = false } = {}) =>
  seedPlayer(q, { memberId: RAIDER_T1_MEMBER, archivedAt: archived ? new Date().toISOString() : null });

describe('notify_player rejects unauthorized callers', () => {
  it('anon cannot execute the function', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select public.notify_player(1, $1)', ['test'])).rejects.toThrow();
    });
  });

  it('a raider (not officer/team_leader, not site admin) is rejected', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(notify(asUser, RAIDER_T1, 1, 'test')).rejects.toThrow(/not authorized/i);
    });
  });

  it('an officer on another team is rejected for a team 1 player', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(notify(asUser, OFFICER_T2, 1, 'test')).rejects.toThrow(/not authorized/i);
    });
  });

  it('an unknown player_id raises', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(notify(asUser, OFFICER_T1, 999999, 'test')).rejects.toThrow(/unknown player_id/i);
    });
  });
});

describe('notify_player inserts a row for an authorized caller', () => {
  it("an officer's call inserts a row and returns its id", async () => {
    await withTxn(async ({ q, asUser }) => {
      const res = await notify(asUser, OFFICER_T1, 1, 'Your BiS link was approved.');
      const id = res.rows[0].id;
      expect(id).toBeGreaterThan(0);

      const row = (await q('select team_id, player_id, message, read from public.notifications where id = $1', [id]))
        .rows[0];
      expect(row.team_id).toBe(1);
      expect(row.player_id).toBe(1);
      expect(row.message).toBe('Your BiS link was approved.');
      expect(row.read).toBe(false);
    });
  });

  it('a team leader can also notify', async () => {
    await withTxn(async ({ asUser }) => {
      const res = await notify(asUser, TEAM_LEADER_T1, 1, 'test');
      expect(res.rows[0].id).toBeGreaterThan(0);
    });
  });

  it("a site admin can notify a player on a team they don't belong to", async () => {
    await withTxn(async ({ asUser }) => {
      const res = await notify(asUser, SITE_ADMIN, 1, 'test');
      expect(res.rows[0].id).toBeGreaterThan(0);
    });
  });
});

describe('no direct table INSERT policy exists', () => {
  it('an officer cannot insert directly into notifications, only via notify_player()', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(
        asUser(OFFICER_T1, 'insert into public.notifications (team_id, player_id, message) values (1, 1, $1)', [
          'forged'
        ])
      ).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});

describe('a raider can only read/mark-read their own notifications', () => {
  it('an unlinked raider sees no rows for a player they have not claimed', async () => {
    await withTxn(async ({ q, asUser }) => {
      await notify(asUser, OFFICER_T1, 1, 'test');
      const res = await asUser(RAIDER_T1, 'select id from public.notifications where player_id = 1');
      expect(res.rows.length).toBe(0);
    });
  });

  it('a raider sees and can mark read their own notification once linked', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q);
      const inserted = await notify(asUser, OFFICER_T1, pid, 'Your self-received item was approved.');
      const id = inserted.rows[0].id;

      const seen = await asUser(RAIDER_T1, 'select id, read from public.notifications where id = $1', [id]);
      expect(seen.rows.length).toBe(1);
      expect(seen.rows[0].read).toBe(false);

      await asUser(RAIDER_T1, 'update public.notifications set read = true where id = $1', [id]);
      const after = (await q('select read from public.notifications where id = $1', [id])).rows[0];
      expect(after.read).toBe(true);
    });
  });

  it("a raider cannot mark another player's notification read", async () => {
    await withTxn(async ({ q, asUser }) => {
      const other = await seedPlayer(q);
      const inserted = await notify(asUser, OFFICER_T1, other, 'not yours');
      const id = inserted.rows[0].id;
      await ownPlayer(q);

      await asUser(RAIDER_T1, 'update public.notifications set read = true where id = $1', [id]);
      const after = (await q('select read from public.notifications where id = $1', [id])).rows[0];
      expect(after.read).toBe(false);
    });
  });
});

// #942 step 4: the inbox belongs to the person. A main swap archives the old
// character but keeps it linked (#941), and its notifications stay in the
// raider's inbox; before this they vanished with the character.
describe("a raider's inbox includes their archived characters", () => {
  it('a notification on an archived character of theirs is seen and can be marked read', async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q, { archived: true });
      const id = (await notify(asUser, OFFICER_T1, pid, 'On the old main.')).rows[0].id;

      const seen = await asUser(RAIDER_T1, 'select id from public.notifications where id = $1', [id]);
      expect(seen.rows.length).toBe(1);

      await asUser(RAIDER_T1, 'update public.notifications set read = true where id = $1', [id]);
      expect((await q('select read from public.notifications where id = $1', [id])).rows[0].read).toBe(true);
    });
  });

  it("someone else's archived character stays out of the inbox", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q, { archived: true });
      const id = (await notify(asUser, OFFICER_T1, pid, 'Not yours.')).rows[0].id;

      expect((await asUser(OFFICER_T1, 'select id from public.notifications where id = $1', [id])).rows.length).toBe(0);
    });
  });

  it("an archived character's own rows stay read-only: my_active_player_ids still excludes it", async () => {
    await withTxn(async ({ q, asUser }) => {
      const pid = await ownPlayer(q, { archived: true });
      const { rows } = await asUser(
        RAIDER_T1,
        'select public.my_player_ids() as all_ids, public.my_active_player_ids() as active_ids'
      );
      expect(rows[0].all_ids).toContain(pid);
      expect(rows[0].active_ids).not.toContain(pid);
    });
  });
});

afterAll(() => pool.end());
