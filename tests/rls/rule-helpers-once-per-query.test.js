// #1106: access rules look up the caller's roles once per query.
//
// A rule that calls a helper with a per-row argument (my_team_role(team_id),
// is_own_player(player_id)) runs that helper's query once for every row it
// checks; on production's wishlist table that was 127 ms against 5 ms. The
// shape test below fails when a new rule brings that form back, and the
// helper tests pin what the array helpers return for each kind of caller.
import { describe, it, expect, afterAll } from 'vitest';
import { pool, withTxn, OFFICER_T1, TEAM_LEADER_T1, RAIDER_T1, OFFICER_T2, SITE_ADMIN } from './helpers.js';

afterAll(() => pool.end());

// Functions a rule may call only inside a (SELECT f()) wrapper.
const HELPERS = [
  'my_officer_team_ids',
  'my_leader_team_ids',
  'my_active_player_ids',
  'is_site_admin',
  'is_guild_officer',
  'is_boe_manager',
  'is_any_team_officer',
  'current_discord_id',
  'auth\\.uid'
];
// Postgres stores (SELECT f()) as "( SELECT f() AS f)".
const WRAPPED = new RegExp(`\\( SELECT (${HELPERS.join('|')})\\(\\) AS \\w+\\)`, 'g');

describe('rule shape (#1106)', () => {
  it('no access rule calls a function except a wrapped, argument-free helper', async () => {
    // rls-pool-read-only: reads pg_policies, writes nothing.
    const { rows } = await pool.query(`
      select tablename, policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr
        from pg_policies
       where schemaname = 'public'
    `);
    expect(rows.length).toBeGreaterThan(50);
    const offenders = rows
      .map((r) => ({ rule: `${r.tablename}: ${r.policyname}`, calls: r.expr.replace(WRAPPED, '').match(/\w+\(/g) }))
      .filter((r) => r.calls);
    expect(offenders).toEqual([]);
  });
});

describe('once-per-query helpers', () => {
  const call = async (run, fn) => (await run(`select public.${fn}() as v`)).rows[0].v;

  it('return empty arrays when signed out', async () => {
    await withTxn(async ({ asAnon }) => {
      for (const fn of ['my_officer_team_ids', 'my_leader_team_ids', 'my_active_player_ids']) {
        expect(await call(asAnon, fn)).toEqual([]);
      }
    });
  });

  it('my_officer_team_ids counts officers and team leaders, not raiders', async () => {
    await withTxn(async ({ asUser }) => {
      expect(await call((t) => asUser(OFFICER_T1, t), 'my_officer_team_ids')).toEqual([1]);
      expect(await call((t) => asUser(TEAM_LEADER_T1, t), 'my_officer_team_ids')).toEqual([1]);
      expect(await call((t) => asUser(OFFICER_T2, t), 'my_officer_team_ids')).toEqual([2]);
      expect(await call((t) => asUser(RAIDER_T1, t), 'my_officer_team_ids')).toEqual([]);
      expect(await call((t) => asUser(SITE_ADMIN, t), 'my_officer_team_ids')).toEqual([]);
    });
  });

  it('my_leader_team_ids counts team leaders only', async () => {
    await withTxn(async ({ asUser }) => {
      expect(await call((t) => asUser(TEAM_LEADER_T1, t), 'my_leader_team_ids')).toEqual([1]);
      expect(await call((t) => asUser(OFFICER_T1, t), 'my_leader_team_ids')).toEqual([]);
    });
  });

  it('my_active_player_ids matches is_own_player(): linked and not archived', async () => {
    await withTxn(async ({ q, asUser }) => {
      // Seeded team_members 3 is RAIDER_T1; players 1 and 2 are unlinked team 1 characters.
      await q('update public.players set team_member_id = 3 where id in (1, 2)');
      await q('update public.players set archived_at = now() where id = 2');
      expect(await call((t) => asUser(RAIDER_T1, t), 'my_active_player_ids')).toEqual([1]);
      const own = await asUser(RAIDER_T1, 'select public.is_own_player(1) as a, public.is_own_player(2) as b');
      expect(own.rows[0]).toEqual({ a: true, b: false });
    });
  });

  it('a role removed mid-session applies to the next query', async () => {
    await withTxn(async ({ q, asUser }) => {
      const visible = async () =>
        (await asUser(OFFICER_T1, 'select count(*)::int as n from public.audit_log where team_id = 1')).rows[0].n;
      expect(await visible()).toBeGreaterThan(0);
      await q("update public.team_members set role = 'raider' where auth_user_id = $1 and team_id = 1", [OFFICER_T1]);
      expect(await visible()).toBe(0);
    });
  });
});
