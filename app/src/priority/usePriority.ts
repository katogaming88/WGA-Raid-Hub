import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { realmSlug } from '../profile/profile';
import type { PlayerRow } from '../roster/roster';
import {
  exportString,
  splitNameRealm,
  tierPiecesEquipped,
  type BossRow,
  type EmptyRow,
  type GearRun,
  type OrderRow,
  type PrefRow,
  type PriorityData,
  type TeamLootRow,
  type TierPieceRow,
  type Track
} from './priority';

// Everything the list reads for one season. Priority rows, wishlist marks and
// the season's loot each pass 1000 rows on a full team, so they page.
export function usePriorityData(teamId: number, season: string) {
  return useSupabaseQuery<PriorityData>(['priority-data', teamId, season], async (client) => {
    const [order, empty, prefs, loot, bosses, tierPieces] = await Promise.all([
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
          .select('player_id, item_id, status')
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
        .eq('season', season)
    ]);
    const error = order.error ?? empty.error ?? prefs.error ?? loot.error ?? bosses.error ?? tierPieces.error;
    if (error) return { data: null, error };
    return {
      data: {
        order: order.data!,
        empty: empty.data!,
        prefs: prefs.data!,
        loot: loot.data!,
        bosses: bosses.data!,
        tierPieces: (tierPieces.data ?? []) as unknown as TierPieceRow[]
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
