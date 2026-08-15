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
  discordId: string;
  categories: NudgeCategory[];
  missingBisRows: string[];
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
        discordId: row.discord_id,
        categories,
        missingBisRows: row.missing_bis_rows,
      };
    })
    .filter(c => c.categories.length > 0);
}
