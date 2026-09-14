// discard-empty-account (#1101): removes the caller's own account when it is a
// Battle.net sign-in with nothing else on it.
//
// The new app signs in with Battle.net, with Discord linked to the same
// account. A raider who already uses Discord and presses Battle.net first gets
// a second, empty account, and Supabase cannot merge accounts: connecting their
// Discord to it is refused because that Discord belongs to their real account.
// The app offers "Sign in with Discord instead", which calls this to free the
// Battle.net login, signs in with Discord, and connects Battle.net there.
//
// Self-only: the account deleted is the one the caller's own token resolves to,
// never an id from the body. The gateway verifies the JWT (verify_jwt default).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { canDiscard, isStillReferenced } from './empty.ts';
import { VERSION } from './version.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'X-WGA-Version',
  'X-WGA-Version': VERSION
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ success: false, error: 'Not signed in' }, 401);

  const caller = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  });
  const {
    data: { user }
  } = await caller.auth.getUser();
  if (!user) return jsonResponse({ success: false, error: 'Not signed in' }, 401);

  // Identities read with the service role rather than trusted from the token's
  // copy, so a stale token cannot describe an account that has since gained a
  // Discord login.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: fresh, error: readError } = await admin.auth.admin.getUserById(user.id);
  if (readError || !fresh?.user) {
    return jsonResponse({ success: false, error: 'Could not read the account' }, 500);
  }

  const verdict = canDiscard(fresh.user);
  if (!verdict.ok) return jsonResponse({ success: false, error: verdict.reason }, 409);

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    if (isStillReferenced(deleteError.message)) {
      return jsonResponse({ success: false, error: 'This account has data attached, so it was kept' }, 409);
    }
    return jsonResponse({ success: false, error: 'Could not remove the account' }, 500);
  }

  return jsonResponse({ success: true });
});
