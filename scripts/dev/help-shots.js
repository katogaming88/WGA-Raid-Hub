// Retakes the Help guides' pictures (#1526) into app/public/help-shots/, and
// the front page's (#1226) into app/public/front-shots/ and og-banner.png:
// builds the app, then runs the "help guide pictures" block of the browser
// tests, which opens each page on made-up data and numbers what each step
// points at. Run it after a page a guide shows changes, and commit the
// pictures with that change.
import { spawnSync } from 'node:child_process';

const run = (cmd, args, opts = {}) => {
  const result = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('npm', ['run', 'build'], { cwd: 'app' });
run(
  'npx',
  ['vitest', 'run', 'tests/browser-app/app.test.js', '-t', '"(help guide|front page) pictures"', '--testTimeout=60000'],
  {
    env: { ...process.env, HELP_SHOTS: '1' }
  }
);
