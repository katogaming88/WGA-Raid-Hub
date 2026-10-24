import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { IncomingSignupRow } from './signup';

export type OwnSignupRow = {
  id: number;
  signup_name_realm: string;
  class: string | null;
  spec: string | null;
  off_specs: string | null;
  main_swap: boolean;
  swap_class: string | null;
  swap_spec: string | null;
  swap_from_name_realm: string | null;
  player_note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'added';
  season: string;
  submitted_at: string;
  is_backup_tank: boolean;
  is_backup_healer: boolean;
};

// The raider's own signup for a tier, if any (get_own_signup): null tier
// means whichever one tier the team has open. Off for someone signed out,
// whom the function refuses.
export function useOwnSignup(teamId: number, seasonCodeArg: string | null, enabled = true) {
  return useSupabaseQuery<OwnSignupRow | null>(
    ['own-signup', teamId, seasonCodeArg],
    async (client) => {
      const { data, error } = await client.rpc('get_own_signup', {
        p_team_id: teamId,
        ...(seasonCodeArg ? { p_season: seasonCodeArg } : {})
      });
      if (error) return { data: null, error };
      return { data: (data?.[0] as OwnSignupRow | undefined) ?? null, error: null };
    },
    { enabled }
  );
}

// Tank/Heal capacity targets an officer set in Season Settings, for the role
// advisory on step 3. Neither set means no target -- the advisory still
// shows the count, just with no "target: N" comparison.
export function useRoleTargets(teamId: number) {
  return useSupabaseQuery<{ tank: number | null; heal: number | null }>(['role-targets', teamId], async (client) => {
    const { data, error } = await client
      .from('team_settings')
      .select('tank:config->targetTankCount, heal:config->targetHealCount')
      .eq('team_id', teamId)
      .maybeSingle();
    if (error) return { data: null, error };
    const row = data as { tank: number | null; heal: number | null } | null;
    return { data: { tank: row?.tank ?? null, heal: row?.heal ?? null }, error: null };
  });
}

// The incoming roster with swap_from_name_realm, which roster/useRoster.ts's
// useIncomingRoster does not select (the Roster page has no use for it).
// Same view, same cache-friendly shape otherwise.
export function useIncomingWithSwap(teamId: number) {
  return useSupabaseQuery<IncomingSignupRow[]>(['incoming-roster-swap', teamId], async (client) => {
    // team-read-guard: signups not on the roster yet, dozens at most
    const { data, error } = await client
      .from('incoming_roster')
      .select('signup_name_realm, class, spec, role, swap_from_name_realm')
      .eq('team_id', teamId);
    if (error) return { data: null, error };
    return {
      data: (data ?? []).map((r) => ({
        nameRealm: r.signup_name_realm ?? '',
        class: r.class,
        spec: r.spec,
        role: r.role,
        swapFromNameRealm: r.swap_from_name_realm
      })),
      error: null
    };
  });
}

export type Declaration = {
  characterId: number;
  classSpecId: number;
  offSpecs: string;
  note: string;
  backupTank: boolean;
  backupHealer: boolean;
};

// Signs up, or changes a signup, through declare_season_signup() (#1466): the
// database works out from the roster whether the pick is the same main, a new
// one or a first one, so nothing about a swap is sent.
export function useDeclareSignup(teamId: number, season: string) {
  return useSupabaseMutation<number, Declaration>(
    async (client, d) => {
      const { data, error } = await client.rpc('declare_season_signup', {
        p_team_id: teamId,
        p_season: season,
        p_character_id: d.characterId,
        p_class_spec_id: d.classSpecId,
        p_off_specs: d.offSpecs,
        p_note: d.note,
        p_backup_tank: d.backupTank,
        p_backup_healer: d.backupHealer
      });
      return { data: data as number, error };
    },
    {
      key: ['declare-signup', teamId],
      refreshes: [
        ['own-signup', teamId, season],
        ['incoming-roster-swap', teamId]
      ]
    }
  );
}
