import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { COUNTED_LOOT, realmSlug } from '../profile/profile';
import type { PlayerRow } from '../roster/roster';
import {
  exportString,
  splitNameRealm,
  tierPiecesEquipped,
  type BossRow,
  type EmptyRow,
  type GearRun,
  type OrderRow,
  type PerfRole,
  type PerfScore,
  type PrefRow,
  type PriorityData,
  type ReceivedRow,
  type ScoringRow,
  type Suggested,
  type TeamLootRow,
  type TierPieceRow,
  type Track
} from './priority';

// Everything the list reads for one season. Priority rows, wishlist marks and
// the season's loot each pass 1000 rows on a full team, so they page.
export function usePriorityData(teamId: number, season: string) {
  return useSupabaseQuery<PriorityData>(['priority-data', teamId, season], async (client) => {
    const [order, empty, prefs, loot, bosses, tierPieces, received] = await Promise.all([
      readAll<OrderRow>((from, to) =>
        client
          .from('priority_order')
          .select('item_id, track, rank, player_id, players(name_realm)')
          .eq('team_id', teamId)
          .eq('season', season)
          .order('id')
          .range(from, to)
      ),
      readAll<EmptyRow>((from, to) =>
        client
          .from('priority_order_confirmed_empty')
          .select('item_id, track')
          .eq('team_id', teamId)
          .eq('season', season)
          .order('item_id')
          .order('track')
          .range(from, to)
      ),
      readAll<PrefRow>((from, to) =>
        client
          .from('item_preferences')
          .select('id, player_id, item_id, status, note')
          .eq('team_id', teamId)
          .eq('season', season)
          .order('id')
          .range(from, to)
      ),
      readAll<TeamLootRow>((from, to) =>
        client
          .from('rclc_loot')
          .select('player_id, item_id, track, response')
          .eq('team_id', teamId)
          .or(COUNTED_LOOT)
          .eq('season', season)
          .order('id')
          .range(from, to)
      ),
      readAll<BossRow>((from, to) =>
        client.from('item_bosses').select('item_id, boss').order('item_id').order('boss').range(from, to)
      ),
      client
        .from('tier_token_map')
        .select('class, resolved_item_id, resolved:items!tier_token_map_resolved_item_id_fkey(wow_item_id, slot)')
        .eq('season', season),
      readAll<ReceivedRow>((from, to) =>
        client
          .from('self_received_requests')
          .select('player_id, self_item_id, track')
          .eq('team_id', teamId)
          .eq('status', 'approved')
          .order('id')
          .range(from, to)
      )
    ]);
    const error =
      order.error ?? empty.error ?? prefs.error ?? loot.error ?? bosses.error ?? tierPieces.error ?? received.error;
    if (error) return { data: null, error };
    return {
      data: {
        order: order.data!,
        empty: empty.data!,
        prefs: prefs.data!,
        loot: loot.data!,
        bosses: bosses.data!,
        tierPieces: (tierPieces.data ?? []) as unknown as TierPieceRow[],
        received: received.data!
      },
      error: null
    };
  });
}

// The RCLootCouncil string for one track, made on demand: the addon's import
// box takes one track at a time (#859).
export function useExportString(teamId: number) {
  return useSupabaseMutation<string, { season: string; track: Track }>(
    async (client, { season, track }) => {
      const { data, error } = await client.rpc('build_rclc_export', {
        p_team_id: teamId,
        p_season: season,
        p_track: track
      });
      if (error) return { data: null, error };
      return { data: exportString(data), error: null };
    },
    { key: ['rclc-export', teamId], refreshes: [] }
  );
}

export function useGearRuns() {
  return useSupabaseQuery<{ cron: GearRun | null; byHand: GearRun | null }>(['gear-runs'], async (client) => {
    const { data, error } = await client
      .from('site_settings')
      .select('gear_sync_last_cron_run, gear_sync_last_officer_run')
      .eq('id', 1)
      .maybeSingle();
    if (error) return { data: null, error };
    const row = (data ?? {}) as {
      gear_sync_last_cron_run?: GearRun | null;
      gear_sync_last_officer_run?: GearRun | null;
    };
    return {
      data: { cron: row.gear_sync_last_cron_run ?? null, byHand: row.gear_sync_last_officer_run ?? null },
      error: null
    };
  });
}

// Refresh equipped gear: the Blizzard Armory read the morning job runs, now,
// for the whole roster (blizzard-gear-sync takes an officer's sign-in).
export function useRefreshGear(teamId: number) {
  return useSupabaseMutation<{ synced: number; skipped: number }, void>(
    async (client) => {
      const { data, error } = await client.functions.invoke('blizzard-gear-sync', { body: { teamId } });
      if (error) return { data: null, error };
      const result = (data ?? {}) as { success?: boolean; error?: string; synced?: number; skipped?: number };
      if (result.success === false) return { data: null, error: { message: result.error || 'The gear read failed.' } };
      return { data: { synced: result.synced ?? 0, skipped: result.skipped ?? 0 }, error: null };
    },
    { key: ['refresh-gear', teamId], refreshes: [['gear-runs'], ['roster-gear', teamId]] }
  );
}

// Sync tier counts (#651): each raider's tier pieces from Raider.IO, one
// raider at a time with a short pause, as the current site does. A raider
// Raider.IO has nothing for keeps their last count rather than a false 0.
export function useSyncTierCounts(teamId: number) {
  return useSupabaseMutation<
    { synced: number; skipped: number },
    { players: PlayerRow[]; pieces: TierPieceRow[]; onProgress: (done: number, total: number) => void }
  >(
    async (client, { players, pieces, onProgress }) => {
      const raiders = players.filter((p) => p.classes_specs?.class);
      let synced = 0;
      let skipped = 0;
      for (const [i, player] of raiders.entries()) {
        onProgress(i + 1, raiders.length);
        const { name, realm } = splitNameRealm(player.name_realm);
        try {
          const response = await fetch(
            `https://raider.io/api/v1/characters/profile?region=us&realm=${encodeURIComponent(realmSlug(realm))}&name=${encodeURIComponent(name)}&fields=gear`
          );
          const body = response.ok
            ? ((await response.json()) as { gear?: { items?: Record<string, { item_id?: number }> } })
            : null;
          const gear = body?.gear?.items;
          if (!gear) {
            skipped++;
          } else {
            const { error } = await client
              .from('players')
              .update({
                tier_pieces_equipped: tierPiecesEquipped(player.classes_specs!.class, pieces, gear),
                tier_pieces_synced_at: new Date().toISOString()
              })
              .eq('id', player.id);
            if (error) return { data: null, error };
            synced++;
          }
        } catch {
          skipped++;
        }
        if (i < raiders.length - 1) await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return { data: { synced, skipped }, error: null };
    },
    { key: ['sync-tier-counts', teamId], refreshes: [['roster', teamId]] }
  );
}

// Suggest order: generate_priority_order() ranks the item for the track.
export function useSuggestOrder(teamId: number) {
  return useSupabaseMutation<Suggested[], { season: string; itemId: number; track: Track }>(
    (client, { season, itemId, track }) =>
      client.rpc('generate_priority_order', {
        p_team_id: teamId,
        p_season: season,
        p_item_id: itemId,
        p_track: track
      }) as unknown as PromiseLike<{ data: Suggested[] | null; error: { message: string } | null }>,
    { key: ['suggest-order', teamId], refreshes: [] }
  );
}

// Save: the item's whole order on the track replaces what was there; an empty
// one is saved as "nobody on purpose", which keeps it off Unmanaged.
export function useSaveOrder(teamId: number, season: string) {
  return useSupabaseMutation<unknown, { itemId: number; track: Track; order: number[] }>(
    (client, { itemId, track, order }) =>
      client.rpc('save_priority_order', {
        p_team_id: teamId,
        p_season: season,
        p_item_id: itemId,
        p_track: track,
        p_player_ids: order
      }),
    { key: ['save-order', teamId], refreshes: [['priority-data', teamId, season]] }
  );
}

// Clear a raider's note (#1362 part 4). An officer may only set the note to
// none (restrict_item_preferences_officer_update_to_note_clear()); the mark
// stays. Logged like the current site's Clear Note.
export function useClearNote(teamId: number, season: string) {
  return useSupabaseMutation<null, { ids: number[]; playerId: number; detail: string }>(
    async (client, { ids, playerId, detail }) => {
      const { error } = await client.from('item_preferences').update({ note: null }).in('id', ids);
      if (error) return { data: null, error };
      await auditLog(client, teamId, 'Wishlist Note Cleared', detail, { type: 'players', id: playerId });
      return { data: null, error: null };
    },
    { key: ['clear-note', teamId], refreshes: [['priority-data', teamId, season]] }
  );
}

// The scores saved for the season (#1362 part 5).
export function useScoring(teamId: number, season: string) {
  return useSupabaseQuery<ScoringRow[]>(['scoring', teamId, season], (client) =>
    readAll<ScoringRow>((from, to) =>
      client
        .from('scoring')
        .select('player_id, recent_score, trend_score, best_score, performance_score')
        .eq('team_id', teamId)
        .eq('season', season)
        .order('player_id')
        .range(from, to)
    )
  );
}

export type Metric = 'bracket' | 'overall';
export type Fetched = { scores: PerfScore[]; updated: number; recentReports: number; trendReports: number };

// Fetch from Warcraft Logs: wcl-sync reads the guild's last 20 reports and
// scores every raider. Nothing is saved until Commit.
export function useFetchPerformance(teamId: number) {
  return useSupabaseMutation<Fetched, Metric>(
    async (client, metric) => {
      const res = await client.functions.invoke('wcl-sync', {
        body: { action: 'refreshPerformance', teamId, scoringMetric: metric }
      });
      if (res.error) return { data: null, error: { message: res.error.message } };
      const result = (res.data ?? {}) as {
        success?: boolean;
        error?: string;
        updated?: number;
        recentReports?: number;
        trendReports?: number;
        scores?: {
          playerId: number;
          role: PerfRole;
          recent: number | null;
          trend: number | null;
          best: number | null;
          noData: boolean;
          usedTrend: boolean;
        }[];
      };
      if (!result.success) return { data: null, error: { message: result.error || 'The Warcraft Logs read failed.' } };
      return {
        data: {
          scores: (result.scores ?? []).map(({ playerId, role, recent, trend, best, noData, usedTrend }) => ({
            playerId,
            role,
            recent,
            trend,
            best,
            noData,
            usedTrend
          })),
          updated: result.updated ?? 0,
          recentReports: result.recentReports ?? 0,
          trendReports: result.trendReports ?? 0
        },
        error: null
      };
    },
    { key: ['fetch-performance', teamId], refreshes: [] }
  );
}

// Commit: Recent becomes performance_score, the score Suggest order uses, for
// every DPS raider with one. Attendance columns are left as they are.
export function useCommitPerformance(teamId: number, season: string) {
  return useSupabaseMutation<number, PerfScore[]>(
    async (client, scores) => {
      const rows = scores.map((s) => ({
        team_id: teamId,
        player_id: s.playerId,
        season,
        recent_score: s.recent,
        trend_score: s.trend,
        best_score: s.best,
        performance_score: s.recent
      }));
      if (rows.length === 0) return { data: 0, error: null };
      const { error } = await client.from('scoring').upsert(rows, { onConflict: 'player_id,season' });
      if (error) return { data: null, error };
      await auditLog(client, teamId, 'Performance Scores Committed', `${rows.length} players`);
      return { data: rows.length, error: null };
    },
    { key: ['commit-performance', teamId], refreshes: [['scoring', teamId, season]] }
  );
}

// Best effort, as everywhere: a failed log entry does not undo the write.
async function auditLog(
  client: Client,
  teamId: number,
  action: string,
  detail: string,
  target?: { type: string; id: number }
) {
  try {
    await client.rpc('write_audit_log', {
      p_team_id: teamId,
      p_action: action,
      ...(target ? { p_target_type: target.type, p_target_id: target.id } : {}),
      p_detail: detail
    });
  } catch {
    // The write is already saved.
  }
}
