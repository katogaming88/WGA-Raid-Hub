// Last night's production data under this branch's migrations (#1056).
//
//   npm run db:snapshot                 # newest dump, schema version computed
//   npm run db:snapshot -- --plan       # print the steps, run nothing
//   npm run db:snapshot -- --dump wga-2026-09-08.dump --version 20260908090000
//
// The local stack rebuilds from a small seed, so a migration is otherwise
// rehearsed on four players and three teams. This pulls the nightly pg_dump of
// `public` out of R2, resets to the schema that dump belongs to, loads it, and
// runs this branch's own migrations on top.
//
// The result is production data on your machine, with a named persona per
// role per team to sign in as (snapshot-personas.js). The next `supabase db
// reset` wipes it, it is never committed, and the downloaded file is deleted
// as soon as the restore succeeds. Section 12 of docs/supabase-local-dev-setup.md
// has the rest, including who can reach the bucket and why a token to it is
// granted the way production access is granted.
//
// Node built-ins only, like everything in scripts/. Every command is spawned
// without a shell, so no argument is ever exposed to MSYS path rewriting.
import { spawnSync } from 'node:child_process';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PERSONAS_SQL } from './snapshot-personas.js';

const BUCKET = 's3://wga-raid-hub-backups/pg/';

// Russell's read-only token from #544 lives here, with the R2 endpoint set on
// the profile itself, so the account id never reaches a command line.
const DEFAULT_PROFILE = 'wga-raidhub-backups-ro';

// The only local superuser: `postgres` has bypassrls but not rolsuper, and
// pg_restore --disable-triggers needs a superuser.
const SUPERUSER_DSN = 'postgresql://supabase_admin:postgres@127.0.0.1:54322/postgres';

// A public dump, not one of the auth dumps beside it. The auth dump is never
// restored here: the personas are minted locally instead, which keeps real auth
// rows off laptops (see the unlink step below).
const PUBLIC_DUMP = /^pg\/wga-(\d{4}-\d{2}-\d{2})\.dump$/;

const MIGRATION_PATH = /^supabase\/migrations\/(\d{14})_.*\.sql$/;

// Emptying by catalog rather than by a written-down list. 46 migrations insert
// rows into a dozen public tables, so a data-only restore on top of a fresh
// reset would stop at the first duplicate key, and a hand-maintained list goes
// stale the next time somebody adds a table.
const TRUNCATE_ALL = `
do $$
declare stmt text;
begin
  select 'truncate ' || string_agg(format('public.%I', tablename), ', ') || ' restart identity cascade'
    into stmt
    from pg_tables
   where schemaname = 'public';
  if stmt is null then
    raise exception 'no public base tables to empty; is the reset finished?';
  end if;
  execute stmt;
end $$;
`;

// The seed normally does this (#1055), and --no-seed skipped it. Its own call,
// committed before the truncate batch opens: that batch is one transaction, so
// a statement inside it would not take effect until the whole thing commits and
// the jobs would stay live for the duration.
const CRON_QUIET = 'select cron.alter_job(jobid, active := false) from cron.job;';

// The full-rebuild runbook's step 9. Every restored row points at an auth.users
// id from production, and the local auth.users is empty, so the links are dead
// weight that also stops link_auth_user_to_member() from ever binding a local
// sign-in: every branch of it ends `and auth_user_id is null`. Nulling these is
// what makes `dev:login -- --discord-id <id>` reach a real officer's rows.
const UNLINK = `
update public.audit_log                    set actor_id = null     where actor_id is not null;
update public.boe_managers                 set auth_user_id = null where auth_user_id is not null;
update public.guild_officers               set auth_user_id = null where auth_user_id is not null;
update public.season_signups               set auth_user_id = null where auth_user_id is not null;
update public.site_admins                  set auth_user_id = null where auth_user_id is not null;
update public.team_members                 set auth_user_id = null where auth_user_id is not null;
update public.priority_conflict_dismissals set dismissed_by = null where dismissed_by is not null;
update public.priority_stale_dismissals    set dismissed_by = null where dismissed_by is not null;
delete from public.no_character_dismissals;
`;

// The tables db-backup.yml refuses to see empty, printed so a restore that
// technically succeeded but loaded nothing is visible. Kept identical to that
// workflow's EMPTY_CHECK by a test rather than by anyone remembering: two lists
// of the same thing in two files drift, and this pair drifts silently.
export const EMPTY_CHECK_TABLES = [
  'players',
  'item_preferences',
  'season_signups',
  'team_settings',
  'team_members',
  'teams',
  'site_admins',
  'attendance'
];

const COUNTS =
  EMPTY_CHECK_TABLES.map(
    (table, i) =>
      `${i === 0 ? 'select' : 'union all select'} '${table}'${i === 0 ? ' as t' : ''}, count(*) from public.${table}`
  ).join('\n') + ';\n';

// What installs each program the steps shell out to. spawnSync on something
// that is not on PATH returns a null status with no stderr, so without this the
// whole message is "aws exited null", which is the first thing a machine that
// has never done this before will see.
const INSTALLED_BY = {
  aws: 'the AWS CLI (scoop install aws, or the installer from aws.amazon.com/cli). Section 1e.',
  pg_restore: 'a Postgres client, version 17 or newer, because the server that wrote the archive is 17. Section 1d.',
  psql: 'a Postgres client, version 17 or newer. Section 1d.',
  supabase: 'the Supabase CLI. Section 1c.',
  git: 'git.'
};

/** The bucket listing call. JSON because LastModified is then an exact instant. */
export function listCommand({ profile, endpointUrl } = {}) {
  const args = ['s3api', 'list-objects-v2', '--bucket', 'wga-raid-hub-backups', '--prefix', 'pg/', '--output', 'json'];
  args.push('--profile', profile || process.env.AWS_PROFILE || DEFAULT_PROFILE);
  // Normally absent: the profile carries the endpoint, which is what keeps the
  // account id off the command line. Set R2_ENDPOINT_URL for a caller with no
  // configured profile, such as CI.
  if (endpointUrl) args.push('--endpoint-url', endpointUrl);
  return { command: 'aws', args };
}

/** The newest public dump in a listing, with the instant it was captured. */
export function newestDump(listing) {
  if (listing && listing.IsTruncated) {
    throw new Error('The bucket listing holds more than one page. Narrow the prefix or pass --dump <name>.');
  }
  const dumps = ((listing && listing.Contents) || [])
    .filter((object) => PUBLIC_DUMP.test(object.Key))
    .sort((a, b) => a.Key.localeCompare(b.Key));
  const newest = dumps.at(-1);
  if (!newest) {
    throw new Error(`Found no wga-<date>.dump under ${BUCKET}. Check the profile reaches the bucket.`);
  }
  return { key: newest.Key, lastModified: newest.LastModified };
}

/**
 * Migration versions and the instant each was merged, newest first, from
 * `git log --first-parent --no-renames --diff-filter=A --format=%cI --name-only`.
 *
 * --no-renames matters: a re-stamped migration (`migration:new -- --rename`) is
 * a rename to git, and rename detection would hide the commit that added it.
 */
export function parseMergeTimes(output) {
  const entries = [];
  const seen = new Set();
  let mergedAt = null;
  for (const line of output.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const path = text.match(MIGRATION_PATH);
    if (path) {
      // First record wins: git prints newest first, and a file can be added
      // more than once across a revert or a re-land.
      if (mergedAt && !seen.has(path[1])) {
        seen.add(path[1]);
        entries.push({ version: path[1], mergedAt });
      }
      continue;
    }
    mergedAt = text;
  }
  return entries;
}

/**
 * The schema the dump belongs to: the newest migration merged before it was
 * captured. Merged, not stamped. Since #1050 the merge is what applies a
 * migration to production, and a PR that sits open for a day is normal, so a
 * file stamped Tuesday and merged Thursday is not in Wednesday's dump.
 */
export function resetVersionFor(captureIso, entries) {
  const captured = Date.parse(captureIso);
  const before = entries
    .filter((entry) => Date.parse(entry.mergedAt) < captured)
    .sort((a, b) => a.version.localeCompare(b.version));
  const newest = before.at(-1);
  if (!newest) {
    throw new Error(
      `No migration on this branch was merged before ${captureIso}. ` +
        'The dump may predate the repo history you have, or the clone may be shallow. Pass --version <stamp>.'
    );
  }
  return newest.version;
}

const psql = (label, sql, single) => ({
  label,
  command: 'psql',
  // -X so a personal .psqlrc cannot change how this behaves. ON_ERROR_STOP
  // because a psql call with several statements otherwise exits 0 past a failed
  // one and the surrounding successes paper over the hole (2026-09-08).
  args: ['-X', '-v', 'ON_ERROR_STOP=1', ...(single ? ['--single-transaction'] : []), '-d', SUPERUSER_DSN, '-c', sql]
});

/** Every step, in order, as a command and its arguments. Runs nothing. */
export function plan({ version, dumpPath }) {
  return [
    { label: 'reset', command: 'supabase', args: ['db', 'reset', '--version', version, '--no-seed'] },
    psql('cron', CRON_QUIET, false),
    psql('truncate', TRUNCATE_ALL, true),
    {
      label: 'restore',
      command: 'pg_restore',
      // --disable-triggers because the nine foreign keys into auth.users would
      // every one fail against an empty local auth.users. --single-transaction
      // so a failure rolls back to empty tables rather than leaving a half
      // loaded set to diagnose; --exit-on-error stays explicit beside it rather
      // than relying on one implying the other.
      args: [
        '--data-only',
        '--disable-triggers',
        '--no-owner',
        '--exit-on-error',
        '--single-transaction',
        '-d',
        SUPERUSER_DSN,
        dumpPath
      ]
    },
    psql('unlink', UNLINK, true),
    // After unlink, so no real account is ever bound; before migrate, so the
    // persona rows go through the branch's migrations as the restored ones do.
    psql('personas', PERSONAS_SQL, true),
    { label: 'migrate', command: 'supabase', args: ['migration', 'up', '--local'] },
    psql('counts', COUNTS, false)
  ];
}

function runStep(step, exec) {
  // A step whose output is read has to be captured; the rest stream straight to
  // the terminal, because a db reset and a restore are the slow ones and a
  // person wants to watch them rather than wait in silence. Getting this wrong
  // is quiet: an inherited stdout leaves result.stdout null, and the parse of
  // it then fails somewhere else entirely.
  const result = exec(step.command, step.args, { capture: Boolean(step.capture) });
  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(
      `"${step.command}" is not installed or not on PATH. It comes from ${INSTALLED_BY[step.command] || 'your package manager.'}`
    );
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').toString().trim().split('\n').slice(-5).join('\n');
    throw new Error(`Step "${step.label}" failed (${step.command} exited ${result.status}).\n${detail}`);
  }
  if (step.capture && !result.stdout) {
    throw new Error(`Step "${step.label}" produced no output to read. Expected ${step.command} to print to stdout.`);
  }
  return result;
}

/** The bucket listing, parsed, with a message that names the real problem. */
function readListing(options, exec) {
  const raw = runStep({ label: 'list', capture: true, ...listCommand(options) }, exec).stdout;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`The bucket listing was not JSON. First 200 characters:\n${String(raw).slice(0, 200)}`);
  }
}

/**
 * Runs the whole thing. `deps` exists so the tests drive it without a bucket or
 * a database; production passes none of them.
 */
export function run(options = {}, deps = {}) {
  const exec =
    deps.exec ||
    ((command, args, { capture } = {}) =>
      spawnSync(command, args, {
        encoding: 'utf8',
        // stderr stays inherited on a captured step so a credential or network
        // failure is readable as it happens rather than only in the throw.
        stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit'
      }));
  const remove = deps.rm || ((path) => rmSync(path, { force: true }));
  const log = deps.log || (() => {});

  let version = options.version;
  let dumpPath = options.dumpPath;

  // --plan never reaches the network, so it needs a version handed to it or
  // computed from a dump that is already named.
  if (!options.plan) {
    const listing = readListing(options, exec);
    const chosen = options.dump
      ? { key: `pg/${options.dump}`, lastModified: pick(listing, options.dump) }
      : newestDump(listing);
    log(`Dump: ${chosen.key}, captured ${chosen.lastModified}`);

    const dir = join(tmpdir(), 'wga-snapshot');
    mkdirSync(dir, { recursive: true });
    dumpPath = join(dir, chosen.key.replace('pg/', ''));
    runStep(
      {
        label: 'fetch',
        command: 'aws',
        args: ['s3', 'cp', `${BUCKET}${chosen.key.replace('pg/', '')}`, dumpPath, ...profileArgs(options)]
      },
      exec
    );

    if (!version) {
      const log_ = runStep(
        {
          label: 'history',
          capture: true,
          command: 'git',
          args: [
            'log',
            '--first-parent',
            '--no-renames',
            '--diff-filter=A',
            '--format=%cI',
            '--name-only',
            '--',
            'supabase/migrations/'
          ]
        },
        exec
      );
      version = resetVersionFor(chosen.lastModified, parseMergeTimes(log_.stdout));
    }
    log(`Schema: resetting to ${version}, the newest migration merged before that.`);
  }

  const steps = plan({ version, dumpPath });
  if (options.plan) return steps;

  for (const step of steps) {
    log(`\n== ${step.label} ==`);
    runStep(step, exec);
    // Only once the data is in: on a failure the file stays, and the message
    // above names the step that could not read it.
    if (step.label === 'restore') remove(dumpPath);
  }
  return steps;
}

function profileArgs({ profile, endpointUrl } = {}) {
  const args = ['--profile', profile || process.env.AWS_PROFILE || DEFAULT_PROFILE];
  if (endpointUrl) args.push('--endpoint-url', endpointUrl);
  return args;
}

function pick(listing, name) {
  const found = ((listing && listing.Contents) || []).find((object) => object.Key === `pg/${name}`);
  if (!found) throw new Error(`No object called pg/${name} in the bucket.`);
  return found.LastModified;
}

function parseArgs(argv) {
  const value = (flag) => {
    const at = argv.indexOf(flag);
    return at === -1 ? undefined : argv[at + 1];
  };
  return {
    plan: argv.includes('--plan'),
    dump: value('--dump'),
    version: value('--version'),
    profile: value('--profile'),
    endpointUrl: process.env.R2_ENDPOINT_URL
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.plan) {
    // Both of these are normally computed from the bucket listing, which --plan
    // must not touch, so they stand in as the shape they will take.
    if (!options.version) options.version = '<newest migration merged before the dump>';
    if (!options.dumpPath) options.dumpPath = join(tmpdir(), 'wga-snapshot', `${options.dump || '<newest>.dump'}`);
  }
  const steps = run(options, { log: (line) => console.log(line) });
  if (options.plan) {
    console.log('These run, in this order. Nothing above was executed.\n');
    for (const step of steps) {
      console.log(`${step.label}:`);
      console.log(`  ${step.command} ${step.args.map((a) => (a.includes('\n') ? '<sql>' : a)).join(' ')}\n`);
    }
    return;
  }
  console.log('\nProduction data is now on this machine. `supabase db reset` puts the seed back.');
  console.log('Sign in with: npm run dev:login -- <one of the personas printed above>');
}

// Only when run, not when imported by the tests.
if (process.argv[1] && process.argv[1].endsWith('db-snapshot.js')) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
