import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { setTeamSetting } from '../settings/useSettings';
import {
  asStaleDays,
  parseQeLive,
  parseRaidbots,
  type ClassSpec,
  type Difficulty,
  type ParsedReport,
  type SavedResult,
  type SimLink,
  type SimSource,
  type TeamSim
} from './sims';

export type SavedSim = {
  id: number;
  difficulty: Difficulty;
  class_spec_id: number;
  spec: string;
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

// Each sim's spec name rides along with it (#1916).
type WithSpec<T> = T & { classes_specs: { spec: string } | null };
function flatSpec<T>({ classes_specs, ...sim }: WithSpec<T>) {
  return { ...sim, spec: classes_specs?.spec ?? '' };
}

export function usePlayerSims(playerId: number) {
  return useSupabaseQuery<PlayerSims>(simsKey(playerId), async (client) => {
    const sims = await client
      .from('character_sims')
      .select(
        'id, difficulty, class_spec_id, classes_specs(spec), source, report_id, simmed_at, fight_style, target_count, character_sim_results(id, wow_item_id, item_name, slot, item_level, pct_gain, dps_gain, encounter_id, catalyst_from)'
      )
      .eq('player_id', playerId);
    if (sims.error) return { data: null, error: sims.error };
    const rows = ((sims.data ?? []) as unknown as WithSpec<Omit<SavedSim, 'spec'>>[]).map(flatSpec) as SavedSim[];
    const ids = [...new Set(rows.flatMap((s) => s.character_sim_results.map((r) => r.wow_item_id)))];
    if (!ids.length) return { data: { sims: rows, items: [] }, error: null };
    // team-read-guard: one character's sims, a few hundred items at most
    const items = await client.from('items').select('id, wow_item_id, name, icon, is_ptr').in('wow_item_id', ids);
    if (items.error) return { data: null, error: items.error };
    return { data: { sims: rows, items: (items.data ?? []) as KnownItem[] }, error: null };
  });
}

// Whether the character is the team leader's: an officer can't add or remove
// the leader's sims (save_character_sim(), CodeRabbit on PR #1914), so the
// page doesn't offer it.
export function useIsLeaderCharacter(playerId: number) {
  return useSupabaseQuery<boolean>(['sims-leader', playerId], async (client) => {
    const result = await client
      .from('players')
      .select('team_members(role, archived_at)')
      .eq('id', playerId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const member = (result.data as { team_members: { role: string; archived_at: string | null } | null } | null)
      ?.team_members;
    return { data: member?.role === 'team_leader' && !member.archived_at, error: null };
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

// Every spec, to match a report's spec to (#1916).
export function useClassSpecs() {
  return useSupabaseQuery<ClassSpec[]>(['class-specs'], (client) =>
    client.from('classes_specs').select('id, class, spec')
  );
}

// Saves each difficulty in the report as its own sim for its spec, replacing
// the one there.
export function useSaveSims(playerId: number) {
  return useSupabaseMutation<number, { report: ParsedReport; classSpecId: number }>(
    async (client, { report, classSpecId }) => {
      let saved = 0;
      for (const sim of report.sims) {
        const result = await client.rpc('save_character_sim', {
          p_player_id: playerId,
          p_difficulty: sim.difficulty,
          p_class_spec_id: classSpecId,
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
  return useSupabaseMutation<null, { difficulty: Difficulty; classSpecId: number }>(
    async (client, { difficulty, classSpecId }) => {
      const result = await client.rpc('delete_character_sim', {
        p_player_id: playerId,
        p_difficulty: difficulty,
        p_class_spec_id: classSpecId
      });
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

// Every raider's sims on the team, with their results, for the Priority page
// (#1443 part 2). Both reads are paged: a team's results pass 1000 rows.
export function useTeamSims(teamId: number) {
  return useSupabaseQuery<TeamSim[]>(['team-sims', teamId], async (client) => {
    const sims = await readAll<WithSpec<{ id: number; player_id: number; difficulty: string; simmed_at: string }>>(
      (from, to) =>
        client
          .from('character_sims')
          .select('id, player_id, difficulty, classes_specs(spec), simmed_at')
          .eq('team_id', teamId)
          .order('id')
          .range(from, to)
    );
    if (sims.error) return { data: null, error: sims.error };
    const ids = sims.data.map((s) => s.id);
    if (!ids.length) return { data: [], error: null };
    const results = await readAll<SavedResult & { sim_id: number }>((from, to) =>
      client
        .from('character_sim_results')
        .select('id, sim_id, wow_item_id, item_name, slot, item_level, pct_gain, dps_gain, encounter_id, catalyst_from')
        .in('sim_id', ids)
        .order('id')
        .range(from, to)
    );
    if (results.error) return { data: null, error: results.error };
    return {
      data: sims.data.map(flatSpec).map((s) => ({
        ...s,
        difficulty: s.difficulty as Difficulty,
        character_sim_results: results.data.filter((r) => r.sim_id === s.id)
      })),
      error: null
    };
  });
}
