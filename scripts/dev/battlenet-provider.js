// Adds Battle.net sign-in to the local stack (#1157).
//
//   npm run dev:battlenet
//
// Battle.net is a custom provider in Supabase Auth, and custom providers live
// in the auth database rather than in config.toml, so `supabase db reset` can
// drop it. This puts it back, and does nothing when it is already there.
//
// It reads the client secret from supabase/.env (git-ignored), next to the
// Discord one:
//
//   BATTLENET_SIGNIN_CLIENT_SECRET=<the "WGA Raid Hub sign-in" client's secret>
//
// Two settings that look optional are not, both found on 2026-09-14:
// - provider_type oauth2, not oidc. Blizzard publishes its signing key in
//   standard base64, GoTrue's key parser refuses it, and every sign-in fails
//   with "Error getting user profile from external provider".
// - the identifier includes the custom: prefix. The admin API's own docs say
//   it is added for you; the server refuses it without.
//
// Node built-ins only, like everything in scripts/.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStatus } from './local-login.js';

export const IDENTIFIER = 'custom:battlenet';
// The Battle.net developer client "WGA Raid Hub sign-in". Client ids are public.
export const CLIENT_ID = '2f03a1ff9c03463e9e2af08cc5e4e7d3';
export const SECRET_KEY = 'BATTLENET_SIGNIN_CLIENT_SECRET';

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', '.env');

/** KEY=value lines, ignoring blanks and comments. Values are taken verbatim. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** The provider as the admin API creates it. */
export function providerBody(secret) {
  return {
    provider_type: 'oauth2',
    identifier: IDENTIFIER,
    name: 'Battle.net',
    client_id: CLIENT_ID,
    client_secret: secret,
    authorization_url: 'https://oauth.battle.net/authorize',
    token_url: 'https://oauth.battle.net/token',
    userinfo_url: 'https://oauth.battle.net/userinfo',
    // wow.profile is the account's character list.
    scopes: ['openid', 'wow.profile'],
    // Battle.net shares no email address.
    email_optional: true,
    // The BattleTag lands on the identity as custom_claims.battletag.
    custom_claims_allowlist: ['battletag', 'id']
  };
}

function headers(status) {
  return {
    apikey: status.SERVICE_ROLE_KEY,
    Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };
}

/**
 * Creates the provider unless it exists. `deps` lets the tests run without a
 * stack; production passes none. Returns 'exists' or 'created'.
 */
export async function ensureProvider(deps = {}) {
  const status = (deps.status || readStatus)();
  const doFetch = deps.fetch || fetch;
  const readEnv = deps.readEnv || (() => readFileSync(ENV_FILE, 'utf8'));

  const base = `${status.API_URL}/auth/v1/admin/custom-providers`;
  const list = await doFetch(base, { method: 'GET', headers: headers(status) });
  if (!list.ok) throw new Error(`The auth API refused the provider list with ${list.status}: ${await list.text()}`);
  const { providers = [] } = await list.json();
  if (providers.some((p) => p.identifier === IDENTIFIER)) return 'exists';

  let env;
  try {
    env = parseEnv(readEnv());
  } catch {
    env = {};
  }
  const secret = env[SECRET_KEY];
  if (!secret) {
    throw new Error(`Add ${SECRET_KEY}=<client secret> to supabase/.env first. The secret is on develop.battle.net.`);
  }

  const created = await doFetch(base, {
    method: 'POST',
    headers: headers(status),
    body: JSON.stringify(providerBody(secret))
  });
  if (!created.ok) throw new Error(`The auth API refused the provider with ${created.status}: ${await created.text()}`);
  return 'created';
}

if (process.argv[1] && process.argv[1].endsWith('battlenet-provider.js')) {
  ensureProvider()
    .then((result) =>
      console.log(result === 'exists' ? 'Battle.net sign-in is already set up.' : 'Battle.net sign-in added.')
    )
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
