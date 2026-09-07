// boe-webhook (#746): the BoE Found submit card posts here after
// submit_boe_found succeeds, replacing the Google Form -> Apps Script ->
// relay bot hop with a single direct post to a Discord native incoming
// webhook (BOE_WEBHOOK_URL). Like contact-webhook, every team's report lands
// in the same channel, so there is no per-team routing and no secondary bot
// hop; unlike contact-webhook the call site is fire-and-forget (the RPC
// insert is the write of record, this is a best-effort notification).
//
// No auth gate, same stance as contact-webhook: the card is a public
// unauthenticated form, and submit_boe_found is anon-callable by design.
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
// The track folds into the Item line the way the sold post already builds
// it, rather than keeping the separate field the embed had: three qualifiers
// on one item read better on one line than as two boxes.
//
// It was an embed until #926, and the embed is what made a pasted mention
// inert, because a mention inside one never notifies (the comment in
// contact-webhook records this). In plain content it would notify, so
// allowed_mentions is load bearing here rather than decorative. An empty
// parse is what stops a pasted @everyone, @here, role or user mention from
// notifying a guild-wide channel, and it is what lets this stay an open
// unauthenticated endpoint. The two sanitisers below cover the rest: nothing
// a submitter sends can forge a line of this post's own structure.
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

// Every value but the note goes on a line that opens with its own bold
// label, so a newline inside one would end that line and start a new one the
// submitter controls outright. In an embed a stray newline stayed inside its
// field box; in content it can write a whole second post. The note keeps its
// newlines, because it is a textarea and a raider writing two sentences is
// the point of it.
function oneLine(s: string) {
  return s.replace(/\s+/g, ' ').trim();
}

// Discord reads a heading as one to three '#' followed by a space at the
// start of a line, and a quote as '>', '>>' or '>>>' followed by one. The
// note is the one field that keeps its line breaks, so it is the one that
// could open a heading reading as this post's own. Stripped in a loop,
// because '# > text' is two markers on one line.
//
// '#1' is deliberately left alone: it is not a heading to Discord, and
// eating that '#' would take a word out of somebody's note. '-#' (subtext)
// is left for the same reason it is safe to leave: it renders small, which
// cannot forge structure.
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  try {
    const { team, finder, item, track, note, donate, upgradeRank } = await req.json();

    if (!finder || !String(finder).trim()) {
      return jsonResponse({ success: false, error: 'Missing finder' });
    }
    if (!item || !String(item).trim()) {
      return jsonResponse({ success: false, error: 'Missing item' });
    }

    // BOE_WEBHOOK_URL is the documented name (setup guide, .env.example) and
    // the one local `functions serve` can load from a dotenv file. The prod
    // secret was created in the dashboard as BOE-Found-Webhook (2026-08-26)
    // and the runtime delivers hyphenated names fine, so read it as the
    // fallback rather than asking for a re-paste. Either name works.
    const webhookUrl = Deno.env.get('BOE_WEBHOOK_URL') || Deno.env.get('BOE-Found-Webhook');
    if (!webhookUrl) {
      return jsonResponse({ success: true, skipped: true });
    }

    const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '...' : s);

    const finderText = truncate(oneLine(String(finder)), 200);
    const teamText = oneLine(String(team || 'Unknown')) || 'Unknown';
    // The rank follows the name on the Item line (#865): "Voidglass Cloak 2/6".
    // Optional here because a cached client may send none.
    const rankText = upgradeRank ? oneLine(String(upgradeRank)) : '';
    // Plain text since #918. It used to sit in an escaped angle bracket, so
    // that Discord would not read <Track> as a mention or channel token and
    // so that the line matched the retired bot's output byte for byte; the
    // bot is gone and the brackets read as noise. Track is optional on the
    // card, so the chunk drops out entirely when unset.
    const trackText = track ? oneLine(String(track)) : '';
    // The underline sits on the name alone, so the item is what stands out on
    // a line that already carries a track in front of it and a rank behind.
    const itemText =
      (trackText ? trackText + ' - ' : '') +
      '__' +
      truncate(oneLine(String(item)), 200) +
      '__' +
      (rankText ? ' ' + rankText : '');

    const lines = ['## BoE Found', '**Finder:** ' + finderText, '**Team:** ' + teamText, '**Item:** ' + itemText];

    // Sanitised, then truncated, then sanitised again. The truncation decides
    // which characters survive, so the second pass is what covers a cut that
    // leaves a marker sitting at the front of whatever line it ends on.
    if (note && String(note).trim()) {
      const noteText = stripBlockMarkers(truncate(stripBlockMarkers(String(note).trim()), 1024)).trim();
      if (noteText) lines.push('**Note:** ' + noteText);
    }
    // The raider's donate intent (#862), on its own line so the channel sees
    // it without reading the note. Strictly true: an old cached js/boe.js
    // sends no such key, which reads as not set.
    if (donate === true) {
      lines.push("**Finder's cut:** Donating to the guild");
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
        // Nothing on this post pings anyone: not a user, not a role, and
        // not @everyone or @here. The finder is a character name rather than
        // a Discord id here, and every other value is submitter text off an
        // open unauthenticated endpoint, so there is nothing this post has
        // any business notifying.
        allowed_mentions: { parse: [] }
      })
    });

    if (!response.ok) {
      console.error('Discord webhook error: ' + response.status + ' - ' + (await response.text()));
      return jsonResponse({ success: false, error: 'Discord responded with ' + response.status });
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error('boe-webhook error:', err);
    return jsonResponse({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
