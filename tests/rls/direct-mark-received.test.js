// #752: direct_mark_received() refuses a caller with no row on the team.
//
// The officer gate compares my_team_role(p_team_id) with the officer roles,
// and my_team_role() is null for a caller who holds no team_members row on
// that team. Without coalesce the comparison is null, `if not (null or
// false)` never raises, and the call goes on to insert an approved
// self-received request for a raider the caller has no standing over. Every
// sibling RPC wraps the same comparison in coalesce(..., false); these cases
// pin the gate here.
//
// Each caller is built inside its test rather than borrowed from the seed:
// the refusals depend on a row being absent, and a later seed edit that gave
// a seeded persona a row on team 1 would turn a refusal into a pass for a
// reason nobody wrote down (the 2026-09-10 fixture lesson).
//
// Seeded rows: player 1 'Seedraider-Illidan' on team 1, item 1 'Seed Test
// Staff' (supabase/seed.sql). Each test runs in one rolled-back transaction.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, insertDiscordUser } from './helpers.js';

afterAll(() => pool.end());

const TEAM_1 = 1;
const TEAM_2 = 2;
const PLAYER_1 = 1;
const ITEM_1 = 1;

// Accounts invented here. None collide with the seed.
const OTHER_TEAM_OFFICER = '00000000-0000-0000-0000-000000000752';
const NO_ROLE = '00000000-0000-0000-0000-000000001752';
const SAME_TEAM_RAIDER = '00000000-0000-0000-0000-000000002752';
const SAME_TEAM_OFFICER = '00000000-0000-0000-0000-000000003752';

// An account plus the team_members row that gives it one role on one team.
async function addMember(q, uid, discordId, teamId, role) {
  await insertDiscordUser(q, uid, discordId);
  await q('insert into public.team_members (team_id, discord_id, auth_user_id, role) values ($1, $2, $3, $4)', [
    teamId,
    discordId,
    uid,
    role
  ]);
}

const markReceived = (asUser, uid) =>
  asUser(
    uid,
    "select public.direct_mark_received($1, 'Seedraider-Illidan', 'Seed Test Staff', 'Hero', null, null, null) as id",
    [TEAM_1]
  );

describe('direct_mark_received() refuses a caller with no row on the team (#752)', () => {
  it('an officer on another team is refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addMember(q, OTHER_TEAM_OFFICER, 'discord-752-officer-t2', TEAM_2, 'officer');
      await expect(markReceived(asUser, OTHER_TEAM_OFFICER)).rejects.toThrow(/not authorized/i);
    });
  });

  it('an account with no role anywhere is refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      await insertDiscordUser(q, NO_ROLE, 'discord-752-no-role');
      await expect(markReceived(asUser, NO_ROLE)).rejects.toThrow(/not authorized/i);
    });
  });

  // Green on both sides: the comparison is false, not null, for a raider.
  it('a raider on the team is refused', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addMember(q, SAME_TEAM_RAIDER, 'discord-752-raider-t1', TEAM_1, 'raider');
      await expect(markReceived(asUser, SAME_TEAM_RAIDER)).rejects.toThrow(/not authorized/i);
    });
  });

  it('an officer on the team marks the item received as approved', async () => {
    await withTxn(async ({ q, asUser }) => {
      await addMember(q, SAME_TEAM_OFFICER, 'discord-752-officer-t1', TEAM_1, 'officer');
      const res = await markReceived(asUser, SAME_TEAM_OFFICER);
      const row = (
        await q('select team_id, player_id, self_item_id, status from public.self_received_requests where id = $1', [
          res.rows[0].id
        ])
      ).rows[0];
      expect(row).toEqual({ team_id: TEAM_1, player_id: PLAYER_1, self_item_id: ITEM_1, status: 'approved' });
    });
  });

  it('anon cannot reach the function at all', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(
        asAnon("select public.direct_mark_received($1, 'Seedraider-Illidan', 'Seed Test Staff')", [TEAM_1])
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
