// boe-webhook (#746): the BoE Found submit card posts here after
// submit_boe_found succeeds, replacing the Google Form -> Apps Script ->
// relay bot hop with a single direct post to a Discord native incoming
// webhook. Every team's report lands in the same channel, so there is no
// per-team routing, and the call site is fire-and-forget: the RPC insert is
// the write of record and this is a best-effort notification.
//
// It takes a row id and reads the row (#956). It used to post its request
// body, and the card is a public unauthenticated form, so whatever reached
// this endpoint is what the guild channel printed. boe_items.found_posted_at
// is the one-post-per-row claim: taken before the post, so a replay or a race
// announces a find once, and cleared again if Discord refuses it.
//
// Plain content since #926, in the sold post's skeleton so the two read as
// one pair rather than as two bots:
//
//   ## BoE Found
//   **Finder:** Aeliana-Illidan
//   **Team:** Phoenix
//   **Item:** Hero - __Voidglass Cloak__ 2/6
//   **Note:** dropped off the second boss
//   **Finder's cut:** Donating to the guild
//
// It was an embed until #926, and a mention inside an embed never notifies.
// In plain content it would, so allowed_mentions is load bearing rather than
// decorative. The note is still raider text once it is on the row, so both
// sanitisers below stay.
//
// Smoke mode (#1007): `smoke: true` plus the x-cron-secret header posts to the
// bot test channel, takes no claim, and marks the post. Without the header it
// refuses, and with no test channel configured it refuses rather than falling
// back to the live one, which is the whole point of the mode.
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

// Every value but the note goes on a line that opens with its own bold label,
// so a newline inside one would end that line and start a new one nobody
// wrote deliberately.
function oneLine(s: unknown) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Discord reads a heading as one to three '#' followed by a space at the start
// of a line, and a quote as '>', '>>' or '>>>' followed by one. The note is
// the one field that keeps its line breaks, so it is the one that could open a
// heading reading as this post's own. Stripped in a loop, because '# > text'
// is two markers on one line.
//
// '#1' is deliberately left alone: it is not a heading to Discord, and eating
// that '#' would take a word out of somebody's note. '-#' (subtext) is left
// for the same reason it is safe to leave: it renders small, which cannot
// forge structure.
function stripBlockMarkers(s: string) {
  return s
    .split('\n')
    .map((line) => {
      let out = line;
      let prev = '';
      while (out !== prev) {
        prev = out;
        out = out.replace(/^[ \t]*(?:#{1,3}|>{1,3})[ \t]/, '');
      }
      return out;
    })
    .join('\n');
}

const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  let claimTaken = false;
  let db: ReturnType<typeof createClient> | null = null;
  let numericId = 0;

  const releaseClaim = async () => {
    if (!claimTaken || !db) return;
    const { error } = await db.from('boe_items').update({ found_posted_at: null }).eq('id', numericId);
    if (error) console.error('boe-webhook could not release the claim on ' + numericId + ':', error.message);
  };

  try {
    const { id, smoke } = await req.json();
    numericId = Number(id);
    if (id === undefined || id === null || id === '' || !Number.isInteger(numericId) || numericId <= 0) {
      return jsonResponse({ success: false, error: 'Missing id' }, 400);
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

    // BOE_WEBHOOK_URL is the documented name (setup guide, .env.example) and
    // the one local `functions serve` can load from a dotenv file. The prod
    // secret was created in the dashboard as BOE-Found-Webhook (2026-08-26)
    // and the runtime delivers hyphenated names fine, so read it as the
    // fallback rather than asking for a re-paste. Either name works.
    const webhookUrl = isSmoke
      ? Deno.env.get('DISCORD_TEST_WEBHOOK_URL')
      : Deno.env.get('BOE_WEBHOOK_URL') || Deno.env.get('BOE-Found-Webhook');
    if (!webhookUrl) {
      if (isSmoke) {
        return jsonResponse({ success: false, error: 'No test webhook is configured' }, 500);
      }
      return jsonResponse({ success: true, skipped: true });
    }

    db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: row, error: rowError } = await db
      .from('boe_items')
      .select('id, team_id, finder_name, item_name, track, upgrade_rank, note, payout_donated')
      .eq('id', numericId)
      .maybeSingle();
    if (rowError) {
      console.error('boe-webhook row read failed:', rowError.message);
      return jsonResponse({ success: false, error: 'Could not read the find' }, 500);
    }
    if (!row) {
      return jsonResponse({ success: false, error: 'No such find' }, 404);
    }

    // A second read rather than a teams(name) embed: an embed's shape depends
    // on how PostgREST reads the relationship, and nothing in CI parses this
    // file to catch getting it wrong.
    const { data: team } = await db.from('teams').select('name').eq('id', row.team_id).maybeSingle();

    const rankText = row.upgrade_rank ? oneLine(row.upgrade_rank) : '';
    // Track is nullable on rows predating #865, so the chunk drops out.
    const trackText = row.track ? oneLine(row.track) : '';
    // The underline sits on the name alone, so the item is what stands out on
    // a line that already carries a track in front of it and a rank behind.
    const itemText =
      (trackText ? trackText + ' - ' : '') +
      '__' +
      truncate(oneLine(row.item_name), 200) +
      '__' +
      (rankText ? ' ' + rankText : '');

    const lines = [
      '## BoE Found',
      '**Finder:** ' + truncate(oneLine(row.finder_name) || 'Unknown', 200),
      '**Team:** ' + (oneLine(team?.name) || 'Unknown'),
      '**Item:** ' + itemText
    ];

    // Sanitised, then truncated, then sanitised again. The truncation decides
    // which characters survive, so the second pass is what covers a cut that
    // leaves a marker sitting at the front of whatever line it ends on.
    if (row.note && String(row.note).trim()) {
      const noteText = stripBlockMarkers(truncate(stripBlockMarkers(String(row.note).trim()), 1024)).trim();
      if (noteText) lines.push('**Note:** ' + noteText);
    }
    // The raider's donate intent (#862), on its own line so the channel sees
    // it without reading the note.
    if (row.payout_donated === true) {
      lines.push("**Finder's cut:** Donating to the guild");
    }
    if (isSmoke) {
      lines.unshift('[smoke]');
    }

    // The claim is the gate, so it sits between building the post and sending
    // it: two callers racing on one id both reach here and exactly one gets a
    // row back. A smoke claims nothing, so it can be run twice.
    if (!isSmoke) {
      const { data: claimed, error: claimError } = await db
        .from('boe_items')
        .update({ found_posted_at: new Date().toISOString() })
        .eq('id', numericId)
        .is('found_posted_at', null)
        .select('id');
      if (claimError) {
        console.error('boe-webhook claim failed:', claimError.message);
        return jsonResponse({ success: false, error: 'Could not claim the find' }, 500);
      }
      if (!claimed || claimed.length === 0) {
        return jsonResponse({ success: true, skipped: true, reason: 'already posted' });
      }
      claimTaken = true;
    }

    const content = lines.join('\n');

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // One name across the found and sold posts (#918). Without it Discord
        // shows whatever the webhook is called in the channel's integration
        // settings, which a rename there would silently change.
        username: 'BoE Sales',
        content: content.length > 2000 ? content.slice(0, 1997) + '...' : content,
        // Nothing on this post pings anyone: not a user, not a role, and not
        // @everyone or @here. The finder is a character name rather than a
        // Discord id here, and the note is raider text, so there is nothing
        // this post has any business notifying.
        allowed_mentions: { parse: [] }
      })
    });

    if (!response.ok) {
      console.error('Discord webhook error: ' + response.status + ' - ' + (await response.text()));
      await releaseClaim();
      return jsonResponse({ success: false, error: 'Discord responded with ' + response.status });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('boe-webhook error:', err);
    await releaseClaim();
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
