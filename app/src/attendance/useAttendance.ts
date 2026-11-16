import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { FullAttendanceRow } from './attendance';

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

// Every attendance row the team has, id-ordered so paging is deterministic
// (#707: unpaged, this silently stopped at 1000 rows).
export function useAttendanceRows(teamId: number) {
  return useSupabaseQuery<FullAttendanceRow[]>(rowsKey(teamId), (client) =>
    readAll<FullAttendanceRow>((from, to) =>
      client
        .from('attendance')
        .select('id, player_id, raid_date, status, report_excluded, report_title, source')
        .eq('team_id', teamId)
        .order('id')
        .range(from, to)
    )
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
    { key: ['set-attendance-status', teamId], refreshes: [rowsKey(teamId)] }
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
