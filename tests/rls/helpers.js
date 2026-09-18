import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

// Supabase CLI local stack default. CI and local dev both use it.
export const DSN = process.env.SUPABASE_DB_URL || 'postgres://postgres:postgres@127.0.0.1:54322/postgres';

// One pool per worker process. vitest runs up to one file per core (minus
// one) at a time, so a 16-core machine holds 15 pools against the stack's
// max_connections of 100; pg's default of 10 per pool would let that reach
// 150. A file holds a withTxn client plus a countAs or queryAs connection or
// two at once, so 4 is room, never a queue (#1123).
export const pool = new Pool({ connectionString: DSN, max: 4 });

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
// and replace the one the test is asserting on (2026-07-06). Either way the
// call leaves nothing behind: the role, the claims and the savepoint are gone
// when it returns, so a `q` after it runs as postgres with no caller (#1131).
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
        await q("select set_config('request.jwt.claims', NULL, true)");
        await q('release savepoint impersonated_call');
        return res;
      } catch (err) {
        await q('rollback to savepoint impersonated_call');
        await q('release savepoint impersonated_call');
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

// An account as Discord OAuth leaves it (#1135): the auth.users row and the
// auth.identities row the provider writes, in that order, which is the order
// GoTrue itself uses and so the order link_auth_user_to_member() expects.
//
// `metaDiscordId` defaults to the real one. Pass a different value to build the
// account this whole arc is about, whose user metadata claims one Discord id
// while its identity row proves another; identity wins everywhere that matters.
export async function insertDiscordUser(q, uid, discordId, metaDiscordId = discordId) {
  await q(
    `insert into auth.users (id, raw_app_meta_data, raw_user_meta_data)
     values ($1, '{"provider":"discord","providers":["discord"]}'::jsonb,
             jsonb_build_object('provider_id', $2::text))`,
    [uid, metaDiscordId]
  );
  // uid is passed twice on purpose: node-pg cannot deduce one type for a
  // parameter used both as the uuid column and inside jsonb_build_object.
  await q(
    `insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
     values ($1::text, $2::uuid, jsonb_build_object('sub', $3::text, 'provider_id', $1::text), 'discord',
             now(), now(), now())`,
    [discordId, uid, uid]
  );
}

// A guild-wide grant (#942): a guild_grants row for the person behind a Discord
// id, created if nobody holds it yet, on the one guild. Written as whoever `q`
// is, so a fixture writes it as postgres and a rule test as the caller.
export function grantGuild(q, discordId, grantType) {
  return q(
    `insert into public.guild_grants (person_id, guild_id, grant_type)
     values (public.person_for_discord_id($1), (select id from public.guilds), $2)`,
    [discordId, grantType]
  );
}

// Visible row count under a role.
export async function countAs(role, uid, table, where = 'true') {
  const res = await queryAs(role, uid, `select count(*)::int as n from public.${table} where ${where}`);
  return res.rows[0].n;
}

// A season a fixture can stamp (#932). Every season column is a foreign key
// to seasons since 20260914224520, so a test that writes its own season
// (rather than the seed's 'seed-season' or a real tier) inserts the row
// first, inside its transaction. One value serves as both the code and the
// display name, so the same constant works on a code column and a name
// column. Tiers cannot overlap (seasons_no_overlap), so each season is a
// single day, and the day has to be one no other worker is holding: the
// exclusion constraint makes a second transaction on the same day wait for
// the first, which is a deadlock as soon as two files seed two seasons in
// opposite orders. A counter in this process cannot give that (every worker
// starts it at zero), so the day comes from the transaction id instead:
// no two open transactions share one, and a block of 32 days per
// transaction keeps a file's own seasons apart. The blocks tile the years
// 1000 to 2018, below the seed's row and every real tier. Returns the day.
const SEASON_DAY_BASE = Date.UTC(1000, 0, 1);
const SEASON_DAYS_PER_TXN = 32;
const SEASON_DAY_BLOCKS = 11625; // 11625 * 32 = 372000 days, into mid 2018
export function seasonDayFor(xid, n) {
  const block = Number(BigInt(xid) % BigInt(SEASON_DAY_BLOCKS));
  const day = block * SEASON_DAYS_PER_TXN + (n % SEASON_DAYS_PER_TXN);
  return new Date(SEASON_DAY_BASE + day * 86400000).toISOString().slice(0, 10);
}
const seededSeasonsByTxn = new Map();
export async function seedSeason(q, season) {
  const { rows } = await q('select pg_current_xact_id()::text as xid');
  const n = seededSeasonsByTxn.get(rows[0].xid) ?? 0;
  seededSeasonsByTxn.set(rows[0].xid, n + 1);
  const day = seasonDayFor(rows[0].xid, n);
  await q('insert into public.seasons (code, display_name, starts_at, ends_at) values ($1, $1, $2::date, $2::date)', [
    season,
    day
  ]);
  return day;
}

// Rows a test mints for itself (#1123). Every file in the suite runs beside
// the others against one database, and a write to a seeded row (players id
// 1, team_members id 3, the approved signup) is a lock another file may be
// waiting on in the opposite order. A row minted inside the test's
// transaction is held by nobody else and seen by nobody else: ids come from
// the sequences, and every value that has to be unique across workers (the
// account, the Discord id, the character name) comes from randomUUID().
const tag = () => randomUUID().replace(/-/g, '').slice(0, 8);

// A player on a team, optionally linked to a member. With a member and no
// team the player joins the member's team, so the pair never trips
// check_team_id_matches_player() on a table keyed by both. Returns the id.
export async function seedPlayer(q, { teamId, memberId = null, nameRealm, classSpecId = 1, archivedAt = null } = {}) {
  if (teamId == null) {
    teamId =
      memberId == null
        ? 1
        : (await q('select team_id from public.team_members where id = $1', [memberId])).rows[0].team_id;
  }
  const { rows } = await q(
    `insert into public.players (team_id, name_realm, class_spec_id, team_member_id, archived_at)
     values ($1, $2, $3, $4, $5) returning id`,
    [teamId, nameRealm ?? `Fixture${tag()}-Illidan`, classSpecId, memberId, archivedAt]
  );
  return rows[0].id;
}

// A member of a team with an account that signs in as them: the row first,
// then the account and its Discord identity, which is the order the link
// trigger expects (insertDiscordUser). Returns { memberId, uid, discordId };
// pass uid to asUser to act as this person.
export async function seedMember(q, { teamId = 1, role = 'raider', discordId, uid } = {}) {
  const discord = discordId ?? `fixture-${randomUUID()}`;
  const user = uid ?? randomUUID();
  const { rows } = await q(
    'insert into public.team_members (team_id, discord_id, role) values ($1, $2, $3) returning id',
    [teamId, discord, role]
  );
  await insertDiscordUser(q, user, discord);
  return { memberId: rows[0].id, uid: user, discordId: discord };
}

// A team of the test's own, with its settings row and the three people
// every seeded team has. Returns { teamId, officer, leader, raider }, each
// person as seedMember returns them.
export async function seedTeam(q, { name } = {}) {
  const { rows } = await q(
    `insert into public.teams (name, guild_id)
     values ($1, (select id from public.guilds where url_key = 'wga')) returning id`,
    [name ?? `Fixture ${tag()}`]
  );
  const teamId = rows[0].id;
  await q("insert into public.team_settings (team_id, config) values ($1, '{}'::jsonb)", [teamId]);
  const officer = await seedMember(q, { teamId, role: 'officer' });
  const leader = await seedMember(q, { teamId, role: 'team_leader' });
  const raider = await seedMember(q, { teamId, role: 'raider' });
  return { teamId, officer, leader, raider };
}

// A season signup on a team, approved unless told otherwise, so
// add_signup_to_roster() has a row of the test's own. Returns the id.
export async function seedSignup(
  q,
  { teamId = 1, nameRealm, classSpecId = 1, status = 'approved', season = 'seed-season' } = {}
) {
  const { rows } = await q(
    `insert into public.season_signups (team_id, signup_name_realm, class_spec_id, season, status)
     values ($1, $2, $3, $4, $5) returning id`,
    [teamId, nameRealm ?? `Fixture${tag()}-Illidan`, classSpecId, season, status]
  );
  return rows[0].id;
}
