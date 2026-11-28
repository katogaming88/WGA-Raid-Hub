import { useSupabaseQuery } from '../data/query';
import type { PullRow } from './pulls';

// One boss's pulls from the team's main reports, each pull once (#1496). The
// function is the only public way to read them; team_raid_fights itself is
// closed to anyone off the team.
export function useBossPulls(teamId: number, encounterId: number) {
  return useSupabaseQuery<PullRow[]>(['boss-pulls', teamId, encounterId], async (client) => {
    const { data, error } = await client.rpc('team_raid_pulls', { p_team_id: teamId, p_encounter_id: encounterId });
    return error ? { data: null, error } : { data: data ?? [], error: null };
  });
}
