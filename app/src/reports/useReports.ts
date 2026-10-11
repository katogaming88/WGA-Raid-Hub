import { useSupabaseQuery } from '../data/query';

export type RaidNightsRow = {
  // A view's columns all read as nullable.
  player_id: number | null;
  last_award_at: string | null;
  raid_nights_since_last_item: number | null;
};

// The rnlsi view (#227): per active character, when its last item came and
// how many of the team's raid nights have passed since.
export function useRaidNightsSinceItem(teamId: number) {
  return useSupabaseQuery<RaidNightsRow[]>(['raid-nights-since-item', teamId], (client) =>
    // team-read-guard: a view, one row per active character (80 on the largest team)
    client.from('rnlsi').select('player_id, last_award_at, raid_nights_since_last_item').eq('team_id', teamId)
  );
}
