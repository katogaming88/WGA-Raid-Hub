import { useSupabaseQuery } from '../data/query';
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

// Equipped gear synced from Blizzard (#845). It has no team column, so the
// team comes through the player.
export function useRosterGear(teamId: number) {
  return useSupabaseQuery<GearRow[]>(['roster-gear', teamId], (client) =>
    client
      .from('player_equipped_gear')
      .select('player_id, equipment_slot, item_level, players!inner(team_id)')
      .eq('players.team_id', teamId)
  );
}

// Next season's tentative roster: signups approved for the team's signup
// season that are not on the roster yet, and the name of that season.
export function useIncomingRoster(teamId: number) {
  return useSupabaseQuery<IncomingRow[]>(['incoming-roster', teamId], (client) =>
    client.from('incoming_roster').select('signup_id, signup_name_realm, class, spec, role').eq('team_id', teamId)
  );
}

export function useSignupSeason(teamId: number) {
  return useSupabaseQuery<string>(['signup-season', teamId], async (client) => {
    const { data, error } = await client
      .from('team_settings')
      .select('signupSeason:config->>activeSignupSeason')
      .eq('team_id', teamId)
      .maybeSingle();
    if (error) return { data: null, error };
    const season = (data as { signupSeason?: unknown } | null)?.signupSeason;
    return { data: typeof season === 'string' ? season.trim() : '', error: null };
  });
}

// Every row of a read, a page at a time: the API returns at most 1000 rows per
// request, and a team's season of attendance grows past that.
const PAGE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function readAll<T>(page: (from: number, to: number) => Page<T>) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: rows, error: null };
  }
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
