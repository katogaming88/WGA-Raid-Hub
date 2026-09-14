// export-definitions.js
// Writes the current definition of every database function and view to its
// own file under supabase/definitions/, and with --check fails when the
// committed files no longer match the database (#1107).
//
// A function changes by writing a migration that repeats the whole function,
// so `generate_priority_order` exists in full in 15 migration files and a
// one-line rule change reviews as a several-hundred-line new file. These
// files are a generated mirror of the database, the same idea as dbdoc/: a
// PR that changes a function also shows the few lines that changed in
// supabase/definitions/functions/<name>.sql, `git log` on that file is the
// function's history, and the current version is always one file. Migrations
// stay hand-written and remain the only thing that changes the database.
//
// Supabase's declarative schema was tried first and not adopted: it has no
// functions-only mode, its no-change diff dropped a constraint and paused the
// cron jobs, and it stamps migrations in UTC (spike on #1107).
//
// Read through psql rather than the pg package so the Schema docs job needs
// no npm install, the same as its `npm run db:rls` step.
//
// Usage:
//   node scripts/ci/export-definitions.js            write the files
//   node scripts/ci/export-definitions.js --check    exit 1 if any differ
//   --db-url <url>   default: the local stack
//
// Exit codes: 0 written or up to date, 1 stale, 2 usage or database error.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OUT_DIR = 'supabase/definitions';
const DEFAULT_DB_URL = 'postgres://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable';

// Extension-owned objects are left out: they come from the extension, not a
// migration. The access line names only the roles the site calls as (public,
// anon, authenticated), in name order: the owner and service_role always have
// access, and what the Postgres image grants those by default has differed
// between the local stack and CI (see rls-tests.yml's grant measurement).
export const QUERY = `
select coalesce(json_agg(d order by d.kind, d.name), '[]'::json)
from (
  select 'functions' as kind,
         p.proname as name,
         pg_get_functiondef(p.oid) as body,
         (select coalesce(string_agg(r, ', ' order by r), '')
            from (select case when a.grantee = 0 then 'public' else a.grantee::regrole::text end as r
                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE') g
           where r in ('public', 'anon', 'authenticated')) as access
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union all
  select 'views',
         c.relname,
         'create or replace view public.' || quote_ident(c.relname)
           || coalesce(' with (' || array_to_string(c.reloptions, ', ') || ')', '')
           || ' as' || chr(10) || pg_get_viewdef(c.oid, true),
         (select coalesce(string_agg(r, ', ' order by r), '')
            from (select distinct case when a.grantee = 0 then 'public' else a.grantee::regrole::text end as r
                    from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   where a.privilege_type = 'SELECT') g
           where r in ('public', 'anon', 'authenticated'))
    from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relkind = 'v'
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
) d;
`;

const ACCESS_LABEL = { functions: 'execute', views: 'select' };

// One definition to its file's text. Line endings are normalised so a
// checkout with autocrlf compares equal.
export function renderDefinition({ kind, name, body, access }) {
  const header = [
    `-- ${kind === 'functions' ? 'Function' : 'View'} public.${name}: current definition, generated from the database.`,
    '-- Do not edit: change it with a migration, then run `npm run db:definitions` (#1107).',
    `-- ${ACCESS_LABEL[kind]} (site roles): ${access || 'none'}`,
    ''
  ].join('\n');
  const text = body.replace(/\r\n/g, '\n').trimEnd();
  return `${header}\n${text}${text.endsWith(';') ? '' : ';'}\n`;
}

// The full set of files a list of definitions should produce, keyed by path
// relative to OUT_DIR. A duplicate name (an overloaded function) is refused
// rather than silently overwritten; none exists today.
export function planFiles(definitions) {
  const files = new Map();
  for (const def of definitions) {
    const path = `${def.kind}/${def.name}.sql`;
    if (files.has(path)) throw new Error(`two definitions map to ${path}; overloaded functions need a naming rule`);
    files.set(path, renderDefinition(def));
  }
  return files;
}

// Compares planned files with what is on disk under root: changed, missing
// (in the database, not committed) and extra (committed, no longer in the
// database).
export function compare(planned, root) {
  const onDisk = new Map();
  for (const kind of ['functions', 'views']) {
    const dir = join(root, kind);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('.sql'))
        onDisk.set(`${kind}/${file}`, readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n'));
    }
  }
  const changed = [];
  const missing = [];
  for (const [path, text] of planned) {
    if (!onDisk.has(path)) missing.push(path);
    else if (onDisk.get(path) !== text) changed.push(path);
  }
  const extra = [...onDisk.keys()].filter((path) => !planned.has(path));
  return { changed, missing, extra };
}

function readDefinitions(dbUrl) {
  const out = execFileSync('psql', [dbUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', QUERY], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return JSON.parse(out);
}

function main(argv) {
  const check = argv.includes('--check');
  const urlAt = argv.indexOf('--db-url');
  const dbUrl = urlAt >= 0 ? argv[urlAt + 1] : DEFAULT_DB_URL;
  if (urlAt >= 0 && !dbUrl) {
    console.error('--db-url needs a value');
    return 2;
  }

  let planned;
  try {
    planned = planFiles(readDefinitions(dbUrl));
  } catch (err) {
    console.error(`Could not read definitions: ${err.message}`);
    return 2;
  }

  const { changed, missing, extra } = compare(planned, OUT_DIR);
  if (check) {
    if (!changed.length && !missing.length && !extra.length) {
      console.log(`supabase/definitions/ is up to date (${planned.size} files).`);
      return 0;
    }
    console.error('supabase/definitions/ does not match the database the migrations build.');
    for (const p of changed) console.error(`  changed: ${p}`);
    for (const p of missing) console.error(`  missing: ${p}`);
    for (const p of extra) console.error(`  no longer in the database: ${p}`);
    console.error('Run `supabase db reset` then `npm run db:definitions`, and commit the result.');
    return 1;
  }

  for (const p of extra) rmSync(join(OUT_DIR, p));
  for (const [p, text] of planned) {
    mkdirSync(join(OUT_DIR, p.split('/')[0]), { recursive: true });
    writeFileSync(join(OUT_DIR, p), text);
  }
  console.log(
    `Wrote ${planned.size} definitions to ${OUT_DIR}/ (${changed.length} changed, ${missing.length} new, ${extra.length} removed).`
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
