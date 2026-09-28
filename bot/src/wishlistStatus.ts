import { createClient } from '@supabase/supabase-js';

// One row per raider per tier their own page lets them edit (WGA-Raid-Hub#1268).
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

// One tier a raider is chased for: the categories its wishlist raises and the
// BiS rows it is missing.
export interface NudgeTier {
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
  tiers: NudgeTier[];
  // The DM names each tier only once the team's rows span more than one, so a
  // team on one tier reads as it always has.
  nameTiers: boolean;
}

// The order a raider's categories are listed in, and so the order of the
// lines in their DM.
const CATEGORY_ORDER: NudgeCategory[] = ['no-wishlist', 'no-bis-link', 'incomplete-wishlist'];

const NUDGE_MESSAGES: Record<NudgeCategory, (tier: string | null) => string> = {
  'no-wishlist': (tier) =>
    tier ? `You haven't submitted a wishlist for ${tier} yet.` : "You haven't submitted a wishlist yet.",
  'no-bis-link': () => "You haven't submitted a BiS source link yet.",
  'incomplete-wishlist': (tier) =>
    `Your ${tier ? `${tier} ` : ''}wishlist is missing a real BiS pick for one or more slots.`
};

// Which profile sub-tab (WGA-Raid-Hub#698, js/roster.js's '#profile/<name>/<subtab>')
// each category's fix actually lives on. bis_link submission lives on the BiS
// tab, not Overview or Wishlist (js/common.js:6101-6105) -- easy to get backwards
// since the trigger is literally called "no-bis-link".
const CATEGORY_SUBTAB: Record<NudgeCategory, string> = {
  'no-wishlist': 'wishlist',
  'incomplete-wishlist': 'wishlist',
  'no-bis-link': 'bis'
};

// A raider can have multiple categories at once; only one link fits in the DM,
// so it points at the first (categories are pushed in a fixed order by
// nudgeCandidatesFromRows below) -- good enough since every issue is still listed
// in the DM text regardless of which tab the link itself lands on.
export function profileDeepLink(siteUrl: string, firstName: string, categories: NudgeCategory[]): string | null {
  if (categories.length === 0) return null;
  const subtab = CATEGORY_SUBTAB[categories[0]];
  return `${siteUrl.replace(/\/$/, '')}/#profile/${encodeURIComponent(firstName)}/${subtab}`;
}

// One candidate per character, whatever the number of tiers. The nudge log
// keys its cooldown by Discord id and category, so a second DM for the same
// character in one run would land in the Skipped list.
export function nudgeCandidatesFromRows(rows: WishlistSetupStatusRow[]): NudgeCandidate[] {
  const nameTiers = new Set(rows.map((row) => row.season)).size > 1;
  const byPlayer = new Map<number, { candidate: NudgeCandidate; raised: Set<NudgeCategory> }>();
  for (const row of rows) {
    let entry = byPlayer.get(row.player_id);
    if (!entry) {
      entry = {
        candidate: {
          playerId: row.player_id,
          nameRealm: row.name_realm,
          // The deep-link hash router (js/roster.js) matches on first name only,
          // same as the "View My Profile" auto-open flow -- not the full realm.
          firstName: row.name_realm.split('-')[0].trim(),
          discordId: row.discord_id,
          categories: [],
          tiers: [],
          nameTiers
        },
        // The BiS link is the raider's, not a tier's, so it is raised once.
        raised: new Set<NudgeCategory>(row.bis_link ? [] : ['no-bis-link'])
      };
      byPlayer.set(row.player_id, entry);
    }
    const categories: NudgeCategory[] = [];
    if (row.wishlist_count === 0) categories.push('no-wishlist');
    // Only flag incompleteness once a wishlist exists at all -- otherwise
    // every row is trivially "missing" and it just duplicates no-wishlist.
    if (row.wishlist_count > 0 && row.missing_bis_rows.length > 0) categories.push('incomplete-wishlist');
    categories.forEach((cat) => entry.raised.add(cat));
    entry.candidate.tiers.push({
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

// The DM's lines for the categories due, one per tier that raises each.
export function nudgeLines(candidate: NudgeCandidate, due: NudgeCategory[]): string[] {
  const lines: string[] = [];
  for (const cat of due) {
    if (cat === 'no-bis-link') {
      lines.push(`- ${NUDGE_MESSAGES[cat](null)}`);
      continue;
    }
    for (const tier of candidate.tiers) {
      if (!tier.categories.includes(cat)) continue;
      const message = NUDGE_MESSAGES[cat](candidate.nameTiers ? tier.seasonName : null);
      lines.push(
        cat === 'incomplete-wishlist' ? `- ${message} Missing: **${tier.missingBisRows.join(', ')}**` : `- ${message}`
      );
    }
  }
  return lines;
}

// team_id here is WGA Raid Hub's own Supabase teams.id (Phoenix=1, Hellfire=2,
// Immolation=3) -- unrelated to DISCORD_GUILD_ID, which identifies the Discord
// server. The caller resolves which team's id to pass in from the Discord
// guild/relay payload the request came from (see teamConfig.ts, #991) --
// this function itself stays team-agnostic, just given one to query.
export async function fetchNudgeCandidates(
  supabaseUrl: string,
  serviceRoleKey: string,
  teamId: number
): Promise<NudgeCandidate[]> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.rpc('wishlist_setup_status', { p_team_id: teamId });
  if (error) throw new Error(`wishlist_setup_status failed: ${error.message}`);
  return nudgeCandidatesFromRows((data ?? []) as WishlistSetupStatusRow[]);
}
