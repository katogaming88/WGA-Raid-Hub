// Which Edge Functions a push to main deploys (#1083). Read by the
// `functions` job in .github/workflows/deploy.yml: the changed paths of the
// push come in on stdin, or --names for a workflow_dispatch, and the names
// to deploy go out one per line. A held function never deploys, whatever
// the input; the hold carries its reason and the issue that removes it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

export function listFunctions(_root = ROOT) {
  throw new Error('unbuilt');
}

export function sharedImporters(_root = ROOT) {
  throw new Error('unbuilt');
}

export function selectFunctions(_opts = {}) {
  throw new Error('unbuilt');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  throw new Error('unbuilt');
}
