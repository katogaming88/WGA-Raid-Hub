import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import {
  firstLineupBoss,
  type FullAttendanceRow,
  type LastRun,
  type LookContext,
  type ReportKind,
  type ReportRow
} from './attendance';

async function writeAuditLog(
  client: Client,
  teamId: number,
  action: string,
  targetType: string | null,
  targetId: number | null,
  detail: string | null
) {
  // Best-effort like the current site's writeAuditLog(): a failed audit log
  // entry does not undo the write it was describing.
  try {
    await client.rpc('write_audit_log', {
      p_team_id: teamId,
      p_action: action,
      ...(targetType !== null ? { p_target_type: targetType } : {}),
      ...(targetId !== null ? { p_target_id: targetId } : {}),
      p_detail: detail
    });
  } catch {
    // The write is already recorded either way.
  }
}

const rowsKey = (teamId: number) => ['attendance-rows', teamId] as const;
// #1846: the menu's count; refreshed whenever an officer sets a status.
export const waitingKey = (teamId: number) => ['attendance-waiting', teamId] as const;
const lastRunKey = (teamId: number) => ['attendance-last-run', teamId] as const;

// The same count the hourly run commits at zero, so the menu and the run agree.
export function useAttendanceWaiting(teamId: number, enabled: boolean) {
  return useSupabaseQuery<number>(
    waitingKey(teamId),
    async (client) => {
      const result = await client.rpc('attendance_items_waiting', { p_team_id: teamId });
      return result.error ? { data: null, error: result.error } : { data: result.data ?? 0, error: null };
    },
    { enabled }
  );
}

export function useLastRun(teamId: number) {
  return useSupabaseQuery<LastRun | null>(lastRunKey(teamId), async (client) => {
    const result = await client
      .from('team_settings')
      .select('attendance_sync_last_run')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const run = (result.data as { attendance_sync_last_run?: unknown } | null)?.attendance_sync_last_run;
    return { data: (run as LastRun | null) ?? null, error: null };
  });
}

type BossRow = { raid_date: string; encounter_id: number; plan: string; position: number; skipped: boolean };
type PlaceRow = { raid_date: string; encounter_id: number; plan: string; player_id: number };

// One night per call, as wcl-sync asks: raid_rsvps is unique on (team,
// player, night), so each answer holds at most one row per team player, far
// under PostgREST's 1000-row cap, which cuts a long list short without an
// error (CodeRabbit on PR #1861).
async function rsvpsFor(client: Client, teamId: number, dates: string[]) {
  const answers = await Promise.all(
    dates.map((date) => client.rpc('attendance_rsvps_before_start', { p_team_id: teamId, p_dates: [date] }))
  );
  const failed = answers.find((a) => a.error);
  if (failed) return { data: null, error: failed.error };
  return { data: answers.flatMap((a) => a.data ?? []), error: null };
}

export type LookDetails = LookContext & { logNames: { raid_date: string; character_name: string }[] };

// What the Needs a look list's reason lines name, read only for the nights on
// it: the lineup's first boss for a late raider, a Calendar RSVP made before
// the start, and who was in the log but not on the roster.
export function useLookDetails(teamId: number, lateDates: string[], dates: string[]) {
  return useSupabaseQuery<LookDetails>(
    ['attendance-look-details', teamId, lateDates.join(','), dates.join(',')],
    async (client) => {
      const none = { data: [] as never[], error: null };
      const [bosses, places, encounters, rsvps, logNames] = await Promise.all([
        lateDates.length
          ? readAll<BossRow>((from, to) =>
              client
                .from('raid_night_bosses')
                .select('raid_date, encounter_id, plan, position, skipped')
                .eq('team_id', teamId)
                .in('raid_date', lateDates)
                .order('raid_date')
                .order('position')
                .range(from, to)
            )
          : none,
        lateDates.length
          ? readAll<PlaceRow>((from, to) =>
              client
                .from('raid_night_lineups')
                .select('raid_date, encounter_id, plan, player_id')
                .eq('team_id', teamId)
                .in('raid_date', lateDates)
                .order('id')
                .range(from, to)
            )
          : none,
        lateDates.length ? client.from('raid_encounters').select('id, name') : none,
        dates.length ? rsvpsFor(client, teamId, dates) : none,
        dates.length
          ? readAll<{ raid_date: string; character_name: string }>((from, to) =>
              client
                .from('attendance_log_names')
                .select('raid_date, character_name')
                .eq('team_id', teamId)
                .in('raid_date', dates)
                .order('raid_date')
                .order('character_name')
                .range(from, to)
            )
          : none
      ]);
      const error = bosses.error ?? places.error ?? encounters.error ?? rsvps.error ?? logNames.error;
      if (error) return { data: null, error };
      const names = new Map(((encounters.data ?? []) as { id: number; name: string }[]).map((e) => [e.id, e.name]));
      return {
        data: {
          firstBoss: firstLineupBoss(bosses.data ?? [], places.data ?? [], (id) => names.get(id)),
          rsvps: new Map(
            ((rsvps.data ?? []) as { player_id: number; raid_date: string; status: string }[]).map((r) => [
              `${r.player_id}|${r.raid_date}`,
              r.status
            ])
          ),
          logNames: logNames.data ?? []
        },
        error: null
      };
    }
  );
}

// Every attendance row the team has, id-ordered so paging is deterministic
// (#707: unpaged, this silently stopped at 1000 rows).
export function useAttendanceRows(teamId: number) {
  return useSupabaseQuery<FullAttendanceRow[]>(rowsKey(teamId), (client) =>
    readAll<FullAttendanceRow>((from, to) =>
      client
        .from('attendance')
        .select('id, player_id, raid_date, status, report_excluded, report_title, source, report_id')
        .eq('team_id', teamId)
        .order('id')
        .range(from, to)
    )
  );
}

const reportsKey = (teamId: number) => ['team-raid-reports', teamId] as const;

// Every report the progression sync has seen for the team, newest first
// (#1473). started_at then report_code keeps the paging deterministic.
export function useReports(teamId: number) {
  return useSupabaseQuery<ReportRow[]>(reportsKey(teamId), (client) =>
    readAll<ReportRow>((from, to) =>
      client
        .from('team_raid_reports')
        .select(
          'report_code, title, raid_date, boss_pulls, boss_kills, kind, kind_override, kind_override_by, kind_override_at, effective_kind'
        )
        .eq('team_id', teamId)
        .order('started_at', { ascending: false })
        .order('report_code')
        .range(from, to)
    )
  );
}

// Who set each override, by the name they play under on this team. A person
// the team has no member row for (a site admin) reads as null.
export function useOverriders(teamId: number, personIds: number[]) {
  return useSupabaseQuery<Map<number, string>>(
    ['report-overriders', teamId, personIds.join(',')],
    async (client) => {
      const rows = await readAll<{ person_id: number; name_realm: string | null }>((from, to) =>
        client
          .from('team_members')
          .select('person_id, name_realm')
          .eq('team_id', teamId)
          .in('person_id', personIds)
          .order('id')
          .range(from, to)
      );
      if (rows.error) return { data: null, error: rows.error };
      const names = new Map<number, string>();
      for (const r of rows.data ?? []) if (r.name_realm) names.set(r.person_id, r.name_realm);
      return { data: names, error: null };
    },
    { enabled: personIds.length > 0 }
  );
}

// set_report_kind() (#1472): main or alt, or null for the title's verdict.
// The plan, the progression card and the report list follow in the same call.
export function useSetReportKind(teamId: number) {
  return useSupabaseMutation<null, { reportCode: string; kind: ReportKind | null }>(
    async (client, { reportCode, kind }) => {
      const result = await client.rpc('set_report_kind', {
        p_team_id: teamId,
        p_report_code: reportCode,
        // The generated type has no null; the function reads it as "the title's verdict".
        p_kind: kind as string
      });
      return result.error ? { data: null, error: result.error } : { data: null, error: null };
    },
    { key: ['set-report-kind', teamId], refreshes: [reportsKey(teamId), rowsKey(teamId)] }
  );
}

export function useSetAttendanceStatus(teamId: number) {
  return useSupabaseMutation<null, { playerId: number; raidDate: string; status: string; oldStatus: string | null }>(
    async (client, { playerId, raidDate, status, oldStatus }) => {
      const result = await client
        .from('attendance')
        .upsert(
          { team_id: teamId, player_id: playerId, raid_date: raidDate, status, source: 'Officer' },
          { onConflict: 'team_id,player_id,raid_date' }
        );
      if (result.error) return result;
      await writeAuditLog(
        client,
        teamId,
        'Attendance Status Set',
        'players',
        playerId,
        `${oldStatus || '(none)'} -> ${status}`
      );
      return { data: null, error: null };
    },
    { key: ['set-attendance-status', teamId], refreshes: [rowsKey(teamId), waitingKey(teamId)] }
  );
}

export function useToggleReportExcluded(teamId: number) {
  return useSupabaseMutation<null, { raidDate: string; excluded: boolean }>(
    async (client, { raidDate, excluded }) => {
      const result = await client
        .from('attendance')
        .update({ report_excluded: excluded })
        .eq('team_id', teamId)
        .eq('raid_date', raidDate);
      if (result.error) return result;
      await writeAuditLog(
        client,
        teamId,
        excluded ? 'Report Excluded' : 'Report Exclusion Removed',
        null,
        null,
        raidDate
      );
      return { data: null, error: null };
    },
    { key: ['toggle-report-excluded', teamId], refreshes: [rowsKey(teamId)] }
  );
}

export type CommitSummary = { committed: number; totalNights: number };

// Recomputes every player's attendance score from scratch and writes it to
// Scoring for the live season. The math is commit_attendance_scores() (#1845),
// the one copy the current site's button and the hourly wcl-sync run call too.
export function useCommitAttendanceScores(teamId: number) {
  return useSupabaseMutation<CommitSummary, void>(
    async (client) => {
      const result = await client.rpc('commit_attendance_scores', { p_team_id: teamId });
      if (result.error) return { data: null, error: result.error };
      // The function writes its own audit entry.
      return { data: result.data as unknown as CommitSummary, error: null };
    },
    { key: ['commit-attendance-scores', teamId], refreshes: [] }
  );
}

export type RefreshSummary = { mainNights: number; excluded: number };

// refreshAttendanceWCL(): pulls new raid nights from Warcraft Logs via the
// wcl-sync Edge Function.
export function useRefreshAttendanceFromWcl(teamId: number) {
  return useSupabaseMutation<RefreshSummary, void>(
    async (client) => {
      const res = await client.functions.invoke('wcl-sync', { body: { action: 'refreshAttendance', teamId } });
      if (res.error) return { data: null, error: { message: res.error.message } };
      const result = res.data as (RefreshSummary & { success: true }) | { success: false; error: string };
      if (!result.success) return { data: null, error: { message: result.error || 'Error refreshing.' } };
      return { data: result, error: null };
    },
    { key: ['refresh-attendance-wcl', teamId], refreshes: [rowsKey(teamId)] }
  );
}
