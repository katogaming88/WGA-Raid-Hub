// Where a Discord post goes (#1081). A function decides from its own
// SUPABASE_URL, which the platform sets and nothing else can: the one
// production host posts to the poster's live name, and anything else is a
// local stack that posts to DISCORD_TEST_WEBHOOK_URL marked [local] with
// nobody pinged. A local stack never falls through to a live name, and
// production never posts to the test webhook. Every poster names a key in
// DESTINATIONS; tests/ci/functions-webhook-destination.test.js pins that no
// poster reads a webhook name on its own.

export const PLATFORM_URL = 'SUPABASE_URL';

// The project ref js/common.js publishes and deploy.yml deploys to; the CI
// guard pins the three against each other. Any other host, a preview branch
// or a restore under a new ref included, is local until this line moves.
export const PRODUCTION_HOST = 'kxgjqnpwfklbgrxdgmmv.supabase.co';

export const TEST_WEBHOOK = 'DISCORD_TEST_WEBHOOK_URL';

// Each key's env chain on production, first set name wins. BOE_WEBHOOK_URL
// is the documented name and the one a dotenv file can carry; the prod
// secret was created in the dashboard as BOE-Found-Webhook (2026-08-26), so
// it is read as the fallback rather than re-pasted. The sold post falls
// through to the found channel until BOE_SOLD_WEBHOOK_URL is set.
export const DESTINATIONS = {
  'boe-found': ['BOE_WEBHOOK_URL', 'BOE-Found-Webhook'],
  'boe-sold': ['BOE_SOLD_WEBHOOK_URL', 'BOE_WEBHOOK_URL', 'BOE-Found-Webhook'],
  contact: ['CONTACT_WEBHOOK_URL']
} as const;

export type DestinationKey = keyof typeof DESTINATIONS;
export type Env = { get(name: string): string | undefined };
export type Source = 'production' | 'local';
export type Destination =
  { kind: 'post'; url: string; source: Source; via: string } | { kind: 'skip'; reason?: string };

export function isProductionStack(env: Env): boolean {
  const url = env.get(PLATFORM_URL);
  if (!url) return false;
  try {
    return new URL(url).hostname === PRODUCTION_HOST;
  } catch {
    return false;
  }
}

export function isLocalStack(env: Env): boolean {
  return !isProductionStack(env);
}

export function resolveDestination(env: Env, { destination }: { destination: string }): Destination {
  const chain = DESTINATIONS[destination as DestinationKey];
  if (!chain) throw new Error('Unknown Discord destination: ' + destination);
  if (isLocalStack(env)) {
    const url = env.get(TEST_WEBHOOK);
    if (!url) return { kind: 'skip', reason: TEST_WEBHOOK + ' is not set on this local stack' };
    return { kind: 'post', url, source: 'local', via: TEST_WEBHOOK };
  }
  for (const name of chain) {
    const url = env.get(name);
    if (url) return { kind: 'post', url, source: 'production', via: name };
  }
  return { kind: 'skip' };
}

export function marker(source: Source): string | null {
  return source === 'local' ? '[local]' : null;
}

// parse is written out on both stacks so the guard against pinging everyone
// is a line somebody can read; the users allowlist survives production only.
export function allowedMentions(source: Source, users: string[]): { parse: never[]; users: string[] } {
  return { parse: [], users: source === 'production' ? users : [] };
}
