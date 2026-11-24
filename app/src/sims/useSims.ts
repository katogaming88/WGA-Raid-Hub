import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { setTeamSetting } from '../settings/useSettings';
import {
  asStaleDays,
  parseQeLive,
  parseRaidbots,
  type Difficulty,
  type ParsedReport,
  type SavedResult,
  type SimLink,
  type SimSource
} from './sims';

export type SavedSim = {
  id: number;
  difficulty: Difficulty;
  source: SimSource;
  report_id: string;
  simmed_at: string;
  fight_style: string | null;
  target_count: number | null;
  character_sim_results: SavedResult[];
};

// Items the hub knows, by Wowhead id: their names and icons for the table,
// and their ids for the wishlist marks.
export type KnownItem = { id: number; wow_item_id: number; name: string; icon: string | null; is_ptr: boolean };
export type PlayerSims = { sims: SavedSim[]; items: KnownItem[] };

const simsKey = (playerId: number) => ['sims', playerId];

export function usePlayerSims(playerId: number) {
  return useSupabaseQuery<PlayerSims>(simsKey(playerId), async (client) => {
    const sims = await client
      .from('character_sims')
      .select(
        'id, difficulty, source, report_id, simmed_at, fight_style, target_count, character_sim_results(id, wow_item_id, item_name, slot, item_level, pct_gain, dps_gain, encounter_id, catalyst_from)'
      )
      .eq('player_id', playerId);
    if (sims.error) return { data: null, error: sims.error };
    const rows = (sims.data ?? []) as unknown as SavedSim[];
    const ids = [...new Set(rows.flatMap((s) => s.character_sim_results.map((r) => r.wow_item_id)))];
    if (!ids.length) return { data: { sims: rows, items: [] }, error: null };
    // team-read-guard: one character's sims, a few hundred items at most
    const items = await client.from('items').select('id, wow_item_id, name, icon, is_ptr').in('wow_item_id', ids);
    if (items.error) return { data: null, error: items.error };
    return { data: { sims: rows, items: (items.data ?? []) as KnownItem[] }, error: null };
  });
}

// Reads the report from Raidbots or QE Live. Both sites let a browser read
// it; a failure here is theirs (or the network's), said in plain words.
export async function readReport(link: SimLink): Promise<ParsedReport | { error: string }> {
  let response: Response;
  try {
    response = await fetch(link.dataUrl);
  } catch {
    return { error: 'Couldn’t reach the site. Check the link, then try again.' };
  }
  if (response.status === 404) return { error: 'That report doesn’t exist, or the site has deleted it.' };
  if (!response.ok) return { error: 'The site didn’t send the report. Try again in a minute.' };
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { error: 'The site sent back something unreadable. Try again in a minute.' };
  }
  return link.source === 'raidbots' ? parseRaidbots(data, link.reportId) : parseQeLive(data, link.reportId);
}

// Saves each difficulty in the report as its own sim, replacing the one there.
export function useSaveSims(playerId: number) {
  return useSupabaseMutation<number, ParsedReport>(
    async (client, report) => {
      let saved = 0;
      for (const sim of report.sims) {
        const result = await client.rpc('save_character_sim', {
          p_player_id: playerId,
          p_difficulty: sim.difficulty,
          p_source: report.source,
          p_report_id: report.reportId,
          p_simmed_at: report.simmedAt,
          p_fight_style: report.fightStyle ?? '',
          p_target_count: report.targetCount as number,
          p_results: sim.results
        });
        if (result.error) return { data: null, error: result.error };
        saved += 1;
      }
      return { data: saved, error: null };
    },
    { key: ['save-sims', playerId], refreshes: [simsKey(playerId)] }
  );
}

export function useRemoveSim(playerId: number) {
  return useSupabaseMutation<null, Difficulty>(
    async (client, difficulty) => {
      const result = await client.rpc('delete_character_sim', { p_player_id: playerId, p_difficulty: difficulty });
      return { data: null, error: result.error };
    },
    { key: ['remove-sim', playerId], refreshes: [simsKey(playerId)] }
  );
}

// Settings > Loot: how many days a sim stays up to date (#1443).
const staleKey = (teamId: number) => ['sim-stale-days', teamId];

export function useSimStaleDays(teamId: number) {
  return useSupabaseQuery<number>(staleKey(teamId), async (client) => {
    const result = await client
      .from('team_settings')
      .select('days:config->>simStaleDays')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    return { data: asStaleDays((result.data as { days?: unknown } | null)?.days), error: null };
  });
}

export function useSaveSimStaleDays(teamId: number) {
  return useSupabaseMutation<null, number>(
    async (client, days) => {
      const result = await setTeamSetting(client, teamId, { simStaleDays: days });
      return { data: null, error: result.error };
    },
    { key: ['save-sim-stale-days', teamId], refreshes: [staleKey(teamId)] }
  );
}
