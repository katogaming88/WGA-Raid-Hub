import { readAll, useSupabaseQuery } from '../data/query';
import type { SeasonWindow } from '../profile/profile';
import type { FeedLootRow } from './home';
import type { ProgressRow, SettingsRaid } from './progression';
import { monthRange, type ExceptionRow, type RsvpRow, type ScheduleRow } from '../calendar/nights';

// The team's awards for the season, for the stats row and the recent loot
// feed. Paged, since a season's loot for a whole team runs past the 1000 rows
// one request returns. The season is filtered here and again in lootFeed(), so
// the page never counts another season's items even if the filter is dropped.
export function useSeasonLoot(teamId: number, season: SeasonWindow | null) {
  return useSupabaseQuery<FeedLootRow[]>(
    ['home-loot', teamId, season?.code ?? null],
    (client) =>
      readAll<FeedLootRow>((from, to) => {
        let q = client
          .from('rclc_loot')
          .select('id, track, season, awarded_at, response, items(name), players(name_realm, nickname)')
          .eq('team_id', teamId);
        if (season?.code) q = q.eq('season', season.code);
        return q.order('id').range(from, to);
      }),
    { enabled: season !== null }
  );
}

// The season's raids as officers list them, and what the WCL sync has seen of
// each boss. One progress row per boss the team has pulled.
export function useRaidProgression(teamId: number) {
  return useSupabaseQuery<{ raids: SettingsRaid[]; rows: ProgressRow[] }>(
    ['raid-progression', teamId],
    async (client) => {
      const [settings, progress] = await Promise.all([
        client.from('team_settings').select('raids:config->raidProgression').eq('team_id', teamId).maybeSingle(),
        client
          .from('team_raid_progress')
          .select(
            'mythic_date, mythic_pulls, mythic_best_pct, mythic_report_code, mythic_fight_id, heroic_date, heroic_pulls, heroic_best_pct, heroic_report_code, heroic_fight_id, raid_encounters(name, wcl_encounter_id, raid_zones(wcl_zone_id))'
          )
          .eq('team_id', teamId)
      ]);
      const error = settings.error ?? progress.error;
      if (error) return { data: null, error };
      const raids = (settings.data as { raids?: unknown } | null)?.raids;
      return {
        data: {
          raids: Array.isArray(raids) ? (raids as SettingsRaid[]) : [],
          rows: (progress.data ?? []) as ProgressRow[]
        },
        error: null
      };
    }
  );
}

// One month of the team's raid schedule, and the reader's own answers for it
// when they have a character on the team. The weekly schedule is a row per
// raid night of the week; the changes and answers are bounded to the month.
export function useCalendarMonth(teamId: number, year: number, month: number, myPlayerIds: number[], enabled = true) {
  const { first, last } = monthRange(year, month);
  return useSupabaseQuery<{ schedule: ScheduleRow[]; exceptions: ExceptionRow[]; mine: RsvpRow[] }>(
    ['calendar-month', teamId, first, myPlayerIds],
    async (client) => {
      const [schedule, exceptions, mine] = await Promise.all([
        client.from('raid_schedule').select('weekday, is_optional').eq('team_id', teamId).eq('active', true),
        client
          .from('raid_schedule_exceptions')
          .select('raid_date, exception_type, is_optional')
          .eq('team_id', teamId)
          .gte('raid_date', first)
          .lte('raid_date', last),
        myPlayerIds.length
          ? client
              .from('raid_rsvps')
              .select('raid_date, status')
              .eq('team_id', teamId)
              .in('player_id', myPlayerIds)
              .gte('raid_date', first)
              .lte('raid_date', last)
          : Promise.resolve({ data: [], error: null })
      ]);
      const error = schedule.error ?? exceptions.error ?? mine.error;
      if (error) return { data: null, error };
      return {
        data: {
          schedule: (schedule.data ?? []) as ScheduleRow[],
          exceptions: (exceptions.data ?? []) as ExceptionRow[],
          mine: (mine.data ?? []) as RsvpRow[]
        },
        error: null
      };
    },
    { enabled }
  );
}
