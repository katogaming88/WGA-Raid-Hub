import { readAll, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { AttendanceRow, LootRow, SeasonWindow } from '../profile/profile';
import type { GearRow, IncomingRow, PlayerRow } from './roster';

// The active roster, one row per character (80 on the largest team).
export function useRosterPlayers(teamId: number) {
  return useSupabaseQuery<PlayerRow[]>(['roster', teamId], (client) =>
    client
      .from('players')
      .select(
        'id, name_realm, url_code, nickname, is_trial, is_bench, is_rotator, tier_pieces_equipped, join_date, team_member_id, classes_specs(class, spec, role)'
      )
      .eq('team_id', teamId)
      .is('archived_at', null)
      .order('name_realm')
  );
}

// Equipped gear synced from Blizzard (#845), read on its own team column
// (#944). Sixteen slots per raider outgrow one page at 63 raiders.
export function useRosterGear(teamId: number) {
  return useSupabaseQuery<GearRow[]>(['roster-gear', teamId], (client) =>
    readAll<GearRow>((from, to) =>
      client
        .from('player_equipped_gear')
        .select('player_id, equipment_slot, item_level')
        .eq('team_id', teamId)
        .order('id')
        .range(from, to)
    )
  );
}

// Next season's tentative roster: signups approved for the team's signup
// season that are not on the roster yet, and the name of that season.
export function useIncomingRoster(teamId: number) {
  return useSupabaseQuery<IncomingRow[]>(['incoming-roster', teamId], (client) =>
    client.from('incoming_roster').select('signup_id, signup_name_realm, class, spec, role').eq('team_id', teamId)
  );
}

// The tiers the team has signups open for (#934): its team_seasons rows with
// the switch on, newest first, as codes. No row means closed (#939).
export function useSignupSeasons(teamId: number) {
  return useSupabaseQuery<string[]>(['signup-seasons', teamId], async (client) => {
    const { data, error } = await client
      .from('team_seasons')
      .select('season_code, seasons(starts_at)')
      .eq('team_id', teamId)
      .eq('signups_open', true);
    if (error) return { data: null, error };
    const rows = (data ?? []) as { season_code: string; seasons: { starts_at: string } | null }[];
    const startOf = (r: (typeof rows)[number]) => r.seasons?.starts_at ?? '';
    return {
      data: [...rows].sort((a, b) => (startOf(a) < startOf(b) ? 1 : -1)).map((r) => r.season_code),
      error: null
    };
  });
}

// The team's attendance and loot for the season, for the officer-only roster
// columns (Kat, 2026-09-14). Not read at all for anyone else.
export function useRosterOfficerData(teamId: number, season: SeasonWindow | null, enabled: boolean) {
  return useSupabaseQuery<{
    attendance: (AttendanceRow & { player_id: number | null })[];
    loot: (LootRow & { player_id: number | null })[];
  }>(
    ['roster-officer-data', teamId, season?.name ?? null],
    async (client: Client) => {
      const nights = await readAll<AttendanceRow & { player_id: number | null }>((from, to) => {
        let q = client.from('attendance').select('player_id, raid_date, status, report_excluded').eq('team_id', teamId);
        if (season?.start) q = q.gte('raid_date', season.start);
        return q.order('id').range(from, to);
      });
      if (nights.error) return { data: null, error: nights.error };
      const loot = await readAll<LootRow & { player_id: number | null }>((from, to) => {
        let q = client
          .from('rclc_loot')
          .select('id, player_id, track, season, awarded_at, items(name)')
          .eq('team_id', teamId);
        if (season?.code) q = q.eq('season', season.code);
        return q.order('id').range(from, to);
      });
      if (loot.error) return { data: null, error: loot.error };
      return { data: { attendance: nights.data, loot: loot.data }, error: null };
    },
    { enabled: enabled && season !== null }
  );
}
