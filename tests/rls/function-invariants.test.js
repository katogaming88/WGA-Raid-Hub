// Whole-schema invariants over public functions (#1010), from the SQL
// injection spike in #1009. That spike found no injection path and no gate
// holding the line, so these four are the gate.
//
// Two of them are controls that pass the day they are written (T1, T4) and
// two start red (T2, T3). A control is worth keeping here because what it
// asserts is the whole defence: function bodies are static SQL, so nothing a
// raider types is ever parsed as SQL. A regression there would otherwise be
// invisible until someone went looking again.
//
// Read-only against the catalog through the shared pool, no impersonation.
import { describe, it, expect, afterAll } from 'vitest';
import { pool } from './helpers.js';

// The one function that builds SQL at runtime. Its format() argument is the
// object identity Postgres hands it from pg_event_trigger_ddl_commands(), on
// DDL only, so no user text reaches it. Adding a name here needs the same
// reasoning written into the migration that introduces it.
const KNOWN_DYNAMIC = ['rls_auto_enable'];

// Functions allowed to compare my_team_role() without coalesce (#752, T6).
// resolve_person puts the comparison in a WHERE clause, where a null excludes
// the row exactly as false does. Adding a name here needs the same reasoning
// written into the migration.
const BARE_ROLE_COMPARE_OK = ['resolve_person'];

// SECURITY DEFINER functions anon may execute, measured on prod 2026-09-08.
// Eight RLS predicates and helpers, five public submit paths and
// is_own_player. #1106 added the three once-per-query rule helpers
// (my_officer_team_ids, my_leader_team_ids, my_active_player_ids): a
// signed-out read evaluates the rules too, and each returns an empty array
// when there is no auth.uid(). Set equality, so an accidental grant fails and so
// does an accidental revoke.
const ANON_DEFINER_ALLOWLIST = [
  'app_version',
  'can_settle_boe',
  'current_discord_id',
  'flag_bis_list_changed',
  'guild_creation_open',
  'is_any_team_officer',
  'is_boe_manager',
  'is_guild_officer',
  'is_own_player',
  'is_site_admin',
  'is_team_leader_anywhere',
  'my_active_player_ids',
  'my_leader_team_ids',
  'my_officer_team_ids',
  'my_person_id',
  'my_player_ids',
  'my_team_role',
  'submit_bis_link',
  'submit_boe_found',
  'submit_mplus_exclusion',
  'submit_self_received',
  'team_invite_link_resolve'
];

// Comments are stripped before the body is searched: a function that
// explains itself in prose must not match a pattern meant for SQL, which
// would fail this test for a reason that has nothing to do with SQL.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const DYNAMIC_SQL = [
  /\bexecute\b/i,
  /\bformat\s*\(/i,
  /\bquote_(ident|literal|nullable)\b/i,
  /\b(query_to_xml|dblink|xmltable)\b/i
];

async function publicFunctions() {
  // rls-pool-read-only: reads the pg_proc catalog, writes nothing.
  const { rows } = await pool.query(`
    select p.proname,
           p.prosrc,
           p.prosecdef,
           p.proconfig,
           p.prorettype = 'pg_catalog.event_trigger'::regtype as is_event_trigger,
           has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
    order by p.proname
  `);
  return rows;
}

afterAll(() => pool.end());

describe('function invariants (#1010)', () => {
  // The denominator is asserted alongside every verdict below. A query that
  // returned nothing would satisfy each "no function does X" claim without
  // the schema being checked at all.
  it('reads a whole schema, so the assertions below have a subject', async () => {
    const fns = await publicFunctions();
    expect(fns.length).toBeGreaterThan(50);
  });

  it('T1 (control): no function body builds SQL at runtime, except the known one', async () => {
    const fns = await publicFunctions();
    const offenders = fns
      .filter((f) => !KNOWN_DYNAMIC.includes(f.proname))
      .filter((f) => DYNAMIC_SQL.some((re) => re.test(stripComments(f.prosrc))))
      .map((f) => f.proname);
    expect(offenders).toEqual([]);
  });

  it('T2: every function pins its search_path', async () => {
    const fns = await publicFunctions();
    const unpinned = fns
      .filter((f) => !(f.proconfig || []).some((c) => c.startsWith('search_path=')))
      .map((f) => f.proname);
    // Asserted as pinned rather than as a literal value, so a later
    // `public, extensions` pin does not fail for the wrong reason.
    expect(unpinned).toEqual([]);
  });

  it('T3: exactly the allowlisted definer functions are executable by anon', async () => {
    const fns = await publicFunctions();
    const actual = fns
      .filter((f) => f.prosecdef && f.anon_can_execute)
      .map((f) => f.proname)
      .sort();
    // Set equality. A new definer function that forgets its `revoke ... from
    // public` fails here, which is the whole point: on prod that revoke is
    // written by hand in every migration and nothing checks it.
    expect(actual).toEqual([...ANON_DEFINER_ALLOWLIST].sort());
  });

  it('T4 (control): rls_auto_enable is the only event trigger function in public', async () => {
    const fns = await publicFunctions();
    const eventTriggers = fns.filter((f) => f.is_event_trigger).map((f) => f.proname);
    expect(eventTriggers).toEqual(['rls_auto_enable']);
  });

  // T5 (#1135). raw_user_meta_data is written by GoTrue on every OAuth sign-in
  // and is writable by the account it describes, so the copy of the Discord id
  // it carries cannot be removed and must not be trusted. current_discord_id()
  // and auth_user_for_discord_id() read auth.identities instead; this is what
  // stops a seventh caller quietly going back to the easy column.
  //
  // Scoped to provider_id on purpose. Three functions read full_name and name
  // out of the same column for display, which is fine: a forged display name
  // is a cosmetic problem, not an authorization one.
  it('T5: no function resolves identity from raw_user_meta_data', async () => {
    const fns = await publicFunctions();
    const readers = fns
      .filter((f) => /raw_user_meta_data\s*->>\s*'provider_id'/.test(stripComments(f.prosrc)))
      .map((f) => f.proname);
    expect(readers).toEqual([]);
  });

  // T6 (#752). my_team_role() is null for a caller with no row on the team,
  // and `null = 'team_leader'` is null, so `if not (null or false)` never
  // raises: a gate that compares the role without coalesce lets a stranger
  // through. Every gate wraps the comparison in coalesce(..., false) except
  // the three this case was written red against, and nothing else would
  // notice the next one. The coalesced count is asserted beside the empty
  // list so a regex that matched nothing could not pass on its own.
  it('T6: every my_team_role() comparison in a function body is wrapped in coalesce', async () => {
    const fns = await publicFunctions();
    const bare = new Set();
    let coalesced = 0;
    for (const f of fns) {
      if (BARE_ROLE_COMPARE_OK.includes(f.proname)) continue;
      for (const m of stripComments(f.prosrc).matchAll(/(coalesce\s*\(\s*)?(public\.)?my_team_role\s*\(/gi)) {
        if (m[1]) coalesced += 1;
        else bare.add(f.proname);
      }
    }
    expect(coalesced).toBeGreaterThanOrEqual(15);
    expect([...bare].sort()).toEqual([]);
  });
});
