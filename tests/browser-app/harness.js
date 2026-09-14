import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../browser/static-server.js';

// Browser tests for the new app in app/ (#1101 part 4). The current site's
// suite in tests/browser/ reads fixtures shaped for js/; the app reads through
// supabase-js with a different set of calls, so it gets its own small harness
// with the same two rules: serve the built app over http, and answer every
// request from here, recording anything unexpected so a new network call
// fails a test instead of reaching the internet.

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', '..', 'app');
export const DIST = join(APP, 'dist');

export const DESKTOP = { width: 1280, height: 800 };
export const NARROW = { width: 480, height: 800 };

// The build inlines the hosted project from app/.env.production, so that is
// the host the page calls.
function supabaseHost() {
  const env = readFileSync(join(APP, '.env.production'), 'utf8');
  const url = /^VITE_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim();
  if (!url) throw new Error('app/.env.production has no VITE_SUPABASE_URL');
  return new URL(url);
}

export async function startApp() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('app/dist is missing. Build the app first: cd app && npm run build');
  }
  return startServer(DIST, { spaFallback: true });
}

export function launchBrowser() {
  return chromium.launch();
}

const TEAMS = [
  { id: 1, name: 'Phoenix', slug: 'phoenix', archived_at: null },
  { id: 2, name: 'Hellfire Rollers', slug: 'hellfire', archived_at: null }
];

// Who the signed-in states are. resolve_person()'s shape (#941).
export const PEOPLE = {
  officer: {
    discordId: 'discord-officer-1',
    person: {
      site_admin: false,
      guild_officer: false,
      boe_manager: false,
      teams: [
        {
          team_id: 1,
          team_member_id: 1,
          role: 'officer',
          characters: [{ player_id: 1, name_realm: 'Seedofficer-Illidan', url_code: 'abcd1234', archived_at: null }]
        }
      ]
    }
  },
  battlenetOnly: { discordId: null, person: null }
};

// A session as supabase-js stores it. The token only has to look like a JWT
// that has not expired, so the client reads it from storage without calling
// the auth server.
export function storedSession({ battlenet, discord }) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const identities = [];
  if (battlenet) {
    identities.push({ provider: 'custom:battlenet', identity_data: { custom_claims: { battletag: battlenet } } });
  }
  if (discord) {
    identities.push({
      provider: 'discord',
      identity_data: { full_name: discord, custom_claims: { global_name: discord } }
    });
  }
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'user-1', exp, role: 'authenticated' })}.sig`,
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    user: { id: 'user-1', aud: 'authenticated', role: 'authenticated', identities, app_metadata: {}, user_metadata: {} }
  };
}

function json(body, headers = {}) {
  return { status: 200, contentType: 'application/json; charset=utf-8', headers, body: JSON.stringify(body) };
}

/**
 * Opens the app at `path` in a fresh context.
 *
 * @param {import('playwright').Browser} browser
 * @param {number} port
 * @param {{ path: string, viewport?: {width:number,height:number}, session?: object, who?: keyof PEOPLE,
 *           reducedMotion?: 'reduce'|'no-preference', colorScheme?: 'light'|'dark', sentinel?: string }} state
 */
export async function openApp(browser, port, state) {
  const host = supabaseHost();
  const context = await browser.newContext({
    viewport: state.viewport ?? DESKTOP,
    reducedMotion: state.reducedMotion ?? 'no-preference',
    colorScheme: state.colorScheme ?? 'dark'
  });
  const page = await context.newPage();
  const unexpected = [];
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message ?? err)));

  if (state.session) {
    const key = `sb-${host.hostname.split('.')[0]}-auth-token`;
    await context.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [key, JSON.stringify(state.session)]);
  }
  const who = state.who ? PEOPLE[state.who] : null;

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === '127.0.0.1' && url.port === String(port)) return route.continue();

    if (url.host === host.host) {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const rest = url.pathname.split('/rest/v1/')[1];
      if (rest === 'rpc/resolve_address') {
        return route.fulfill(
          json([
            {
              guild_id: 1,
              guild_key: 'wga',
              team_id: 1,
              team_key: 'phoenix',
              player_id: null,
              player_code: null,
              is_canonical: true
            }
          ])
        );
      }
      if (rest === 'rpc/current_discord_id') return route.fulfill(json(who?.discordId ?? null));
      if (rest === 'rpc/resolve_person') return route.fulfill(json(who?.person ?? null));
      if (rest === 'guilds') return route.fulfill(json({ id: 1, name: 'We Go Again', url_key: 'wga' }));
      if (rest === 'teams') return route.fulfill(json(TEAMS));
      if (rest === 'players') return route.fulfill(json([], { 'content-range': '*/18' }));
      if (rest === 'account_preferences') return route.fulfill(json(null));
    }

    unexpected.push(`${request.method()} ${request.url()}`);
    return route.abort();
  });

  await page.goto(`http://127.0.0.1:${port}${state.path}`, { waitUntil: 'load' });
  await page.waitForSelector(state.sentinel ?? 'main h1', { timeout: 20000 });
  return { context, page, unexpected, pageErrors };
}
