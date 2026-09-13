// Sign in to the local site as a named persona (#1053, #1065).
//
//   npm run dev:login                        # lists the personas this stack holds
//   npm run dev:login -- phoenix-officer
//   npm run dev:login -- --discord-id 123456789012345678
//
// It prints a magic link. Opening it in the browser puts a session on
// localhost:3000 and every page on that origin sees it, because supabase-js
// defaults to the implicit flow with detectSessionInUrl on. Nothing under js/
// changes to support this, and nothing here runs anywhere but a local stack:
// the service role key is read from `supabase status` at run time, so it is
// never written down, and the addresses are @wga.local, which is not a real
// inbox.
//
// The personas are whoever the running stack holds at @wga.local: the seed's
// people after a reset, and the ones snapshot-personas.js mints after
// `npm run db:snapshot`. Both name them the same way, <team>-officer,
// <team>-leader, <team>-raider, plus admin, guild-officer and boe-manager, so
// a name means the same person on either stack. The list is read before any
// link is minted, because generate_link creates an account for an address it
// has never seen, and on a snapshot that is a successful sign-in with no grant
// row at all, which reads as broken policies.
//
// The Discord id form is the route for one specific real person on a restored
// snapshot: the grant rows are real and their auth links are nulled, so a
// fresh account whose provider_id matches one of them gets linked by
// link_auth_user_to_member() on insert. It reads that person's data.
//
// That account is minted here in SQL rather than through the auth API, because
// since #1118 the trigger links only an account stamped as a Discord signup in
// raw_app_meta_data, and no admin API call can stamp that before the insert it
// fires on. See mintSql. It needs psql, which the persona route does not.
//
// Node built-ins only, like everything in scripts/.
import { execFileSync } from 'node:child_process';

const DOMAIN = '@wga.local';

// A persona name is an address local part, and the batch that mints them
// refuses anything else, so the same rule applies here.
const PERSONA_NAME = /^[a-z0-9-]+$/;

// Discord snowflakes are 17 to 20 digits. Checked rather than trusted, because
// a typo mints an account that links to nothing and the symptom is a successful
// sign-in with no access at all.
const DISCORD_ID = /^\d{17,20}$/;

/** The address to issue a link for, from either way of naming a target. */
export function resolveTarget({ persona, discordId } = {}) {
  if (discordId) {
    if (!DISCORD_ID.test(discordId)) {
      throw new Error(`Not a Discord id: ${discordId}. Expected 17 to 20 digits.`);
    }
    return { email: `${discordId}${DOMAIN}`, discordId };
  }
  if (!persona) {
    throw new Error('Name a persona or pass --discord-id <id>.');
  }
  if (!PERSONA_NAME.test(persona)) {
    throw new Error(`Not a persona name: "${persona}". Expected lowercase letters, digits and hyphens.`);
  }
  return { email: `${persona}${DOMAIN}` };
}

/** Reads the local API URL and service key from the running stack. */
export function readStatus() {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(raw);
}

function adminHeaders(status) {
  return {
    apikey: status.SERVICE_ROLE_KEY,
    Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`
  };
}

/** The admin user list call, as a URL and fetch options. */
export function listRequest(status) {
  return {
    url: `${status.API_URL}/auth/v1/admin/users?page=1&per_page=1000`,
    options: { method: 'GET', headers: adminHeaders(status) }
  };
}

/** The persona names in a user list: the wga.local accounts, bare, sorted. */
export function personaNames(payload) {
  return ((payload && payload.users) || [])
    .map((user) => user && user.email)
    .filter((email) => typeof email === 'string' && email.endsWith(DOMAIN))
    .map((email) => email.slice(0, -DOMAIN.length))
    .sort();
}

/**
 * The SQL that mints one Discord-provider account.
 *
 * The auth admin API cannot produce one: adminUserCreate stamps
 * provider "email" on the model, inserts, and applies any app_metadata the
 * caller passed afterwards as an update, while on_auth_user_created fires on
 * the insert. So the guard added in #1118 would see "email" every time. Only a
 * real OAuth signup stamps discord before the insert, and the local stack has
 * no Discord provider configured. Minting the rows directly is what seed.sql
 * and snapshot-personas.js already do, on this same column list, and the
 * guarded trigger links the grant rows off the users insert.
 *
 * Interpolated rather than bound because psql -c takes no parameters. Safe
 * here: resolveTarget has already held discordId to 17 to 20 digits, and the
 * address is built from it.
 */
export function mintSql(discordId, email) {
  return `
with created as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values (
    '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
    'authenticated', 'authenticated', '${email}', '', now(),
    '', '', '', '',
    '{"provider":"discord","providers":["discord"]}'::jsonb,
    jsonb_build_object('provider_id', '${discordId}'),
    now(), now()
  )
  returning id
)
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select '${discordId}', c.id,
       jsonb_build_object('sub', c.id::text, 'email', '${email}', 'provider_id', '${discordId}'),
       'discord', now(), now(), now()
  from created c;
`.trim();
}

/** The mint, as a command and its arguments. Runs nothing. */
export function mintRequest(status, { email, discordId }) {
  if (!status.DB_URL) {
    throw new Error('The stack reported no DB_URL, so the account cannot be minted. Is it running?');
  }
  return {
    command: 'psql',
    // -X so a personal .psqlrc cannot change how this behaves, and one
    // transaction so a failed identity insert takes the user row with it.
    // Same shape as db-snapshot.js.
    args: ['-X', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-d', status.DB_URL, '-c', mintSql(discordId, email)]
  };
}

function runMint({ command, args }) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        'psql is not on PATH, and --discord-id needs it to mint the account. Section 1d of docs/supabase-local-dev-setup.md installs it.'
      );
    }
    throw new Error(`Could not mint the account: ${String(err.stderr || err.message).trim()}`);
  }
}

/** The admin generate_link call, as a URL and fetch options. */
export function linkRequest(status, { email }) {
  const body = { type: 'magiclink', email };
  return {
    url: `${status.API_URL}/auth/v1/admin/generate_link`,
    options: {
      method: 'POST',
      headers: { ...adminHeaders(status), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }
  };
}

/** The link out of the response, whichever shape this CLI version returns. */
export function readLink(payload) {
  const link = payload && (payload.action_link || (payload.properties && payload.properties.action_link));
  if (!link) {
    throw new Error(`The auth API returned no action link: ${JSON.stringify(payload)}`);
  }
  return link;
}

async function callAuth(doFetch, { url, options }) {
  const response = await doFetch(url, options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`The auth API refused with ${response.status}: ${detail}`);
  }
  return response.json();
}

/**
 * Mints the link. `deps` exists so the tests can drive this without a stack;
 * production passes neither.
 */
export async function login(target = {}, deps = {}) {
  const status = deps.status || readStatus;
  const doFetch = deps.fetch || fetch;
  const mint = deps.mint || runMint;

  let stack;
  try {
    stack = status();
  } catch {
    throw new Error('Could not read the local stack. Is it running? Start it with `supabase start`.');
  }
  if (!stack || !stack.API_URL || !stack.SERVICE_ROLE_KEY) {
    throw new Error('Could not read the local stack. Is it running? Start it with `supabase start`.');
  }

  // Read on both routes now. A persona name is checked against it, and the
  // Discord route mints only when the stack does not already hold the account.
  const names = personaNames(await callAuth(doFetch, listRequest(stack)));

  if (!target.discordId) {
    const held = names.length ? names.join(', ') : 'nothing yet (run `supabase db reset` or `npm run db:snapshot`)';
    if (!target.persona) {
      throw new Error(`Name a persona. On this stack: ${held}. Or pass --discord-id <id>.`);
    }
    resolveTarget(target);
    if (!names.includes(target.persona)) {
      throw new Error(`No account called "${target.persona}" on this stack. It has: ${held}. Nothing was created.`);
    }
  }

  const resolved = resolveTarget(target);
  if (resolved.discordId && !names.includes(resolved.discordId)) {
    mint(mintRequest(stack, resolved));
  }

  return readLink(await callAuth(doFetch, linkRequest(stack, resolved)));
}

function parseArgs(argv) {
  const flagAt = argv.indexOf('--discord-id');
  if (flagAt !== -1) return { discordId: argv[flagAt + 1] };
  return { persona: argv.find((arg) => !arg.startsWith('--')) };
}

function main() {
  return login(parseArgs(process.argv.slice(2))).then((link) => {
    console.log('');
    console.log('Open this to sign in:');
    console.log('');
    console.log(`  ${link}`);
    console.log('');
    console.log('It lands on localhost:3000 and every page on that origin sees the session.');
  });
}

// Only when run, not when imported by the tests. The exit code is set rather
// than forced: process.exit() straight after a fetch trips a libuv assertion
// on Windows (Node 24, "!(handle->flags & UV_HANDLE_CLOSING)"), printing a
// crash under a message that was itself the whole point.
if (process.argv[1] && process.argv[1].endsWith('local-login.js')) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
