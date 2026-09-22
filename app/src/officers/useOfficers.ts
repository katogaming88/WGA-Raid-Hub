import { useSupabaseQuery } from '../data/query';
import type { OfficerBio } from '../guild/guild';

// team_settings.config.teamOfficerBios, per team, written by the officer
// editor on the current site (js/tabs/tab-bios.js). Guild-wide officers come
// from useGuildOfficers (guild/useGuildHome.ts); this is the per-team list.
export function useTeamOfficers(teamId: number) {
  return useSupabaseQuery<OfficerBio[]>(['team-officers', teamId], async (client) => {
    const result = await client
      .from('team_settings')
      .select('bios:config->teamOfficerBios')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const bios = (result.data as { bios: unknown } | null)?.bios;
    return { data: Array.isArray(bios) ? (bios as OfficerBio[]) : [], error: null };
  });
}
