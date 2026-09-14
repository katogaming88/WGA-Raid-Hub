import { useSupabaseQuery } from '../data/query';
import type { GearRow, IncomingRow, PlayerRow } from './roster';

// The active roster, one row per character (80 on the largest team).
export function useRosterPlayers(teamId: number) {
  return useSupabaseQuery<PlayerRow[]>(['roster', teamId], (client) =>
    client
      .from('players')
      .select(
        'id, name_realm, url_code, nickname, is_trial, is_bench, is_rotator, tier_pieces_equipped, classes_specs(class, spec, role)'
      )
      .eq('team_id', teamId)
      .is('archived_at', null)
      .order('name_realm')
  );
}

// Equipped gear synced from Blizzard (#845). It has no team column, so the
// team comes through the player.
export function useRosterGear(teamId: number) {
  return useSupabaseQuery<GearRow[]>(['roster-gear', teamId], (client) =>
    client
      .from('player_equipped_gear')
      .select('player_id, equipment_slot, item_level, players!inner(team_id)')
      .eq('players.team_id', teamId)
  );
}

// Next season's tentative roster: signups approved for the team's signup
// season that are not on the roster yet, and the name of that season.
export function useIncomingRoster(teamId: number) {
  return useSupabaseQuery<IncomingRow[]>(['incoming-roster', teamId], (client) =>
    client.from('incoming_roster').select('signup_id, signup_name_realm, class, spec, role').eq('team_id', teamId)
  );
}

export function useSignupSeason(teamId: number) {
  return useSupabaseQuery<string>(['signup-season', teamId], async (client) => {
    const { data, error } = await client
      .from('team_settings')
      .select('signupSeason:config->>activeSignupSeason')
      .eq('team_id', teamId)
      .maybeSingle();
    if (error) return { data: null, error };
    const season = (data as { signupSeason?: unknown } | null)?.signupSeason;
    return { data: typeof season === 'string' ? season.trim() : '', error: null };
  });
}
