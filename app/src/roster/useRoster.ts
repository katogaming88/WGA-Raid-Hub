import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { AttendanceRow, LootRow, SeasonWindow } from '../profile/profile';
import type { GearRow, IncomingRow, PlayerRow } from './roster';

// The active roster, one row per character (80 on the largest team).
export function useRosterPlayers(teamId: number) {
  return useSupabaseQuery<PlayerRow[]>(['roster', teamId], (client) =>
    // team-read-guard: one row per active character (80 on the largest team)
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
    // team-read-guard: signups not on the roster yet, dozens at most
    client.from('incoming_roster').select('signup_id, signup_name_realm, class, spec, role').eq('team_id', teamId)
  );
}

export type SignupSeason = { code: string; name: string };

// The tiers the team has signups open for (#934): its team_seasons rows with
// the switch on, newest first, each with the name stored on the season (#1388).
// No row means closed (#939).
export function useSignupSeasons(teamId: number) {
  return useSupabaseQuery<SignupSeason[]>(['signup-seasons', teamId], async (client) => {
    // team-read-guard: one row per season the team has, a handful
    const { data, error } = await client
      .from('team_seasons')
      .select('season_code, seasons(starts_at, display_name)')
      .eq('team_id', teamId)
      .eq('signups_open', true);
    if (error) return { data: null, error };
    const rows = (data ?? []) as {
      season_code: string;
      seasons: { starts_at: string; display_name: string } | null;
    }[];
    const startOf = (r: (typeof rows)[number]) => r.seasons?.starts_at ?? '';
    return {
      data: [...rows]
        .sort((a, b) => (startOf(a) < startOf(b) ? 1 : -1))
        .map((r) => ({ code: r.season_code, name: r.seasons?.display_name ?? r.season_code })),
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

// Which of these raiders have a wishlist row this season, for the Needs a
// look box (#1360). Asked only for the few who joined in the last 30 days,
// not the whole team.
export function useWishlistsStarted(playerIds: number[], season: string | null) {
  return useSupabaseQuery<Set<number>>(
    ['wishlists-started', season, playerIds],
    async (client) => {
      const { data, error } = await client
        .from('item_preferences')
        .select('player_id')
        .in('player_id', playerIds)
        .eq('season', season!);
      if (error) return { data: null, error };
      return { data: new Set((data ?? []).map((r) => r.player_id as number)), error: null };
    },
    { enabled: playerIds.length > 0 && season !== null }
  );
}

export type ArchivedRow = {
  id: number;
  name_realm: string;
  nickname: string | null;
  archived_at: string;
  classes_specs: { class: string; spec: string } | null;
  player_officer_notes: { archived_reason: string | null; archived_reason_detail: string | null } | null;
};

// Officers: every archived character on the team, newest first, with why it
// left (#1360 part 3). The reason is officer-only, so nobody else reads it.
export function useArchivedPlayers(teamId: number, enabled: boolean) {
  return useSupabaseQuery<ArchivedRow[]>(
    ['archived', teamId],
    async (client) => {
      const rows = await readAll<ArchivedRow>((from, to) =>
        client
          .from('players')
          .select(
            'id, name_realm, nickname, archived_at, classes_specs(class, spec), player_officer_notes(archived_reason, archived_reason_detail)'
          )
          .eq('team_id', teamId)
          .not('archived_at', 'is', null)
          .order('id')
          .range(from, to)
      );
      if (rows.error) return rows;
      return { data: rows.data.sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1)), error: null };
    },
    { enabled }
  );
}

// Officers: puts an archived character back on the roster as it was, and
// brings back its membership if that was archived too (restore_player(),
// #1133). Why it left stays on record.
export function useRestorePlayer(teamId: number) {
  return useSupabaseMutation<null, { playerId: number; name: string }>(
    async (client, { playerId }) => {
      const result = await client.rpc('restore_player', { p_player_id: playerId });
      return { data: null, error: result.error };
    },
    {
      key: ['restore-player', teamId],
      refreshes: [
        ['roster', teamId],
        ['archived', teamId],
        ['team-alts', teamId],
        ['names', teamId]
      ]
    }
  );
}

export type AccountLinks = { battlenet: boolean; discord: boolean };

// Officers: whether each current member has connected Battle.net and Discord
// (#1360 part 4). Which accounts they are waits on #1484; until then the
// Roster only lights the logos.
export function useAccountLinks(teamId: number, enabled: boolean) {
  return useSupabaseQuery<Map<number, AccountLinks>>(
    ['account-links', teamId],
    async (client) => {
      const battlenet = await client.rpc('team_battlenet_connections', { p_team_id: teamId });
      if (battlenet.error) return { data: null, error: battlenet.error };
      // team-read-guard: one row per current member of the team (80 on the largest)
      const members = await client
        .from('team_members')
        .select('id, discord_id')
        .eq('team_id', teamId)
        .is('archived_at', null);
      if (members.error) return { data: null, error: members.error };
      const withBattlenet = new Set(
        ((battlenet.data ?? []) as { team_member_id: number }[]).map((r) => r.team_member_id)
      );
      const rows = (members.data ?? []) as { id: number; discord_id: string | null }[];
      return {
        data: new Map(rows.map((m) => [m.id, { battlenet: withBattlenet.has(m.id), discord: m.discord_id !== null }])),
        error: null
      };
    },
    { enabled }
  );
}
