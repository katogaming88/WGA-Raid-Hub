// contact-webhook (#577, fourth slice): the public About tab's Contact
// sub-tab posts site issue reports here. Unlike discord-bot-webhook (a
// per-team relay to each team's own self-hosted bot server), every team's
// report needs to land in the same single admin Discord channel -- so this
// posts directly to a Discord native incoming webhook using CONTACT_WEBHOOK_URL,
// with no per-team routing and no secondary bot hop.
//
// Still a public unauthenticated form, but the submitter's identity comes off
// the JWT rather than out of the request body (#957). An identity the caller
// sends is one the caller chooses, and anyone could put anyone's snowflake in
// it. Signed in, the Discord id on the token renders as a <@id> mention so a
// reply is a right-click away; signed out, the post says so. The typed name
// stays the body's: it is a name somebody typed, not a claim about who they are.
//
// Smoke mode (#1007): `smoke: true` plus the x-cron-secret header posts to the
// bot test channel, marks the post, and refuses rather than falling back to the
// live channel if no test webhook is configured.
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

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

// The caller's own JWT, read the way upload-bio-photo and boe-sold-webhook
// read it. Signed out the site sends its publishable key here instead, which
// is not a user token, so getUser answers nobody -- that is the anonymous
// path, not an error, because this form takes reports from anyone.
async function resolveSubmitter(authHeader: string | null) {
  if (!authHeader) return null;
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  });
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;
  const meta = (user.user_metadata || {}) as Record<string, unknown>;
  return {
    discordId: typeof meta.provider_id === 'string' ? meta.provider_id : null,
    username: typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { team, name, message, smoke } = await req.json();

    if (!message || !String(message).trim()) {
      return jsonResponse({ success: false, error: 'Missing message' });
    }

    const isSmoke = smoke === true;
    if (isSmoke) {
      // The operator credential the cron functions already use, rather than a
      // second secret: this is the same class of caller.
      const cronSecret = Deno.env.get('OPTIONAL_RSVP_REMINDERS_SECRET');
      if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
        return jsonResponse({ success: false, error: 'Smoke mode needs the cron secret' }, 401);
      }
    }

    const webhookUrl = isSmoke ? Deno.env.get('DISCORD_TEST_WEBHOOK_URL') : Deno.env.get('CONTACT_WEBHOOK_URL');
    if (!webhookUrl) {
      if (isSmoke) {
        return jsonResponse({ success: false, error: 'No test webhook is configured' }, 500);
      }
      return jsonResponse({ success: true, skipped: true });
    }

    const submitter = await resolveSubmitter(req.headers.get('Authorization'));

    // <@id> renders as a clickable mention in the embed field (right-click ->
    // Message) same as it would in plain message content -- no ping/
    // notification fires from this alone, it's just a clickable chip.
    const discordField = submitter?.discordId
      ? '<@' + submitter.discordId + '>'
      : submitter?.username
        ? truncate(submitter.username, 1024)
        : '(not logged in)';

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The marker rides above the embed, since an embed has no first line
        // of its own to put it on.
        content: isSmoke ? '[smoke]' : undefined,
        embeds: [
          {
            title: 'Site Contact Form Submission',
            color: 0xd6a344,
            fields: [
              { name: 'Team', value: String(team || 'Unknown'), inline: true },
              { name: 'Name', value: name ? truncate(String(name), 1024) : '(not provided)', inline: true },
              { name: 'Discord', value: discordField, inline: true },
              { name: 'Message', value: truncate(String(message), 1024) }
            ],
            timestamp: new Date().toISOString()
          }
        ],
        // Nothing here has any business notifying anyone. An embed never pings
        // on its own, so this covers the content line beside it.
        allowed_mentions: { parse: [] }
      })
    });

    if (!response.ok) {
      console.error('Discord webhook error: ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Discord responded with ' + response.status });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('contact-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
