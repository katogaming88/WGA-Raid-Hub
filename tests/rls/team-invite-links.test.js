// team_invite_link_reset()/team_invite_link_resolve() and the table they read
// and write (#1264): one active invite code per team, minted by an officer,
// resolved by anyone (including signed-out) before the /join/<code> page
// knows who's asking. No insert/update policy on the table itself -- every
// row comes from reset(), so these tests never write it directly.
import { describe, it, expect, afterAll } from 'vitest';
import {
  pool,
  withTxn,
  RAIDER_T1,
  OFFICER_T1,
  OFFICER_T2,
  TEAM_LEADER_T1,
  GUILD_OFFICER,
  SITE_ADMIN,
  RLS_DENIED
} from './helpers.js';

const reset = (asUser, uid, team = 1, expiresAt = null) =>
  asUser(uid, 'select * from public.team_invite_link_reset($1, $2)', [team, expiresAt]);

const resolve = (q, code) =>
  q('select team_id, team_name, team_slug, guild_id, guild_name from public.team_invite_link_resolve($1)', [code]);

const auditOf = (q) =>
  q("select action, target_id, detail from public.audit_log where target_type = 'team_invite_links' order by id");

describe('team_invite_link_reset()', () => {
  it('lets a team officer, leader, guild officer and site admin mint a code', async () => {
    await withTxn(async ({ q, asUser }) => {
      for (const [uid, team] of [
        [OFFICER_T1, 1],
        [TEAM_LEADER_T1, 1],
        [GUILD_OFFICER, 2],
        [SITE_ADMIN, 2]
      ]) {
        const { rows } = await reset(asUser, uid, team);
        expect(rows[0].code).toMatch(/^[a-z0-9]+-[a-z0-9]{8}$/);
      }
    });
  });

  it('refuses a raider, an officer of another team, and a caller with no session', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await expect(reset(asUser, RAIDER_T1, 1)).rejects.toThrow(/Not authorized/);
      await expect(reset(asUser, OFFICER_T2, 1)).rejects.toThrow(/Not authorized/);
      await expect(reset(asUser, null, 1)).rejects.toThrow(/Not authorized/);
      await expect(asAnon('select public.team_invite_link_reset(1)')).rejects.toMatchObject({ code: RLS_DENIED });
      expect((await q('select count(*) from public.team_invite_links')).rows[0].count).toBe('0');
    });
  });

  it('a second reset replaces the code, killing the first one', async () => {
    await withTxn(async ({ q, asUser }) => {
      const first = (await reset(asUser, OFFICER_T1, 1)).rows[0].code;
      const second = (await reset(asUser, OFFICER_T1, 1)).rows[0].code;
      expect(second).not.toBe(first);
      expect((await resolve(q, first)).rows).toEqual([]);
      expect((await resolve(q, second)).rows).toHaveLength(1);
      expect((await q('select count(*) from public.team_invite_links')).rows[0].count).toBe('1');
    });
  });

  it('writes one audit entry per reset, carrying the expiry', async () => {
    await withTxn(async ({ q, asUser }) => {
      await reset(asUser, OFFICER_T1, 1, '2027-01-01T00:00:00Z');
      expect((await auditOf(q)).rows).toEqual([
        {
          action: 'Invite Link Reset',
          target_id: 1,
          detail: { expires_at: '2027-01-01T00:00:00+00:00' }
        }
      ]);
    });
  });
});

describe('team_invite_link_resolve()', () => {
  it('resolves a live code to its team and guild, for anon and signed-in alike', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      const code = (await reset(asUser, OFFICER_T1, 1)).rows[0].code;
      const expected = [
        { team_id: 1, team_name: 'Team Phoenix', team_slug: 'phoenix', guild_id: 1, guild_name: 'We Go Again' }
      ];
      expect(
        (
          await q(
            'select team_id, team_name, team_slug, guild_id, guild_name from public.team_invite_link_resolve($1)',
            [code]
          )
        ).rows
      ).toEqual(expected);
      expect(
        (
          await asAnon(
            'select team_id, team_name, team_slug, guild_id, guild_name from public.team_invite_link_resolve($1)',
            [code]
          )
        ).rows
      ).toEqual(expected);
    });
  });

  it('answers no rows for an unknown, expired, or superseded code', async () => {
    await withTxn(async ({ q, asUser }) => {
      const past = (await reset(asUser, OFFICER_T1, 1, '2000-01-01T00:00:00Z')).rows[0].code;
      expect((await resolve(q, past)).rows).toEqual([]);

      const live = (await reset(asUser, OFFICER_T2, 2)).rows[0].code;
      await reset(asUser, OFFICER_T2, 2);
      expect((await resolve(q, live)).rows).toEqual([]);

      expect((await resolve(q, 'phoenix-nosuchcode')).rows).toEqual([]);
    });
  });
});

describe('team_invite_links', () => {
  it('officers read their own team, not another team, and cross-team readers see both', async () => {
    await withTxn(async ({ q, asUser, asAnon }) => {
      await reset(asUser, OFFICER_T1, 1);
      await reset(asUser, OFFICER_T2, 2);

      const anon = await asAnon('select * from public.team_invite_links');
      expect(anon.rows).toEqual([]);

      const raider = await asUser(RAIDER_T1, 'select * from public.team_invite_links');
      expect(raider.rows).toEqual([]);

      const officer1 = await asUser(OFFICER_T1, 'select team_id from public.team_invite_links');
      expect(officer1.rows).toEqual([{ team_id: 1 }]);

      const guildOfficer = await asUser(GUILD_OFFICER, 'select team_id from public.team_invite_links order by team_id');
      expect(guildOfficer.rows).toEqual([{ team_id: 1 }, { team_id: 2 }]);

      const siteAdmin = await asUser(SITE_ADMIN, 'select team_id from public.team_invite_links order by team_id');
      expect(siteAdmin.rows).toEqual([{ team_id: 1 }, { team_id: 2 }]);
    });
  });

  it('has no insert/update/delete policy for any API role', async () => {
    await withTxn(async ({ asUser }) => {
      const write = "insert into public.team_invite_links (team_id, code) values (1, 'phoenix-abcdefgh')";
      await expect(asUser(OFFICER_T1, write)).rejects.toMatchObject({ code: RLS_DENIED });
      await expect(asUser(SITE_ADMIN, write)).rejects.toMatchObject({ code: RLS_DENIED });
    });
  });
});

afterAll(() => pool.end());
