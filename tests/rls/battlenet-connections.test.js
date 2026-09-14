// #1157: team_battlenet_connections() tells officers which members have
// connected Battle.net to their account, ahead of the new app's Battle.net
// sign-in. The answer lives in auth.identities, which no client role reads.
//
// Each test runs in one rolled-back transaction (helpers.js withTxn).
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  OFFICER_T1,
  TEAM_LEADER_T1,
  RAIDER_T1,
  OFFICER_T2,
  SITE_ADMIN,
  GUILD_OFFICER
} from './helpers.js';

afterAll(() => pool.end());

// Seeded (supabase/seed.sql): team 1 members 1 officer (OFFICER_T1), 2 leader,
// 3 raider (RAIDER_T1); team 2 member 4 officer (OFFICER_T2), 13 raider.
const connectBattlenet = (q, uid, battlenetId) =>
  q(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ($1::text, $2::uuid, jsonb_build_object('sub', $1::text), 'custom:battlenet', now(), now(), now())`,
    [battlenetId, uid]
  );

const ask = (asUser, uid, teamId) =>
  asUser(uid, 'select team_member_id from public.team_battlenet_connections($1) order by 1', [teamId]);

describe('team_battlenet_connections()', () => {
  it('lists the members whose account has a Battle.net identity, and no one else', async () => {
    await withTxn(async ({ q, asUser }) => {
      await connectBattlenet(q, RAIDER_T1, '900001');
      await connectBattlenet(q, TEAM_LEADER_T1, '900002');
      const res = await ask(asUser, OFFICER_T1, 1);
      expect(res.rows.map((r) => r.team_member_id)).toEqual([2, 3]);
    });
  });

  it('does not count a Discord identity as Battle.net', async () => {
    await withTxn(async ({ asUser }) => {
      // The seed gives every persona a Discord identity and none a Battle.net one.
      const res = await ask(asUser, OFFICER_T1, 1);
      expect(res.rowCount).toBe(0);
    });
  });

  it('stays inside the asked team', async () => {
    await withTxn(async ({ q, asUser }) => {
      await connectBattlenet(q, RAIDER_T1, '900001');
      const res = await ask(asUser, OFFICER_T2, 2);
      expect(res.rowCount).toBe(0);
    });
  });

  it.each([
    ['the team leader', TEAM_LEADER_T1],
    ['a site admin', SITE_ADMIN],
    ['a guild officer', GUILD_OFFICER]
  ])('answers %s', async (_who, uid) => {
    await withTxn(async ({ q, asUser }) => {
      await connectBattlenet(q, RAIDER_T1, '900001');
      const res = await ask(asUser, uid, 1);
      expect(res.rows.map((r) => r.team_member_id)).toEqual([3]);
    });
  });

  it('refuses a raider, and an officer asking about another team', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(ask(asUser, RAIDER_T1, 1)).rejects.toThrow(/Not authorized/);
      await expect(ask(asUser, OFFICER_T2, 1)).rejects.toThrow(/Not authorized/);
    });
  });

  it('is not executable by anon', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select * from public.team_battlenet_connections(1)')).rejects.toThrow(/permission denied/);
    });
  });
});
