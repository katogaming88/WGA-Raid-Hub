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

// SECURITY DEFINER functions anon may execute, measured on prod 2026-09-08.
// Eight RLS predicates and helpers, five public submit paths, one trigger
// helper and is_own_player. Set equality, so an accidental grant fails and so
// does an accidental revoke.
const ANON_DEFINER_ALLOWLIST = [
  'app_version',
  'can_settle_boe',
  'current_discord_id',
  'flag_bis_list_changed',
  'is_any_team_officer',
  'is_boe_manager',
  'is_guild_officer',
  'is_own_player',
  'is_site_admin',
  'is_team_leader_anywhere',
  'my_team_role',
  'submit_bis_link',
  'submit_boe_found',
  'submit_mplus_exclusion',
  'submit_self_received',
  'sync_bis_obtained_from_self_received'
];

// Comments are stripped before the body is searched. wishlist_setup_status
// explains itself with the word "copy" in a comment, and a match on prose
// would make this test fail for a reason that has nothing to do with SQL.
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
});
