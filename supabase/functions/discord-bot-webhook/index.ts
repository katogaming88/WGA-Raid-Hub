// discord-bot-webhook (#224): ports gs/wgaWebApp.gs's sendToBot() out of Apps
// Script. Originally Phoenix and Hellfire each ran their own bot behind its
// own HTTPS URL/secret (BOT_WEBHOOK_URL_<TEAM>/BOT_WEBHOOK_SECRET_<TEAM>).
// #991 consolidated every team onto one bot process, so this relays to one
// shared BOT_WEBHOOK_URL/BOT_WEBHOOK_SECRET now regardless of which team's
// payload it's carrying -- there is exactly one trusted destination either
// way. `team` is still required and now gets forwarded IN the body (it
// never needed to be before -- the per-team URL used to encode which team a
// call was for; the one shared URL doesn't, so the bot needs it to resolve
// its own per-team config). A missing shared secret/URL pair is a real
// misconfiguration now (not a to-be-expected missing team), so it errors
// instead of the old silent no-op.
//
// No auth gate: all four notification paths (signup, self-received,
// BiS link, M+ exclusion) are submitted by unauthenticated public-roster
// forms today (their RPCs are granted to `anon`), so this function accepts
// the same unauthenticated calls the GAS actions did. It only relays a
// notification -- the writes it accompanies are already committed via their
// own RPC before this is ever called.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

const ACTION_PATHS: Record<string, string> = {
  signup: '/signup',
  selfreceived: '/selfreceived',
  bis: '/bis',
  mplus: '/mplus',
  rsvp: '/rsvp-status',
  optionalReminder: '/optional-reminder',
  signupSheetSync: '/signup-sheet-sync',
  verifyChannel: '/verify-channel'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { action, team, payload } = await req.json();

    const path = ACTION_PATHS[action];
    if (!path) return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    if (!team) return jsonResponse({ success: false, error: 'Missing team' });

    const botUrl = Deno.env.get('BOT_WEBHOOK_URL');
    const botSecret = Deno.env.get('BOT_WEBHOOK_SECRET');
    if (!botUrl || !botSecret) {
      console.error('discord-bot-webhook misconfigured: BOT_WEBHOOK_URL/BOT_WEBHOOK_SECRET not set');
      return jsonResponse({ success: false, error: 'Bot relay is not configured' });
    }

    const response = await fetch(botUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': botSecret },
      body: JSON.stringify({ ...(payload || {}), team, submittedAt: new Date().toISOString() })
    });

    if (!response.ok) {
      console.error('Bot error on ' + path + ': ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Bot responded with ' + response.status });
    }

    // Every caller before verifyChannel is fire-and-forget and never reads
    // this body, so forwarding it is backward compatible -- verifyChannel
    // needs the bot's actual {ok, name}/{ok, error} to reach the officer UI.
    const body = await response.json().catch(() => ({}));
    return jsonResponse({ success: true, ...body });
  } catch (err) {
    console.error('discord-bot-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
