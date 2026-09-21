import { readAll, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { isoDate } from '../calendar/nights';
import type { AttentionCounts, OfficerBio, TeamData, TeamSeasonRow, TeamSettingsRow } from './guild';

// Guild home's reads (#1102). Each covers every team in one request rather
// than one request per team card.

// Settings, progression, schedule and roster size for every team's card. The
// schedule changes run two weeks ahead, for "next raid".
export function useTeamCardData(teamIds: number[], today: Date) {
  const from = isoDate(today);
  const until = new Date(today);
  until.setDate(until.getDate() + 14);
  const to = isoDate(until);
  return useSupabaseQuery<TeamData>(
    ['guild-team-cards', teamIds, from],
    async (client) => {
      const [settings, seasons, progress, schedule, changes] = await Promise.all([
        client
          .from('team_settings')
          .select(
            'team_id, signup_season:config->>activeSignupSeason, logs:config->externalLinks->>warcraftLogsUrl, raids:config->raidProgression'
          )
          .in('team_id', teamIds),
        // One row per team and tier an officer has touched (#939).
        client.from('team_seasons').select('team_id, season_code, signups_open').in('team_id', teamIds),
        client
          .from('team_raid_progress')
          .select(
            'team_id, mythic_date, mythic_pulls, mythic_best_pct, mythic_report_code, mythic_fight_id, heroic_date, heroic_pulls, heroic_best_pct, heroic_report_code, heroic_fight_id, raid_encounters(name, wcl_encounter_id, raid_zones(wcl_zone_id))'
          )
          .in('team_id', teamIds),
        client
          .from('raid_schedule')
          .select('team_id, weekday, start_time, duration_minutes, is_optional')
          .in('team_id', teamIds)
          .eq('active', true),
        client
          .from('raid_schedule_exceptions')
          .select('team_id, raid_date, exception_type, start_time, duration_minutes, is_optional, note')
          .in('team_id', teamIds)
          .gte('raid_date', from)
          .lte('raid_date', to)
          .order('raid_date')
      ]);
      const error = settings.error ?? seasons.error ?? progress.error ?? schedule.error ?? changes.error;
      if (error) return { data: null, error };
      // A few hundred rows across the guild, paged anyway.
      const roles = await readAll<TeamData['roles'][number]>((start, end) =>
        client
          .from('players')
          .select('team_id, classes_specs(role)')
          .in('team_id', teamIds)
          .is('archived_at', null)
          .order('id')
          .range(start, end)
      );
      if (roles.error) return { data: null, error: roles.error };
      return {
        data: {
          settings: (settings.data ?? []) as unknown as TeamSettingsRow[],
          seasons: (seasons.data ?? []) as TeamSeasonRow[],
          progress: (progress.data ?? []) as unknown as TeamData['progress'],
          schedule: schedule.data ?? [],
          changes: changes.data ?? [],
          roles: roles.data
        },
        error: null
      };
    },
    { enabled: teamIds.length > 0 }
  );
}

// The guild officers the site admin lists (site_settings, one row).
export function useGuildOfficers() {
  return useSupabaseQuery<OfficerBio[]>(['guild-officers'], async (client) => {
    const result = await client.from('site_settings').select('guild_officer_bios').eq('id', 1).maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const bios = result.data?.guild_officer_bios;
    return { data: Array.isArray(bios) ? (bios as OfficerBio[]) : [], error: null };
  });
}

async function waiting(client: Client, teamId: number) {
  const count = { count: 'exact', head: true } as const;
  const [reviews, signups, boe] = await Promise.all([
    client.from('self_received_requests').select('id', count).eq('team_id', teamId).eq('status', 'pending'),
    client.from('season_signups').select('id', count).eq('team_id', teamId).eq('status', 'pending'),
    client.from('boe_items').select('id', count).eq('team_id', teamId).eq('status', 'found')
  ]);
  const error = reviews.error ?? signups.error ?? boe.error;
  if (error) throw error;
  return { team_id: teamId, reviews: reviews.count ?? 0, signups: signups.count ?? 0, boe: boe.count ?? 0 };
}

// What is waiting on the reader's officer teams: received-item reviews,
// season signups and BoE finds with no price yet. Officers can read these for
// their own teams only (docs/RLS.md), so the caller passes those teams.
export function useAttention(teamIds: number[]) {
  return useSupabaseQuery<AttentionCounts>(
    ['guild-attention', teamIds],
    async (client) => {
      try {
        return { data: await Promise.all(teamIds.map((id) => waiting(client, id))), error: null };
      } catch (error) {
        return { data: null, error: error as { message: string } };
      }
    },
    { enabled: teamIds.length > 0 }
  );
}
