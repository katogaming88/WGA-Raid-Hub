import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { AttendanceRow, GearRow, LootRow, SeasonWindow } from './profile';
import { currentSeason } from './profile';
import type { CatalogItem, RankRow, SelfReceivedRow, TierTokenRow, ZoneRow } from './lootPriority';
import type { NewPick, Pick, TokenRow, WritePlan } from './wishlist';

export type ProfilePlayer = {
  id: number;
  name_realm: string;
  nickname: string | null;
  url_code: string | null;
  is_trial: boolean;
  is_bench: boolean;
  is_rotator: boolean;
  is_backup_tank: boolean;
  is_backup_healer: boolean;
  wishlist_allowed: boolean;
  m_plus_excluded: boolean;
  m_plus_note: string | null;
  join_date: string | null;
  tier_pieces_equipped: number | null;
  classes_specs: { class: string; spec: string; role: string | null } | null;
};

const PLAYER_COLUMNS =
  'id, name_realm, nickname, url_code, is_trial, is_bench, is_rotator, is_backup_tank, is_backup_healer, wishlist_allowed, m_plus_excluded, m_plus_note, join_date, tier_pieces_equipped, classes_specs(class, spec, role)';

// The profile's character, by id (My profile) or by its address code (an
// officer opening someone else's). Active characters only.
export function useProfilePlayer(teamId: number, by: { id: number } | { code: string }) {
  const key = 'id' in by ? ['profile-player', teamId, 'id', by.id] : ['profile-player', teamId, 'code', by.code];
  return useSupabaseQuery<ProfilePlayer | null>(key, (client) => {
    const query = client.from('players').select(PLAYER_COLUMNS).eq('team_id', teamId).is('archived_at', null);
    return ('id' in by ? query.eq('id', by.id) : query.eq('url_code', by.code.toLowerCase())).maybeSingle();
  });
}

// The current season, which scopes attendance and loot: the tier every team
// is on (the latest seasons row whose start has passed, #938), starting on
// this team's own first raid night in it (#1269), which team_season_start()
// derives from the attendance the sync has filed. A team that has not raided
// the tier yet gets the tier's own start, which is what the database answers
// there; the end is the tier's.
export function useCurrentSeason(teamId: number) {
  return useSupabaseQuery<SeasonWindow>(['current-season', teamId], async (client) => {
    const [tiers, firstNight] = await Promise.all([
      client.from('seasons').select('code, display_name, starts_at, ends_at').order('starts_at'),
      client.rpc('team_season_start', { p_team_id: teamId })
    ]);
    if (tiers.error) return { data: null, error: tiers.error };
    if (firstNight.error) return { data: null, error: firstNight.error };
    const tier = currentSeason(tiers.data ?? []);
    return {
      data: {
        name: tier?.display_name ?? '',
        code: tier?.code ?? null,
        start: firstNight.data || tier?.starts_at || null,
        end: tier?.ends_at ?? null
      },
      error: null
    };
  });
}

export function useAttendance(playerId: number) {
  return useSupabaseQuery<AttendanceRow[]>(['attendance', playerId], (client) =>
    client.from('attendance').select('raid_date, status, report_excluded').eq('player_id', playerId).order('raid_date')
  );
}

export function useLoot(playerId: number) {
  return useSupabaseQuery<LootRow[]>(['loot', playerId], (client) =>
    client.from('rclc_loot').select('id, track, season, awarded_at, items(name)').eq('player_id', playerId).order('id')
  );
}

// Equipped gear with each item's name. The sync stores Blizzard's item id,
// which the catalog carries as wow_item_id.
export function useEquippedGear(playerId: number) {
  return useSupabaseQuery<{ rows: GearRow[]; names: Map<number, string> }>(
    ['equipped-gear', playerId],
    async (client) => {
      const gear = await client
        .from('player_equipped_gear')
        .select('equipment_slot, item_id, item_level, track')
        .eq('player_id', playerId);
      if (gear.error) return { data: null, error: gear.error };
      const rows = (gear.data ?? []) as GearRow[];
      const ids = [...new Set(rows.map((r) => r.item_id).filter((id): id is number => id != null))];
      if (!ids.length) return { data: { rows, names: new Map() }, error: null };
      const items = await client.from('items').select('wow_item_id, name').in('wow_item_id', ids);
      if (items.error) return { data: null, error: items.error };
      const names = new Map(
        ((items.data ?? []) as { wow_item_id: number | null; name: string }[])
          .filter((i) => i.wow_item_id != null)
          .map((i) => [i.wow_item_id!, i.name])
      );
      return { data: { rows, names }, error: null };
    }
  );
}

// The latest refused M+ exclusion request, read by officers and by the raider
// it belongs to (20260914201423).
export function useMplusRefusal(teamId: number, playerId: number, enabled: boolean) {
  return useSupabaseQuery<{ officer_notes: string | null } | null>(
    ['mplus-refusal', teamId, playerId],
    (client) =>
      client
        .from('mplus_exclusion_requests')
        .select('officer_notes')
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .eq('status', 'rejected')
        .order('submitted_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    { enabled }
  );
}

// Loot priority reads (#868 part 2).

// A raider reads only their own wishlist and receipts; officers read the team's.
export function useWishlist(playerId: number) {
  return useSupabaseQuery<Pick[]>(['wishlist', playerId], (client) =>
    client.from('item_preferences').select('id, item_id, status, slot, season, synced_bis').eq('player_id', playerId)
  );
}

// The item catalog, a few hundred rows, shared by every profile.
export function useCatalog() {
  return useSupabaseQuery<CatalogItem[]>(['catalog'], (client) =>
    client
      .from('items')
      .select(
        'id, name, slot, wcl_zone_id, is_placeholder, armor_type, main_stats, weapon_subtype, source, item_seasons(season)'
      )
      .order('id')
      .then(({ data, error }) => ({
        data:
          data?.map(({ item_seasons, ...item }) => ({ ...item, seasons: (item_seasons ?? []).map((s) => s.season) })) ??
          null,
        error
      }))
  );
}

export function useRaidZones() {
  return useSupabaseQuery<ZoneRow[]>(['raid-zones'], (client) =>
    client.from('raid_zones').select('wcl_zone_id, season')
  );
}

// Every saved rank for the picked items this season, so a standing can say
// "#2 of 5". Only the items asked about, since the whole table grows by a
// season's worth of rows every season.
export function useItemRanks(teamId: number, seasonCode: string | null, itemIds: number[]) {
  const ids = [...new Set(itemIds)].sort((a, b) => a - b);
  return useSupabaseQuery<RankRow[]>(
    ['item-ranks', teamId, seasonCode, ids],
    (client) =>
      client
        .from('priority_order')
        .select('item_id, track, rank, player_id')
        .eq('team_id', teamId)
        .eq('season', seasonCode!)
        .in('item_id', ids),
    { enabled: seasonCode !== null && ids.length > 0 }
  );
}

// Tier tokens this season, as the piece each becomes for the raider's class.
export function useTierTokens(seasonCode: string | null, className: string | null) {
  return useSupabaseQuery<TierTokenRow[]>(
    ['tier-tokens', seasonCode, className],
    (client) =>
      client
        .from('tier_token_map')
        .select('token_item_id, resolved:items!tier_token_map_resolved_item_id_fkey(name)')
        .eq('season', seasonCode!)
        .eq('class', className!),
    { enabled: seasonCode !== null && className !== null }
  );
}

export function useSelfReceived(playerId: number) {
  return useSupabaseQuery<SelfReceivedRow[]>(['self-received', playerId], (client) =>
    client
      .from('self_received_requests')
      .select('track, source, slot, updated_at, items(name)')
      .eq('player_id', playerId)
      .eq('status', 'approved')
  );
}

// Wishlist editor reads and writes (#868 part 3).

// The season an officer is planning for, if they set one (a season code, the
// form raid_zones.season holds, #933), and the tiers the team has wishlist
// editing open for (#939: one team_seasons row per tier; no row means closed).
export function useWishlistSettings(teamId: number) {
  return useSupabaseQuery<{ view: string | null; openSeasons: string[] }>(
    ['wishlist-settings', teamId],
    async (client) => {
      const [settings, seasons] = await Promise.all([
        client.from('team_settings').select('view:config->>seasonView').eq('team_id', teamId).maybeSingle(),
        client.from('team_seasons').select('season_code, wishlist_open').eq('team_id', teamId)
      ]);
      const error = settings.error ?? seasons.error;
      if (error) return { data: null, error };
      const row = (settings.data ?? {}) as { view?: string | null };
      const rows = (seasons.data ?? []) as { season_code: string; wishlist_open: boolean }[];
      return {
        data: {
          view: row.view?.trim() || null,
          openSeasons: rows.filter((r) => r.wishlist_open === true).map((r) => r.season_code)
        },
        error: null
      };
    }
  );
}

// Every class's tier pieces for a season: the editor offers the token, not the
// piece it becomes.
export function useSeasonTierTokens(seasonCode: string | null) {
  return useSupabaseQuery<TokenRow[]>(
    ['season-tier-tokens', seasonCode],
    (client) =>
      client.from('tier_token_map').select('token_item_id, resolved_item_id, class').eq('season', seasonCode!),
    { enabled: seasonCode !== null }
  );
}

// Applies a planMark() plan, one row at a time: deletes, then the kept row,
// then a new one. The wishlist and everything read from it refresh after.
export function useMarkWishlist(playerId: number) {
  return useSupabaseMutation<null, WritePlan>(
    async (client, plan) => {
      if (plan.deletes.length) {
        const { error } = await client.from('item_preferences').delete().in('id', plan.deletes);
        if (error) return { data: null, error };
      }
      if (plan.update) {
        const { id, status, slot } = plan.update;
        const { error } = await client
          .from('item_preferences')
          .update({ status, slot, synced_bis: false })
          .eq('id', id);
        if (error) return { data: null, error };
      }
      if (plan.insert) {
        const row: NewPick = plan.insert;
        const { error } = await client.from('item_preferences').insert(row);
        if (error) return { data: null, error };
      }
      return { data: null, error: null };
    },
    { key: ['mark-wishlist', playerId], refreshes: [['wishlist', playerId]] }
  );
}

// Profile forms (#868 part 4).

// Whether the team takes Mark Received reports (the requests feature, on unless
// switched off) and M+ exclusion requests.
export function useRequestSettings(teamId: number) {
  return useSupabaseQuery<{ reports: boolean; mplusOpen: boolean }>(['request-settings', teamId], async (client) => {
    const { data, error } = await client
      .from('team_settings')
      .select('requests:config->features->>requests, mplusOpen:config->>mPlusExclusionsOpen')
      .eq('team_id', teamId)
      .maybeSingle();
    if (error) return { data: null, error };
    const row = (data ?? {}) as { requests?: string | null; mplusOpen?: string | null };
    return { data: { reports: row.requests !== 'false', mplusOpen: row.mplusOpen === 'true' }, error: null };
  });
}

// Tells the officers in Discord about a request waiting for them. A failed
// notice does not undo the request, which is already saved.
async function notifyOfficers(client: Client, body: Record<string, unknown>) {
  try {
    await client.functions.invoke('discord-bot-webhook', { body });
  } catch {
    // The request is in the officers' queue either way.
  }
}

export type Report = {
  teamKey: string;
  nameRealm: string;
  itemName: string;
  slot: string;
  track: 'Myth' | 'Hero' | 'Champion';
  source: string;
  note: string;
};

// A Mark Received report. Saved at once for the raider's own character unless
// it is Other or its note mentions a raid, which go to officer review.
export function useSubmitReport(teamId: number, playerId: number) {
  return useSupabaseMutation<{ autoApproved: boolean }, Report>(
    async (client, report) => {
      const { data, error } = await client.rpc('submit_self_received', {
        p_team_id: teamId,
        p_name_realm: report.nameRealm,
        p_item_name: report.itemName,
        p_track: report.track,
        p_source: report.source,
        p_note: report.note,
        p_slot: report.slot
      });
      if (error) return { data: null, error };
      const autoApproved = !!(data as { auto_approved: boolean }[] | null)?.[0]?.auto_approved;
      if (!autoApproved) {
        await notifyOfficers(client, {
          action: 'selfreceived',
          team: report.teamKey,
          payload: {
            player: report.nameRealm,
            item: report.itemName,
            slot: report.slot,
            source: report.source,
            notes: report.note
          }
        });
      }
      return { data: { autoApproved }, error: null };
    },
    { key: ['submit-report', playerId], refreshes: [['self-received', playerId]] }
  );
}

export type MplusRequest = { teamKey: string; nameRealm: string; raiderioUrl: string; reason: string };

export function useSubmitMplusRequest(teamId: number, playerId: number) {
  return useSupabaseMutation<null, MplusRequest>(
    async (client, request) => {
      const { error } = await client.rpc('submit_mplus_exclusion', {
        p_team_id: teamId,
        p_name_realm: request.nameRealm,
        p_raiderio_url: request.raiderioUrl,
        p_reason: request.reason
      });
      if (error) return { data: null, error };
      await notifyOfficers(client, {
        action: 'mplus',
        team: request.teamKey,
        payload: { nameRealm: request.nameRealm, raiderioUrl: request.raiderioUrl, notes: request.reason }
      });
      return { data: null, error: null };
    },
    { key: ['submit-mplus', playerId], refreshes: [['mplus-refusal', teamId, playerId]] }
  );
}
