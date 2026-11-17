// #1484: team_member_accounts() shows officers which Battle.net and Discord
// account each current team member connected. The names live in
// auth.identities, which no client role reads.
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
// 3 raider (RAIDER_T1), each with a Discord id and a bare Discord identity.
const connectBattlenet = (q, uid, battletag) =>
  q(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ('bn-' || $1::text, $2::uuid,
             jsonb_build_object('sub', $1::text, 'custom_claims', jsonb_build_object('battletag', $1::text)),
             'custom:battlenet', now(), now(), now())`,
    [battletag, uid]
  );
const nameDiscord = (q, uid, data) =>
  q(
    `update auth.identities set identity_data = identity_data || $2::jsonb where user_id = $1 and provider = 'discord'`,
    [uid, JSON.stringify(data)]
  );

const ask = (asUser, uid, teamId) =>
  asUser(
    uid,
    'select team_member_id, battlenet, battletag, discord, discord_username from public.team_member_accounts($1) order by 1',
    [teamId]
  );

describe('team_member_accounts()', () => {
  it("names each member's BattleTag and Discord username, null where there is none", async () => {
    await withTxn(async ({ q, asUser }) => {
      await connectBattlenet(q, RAIDER_T1, 'Brakkus#1184');
      await nameDiscord(q, RAIDER_T1, { full_name: 'brakkus', name: 'brakkus#0' });
      // A sign-in with no full_name: the "#0" comes off name.
      await nameDiscord(q, TEAM_LEADER_T1, { name: 'leadguy#0' });
      const res = await ask(asUser, OFFICER_T1, 1);
      const byId = Object.fromEntries(res.rows.map((r) => [r.team_member_id, r]));
      expect(byId[3]).toEqual({
        team_member_id: 3,
        battlenet: true,
        battletag: 'Brakkus#1184',
        discord: true,
        discord_username: 'brakkus'
      });
      expect(byId[2]).toMatchObject({ battlenet: false, battletag: null, discord_username: 'leadguy' });
      // Linked to Discord by id, no name on record.
      expect(byId[1]).toMatchObject({ battlenet: false, discord: true, discord_username: null });
    });
  });

  it('leaves out members who left', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Past the guard that sends archiving through archive_team_member().
      await q('set local session_replication_role = replica');
      await q('update public.team_members set archived_at = now() where id = 3');
      await q('set local session_replication_role = origin');
      const res = await ask(asUser, OFFICER_T1, 1);
      expect(res.rows.map((r) => r.team_member_id)).not.toContain(3);
    });
  });

  it.each([
    ['the team leader', TEAM_LEADER_T1],
    ['a site admin', SITE_ADMIN]
  ])('answers %s', async (_who, uid) => {
    await withTxn(async ({ q, asUser }) => {
      await connectBattlenet(q, RAIDER_T1, 'Brakkus#1184');
      const res = await ask(asUser, uid, 1);
      expect(res.rows.find((r) => r.team_member_id === 3).battletag).toBe('Brakkus#1184');
    });
  });

  it('refuses a raider, an officer of another team and a guild officer', async () => {
    await withTxn(async ({ asUser }) => {
      await expect(ask(asUser, RAIDER_T1, 1)).rejects.toThrow(/Not authorized/);
      await expect(ask(asUser, OFFICER_T2, 1)).rejects.toThrow(/Not authorized/);
      await expect(ask(asUser, GUILD_OFFICER, 1)).rejects.toThrow(/Not authorized/);
    });
  });

  it('is not executable by anon', async () => {
    await withTxn(async ({ asAnon }) => {
      await expect(asAnon('select * from public.team_member_accounts(1)')).rejects.toThrow(/permission denied/);
    });
  });
});
