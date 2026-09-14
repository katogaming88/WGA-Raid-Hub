import { useSupabaseQuery } from '../data/query';
import type { AttendanceRow, GearRow, LootRow, SeasonWindow } from './profile';
import { seasonCode } from './profile';

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
  m_plus_excluded: boolean;
  m_plus_note: string | null;
  join_date: string | null;
  tier_pieces_equipped: number | null;
  classes_specs: { class: string; spec: string; role: string | null } | null;
};

const PLAYER_COLUMNS =
  'id, name_realm, nickname, url_code, is_trial, is_bench, is_rotator, is_backup_tank, is_backup_healer, m_plus_excluded, m_plus_note, join_date, tier_pieces_equipped, classes_specs(class, spec, role)';

// The profile's character, by id (My profile) or by its address code (an
// officer opening someone else's). Active characters only.
export function useProfilePlayer(teamId: number, by: { id: number } | { code: string }) {
  const key = 'id' in by ? ['profile-player', teamId, 'id', by.id] : ['profile-player', teamId, 'code', by.code];
  return useSupabaseQuery<ProfilePlayer | null>(key, (client) => {
    const query = client.from('players').select(PLAYER_COLUMNS).eq('team_id', teamId).is('archived_at', null);
    return ('id' in by ? query.eq('id', by.id) : query.eq('url_code', by.code.toLowerCase())).maybeSingle();
  });
}

// The team's current season, which scopes attendance and loot.
export function useCurrentSeason(teamId: number) {
  return useSupabaseQuery<SeasonWindow>(['current-season', teamId], async (client) => {
    const { data, error } = await client
      .from('team_settings')
      .select('name:config->>seasonName, start:config->>seasonStart, end:config->>seasonEnd')
      .eq('team_id', teamId)
      .maybeSingle();
    if (error) return { data: null, error };
    const row = (data ?? {}) as { name?: string | null; start?: string | null; end?: string | null };
    const name = row.name?.trim() ?? '';
    return {
      data: { name, code: name ? seasonCode(name) : null, start: row.start || null, end: row.end || null },
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

// The latest refused M+ exclusion request. Only officers can read requests,
// so for anyone else this is always empty.
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
