// The sold post's text, built from a boe_items row and nothing else (#1006
// split it out of index.ts so it can be tested without a server). The
// message kept the retired relay bot's shape until #926, which is what the
// channel had read for two seasons. It reads like this now:
//
//   ## BoE Sold
//   <@finder>
//
//   **Item:** Hero - __Voidglass Cloak__ 2/6
//   **Sale Price:** 52,800g
//   **Auction House Fee:** 2,640g
//   **Guild Bank:** 30,160g
//   **Finder's Cut:** 20,000g
//
//   Please get in touch with your raid leaders or <@manager> in the 15
//   minutes before raid starts to receive your gold.
//
// The heading names the event and the mention sits beneath it, so the ping is
// still the first thing a finder sees without the event reading as part of
// their name. The labels are bold and the item name underlined, which is what
// stops the five lines reading as the old bot's output with the brackets
// taken off (#926). The underline sits on the name alone, because that line
// already carries a track in front of it and an upgrade rank behind.
//
// Four decisions worth stating, all settled with Russell on 2026-09-03:
//
//   - Content, not an embed. A mention inside an embed field never notifies
//     (the comment in contact-webhook records this), and the ping is the
//     whole point of the message.
//   - The auction house fee gets its own line. Since #861 the guild cut is
//     net of it, so without the line the four numbers do not add up and the
//     finder is left assuming the guild took the difference.
//   - The closing line names the raid leaders as a role and the BoE manager
//     as a mention. An earlier build listed the finding team's officers by
//     id, which put five names in one sentence on Phoenix and would grow
//     with the roster; the role covers them in two words a finder already
//     knows. The manager is the opposite case: the grant is held by one or
//     two people and a finder has no way to know who this season, so it is
//     read at post time and rendered as a link they can click.
//   - A donated row (#862) ends with thanks instead. Telling someone to
//     collect gold they chose to give away is the one thing the old message
//     could not have got wrong, because the option did not exist.

export type SaleRow = {
  id: number;
  team_id: number;
  finder_name: string | null;
  item_name: string | null;
  track: string | null;
  upgrade_rank: string | null;
  status: string;
  sale_price: unknown;
  ah_fee: unknown;
  guild_cut: unknown;
  finder_payout: unknown;
  payout_donated: boolean | null;
};

export type SoldPost = {
  username: string;
  content: string;
  allowed_mentions: { parse: never[]; users: string[] };
};

// The window is prose because nothing in the data holds a raid schedule:
// teams, team settings and site settings carry none, and the WCL sync cron is
// a polling window rather than a calendar. Kat's raid_schedule (#640) is per
// team and this message goes to one channel for the whole guild, so it stays
// a constant here.
const PAYOUT_WINDOW = 'in the 15 minutes before raid starts';

// "A", "A or B", "A, B or C" -- the manager list reads as a sentence rather
// than a comma-joined dump, because it sits inside one.
export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] || '';
  return names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1];
}

// Whole gold with thousands separators, the way every money figure on the
// site and in the old bot's messages reads.
export function gold(n: unknown) {
  const v = Math.round(Number(n) || 0);
  return v.toLocaleString('en-US') + 'g';
}

// Every value below sits on a line that opens with its own bold label, so a
// newline inside one would end that line and start a second one nobody wrote
// deliberately. finder_name arrives from the public report card and is raider
// text; the item catalog and the track are ours. All of it collapses the same
// way, because the post cannot tell them apart once they are strings.
export function oneLine(s: unknown) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The Item line, in the found post's own format: the track, then the
// name, then the rank. Identical items can be open at once, so this is
// what tells a finder with two open finds which one sold. The track used
// to sit in an escaped angle bracket, which reproduced the retired relay
// bot's output byte for byte and stopped being a reason once the bot was
// retired (#918).
export function itemLine(row: Pick<SaleRow, 'track' | 'item_name' | 'upgrade_rank'>) {
  const trackText = oneLine(row.track);
  const rankText = oneLine(row.upgrade_rank);
  return (
    '**Item:** ' +
    (trackText ? trackText + ' - ' : '') +
    '__' +
    (oneLine(row.item_name) || 'Unknown item') +
    '__' +
    (rankText ? ' ' + rankText : '')
  );
}

// A resolved finder is a mention; an unresolved one renders in bold with no
// ping, the way the found post renders one.
export function finderText(finderId: string | null, finderName: unknown) {
  return finderId ? '<@' + finderId + '>' : '**' + (oneLine(finderName) || 'Unknown finder') + '**';
}

// Four money lines that add up. The fee is the game's cut off the top
// (#861) and the guild cut below it is already net of it, so leaving the
// fee out would read as the guild taking the difference.
export function moneyLines(row: Pick<SaleRow, 'sale_price' | 'ah_fee' | 'guild_cut' | 'finder_payout'>) {
  return [
    '**Sale Price:** ' + gold(row.sale_price),
    '**Auction House Fee:** ' + gold(row.ah_fee),
    '**Guild Bank:** ' + gold(row.guild_cut),
    "**Finder's Cut:** " + gold(row.finder_payout)
  ];
}

// The BoE manager is a mention of whoever currently holds the grant, so a
// finder can click through to them rather than go looking for who that is
// this season. Raid leaders stay prose: that is a role a finder already
// knows how to find, and naming the officers of every team would put five
// names in one sentence. A finder who ticked the donate box (#862) has
// nothing to collect, so the closing line thanks them instead of sending
// them to find someone. The money lines still stand: what their cut would
// have been is the size of what they gave.
export function closing(payoutDonated: boolean | null | undefined, managerIds: string[]) {
  const managerText = managerIds.length ? joinNames(managerIds.map((id) => '<@' + id + '>')) : 'a BoE manager';
  return payoutDonated
    ? 'Thanks for giving your cut to the guild bank.'
    : 'Please get in touch with your raid leaders or ' + managerText + ' ' + PAYOUT_WINDOW + ' to receive your gold.';
}

// The webhook body. Only the finder is notified, and only ever the finder.
// parse is empty, so @everyone, @here and every role are suppressed whatever
// ends up in the content, and the users allowlist is the sole thing that can
// ping: one finder, or nobody. The manager mention renders as a clickable
// name and notifies no one, because it is not on that list; with one manager
// today, listing them would mean a ping on every sale for a season.
//
// parse is written out rather than left off the resolved branch. An absent
// parse is treated as empty, but this posts to a guild-wide channel, so the
// guard against pinging everyone in it should be a line somebody can read
// instead of a default somebody has to know.
export function soldPost(row: SaleRow, finderId: string | null, managerIds: string[]): SoldPost {
  const content =
    '## BoE Sold\n' +
    finderText(finderId, row.finder_name) +
    '\n\n' +
    [itemLine(row), ...moneyLines(row)].join('\n') +
    '\n\n' +
    closing(row.payout_donated, managerIds);
  return {
    // One name across the found and sold posts (#918). Without it Discord
    // shows whatever the webhook is called in the channel's integration
    // settings, which a rename there would silently change.
    username: 'BoE Sales',
    content: content.length > 2000 ? content.slice(0, 1997) + '...' : content,
    allowed_mentions: { parse: [], users: finderId ? [finderId] : [] }
  };
}
