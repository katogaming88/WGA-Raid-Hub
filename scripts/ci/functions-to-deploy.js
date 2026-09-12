// Which Edge Functions a push to main deploys (#1083). Read by the
// `functions` job in .github/workflows/deploy.yml: the changed paths of the
// push come in on stdin, or --names for a workflow_dispatch, and the names
// to deploy go out one per line. A held function never deploys, whatever
// the input; the hold carries its reason and the issue that removes it.
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// A directory is a function when its name fits the CLI's slug rule; _shared/
// is not one (the same rule tests/ci/functions-config.test.js applies).
export const FUNCTION_SLUG = /^[A-Za-z][A-Za-z0-9_-]*$/;

// Functions main cannot deploy yet, each with the reason and the PR that
// lifts the hold. discord-bot-webhook: main reads the single BOT_WEBHOOK_URL
// and BOT_WEBHOOK_SECRET pair from #992 and production has neither, so a
// deploy from main breaks every relay call (#997); #959 sets DISCORD_BOT_TOKEN
// ahead of its merge and deletes this entry.
export const HOLD = [
  {
    name: 'discord-bot-webhook',
    reason: 'main needs BOT_WEBHOOK_URL and BOT_WEBHOOK_SECRET, which prod does not have (#997); #959 lifts it'
  }
];

export function listFunctions(root = ROOT) {
  const dir = join(root, 'supabase', 'functions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && FUNCTION_SLUG.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

// Read from the tree rather than kept as a list, so it is true on the day.
export function sharedImporters(root = ROOT) {
  return listFunctions(root).filter((name) => {
    const dir = join(root, 'supabase', 'functions', name);
    return readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .some((file) => readFileSync(join(dir, file), 'utf8').includes('_shared/'));
  });
}

/**
 * `names` wins when given: 'all', or an array of function names (an unknown
 * one throws). Otherwise `changed` is the push's changed paths, repo-relative.
 */
export function selectFunctions({ changed = [], names = null, root = ROOT } = {}) {
  const all = listFunctions(root);
  const wanted = new Set();

  if (names !== null && names !== undefined) {
    if (names === 'all') {
      all.forEach((name) => wanted.add(name));
    } else {
      for (const name of names) {
        if (!all.includes(name)) throw new Error(`Unknown function: ${name}`);
        wanted.add(name);
      }
    }
  } else {
    let importers = null;
    for (const raw of changed) {
      const path = raw.replace(/\\/g, '/');
      if (path === 'supabase/config.toml') {
        all.forEach((name) => wanted.add(name));
        continue;
      }
      const match = path.match(/^supabase\/functions\/([^/]+)\//);
      if (!match) continue;
      if (match[1] === '_shared') {
        if (importers === null) importers = sharedImporters(root);
        importers.forEach((name) => wanted.add(name));
        continue;
      }
      // A path under a directory that no longer exists is a deleted function,
      // and there is nothing to deploy for it.
      if (all.includes(match[1])) wanted.add(match[1]);
    }
  }

  const held = HOLD.filter((entry) => wanted.has(entry.name)).map(({ name, reason }) => ({ name, reason }));
  const deploy = [...wanted].filter((name) => !HOLD.some((entry) => entry.name === name)).sort();
  return { deploy, held };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (flag) => {
    const at = args.indexOf(flag);
    return at >= 0 ? (args[at + 1] ?? '') : undefined;
  };
  const root = option('--root') ?? ROOT;
  const namesArg = option('--names');
  let names = null;
  if (namesArg !== undefined) {
    const trimmed = namesArg.trim();
    names =
      trimmed === 'all'
        ? 'all'
        : trimmed === ''
          ? []
          : trimmed
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
  }
  const changed =
    names === null
      ? readFileSync(0, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
  const { deploy, held } = selectFunctions({ changed, names, root });
  for (const entry of held) console.error(`held: ${entry.name} (${entry.reason})`);
  for (const name of deploy) console.log(name);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `functions=${deploy.join(' ')}\nheld=${held.map((entry) => entry.name).join(' ')}\n`
    );
  }
}
