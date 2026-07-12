// twitch-live-check (#286): keeps streamers.is_live/last_checked_at current
// by polling Twitch's Helix API for every linked channel's live status.
//
// Unlike wcl-sync, there is no logged-in officer to forward a JWT from --
// this runs on a GitHub Actions cron schedule (.github/workflows/
// twitch-live-check.yml), not a button click. It writes is_live for every
// team at once, which no per-team RLS policy grants to an unauthenticated
// caller (the "Raiders manage own streamer"/"Officers write streamers"
// policies are both scoped to a specific person's own row or their own
// team), so this uses the service-role key -- Supabase injects
// SUPABASE_SERVICE_ROLE_KEY into every Edge Function's environment
// automatically, nothing to configure for that part.
//
// What does need configuring (Project Settings > Edge Functions > Secrets,
// same as WCL_CLIENT_ID/WCL_CLIENT_SECRET and BOT_WEBHOOK_URL_<TEAM>/
// BOT_WEBHOOK_SECRET_<TEAM>):
//   TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET -- a Twitch Developer app
//     (https://dev.twitch.tv/console/apps), client-credentials grant only,
//     no user-facing OAuth flow needed since this only reads public stream
//     status.
//   TWITCH_LIVE_CHECK_SECRET -- an arbitrary shared secret this function
//     checks against the x-cron-secret header, matching bot-webhook's
//     x-webhook-secret pattern. Without this, the function URL would be
//     open to anyone on the internet triggering a service-role write. The
//     same value also has to be set as the TWITCH_LIVE_CHECK_SECRET repo
//     secret (Settings > Secrets and variables > Actions) for the GitHub
//     Actions workflow that calls this on a schedule.
//
// Also needs deploying with --no-verify-jwt: this is called by a bare curl
// from GitHub Actions, no Supabase session/JWT at all -- confirmed via
// `supabase functions list` that discord-bot-webhook (the other function
// with no logged-in caller) is deployed the same way, unlike wcl-sync
// (verify_jwt: true, since it always forwards a real officer's JWT).
//   supabase functions deploy twitch-live-check --no-verify-jwt
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
  });
}

// Twitch's client-credentials grant -- an app access token with no user
// context, valid for Helix's public stream-status endpoint. Fetched fresh
// every invocation rather than cached: this runs on a multi-minute cron
// interval at most, nowhere near Twitch's token-request rate limit, and
// caching would need somewhere to persist the token between invocations
// (Edge Functions don't share memory across cold starts) for no real benefit.
async function getTwitchAppToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials'
    })
  });
  if (!res.ok) throw new Error('Twitch token request failed: ' + res.status);
  const json = await res.json();
  return json.access_token;
}

// Helix caps user_login at 100 per request; chunks the channel list so a
// large roster doesn't silently drop channels past the 100th.
const HELIX_BATCH_SIZE = 100;

async function fetchLiveChannels(channels: string[], clientId: string, token: string): Promise<Set<string>> {
  const live = new Set<string>();
  for (let i = 0; i < channels.length; i += HELIX_BATCH_SIZE) {
    const batch = channels.slice(i, i + HELIX_BATCH_SIZE);
    const params = new URLSearchParams();
    for (const channel of batch) params.append('user_login', channel);
    const res = await fetch('https://api.twitch.tv/helix/streams?' + params.toString(), {
      headers: { 'Client-Id': clientId, Authorization: 'Bearer ' + token }
    });
    if (!res.ok) throw new Error('Twitch Helix request failed: ' + res.status);
    const json = await res.json();
    for (const stream of json.data || []) {
      // Twitch logins are case-insensitive; streamers.twitch_channel is
      // stored exactly as the raider typed it (js/streamers.js's
      // TWITCH_CHANNEL_RE allows mixed case), so compare lowercase both sides.
      live.add(String(stream.user_login).toLowerCase());
    }
  }
  return live;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const cronSecret = Deno.env.get('TWITCH_LIVE_CHECK_SECRET');
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }

    const clientId = Deno.env.get('TWITCH_CLIENT_ID');
    const clientSecret = Deno.env.get('TWITCH_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return jsonResponse({ success: false, error: 'Twitch credentials not configured' }, 500);
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: rows, error: readError } = await supabase.from('streamers').select('id, twitch_channel');
    if (readError) return jsonResponse({ success: false, error: readError.message }, 500);
    if (!rows || rows.length === 0) {
      return jsonResponse({ success: true, checked: 0, live: 0 });
    }

    const channels = rows.map((r) => String(r.twitch_channel));
    const token = await getTwitchAppToken(clientId, clientSecret);
    const liveChannels = await fetchLiveChannels(channels, clientId, token);

    const now = new Date().toISOString();
    const liveIds = rows.filter((r) => liveChannels.has(String(r.twitch_channel).toLowerCase())).map((r) => r.id);
    const offlineIds = rows.filter((r) => !liveChannels.has(String(r.twitch_channel).toLowerCase())).map((r) => r.id);

    // Two bulk updates (one per is_live value) rather than one per row --
    // a roster of even a few dozen streamers would otherwise mean that many
    // round trips every cron tick.
    if (liveIds.length) {
      const { error } = await supabase
        .from('streamers')
        .update({ is_live: true, last_checked_at: now })
        .in('id', liveIds);
      if (error) return jsonResponse({ success: false, error: error.message }, 500);
    }
    if (offlineIds.length) {
      const { error } = await supabase
        .from('streamers')
        .update({ is_live: false, last_checked_at: now })
        .in('id', offlineIds);
      if (error) return jsonResponse({ success: false, error: error.message }, 500);
    }

    return jsonResponse({ success: true, checked: rows.length, live: liveIds.length });
  } catch (err) {
    console.error('twitch-live-check error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});
