import { Pool } from 'pg';

// Supabase CLI local stack default. CI and local dev both use it.
export const DSN = process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

export const pool = new Pool({ connectionString: DSN });

// Must stay in sync with supabase/seed.sql.
export const OFFICER_T1 = '00000000-0000-0000-0000-000000000001';
export const TEAM_LEADER_T1 = '00000000-0000-0000-0000-000000000002';
export const RAIDER_T1 = '00000000-0000-0000-0000-000000000003';
export const SITE_ADMIN = '00000000-0000-0000-0000-000000000004';
export const OFFICER_T2 = '00000000-0000-0000-0000-000000000005';
export const SIGNUP_OWNER_T1 = '00000000-0000-0000-0000-000000000006';
// #607: raider on team 1, no officer/team_leader role anywhere, granted
// via guild_officers (not derived from any team_members role).
export const GUILD_OFFICER = '00000000-0000-0000-0000-000000000007';
// #1065: every seeded team has its own three people, so the seed offers the
// same persona names a snapshot mints. Immolation (team 3) is a seed row;
// Wrathless (team 4) comes from the migration that created it.
export const OFFICER_T3 = '00000000-0000-0000-0000-000000000008';
export const TEAM_LEADER_T3 = '00000000-0000-0000-0000-000000000009';
export const RAIDER_T3 = '00000000-0000-0000-0000-000000000010';
export const OFFICER_T4 = '00000000-0000-0000-0000-000000000011';
export const TEAM_LEADER_T4 = '00000000-0000-0000-0000-000000000012';
export const RAIDER_T4 = '00000000-0000-0000-0000-000000000013';
// The BoE manager persona: only that grant, no team row, the guild banker who
// is not a site admin (#745, #766). OFFICER_T1 also holds the grant, for the
// BoE suite (#753).
export const BOE_MANAGER = '00000000-0000-0000-0000-000000000014';
export const TEAM_LEADER_T2 = '00000000-0000-0000-0000-000000000015';
export const RAIDER_T2 = '00000000-0000-0000-0000-000000000016';

// SQLSTATE for "new row violates row-level security policy".
export const RLS_DENIED = '42501';

// Runs fn inside a transaction that is always rolled back, impersonating a
// PostgREST role. `uid` lands in request.jwt.claims and becomes auth.uid();
// pass null for anon. The claims must be set before `set local role` drops
// the superuser-ish postgres privileges.
export async function withRole(role, uid, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (uid) {
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role })]);
    }
    await client.query(`set local role ${role}`);
    return await fn((text, params) => client.query(text, params));
  } finally {
    await client.query('rollback');
    client.release();
  }
}

// One-shot query under a role.
export function queryAs(role, uid, text, params) {
  return withRole(role, uid, (q) => q(text, params));
}

// Runs fn inside one transaction that is always rolled back, and hands it a
// postgres-role `q` for fixtures and assertions plus impersonating callers on
// that same client. Same-client is the point: a fixture written here is never
// committed, so no other worker in the suite can see it, and only a caller on
// this connection can read it back (#1021). countAs and queryAs above open
// their own connection and cannot, which is why they suit a seeded table and
// not a fixture the test just wrote.
//
// Each impersonated call rides its own savepoint. A call that raises aborts
// the transaction, so the `reset role` that follows would raise its own error
// and replace the one the test is asserting on (2026-07-06).
export async function withTxn(fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const q = (text, params) => client.query(text, params);
    const asRole = (role, uid) => async (text, params) => {
      await q('savepoint impersonated_call');
      await q("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(uid ? { sub: uid, role } : { role })
      ]);
      await q(`set local role ${role}`);
      try {
        const res = await q(text, params);
        await q('reset role');
        return res;
      } catch (err) {
        await q('rollback to savepoint impersonated_call');
        throw err;
      }
    };
    const asUser = (uid, text, params) => asRole('authenticated', uid)(text, params);
    const asAnon = (text, params) => asRole('anon', null)(text, params);
    return await fn({ q, asRole, asUser, asAnon });
  } finally {
    await client.query('rollback');
    client.release();
  }
}

// Visible row count under a role.
export async function countAs(role, uid, table, where = 'true') {
  const res = await queryAs(role, uid, `select count(*)::int as n from public.${table} where ${where}`);
  return res.rows[0].n;
}
