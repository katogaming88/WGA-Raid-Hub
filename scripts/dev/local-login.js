// Sign in to the local site as one of the seeded people (#1053).
//
//   npm run dev:login -- officer
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
// The Discord id form is what composes with a restored production snapshot: the
// grant rows are real and their auth links are nulled, so a fresh account whose
// provider_id matches one of them gets linked by link_auth_user_to_member() on
// insert. It is also the escape hatch for any identity the seed does not name.
//
// Node built-ins only, like everything in scripts/.
import { execFileSync } from 'node:child_process';

// The six seeded people with a grant row, and the addresses seed.sql gives
// them. tests/rls/seed-personas.test.js pins these against the seed, because
// three places name the same people and only one of them is exercised by the
// suite.
//
// The seventh seeded identity (...0006) is deliberately absent: it stands for
// somebody with a signup and no roster row, so it has no grant row to link to
// and no role to look at. Reach it with --discord-id if it is ever wanted.
export const PERSONAS = {
  officer: 'officer@wga.local',
  leader: 'leader@wga.local',
  raider: 'raider@wga.local',
  admin: 'admin@wga.local',
  officer2: 'officer2@wga.local',
  'guild-officer': 'guild-officer@wga.local'
};

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
    return { email: `${discordId}@wga.local`, discordId };
  }
  if (!persona) {
    throw new Error(`Name a persona (${Object.keys(PERSONAS).join(', ')}) or pass --discord-id <id>.`);
  }
  const email = PERSONAS[persona];
  if (!email) {
    throw new Error(`No seeded persona called "${persona}". Try one of: ${Object.keys(PERSONAS).join(', ')}.`);
  }
  return { email };
}

/** Reads the local API URL and service key from the running stack. */
export function readStatus() {
  const raw = execFileSync('supabase', ['status', '-o', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(raw);
}

/** The admin generate_link call, as a URL and fetch options. */
export function linkRequest(status, { email, discordId }) {
  const body = { type: 'magiclink', email };
  // Carried as user metadata so the link trigger can bind the new account to
  // whatever grant rows already name that Discord id.
  if (discordId) body.data = { provider_id: discordId };
  return {
    url: `${status.API_URL}/auth/v1/admin/generate_link`,
    options: {
      method: 'POST',
      headers: {
        apikey: status.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
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

/**
 * Mints the link. `deps` exists so the tests can drive this without a stack;
 * production passes neither.
 */
export async function login(target, deps = {}) {
  const status = deps.status || readStatus;
  const doFetch = deps.fetch || fetch;

  let stack;
  try {
    stack = status();
  } catch {
    throw new Error('Could not read the local stack. Is it running? Start it with `supabase start`.');
  }
  if (!stack || !stack.API_URL || !stack.SERVICE_ROLE_KEY) {
    throw new Error('Could not read the local stack. Is it running? Start it with `supabase start`.');
  }

  const resolved = resolveTarget(target);
  const { url, options } = linkRequest(stack, resolved);
  const response = await doFetch(url, options);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`The auth API refused with ${response.status}: ${detail}`);
  }
  return readLink(await response.json());
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

// Only when run, not when imported by the tests.
if (process.argv[1] && process.argv[1].endsWith('local-login.js')) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
