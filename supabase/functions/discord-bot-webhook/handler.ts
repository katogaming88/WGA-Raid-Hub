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
// No auth gate for the signup, self-received, BiS link and M+ exclusion
// notices: they are submitted by unauthenticated public-roster forms today
// (their RPCs are granted to `anon`), and each points at something officers
// then review on the site. addCharacter (#1674) is the exception: it is the
// officers' only word of an add that has already happened, so it needs a
// signed-in caller and ignores the caller's text. The Member, character and
// spec come from the caller's own Audit Log row for the add on that team (the
// team only picks among the caller's own adds), and the
// row's id goes to the bot, which posts each row once.
//
// handle() takes its reads, its fetch and its environment as an argument
// (#1006), so tests/edge/ runs it against plain objects; deps.ts supplies the
// real ones and index.ts serves it.

// What add_own_character() wrote, read back with the service role.
export type OwnAdd = {
  auditId: number;
  team: string;
  member: string;
  nameRealm: string;
  classSpec: string;
  addedAt: string;
};

export interface RelayDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  // The caller's newest "added by the member" Audit Log row on this team
  // since `since`, or null when there is none.
  latestOwnAdd(userId: string, team: string, since: Date): Promise<OwnAdd | null>;
}

export type Env = { get(name: string): string | undefined };

export type Deps = { fetch: typeof fetch; env: Env; db: RelayDb; now?: () => Date };

// The page calls right after add_own_character() returns, so seconds is the
// usual gap; minutes leaves room for a slow phone.
export const OWN_ADD_WINDOW_MS = 5 * 60 * 1000;

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
  addCharacter: '/add-character',
  selfreceived: '/selfreceived',
  bis: '/bis',
  mplus: '/mplus',
  rsvp: '/rsvp-status',
  optionalReminder: '/optional-reminder',
  signupSheetSync: '/signup-sheet-sync',
  verifyChannel: '/verify-channel'
};

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { action, team, payload } = await req.json();

    const path = ACTION_PATHS[action];
    if (!path) return jsonResponse({ success: false, error: 'Unknown action: ' + action });
    if (!team) return jsonResponse({ success: false, error: 'Missing team' });

    let body: Record<string, unknown> = { ...(payload || {}), team, submittedAt: new Date().toISOString() };
    if (action === 'addCharacter') {
      const authHeader = req.headers.get('Authorization');
      const user = authHeader ? await deps.db.getUser(authHeader) : null;
      if (!user) return jsonResponse({ success: false, error: 'Not signed in' }, 401);

      const now = deps.now ? deps.now() : new Date();
      const add = await deps.db.latestOwnAdd(user.id, team, new Date(now.getTime() - OWN_ADD_WINDOW_MS));
      if (!add) return jsonResponse({ success: false, error: 'No character added' }, 404);
      body = {
        team: add.team,
        auditId: add.auditId,
        member: add.member,
        nameRealm: add.nameRealm,
        classSpec: add.classSpec,
        submittedAt: add.addedAt
      };
    }

    const botUrl = deps.env.get('BOT_WEBHOOK_URL');
    const botSecret = deps.env.get('BOT_WEBHOOK_SECRET');
    if (!botUrl || !botSecret) {
      console.error('discord-bot-webhook misconfigured: BOT_WEBHOOK_URL/BOT_WEBHOOK_SECRET not set');
      return jsonResponse({ success: false, error: 'Bot relay is not configured' });
    }

    const response = await deps.fetch(botUrl + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-webhook-secret': botSecret },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      console.error('Bot error on ' + path + ': ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Bot responded with ' + response.status });
    }

    // Every caller before verifyChannel is fire-and-forget and never reads
    // this body, so forwarding it is backward compatible -- verifyChannel
    // needs the bot's actual {ok, name}/{ok, error} to reach the officer UI.
    const reply = await response.json().catch(() => ({}));
    return jsonResponse({ success: true, ...reply });
  } catch (err) {
    console.error('discord-bot-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
