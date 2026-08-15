import { createClient } from '@supabase/supabase-js';

export interface WishlistSetupStatusRow {
  player_id: number;
  name_realm: string;
  discord_id: string;
  wishlist_count: number;
  bis_link: string | null;
  missing_bis_rows: string[];
}

export type NudgeCategory = 'no-wishlist' | 'no-bis-link' | 'incomplete-wishlist';

export interface NudgeCandidate {
  playerId: number;
  nameRealm: string;
  firstName: string;
  discordId: string;
  categories: NudgeCategory[];
  missingBisRows: string[];
}

// Which profile sub-tab (WGA-Raid-Hub#698, js/roster.js's '#profile/<name>/<subtab>')
// each category's fix actually lives on. bis_link submission lives on the BiS
// tab, not Overview or Wishlist (js/common.js:6101-6105) -- easy to get backwards
// since the trigger is literally called "no-bis-link".
const CATEGORY_SUBTAB: Record<NudgeCategory, string> = {
  'no-wishlist': 'wishlist',
  'incomplete-wishlist': 'wishlist',
  'no-bis-link': 'bis',
};

// A raider can have multiple categories at once; only one link fits in the DM,
// so it points at the first (categories are pushed in a fixed order by
// fetchNudgeCandidates below) -- good enough since every issue is still listed
// in the DM text regardless of which tab the link itself lands on.
export function profileDeepLink(siteUrl: string, firstName: string, categories: NudgeCategory[]): string | null {
  if (categories.length === 0) return null;
  const subtab = CATEGORY_SUBTAB[categories[0]];
  return `${siteUrl.replace(/\/$/, '')}/#profile/${encodeURIComponent(firstName)}/${subtab}`;
}

// team_id here is WGA Raid Hub's own Supabase teams.id (Phoenix=1, Hellfire=2,
// Immolation=3) -- unrelated to DISCORD_GUILD_ID, which identifies the Discord
// server. Each bot deployment is scoped to one team via TEAM_ID.
export async function fetchNudgeCandidates(
  supabaseUrl: string,
  serviceRoleKey: string,
  teamId: number
): Promise<NudgeCandidate[]> {
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase.rpc('wishlist_setup_status', { p_team_id: teamId });
  if (error) throw new Error(`wishlist_setup_status failed: ${error.message}`);

  const rows = (data ?? []) as WishlistSetupStatusRow[];
  return rows
    .map((row): NudgeCandidate => {
      const categories: NudgeCategory[] = [];
      if (row.wishlist_count === 0) categories.push('no-wishlist');
      if (!row.bis_link) categories.push('no-bis-link');
      // Only flag incompleteness once a wishlist exists at all -- otherwise
      // every row is trivially "missing" and it just duplicates no-wishlist.
      if (row.wishlist_count > 0 && row.missing_bis_rows.length > 0) {
        categories.push('incomplete-wishlist');
      }
      return {
        playerId: row.player_id,
        nameRealm: row.name_realm,
        // The deep-link hash router (js/roster.js) matches on first name only,
        // same as the "View My Profile" auto-open flow -- not the full realm.
        firstName: row.name_realm.split('-')[0].trim(),
        discordId: row.discord_id,
        categories,
        missingBisRows: row.missing_bis_rows,
      };
    })
    .filter(c => c.categories.length > 0);
}
