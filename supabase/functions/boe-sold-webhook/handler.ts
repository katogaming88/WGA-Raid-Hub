// boe-sold-webhook (#873): posts to Discord when a BoE sells, so the finder
// hears it from the channel rather than from a manager remembering to tell
// them. js/boe-manage.js's confirmBoeSale() invokes this after
// boe_record_sale lands, fire and forget -- the row update is the write of
// record, this is a best-effort notification, the same stance as the found
// post in js/boe.js.
//
// Both BoE functions take a row id and post what the database says about it
// (boe-webhook since #956). This one is gated on top of that: a sale is news
// an open endpoint would let anyone announce, so the gate is the same pair
// boe_record_sale itself requires, admitting exactly the people who could
// have caused this message legitimately. The found post stays open because
// its caller is the public report card, and its own replay guard is the
// found_posted_at claim rather than a credential.
//
// handle() takes its reads, its fetch and its environment as an argument
// (#1006), so tests/edge/ runs it against plain objects; deps.ts supplies the
// real ones and index.ts is the one line that serves it. The text of the
// post is format.ts.
import { type SaleRow, soldPost } from './format.ts';

export type { SaleRow };

// One method per read the function performs. Production implements it over
// supabase-js in deps.ts; a test hands in a plain object.
export interface SaleDb {
  getUser(authHeader: string): Promise<{ id: string } | null>;
  isBoeManager(authHeader: string): Promise<boolean>;
  isSiteAdmin(authHeader: string): Promise<boolean>;
  // Throws when the read itself fails; null when no row has the id.
  readSale(id: number): Promise<SaleRow | null>;
  resolveFinderDiscordId(authHeader: string, id: number): Promise<string | null>;
  managerDiscordIds(): Promise<string[]>;
}

export type Env = { get(name: string): string | undefined };

export type Deps = { fetch: typeof fetch; env: Env; db: SaleDb };

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

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { id } = await req.json();
    if (id === undefined || id === null || Number.isNaN(Number(id))) {
      return jsonResponse({ success: false, error: 'Missing id' }, 400);
    }

    // The caller's own JWT, so is_boe_manager()/is_site_admin() resolve
    // auth.uid() exactly as they would for a direct frontend call (the
    // upload-bio-photo and wcl-sync pattern).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }
    const user = await deps.db.getUser(authHeader);
    if (!user) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 401);
    }
    const [isManager, isSiteAdmin] = await Promise.all([
      deps.db.isBoeManager(authHeader),
      deps.db.isSiteAdmin(authHeader)
    ]);
    if (isManager !== true && isSiteAdmin !== true) {
      return jsonResponse({ success: false, error: 'Not authorized' }, 403);
    }

    // BOE_SOLD_WEBHOOK_URL first, so the sold post can be moved to its own
    // channel by adding one dashboard secret rather than by a code change.
    // With none set it lands in the found channel; with nothing set at all it
    // no-ops, the way the found function does.
    const webhookUrl =
      deps.env.get('BOE_SOLD_WEBHOOK_URL') || deps.env.get('BOE_WEBHOOK_URL') || deps.env.get('BOE-Found-Webhook');
    if (!webhookUrl) {
      return jsonResponse({ success: true, skipped: true });
    }

    let row: SaleRow | null;
    try {
      row = await deps.db.readSale(Number(id));
    } catch (err) {
      console.error('boe-sold-webhook row read failed:', err instanceof Error ? err.message : err);
      return jsonResponse({ success: false, error: 'Could not read the find' }, 500);
    }
    if (!row) {
      return jsonResponse({ success: false, error: 'No such find' }, 404);
    }
    // Only a sold row is news. A replay after Undo Sale, or an id that has
    // since been paid or retired, posts nothing rather than announcing a sale
    // that is no longer standing.
    if (row.status !== 'sold') {
      return jsonResponse({ success: true, skipped: true, reason: 'not sold' });
    }

    // The finder's Discord id, in one call (#918): the id stamped on the row
    // at submit when they were signed in (#889), else their claimed
    // character's member row, else a guild-wide name match, which is what
    // reaches somebody who reported a find while raiding with another team.
    // Null when nothing matches or when one name reaches two different
    // people, and the finder's name renders in bold with no ping instead.
    // On the caller's session rather than the service role, so the
    // function's own gate does real work.
    const finderId = await deps.db.resolveFinderDiscordId(authHeader, Number(id));

    // The manager list is read at post time, so it follows the grant without
    // anyone editing this file.
    const managerIds = await deps.db.managerDiscordIds();

    const response = await deps.fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(soldPost(row, finderId, managerIds))
    });

    if (!response.ok) {
      console.error('Discord webhook error: ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Discord responded with ' + response.status });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('boe-sold-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}
