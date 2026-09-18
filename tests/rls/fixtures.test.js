// Behavior tests for the fixture factories (#1123). A file in this suite writes
// rows it minted, never the seed's, so two files running at once can never
// take the same row: that is what lets the suite run its files in parallel.
// The property under test is ownership: a minted row lives only in the
// transaction that made it, its account resolves to the role it asked for,
// and nothing about it is shared with another worker.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  countAs,
  seedPlayer,
  seedMember,
  seedTeam,
  seedSignup,
  seedSeason,
  seasonDayFor,
  RAIDER_T1
} from './helpers.js';

const RAIDER_T1_MEMBER = 3;

afterAll(() => pool.end());

describe('fixture factories mint rows the test owns (#1123)', () => {
  it('the pool is capped, so fifteen workers stay under the stack ceiling', () => {
    expect(pool.options.max).toBe(4);
  });

  it('a minted player is visible on its own transaction and to no other connection', async () => {
    await withTxn(async ({ q, asUser }) => {
      const id = await seedPlayer(q, { memberId: RAIDER_T1_MEMBER });
      const own = await q('select team_id, team_member_id from public.players where id = $1', [id]);
      expect(own.rows[0]).toEqual({ team_id: 1, team_member_id: RAIDER_T1_MEMBER });
      const asRaider = await asUser(RAIDER_T1, 'select count(*)::int as n from public.players where id = $1', [id]);
      expect(asRaider.rows[0].n).toBe(1);
      expect(await countAs('authenticated', RAIDER_T1, 'players', `id = ${id}`)).toBe(0);
    });
  });

  it('a minted player takes its team from the member it is linked to', async () => {
    await withTxn(async ({ q }) => {
      const member = await seedMember(q, { teamId: 2 });
      const id = await seedPlayer(q, { memberId: member.memberId });
      const { rows } = await q('select team_id from public.players where id = $1', [id]);
      expect(rows[0].team_id).toBe(2);
    });
  });

  it('a minted member signs in as the role it asked for, on that team only', async () => {
    await withTxn(async ({ q, asUser }) => {
      const { memberId, uid } = await seedMember(q, { teamId: 2, role: 'officer' });
      const linked = await q('select auth_user_id from public.team_members where id = $1', [memberId]);
      expect(linked.rows[0].auth_user_id).toBe(uid);
      const there = await asUser(uid, 'select public.my_team_role($1) as role', [2]);
      expect(there.rows[0].role).toBe('officer');
      const elsewhere = await asUser(uid, 'select public.my_team_role($1) as role', [1]);
      expect(elsewhere.rows[0].role).toBeNull();
    });
  });

  it('two minted members share nothing', async () => {
    await withTxn(async ({ q }) => {
      const a = await seedMember(q);
      const b = await seedMember(q);
      expect(a.uid).not.toBe(b.uid);
      expect(a.discordId).not.toBe(b.discordId);
      expect(a.memberId).not.toBe(b.memberId);
    });
  });

  it('a minted team comes with settings and three people, and its leader writes only its own settings', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const settings = await q('select config from public.team_settings where team_id = $1', [team.teamId]);
      expect(settings.rows[0].config).toEqual({});
      const write = `update public.team_settings set config = '{"minted": true}' where team_id = $1`;
      const own = await asUser(team.leader.uid, write, [team.teamId]);
      expect(own.rowCount).toBe(1);
      const seeded = await asUser(team.leader.uid, write, [1]);
      expect(seeded.rowCount).toBe(0);
      const roles = await Promise.all(
        [team.officer, team.leader, team.raider].map(async (p) => {
          const { rows } = await asUser(p.uid, 'select public.my_team_role($1) as role', [team.teamId]);
          return rows[0].role;
        })
      );
      expect(roles).toEqual(['officer', 'team_leader', 'raider']);
    });
  });

  it('a seeded season takes its day from the transaction, never from a counter this process keeps', async () => {
    // Two workers each starting a counter at zero took the same day and the
    // exclusion constraint made them wait on each other (120 of the 122
    // deadlocked statements in the parallel baseline of 2026-09-18).
    await withTxn(async ({ q }) => {
      const { rows } = await q('select pg_current_xact_id()::text as xid');
      const first = await seedSeason(q, `fixture-${rows[0].xid}-a`);
      const second = await seedSeason(q, `fixture-${rows[0].xid}-b`);
      expect(first).toBe(seasonDayFor(rows[0].xid, 0));
      expect(second).toBe(seasonDayFor(rows[0].xid, 1));
      expect(first).not.toBe(second);
    });
  });

  it('a minted approved signup is one add_signup_to_roster() accepts from that team', async () => {
    await withTxn(async ({ q, asUser }) => {
      const team = await seedTeam(q);
      const signupId = await seedSignup(q, { teamId: team.teamId });
      const { rows } = await asUser(team.officer.uid, 'select public.add_signup_to_roster($1) as player_id', [signupId]);
      const player = await q('select team_id from public.players where id = $1', [rows[0].player_id]);
      expect(player.rows[0].team_id).toBe(team.teamId);
      const signup = await q('select status from public.season_signups where id = $1', [signupId]);
      expect(signup.rows[0].status).toBe('added');
    });
  });
});
