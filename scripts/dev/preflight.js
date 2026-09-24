// Runs, before a push, the CI checks that apply to what this branch changed.
//
// `npm run preflight` reads the changed paths (against origin/main, plus
// uncommitted and untracked files), picks the jobs from .github/workflows that
// those paths trigger, runs each, and prints one line per job. Only a failing
// job shows output (its last lines). The point is to run the whole set that CI
// will run, once, in the right order, instead of a hand-picked subset:
// a subset let a stale version stamp and a browser test through on #1318 and
// #1323.
//
// Usage:
//   npm run preflight                 the jobs this branch's changes trigger
//   npm run preflight -- --list       show which jobs would run
//   npm run preflight -- --all        every job, whatever changed
//   npm run preflight -- --only=lint,rls
//   npm run preflight -- --skip=browser
//
// Needs the local Supabase stack up for the rls and schema jobs. After a manual
// session against the local stack (a screenshot that flips a switch), run
// `supabase db reset` first: committed rows from that session fail the audit
// tests. Exit code 1 if any job fails.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DENO = 'npx -y deno@2.9.6';
const starts = (files, prefixes) => files.some((f) => prefixes.some((p) => f === p || f.startsWith(p)));

const PAGES = ['index.html', 'officer.html', 'admin.html', 'guild.html', 'boe.html', 'calendar.html'];

// One entry per CI job. `when` is the path filter the workflow uses, `steps`
// the commands it runs (a string, or [command, cwd]).
export const CHECKS = [
  {
    name: 'version',
    when: () => true,
    steps: [
      'node scripts/ci/manifest-check.js origin/main',
      { changelog: 'node scripts/ci/changelog-check.js origin/main' }
    ]
  },
  {
    name: 'lint',
    when: (f) => starts(f, ['js/', 'scripts/', 'tests/', 'supabase/functions/']),
    steps: ['npm run lint', 'npm run format:check', 'npm run typecheck', 'node scripts/ci/rls-no-autocommit-check.js']
  },
  {
    name: 'frontend',
    when: (f) => starts(f, ['js/', 'tests/frontend/', 'package.json']),
    steps: ['npm run test:frontend', 'node scripts/ci/team-wide-read-check.js']
  },
  { name: 'rls', when: (f) => starts(f, ['supabase/', 'tests/rls/']), steps: ['npm run test:rls'] },
  {
    name: 'schema',
    when: (f) =>
      starts(f, ['supabase/migrations/', 'supabase/roles.sql', 'supabase/config.toml', 'dbdoc/', 'docs/rls_policies']),
    steps: [
      'npm run db:definitions:check',
      'npm run db:types:check',
      'npm run db:docs:check',
      'npx supabase db lint --local --schema public --level warning --fail-on warning'
    ]
  },
  {
    name: 'ledger',
    when: (f) => starts(f, ['supabase/migrations/', 'docs/database-decisions.md']),
    steps: ['node scripts/ci/decision-log-check.js', 'node scripts/ci/migration-ledger-check.js']
  },
  {
    name: 'app',
    when: (f) => starts(f, ['app/', 'js/database.types.ts', 'tests/browser-app/', 'tests/behavior/']),
    steps: [
      ['npm run typecheck', 'app'],
      ['npm run lint', 'app'],
      ['npm run format:check', 'app'],
      ['npm test', 'app'],
      ['npm run build', 'app']
    ]
  },
  // Serves app/dist, so it has to come after the app job's build.
  {
    name: 'browser',
    when: (f) => starts(f, ['app/', 'js/database.types.ts', 'tests/browser-app/', 'tests/behavior/']),
    steps: ['npm run test:app-browser']
  },
  {
    name: 'pages',
    when: (f) => starts(f, [...PAGES, 'js/', 'css/']),
    steps: [
      'npx vitest run tests/ci/asset-version-check.test.js',
      'npx vitest run tests/ci/page-markup.test.js',
      'npm run test:a11y'
    ]
  },
  {
    name: 'functions',
    when: (f) => starts(f, ['supabase/functions/', 'tests/edge/', 'deno.jsonc', 'js/common.js']),
    steps: () => [
      `${DENO} check ${readdirSync('supabase/functions')
        .map((d) => `supabase/functions/${d}/index.ts`)
        .filter((p) => existsSync(p))
        .join(' ')}`,
      `${DENO} lint`,
      `${DENO} task test`,
      'npx vitest run tests/ci/functions-'
    ]
  },
  { name: 'import', when: (f) => starts(f, ['scripts/', 'tests/import/']), steps: ['npm run test:import'] },
  { name: 'ci-tests', when: (f) => starts(f, ['scripts/ci/', 'tests/ci/']), steps: ['npm run test:ci'] },
  { name: 'bot', when: (f) => starts(f, ['bot/']), steps: ['npm --prefix bot test'] }
];

export const selectChecks = (files, checks = CHECKS) => checks.filter((c) => c.when(files));

function changedFiles() {
  const base = execSync('git merge-base origin/main HEAD', { encoding: 'utf8' }).trim();
  const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).split('\n').filter(Boolean);
  return [...new Set([...run(`git diff --name-only ${base}`), ...run('git ls-files -o --exclude-standard')])];
}

const tail = (text, n = 30) => text.trim().split('\n').slice(-n).join('\n');

// changelog-check.js reports through outputs, not its exit code.
function changelogProblem(out) {
  if (/^missing_entry=.+/m.test(out)) return `CHANGELOG.md has no entry for: ${out.match(/^missing_entry=(.+)$/m)[1]}`;
  if (/^version_bump=false/m.test(out)) return 'no version bump (npm run stamp -- <x.y.z>)';
  return null;
}

function runStep(step) {
  const [cmd, cwd] = typeof step === 'string' ? [step, '.'] : step.changelog ? [step.changelog, '.'] : step;
  const res = spawnSync(cmd, { shell: true, cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  if (typeof step === 'object' && !Array.isArray(step) && step.changelog) {
    const problem = changelogProblem(out);
    return problem ? { ok: false, cmd, out: problem } : { ok: true };
  }
  return res.status === 0 ? { ok: true } : { ok: false, cmd, out };
}

function main(argv) {
  const opt = (name) =>
    argv
      .find((a) => a.startsWith(`--${name}=`))
      ?.split('=')[1]
      ?.split(',');
  const files = changedFiles();
  let checks = argv.includes('--all') ? CHECKS : selectChecks(files);
  if (opt('only')) checks = CHECKS.filter((c) => opt('only').includes(c.name));
  if (opt('skip')) checks = checks.filter((c) => !opt('skip').includes(c.name));

  if (argv.includes('--list')) {
    console.log(`${files.length} changed files. Would run: ${checks.map((c) => c.name).join(', ') || 'nothing'}`);
    return 0;
  }

  // The version job compares committed changes with origin/main, as CI does.
  const uncommitted = execSync('git status --porcelain', { encoding: 'utf8' }).split('\n').filter(Boolean).length;
  if (uncommitted && checks.some((c) => c.name === 'version')) {
    console.log(
      `note: ${uncommitted} uncommitted files. The version job reads committed changes only; commit first.\n`
    );
  }

  let failed = 0;
  for (const check of checks) {
    const started = Date.now();
    const steps = typeof check.steps === 'function' ? check.steps() : check.steps;
    let bad = null;
    for (const step of steps) {
      const result = runStep(step);
      if (!result.ok) {
        bad = result;
        break;
      }
    }
    const secs = Math.round((Date.now() - started) / 1000);
    if (bad) {
      failed++;
      console.log(`FAIL ${check.name} (${secs}s)  ${bad.cmd}\n${tail(bad.out)}\n`);
    } else {
      console.log(`PASS ${check.name} (${secs}s)`);
    }
  }
  console.log(failed ? `\n${failed} of ${checks.length} failed` : `\nAll ${checks.length} passed`);
  return failed ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
