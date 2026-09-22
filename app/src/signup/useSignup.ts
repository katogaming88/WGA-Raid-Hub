import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { IncomingSignupRow, SignupSubmission } from './signup';

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
};

// The raider's own signup for a tier, if any (get_own_signup): null tier
// means whichever one tier the team has open.
export function useOwnSignup(teamId: number, seasonCodeArg: string | null) {
  return useSupabaseQuery<OwnSignupRow | null>(['own-signup', teamId, seasonCodeArg], async (client) => {
    const { data, error } = await client.rpc('get_own_signup', {
      p_team_id: teamId,
      ...(seasonCodeArg ? { p_season: seasonCodeArg } : {})
    });
    if (error) return { data: null, error };
    return { data: (data?.[0] as OwnSignupRow | undefined) ?? null, error: null };
  });
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

async function submit(
  client: Client,
  args: { isEdit: boolean; teamId: number; season: string | null; signupId: number | null; fields: SignupSubmission }
) {
  const { isEdit, teamId, season, signupId, fields } = args;
  const { p_swap_from_name_realm, ...rest } = fields;
  const params = { ...rest, ...(p_swap_from_name_realm ? { p_swap_from_name_realm } : {}) };
  if (isEdit) {
    return client.rpc('update_own_signup', { p_signup_id: signupId as number, ...params });
  }
  return client.rpc('submit_season_signup', { p_team_id: teamId, ...(season ? { p_season: season } : {}), ...params });
}

// One mutation for both submit_season_signup and update_own_signup (#500):
// same field shape, only how the row is identified differs.
export function useSubmitSignup(teamId: number, seasonCodeArg: string | null) {
  return useSupabaseMutation<number, { isEdit: boolean; signupId: number | null; fields: SignupSubmission }>(
    (client, { isEdit, signupId, fields }) =>
      submit(client, { isEdit, teamId, season: seasonCodeArg, signupId, fields }),
    { key: ['submit-signup', teamId], refreshes: [['own-signup', teamId, seasonCodeArg]] }
  );
}
