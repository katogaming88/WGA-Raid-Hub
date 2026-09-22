import { useSupabaseQuery } from '../data/query';
import type { SeasonHistoryEntry } from './history';

export function useSeasonHistory(teamId: number) {
  return useSupabaseQuery<SeasonHistoryEntry[]>(['season-history', teamId], async (client) => {
    const result = await client
      .from('team_settings')
      .select('history:config->seasonHistory')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const history = (result.data as { history: unknown } | null)?.history;
    return { data: Array.isArray(history) ? (history as SeasonHistoryEntry[]) : [], error: null };
  });
}
