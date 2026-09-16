import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newestDump,
  parseMergeTimes,
  resetVersionFor,
  listCommand,
  plan,
  run,
  historyArgs,
  DEFAULT_BRANCH,
  EMPTY_CHECK_TABLES
} from '../../scripts/dev/db-snapshot.js';
import { PERSONAS_SQL } from '../../scripts/dev/snapshot-personas.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Last night's production data under the PR's migrations (#1056).
//
// The local stack rebuilds from a small seed, so a migration is rehearsed on
// six players and four teams. This loads the nightly dump instead. Everything
// here runs with the bucket and the database injected, because the real thing
// reads production onto the machine and a test that did so would be either
// skipped or unsafe.
//
// What is pinned is the part that is easy to get wrong and impossible to see
// afterwards: which dump, which schema version it belongs to, and the order and
// flags of the steps. A restore into the wrong schema does not announce itself.

const LISTING = {
  IsTruncated: false,
  Contents: [
    { Key: 'pg/wga-2026-09-08.dump', LastModified: '2026-09-08T10:02:11Z' },
    { Key: 'pg/wga-auth-2026-09-09.dump', LastModified: '2026-09-09T10:03:40Z' },
    { Key: 'pg/wga-2026-09-09.dump', LastModified: '2026-09-09T10:02:55Z' },
    { Key: 'pg/wga-auth-2026-09-08.dump', LastModified: '2026-09-08T10:03:02Z' }
  ]
};

describe('newestDump (#1056)', () => {
  it('picks the newest public dump', () => {
    expect(newestDump(LISTING).key).toBe('pg/wga-2026-09-09.dump');
  });

  it('carries the capture instant, which is what the schema version is computed from', () => {
    // The upload time, not the 10:00 UTC schedule: GitHub cron drifts, and the
    // dump is uploaded minutes after it is taken.
    expect(newestDump(LISTING).lastModified).toBe('2026-09-09T10:02:55Z');
  });

  it('ignores the auth dumps, which are never restored here', () => {
    const authOnly = { IsTruncated: false, Contents: [LISTING.Contents[1], LISTING.Contents[3]] };
    expect(() => newestDump(authOnly)).toThrow(/no .*dump/i);
  });

  it('refuses an empty listing rather than handing undefined to a download', () => {
    expect(() => newestDump({ IsTruncated: false, Contents: [] })).toThrow(/no .*dump/i);
  });

  it('refuses a truncated listing rather than picking the newest of one page', () => {
    // Retention is 365 days times two objects, so the 1000-key page is reachable.
    expect(() => newestDump({ ...LISTING, IsTruncated: true })).toThrow(/truncated|more than/i);
  });
});

describe('parseMergeTimes (#1056)', () => {
  // git log --first-parent --no-renames --diff-filter=A --format=%cI --name-only
  const LOG = [
    '2026-09-09T18:06:48-04:00',
    '',
    'supabase/migrations/20260909170340_app_version_ledger_head.sql',
    '',
    '2026-09-09T14:14:52-04:00',
    '',
    'supabase/migrations/20260909131340_profile_updated_at_timestamps.sql',
    'supabase/migrations/20260909134816_self_received_requests_updated_at_insert_trigger.sql',
    ''
  ].join('\n');

  it('reads a version and its merge instant out of each block', () => {
    expect(parseMergeTimes(LOG)).toEqual([
      { version: '20260909170340', mergedAt: '2026-09-09T18:06:48-04:00' },
      { version: '20260909131340', mergedAt: '2026-09-09T14:14:52-04:00' },
      { version: '20260909134816', mergedAt: '2026-09-09T14:14:52-04:00' }
    ]);
  });

  it('keeps the first record for a file, which is the newest commit that added it', () => {
    const readded =
      LOG + '\n2026-01-01T00:00:00-05:00\n\nsupabase/migrations/20260909170340_app_version_ledger_head.sql\n';
    const found = parseMergeTimes(readded).filter((e) => e.version === '20260909170340');
    expect(found).toEqual([{ version: '20260909170340', mergedAt: '2026-09-09T18:06:48-04:00' }]);
  });
});

describe('resetVersionFor (#1056)', () => {
  const CAPTURE = '2026-09-09T10:00:00Z';
  const entries = [
    { version: '20260908090000', mergedAt: '2026-09-08T12:00:00Z' },
    { version: '20260909050000', mergedAt: '2026-09-09T09:59:00Z' },
    { version: '20260909053000', mergedAt: '2026-09-09T10:01:00Z' }
  ];

  it('takes the newest migration merged before the capture', () => {
    expect(resetVersionFor(CAPTURE, entries)).toBe('20260909050000');
  });

  it('excludes one merged a minute after the capture', () => {
    // After #1050 the merge is what applies a migration to production, so a
    // migration merged after the dump was taken is not in the dump's schema.
    expect(resetVersionFor(CAPTURE, entries)).not.toBe('20260909053000');
  });

  it('excludes a migration stamped before the capture but merged after it', () => {
    // This is the case the stamp-based rule got wrong. A stamp is when the file
    // was created; a PR that sits open for a day is normal here, and including
    // a migration the dump's schema never had can fail the restore on a NOT
    // NULL column with no default.
    const stampedEarly = [
      { version: '20260908090000', mergedAt: '2026-09-08T12:00:00Z' },
      { version: '20260909010000', mergedAt: '2026-09-09T15:00:00Z' }
    ];
    expect(resetVersionFor(CAPTURE, stampedEarly)).toBe('20260908090000');
  });

  it('refuses when nothing was merged before the capture, naming what to pass', () => {
    expect(() => resetVersionFor('2020-01-01T00:00:00Z', entries)).toThrow(/--version/);
  });
});

describe('plan (#1056)', () => {
  const built = plan({ version: '20260909050000', dumpPath: '/tmp/wga-snapshot/wga-2026-09-09.dump' });
  const labels = built.map((step) => step.label);
  const step = (label) => built.find((s) => s.label === label);
  const argsOf = (label) => step(label).args.join(' ');

  it('orders reset, cron quiet, truncate, restore, unlink, personas, migrate, counts', () => {
    expect(labels).toEqual(['reset', 'cron', 'truncate', 'restore', 'unlink', 'personas', 'migrate', 'counts']);
  });

  it('resets to the computed version without the seed', () => {
    expect(argsOf('reset')).toContain('--version 20260909050000');
    expect(argsOf('reset')).toContain('--no-seed');
  });

  it('quiets cron in its own committed call, before the truncate', () => {
    // Not folded into the truncate batch: that batch is one transaction, so
    // nothing in it takes effect until it commits, and the jobs would stay live
    // for the whole of it. A --no-seed reset leaves them active.
    expect(labels.indexOf('cron')).toBeLessThan(labels.indexOf('truncate'));
    expect(argsOf('cron')).toContain('cron.alter_job');
    expect(argsOf('cron')).not.toContain('--single-transaction');
  });

  it('empties every public base table by asking the catalog, not by listing them', () => {
    // A written-down list is a list that goes stale the next time someone adds
    // a table, and the symptom would be a duplicate key deep in the restore.
    expect(argsOf('truncate')).toContain('pg_tables');
    expect(argsOf('truncate')).toContain('restart identity cascade');
  });

  it('restores data only, with triggers off and the whole thing in one transaction', () => {
    const args = argsOf('restore');
    expect(args).toContain('--data-only');
    expect(args).toContain('--disable-triggers');
    expect(args).toContain('--no-owner');
    expect(args).toContain('--exit-on-error');
    expect(args).toContain('--single-transaction');
    expect(args).toContain('/tmp/wga-snapshot/wga-2026-09-09.dump');
  });

  it('runs as supabase_admin, the only local superuser', () => {
    // postgres has bypassrls but not rolsuper, and --disable-triggers needs
    // superuser. Measured on this stack.
    expect(argsOf('restore')).toContain('supabase_admin');
    expect(argsOf('truncate')).toContain('supabase_admin');
    expect(argsOf('personas')).toContain('supabase_admin');
  });

  it('stops every psql batch on the first error', () => {
    // A psql call with several statements exits 0 past a failed one and the
    // surrounding successes paper over the hole (2026-09-08).
    for (const label of ['cron', 'truncate', 'unlink', 'personas', 'counts']) {
      expect(argsOf(label)).toContain('ON_ERROR_STOP=1');
    }
  });

  it('unlinks every column that points at auth.users, and deletes the one that cannot be nulled', () => {
    const args = argsOf('unlink');
    for (const table of [
      'audit_log',
      'boe_managers',
      'guild_officers',
      'season_signups',
      'site_admins',
      'team_members',
      'priority_conflict_dismissals',
      'priority_stale_dismissals'
    ]) {
      expect(args).toContain(table);
    }
    expect(args).toMatch(/delete from public\.account_preferences/);
    // Until #940 reaches production, the restored schema still has the table it replaced.
    expect(args).toMatch(/delete from public\.no_character_dismissals/);
    // #942: people keep the Discord id and lose the production account.
    expect(args).toMatch(/update public\.people set auth_user_id = null/);
    // #942 step 2: the three grant names are only updated while they are still
    // tables; after it they are views that reach the account through people.
    expect(args).toMatch(/relkind from pg_class where oid = to_regclass\('public\.site_admins'\)\) = 'r'/);
  });

  it('mints the personas after the unlink and before the migrations, in one transaction', () => {
    // After unlink so auth.users is empty and every restored link is null,
    // which keeps the guarantee that step exists for: no real account is ever
    // bound on this machine. Before migrate so the persona rows go through the
    // branch's migrations exactly as the restored rows do.
    expect(labels.indexOf('personas')).toBeGreaterThan(labels.indexOf('unlink'));
    expect(labels.indexOf('personas')).toBeLessThan(labels.indexOf('migrate'));
    expect(argsOf('personas')).toContain('--single-transaction');
    expect(step('personas').args).toContain(PERSONAS_SQL);
  });

  it('runs the branch own migrations on top, last', () => {
    expect(argsOf('migrate')).toContain('--local');
    expect(labels.indexOf('migrate')).toBeGreaterThan(labels.indexOf('personas'));
  });
});

describe('the persona batch (#1065)', () => {
  // The batch is SQL the tests cannot run here (tests/rls/snapshot-personas
  // does, against the seeded stack). What is pinned is what it reads and
  // writes, so a table added to the grant set or dropped from it shows up.
  it('derives the team personas from the teams table rather than a list', () => {
    expect(PERSONAS_SQL).toMatch(/from public\.teams/);
  });

  it('mints an account and an identity, then every grant row and the raider character', () => {
    for (const table of [
      'auth.users',
      'auth.identities',
      'public.team_members',
      'public.guild_grants',
      // Until #942 step 2 reaches production, the dump's schema still has the
      // three tables it replaced.
      'public.site_admins',
      'public.guild_officers',
      'public.boe_managers',
      'public.players'
    ]) {
      expect(PERSONAS_SQL).toContain(`insert into ${table}`);
    }
    expect(PERSONAS_SQL).toMatch(/to_regclass\('public\.guild_grants'\)/);
    expect(PERSONAS_SQL).toContain('raider-Persona');
  });

  it('reserves 20-digit ids starting with 9, which no snowflake can ever be', () => {
    // A Discord snowflake is an unsigned 64-bit integer, so it never exceeds
    // 18446744073709551615. Twenty digits starting with 9 is outside the space
    // for good, and the unique constraints turn any collision into a loud
    // insert failure rather than a silent bind to a stranger's row.
    expect(PERSONAS_SQL).toContain("'9000000000000000'");
  });

  it('never papers over a collision', () => {
    expect(PERSONAS_SQL).not.toMatch(/on conflict/i);
  });
});

describe('the bucket call (#1056)', () => {
  const args = (opts) => listCommand(opts).args.join(' ');

  it('asks for json, so the capture instant is exact rather than a printed local time', () => {
    expect(args({})).toContain('list-objects-v2');
    expect(args({})).toContain('--output json');
  });

  it('names the read-only profile by default', () => {
    expect(args({})).toContain('--profile wga-raidhub-backups-ro');
  });

  it('carries no endpoint, because the profile holds it', () => {
    // aws configure set endpoint_url ... --profile <p>, typed once. Keeping the
    // account id off the command line is the point: it is a repo secret and it
    // is not written down anywhere here.
    expect(args({})).not.toContain('--endpoint-url');
  });

  it('carries one when the environment names it, for a caller with no profile', () => {
    expect(args({ endpointUrl: 'https://acct.r2.cloudflarestorage.com' })).toContain(
      '--endpoint-url https://acct.r2.cloudflarestorage.com'
    );
  });
});

describe('run (#1056)', () => {
  it('builds steps that can be printed, with no hole where a computed value goes', () => {
    // --plan runs before anything is fetched, so the dump path and the version
    // are both still unknown. Leaving either undefined puts it straight into an
    // argument list, and the failure surfaces in the printer rather than here.
    const steps = run(
      { plan: true, version: '20260909050000', dumpPath: '/tmp/d.dump' },
      { exec: () => ({ status: 0 }) }
    );
    for (const step of steps) {
      expect(typeof step.command).toBe('string');
      for (const arg of step.args) expect(typeof arg).toBe('string');
    }
  });

  it('executes nothing under --plan, and never reaches the network', () => {
    const calls = [];
    run(
      { plan: true, version: '20260909050000' },
      {
        exec: (cmd, args) => {
          calls.push([cmd, ...args].join(' '));
          return { status: 0, stdout: '' };
        }
      }
    );
    expect(calls).toEqual([]);
  });

  it('stops at the first failing step and names it, leaving the dump behind to diagnose', () => {
    const removed = [];
    const exec = (cmd) => {
      if (cmd === 'aws') return { status: 0, stdout: JSON.stringify(LISTING) };
      if (cmd === 'pg_restore') return { status: 1, stderr: 'ERROR: column "note" of relation "loot" does not exist' };
      return { status: 0, stdout: '' };
    };
    expect(() => run({ version: '20260909050000' }, { exec, rm: (p) => removed.push(p) })).toThrow(/restore/);
    // The downloaded dump is production data, so it is deleted the moment the
    // restore succeeds. This is the other branch: it stays, because the two
    // failure shapes here are both diagnosed from the file.
    expect(removed).toEqual([]);
  });

  it('deletes the dump once the restore has taken', () => {
    const removed = [];
    const exec = (cmd) => (cmd === 'aws' ? { status: 0, stdout: JSON.stringify(LISTING) } : { status: 0, stdout: '' });
    run({ version: '20260909050000' }, { exec, rm: (p) => removed.push(p) });
    expect(removed.length).toBe(1);
    expect(removed[0]).toContain('wga-2026-09-09.dump');
  });

  it('captures the output of a step it reads, and lets the slow ones stream', () => {
    // The listing has to be captured to be parsed. The reset and the restore
    // are the slow steps and belong on the terminal, so a person can watch them
    // rather than wait in silence. Getting this backwards is quiet: an
    // inherited stdout leaves the result empty and the failure lands at the
    // parse, several lines away from the cause.
    const seen = [];
    const exec = (cmd, args, opts) => {
      seen.push({ cmd, capture: Boolean(opts && opts.capture) });
      return cmd === 'aws' && args[0] === 's3api'
        ? { status: 0, stdout: JSON.stringify(LISTING) }
        : { status: 0, stdout: '' };
    };
    run({ version: '20260909050000' }, { exec });
    expect(seen.find((s) => s.cmd === 'aws').capture).toBe(true);
    expect(seen.find((s) => s.cmd === 'supabase').capture).toBe(false);
    expect(seen.find((s) => s.cmd === 'pg_restore').capture).toBe(false);
  });

  it('says which step printed nothing, rather than failing later at the parse', () => {
    const exec = (cmd) => (cmd === 'aws' ? { status: 0, stdout: null } : { status: 0, stdout: '' });
    expect(() => run({ version: '20260909050000' }, { exec })).toThrow(/list.*no output/i);
  });

  it('names the listing when it comes back as something other than JSON', () => {
    const exec = (cmd) =>
      cmd === 'aws' ? { status: 0, stdout: 'Unable to locate credentials' } : { status: 0, stdout: '' };
    expect(() => run({ version: '20260909050000' }, { exec })).toThrow(/not JSON/i);
  });

  // spawnSync on a program that is not on PATH returns status null with
  // error.code ENOENT and no stderr at all, so without this the message is
  // "aws exited null" and nothing else. It is the first thing a new machine
  // hits, and the two programs it hits are the two the repo never asked anyone
  // to install.
  const missing = (name) => (cmd) =>
    cmd === name
      ? { status: null, error: Object.assign(new Error('spawnSync ENOENT'), { code: 'ENOENT' }) }
      : { status: 0, stdout: JSON.stringify(LISTING) };

  it('says the AWS CLI is missing rather than reporting a null exit', () => {
    expect(() => run({ version: '20260909050000' }, { exec: missing('aws') })).toThrow(
      /aws.*not installed|not on PATH/i
    );
    expect(() => run({ version: '20260909050000' }, { exec: missing('aws') })).toThrow(/AWS CLI/);
  });

  it('names the Postgres client, and its version floor, when pg_restore is missing', () => {
    // The archive is written by a 17 server, so an older client cannot read it.
    const exec = (cmd) =>
      cmd === 'pg_restore'
        ? { status: null, error: Object.assign(new Error('spawnSync ENOENT'), { code: 'ENOENT' }) }
        : { status: 0, stdout: JSON.stringify(LISTING) };
    expect(() => run({ version: '20260909050000' }, { exec })).toThrow(/pg_restore/);
    expect(() => run({ version: '20260909050000' }, { exec })).toThrow(/17/);
  });
});

describe('the printed counts follow the backup workflow (#1056)', () => {
  it('checks exactly the tables db-backup.yml refuses to see empty', () => {
    // Two lists of the same thing in two files drift, and this pair drifts
    // silently: the snapshot would keep reporting on a table the backup stopped
    // caring about, or stay quiet about one it started caring about.
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'db-backup.yml'), 'utf8');
    const line = workflow.match(/EMPTY_CHECK="([^"]+)"/);
    expect(line, 'db-backup.yml no longer declares EMPTY_CHECK').not.toBeNull();
    expect(EMPTY_CHECK_TABLES).toEqual(line[1].trim().split(/\s+/));
  });
});

describe('the history walk (#1198)', () => {
  // A branch's own migration is not on production, whatever its commit time.
  // The walk that decides the starting schema therefore begins at the merge
  // base with origin/main, never at the branch tip: a file that exists only on
  // the branch is applied on top by `migration up`, and is never the reset
  // target. Seen on feat/942-guild-grants (committed 13:52Z, dump captured
  // 14:37Z): the script reset to the branch's own migration and the restore
  // failed on a view the dump still held as a table.
  const CAPTURE = '2026-09-15T14:37:15Z';
  const MERGE_BASE = '5833c6b0000000000000000000000000000000000';
  // What git prints when asked from the trunk: main's files only.
  const MAIN_LOG = ['2026-09-15T12:10:00Z', 'supabase/migrations/20260915003743_on_main.sql', ''].join('\n');
  // What it prints when asked from the branch tip: the branch's own migration
  // first, committed the morning before the capture.
  const BRANCH_LOG = [
    '2026-09-15T13:52:00Z',
    'supabase/migrations/20260915092357_only_on_branch.sql',
    '',
    MAIN_LOG
  ].join('\n');

  const gitExec = (calls) => (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'aws' && args[0] === 's3api') {
      return {
        status: 0,
        stdout: JSON.stringify({
          IsTruncated: false,
          Contents: [{ Key: 'pg/wga-2026-09-15.dump', LastModified: CAPTURE }]
        })
      };
    }
    if (cmd === 'git' && args[0] === 'merge-base') return { status: 0, stdout: `${MERGE_BASE}\n` };
    if (cmd === 'git' && args[0] === 'log') {
      return { status: 0, stdout: args.includes(MERGE_BASE) ? MAIN_LOG : BRANCH_LOG };
    }
    return { status: 0, stdout: '' };
  };

  it('asks git for the log from a named revision, with the flags parseMergeTimes documents', () => {
    const args = historyArgs('abc123');
    expect(args[0]).toBe('log');
    expect(args[1]).toBe('abc123');
    for (const flag of ['--first-parent', '--no-renames', '--diff-filter=A', '--format=%cI', '--name-only']) {
      expect(args).toContain(flag);
    }
    expect(args.slice(-2)).toEqual(['--', 'supabase/migrations/']);
  });

  it('fetches main, finds the merge base, and walks from there', () => {
    const calls = [];
    run({}, { exec: gitExec(calls), rm: () => {} });
    const git = calls.filter(([cmd]) => cmd === 'git').map((c) => c.slice(1));
    expect(git[0]).toEqual(['fetch', 'origin', 'main']);
    expect(git[1]).toEqual(['merge-base', 'HEAD', DEFAULT_BRANCH]);
    expect(git[2].slice(0, 2)).toEqual(['log', MERGE_BASE]);
  });

  it('never resets to a migration that exists only on the branch', () => {
    const calls = [];
    const steps = run({}, { exec: gitExec(calls), rm: () => {} });
    const reset = steps.find((s) => s.label === 'reset');
    expect(reset.args).toContain('20260915003743');
    expect(reset.args).not.toContain('20260915092357');
  });
});
