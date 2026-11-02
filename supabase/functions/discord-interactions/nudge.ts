// /nudge-missing's words (#998): who is chased for what, and the DM they get.
// Moved from bot/src/wishlistStatus.ts unchanged in what it decides, so a
// raider's DM reads as it did from the VM bot.

// One row per raider per season their own page lets them edit (#1268).
export interface WishlistSetupStatusRow {
  player_id: number;
  name_realm: string;
  discord_id: string;
  wishlist_count: number;
  bis_link: string | null;
  missing_bis_rows: string[];
  season: string;
  season_name: string;
}

export type NudgeCategory = 'no-wishlist' | 'no-bis-link' | 'incomplete-wishlist';

// One season a raider is chased for: the categories its wishlist raises and
// the BiS rows it is missing.
export interface NudgeSeason {
  season: string;
  seasonName: string;
  categories: NudgeCategory[];
  missingBisRows: string[];
}

export interface NudgeCandidate {
  playerId: number;
  nameRealm: string;
  firstName: string;
  discordId: string;
  categories: NudgeCategory[];
  seasons: NudgeSeason[];
  // The DM names each season only once the team's rows span more than one,
  // so a team on one season reads as it always has.
  nameSeasons: boolean;
}

// The order a raider's categories are listed in, and so the order of the
// lines in their DM.
const CATEGORY_ORDER: NudgeCategory[] = ['no-wishlist', 'no-bis-link', 'incomplete-wishlist'];

const NUDGE_MESSAGES: Record<NudgeCategory, (season: string | null) => string> = {
  'no-wishlist': (season) =>
    season ? `You haven't submitted a wishlist for ${season} yet.` : "You haven't submitted a wishlist yet.",
  'no-bis-link': () => "You haven't submitted a BiS source link yet.",
  'incomplete-wishlist': (season) =>
    `Your ${season ? `${season} ` : ''}wishlist is missing a real BiS pick for one or more slots.`
};

// The profile tab each category's fix lives on. A missing BiS link is fixed
// on the BiS tab, not the Wishlist one, easy to get backwards.
const CATEGORY_SUBTAB: Record<NudgeCategory, string> = {
  'no-wishlist': 'wishlist',
  'incomplete-wishlist': 'wishlist',
  'no-bis-link': 'bis'
};

// Only one link fits in the DM, so it follows the first category; every
// category is still listed in the text.
export function profileDeepLink(siteUrl: string, firstName: string, categories: NudgeCategory[]): string | null {
  if (categories.length === 0) return null;
  const subtab = CATEGORY_SUBTAB[categories[0]];
  return `${siteUrl.replace(/\/$/, '')}/#profile/${encodeURIComponent(firstName)}/${subtab}`;
}

// One candidate per character, whatever the number of seasons, so one run
// sends each raider one DM.
export function nudgeCandidatesFromRows(rows: WishlistSetupStatusRow[]): NudgeCandidate[] {
  const nameSeasons = new Set(rows.map((row) => row.season)).size > 1;
  const byPlayer = new Map<number, { candidate: NudgeCandidate; raised: Set<NudgeCategory> }>();
  for (const row of rows) {
    let entry = byPlayer.get(row.player_id);
    if (!entry) {
      entry = {
        candidate: {
          playerId: row.player_id,
          nameRealm: row.name_realm,
          // The profile link matches on the first name only.
          firstName: row.name_realm.split('-')[0].trim(),
          discordId: row.discord_id,
          categories: [],
          seasons: [],
          nameSeasons
        },
        // The BiS link is the raider's, not a season's, so it is raised once.
        raised: new Set<NudgeCategory>(row.bis_link ? [] : ['no-bis-link'])
      };
      byPlayer.set(row.player_id, entry);
    }
    const categories: NudgeCategory[] = [];
    if (row.wishlist_count === 0) categories.push('no-wishlist');
    // Incomplete only once a wishlist exists, or it repeats no-wishlist.
    if (row.wishlist_count > 0 && row.missing_bis_rows.length > 0) categories.push('incomplete-wishlist');
    categories.forEach((cat) => entry.raised.add(cat));
    entry.candidate.seasons.push({
      season: row.season,
      seasonName: row.season_name,
      categories,
      missingBisRows: row.missing_bis_rows
    });
  }
  return [...byPlayer.values()]
    .map(({ candidate, raised }) => ({ ...candidate, categories: CATEGORY_ORDER.filter((cat) => raised.has(cat)) }))
    .filter((c) => c.categories.length > 0);
}

// The DM's lines for the categories due, one per season that raises each.
export function nudgeLines(candidate: NudgeCandidate, due: NudgeCategory[]): string[] {
  const lines: string[] = [];
  for (const cat of due) {
    if (cat === 'no-bis-link') {
      lines.push(`- ${NUDGE_MESSAGES[cat](null)}`);
      continue;
    }
    for (const season of candidate.seasons) {
      if (!season.categories.includes(cat)) continue;
      const message = NUDGE_MESSAGES[cat](candidate.nameSeasons ? season.seasonName : null);
      lines.push(
        cat === 'incomplete-wishlist' ? `- ${message} Missing: **${season.missingBisRows.join(', ')}**` : `- ${message}`
      );
    }
  }
  return lines;
}

const RED = 0xe74c3c;

// The DM itself.
export function nudgeEmbed(teamName: string, candidate: NudgeCandidate, due: NudgeCategory[], siteUrl?: string) {
  const link = siteUrl ? profileDeepLink(siteUrl, candidate.firstName, due) : null;
  return {
    color: RED,
    title: `${teamName} -- Setup Reminder`,
    description: `Hey ${candidate.nameRealm}! A quick check found your loot setup is missing something:\n\n${nudgeLines(
      candidate,
      due
    ).join('\n')}`,
    footer: { text: 'This helps officers award loot correctly -- please take a moment to update it.' },
    ...(link ? { fields: [{ name: 'Update it here', value: link }] } : {})
  };
}

// A list of names cut to fit an embed field, with a count of the rest.
function truncateLines(lines: string[], limit = 1000): string {
  if (lines.length === 0) return 'None';
  let out = '';
  let i = 0;
  for (; i < lines.length; i++) {
    const next = out ? out + '\n' + lines[i] : lines[i];
    if (next.length > limit) break;
    out = next;
  }
  const remaining = lines.length - i;
  if (remaining > 0) out += `\n... and ${remaining} more`;
  return out;
}

// What the officer who ran the command sees when it finishes.
export function summaryEmbed(nudged: string[], skipped: string[], failed: string[]) {
  return {
    color: RED,
    title: 'Missing Setup Nudge',
    fields: [
      { name: `Nudged (${nudged.length})`, value: truncateLines(nudged) },
      { name: `Skipped -- nudged in last 24h (${skipped.length})`, value: truncateLines(skipped) },
      ...(failed.length
        ? [{ name: `Couldn't DM -- DMs closed? (${failed.length})`, value: truncateLines(failed) }]
        : [])
    ]
  };
}
