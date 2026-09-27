import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { commitScores, type FullAttendanceRow, type ScoreRow } from './attendance';
import { ATTENDANCE_WEIGHTS } from '../profile/profile';

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

// executeCommitScores(): recomputes every player's attendance score from
// scratch and writes it to Scoring. Reads the same rows useAttendanceRows()
// has cached rather than a second full-table read.
export function useCommitAttendanceScores(teamId: number) {
  return useSupabaseMutation<CommitSummary, { rows: FullAttendanceRow[]; season: string }>(
    async (client, { rows, season }) => {
      const { rows: scoreRows, totalNights } = commitScores(rows, ATTENDANCE_WEIGHTS, season);
      if (scoreRows.length === 0) return { data: { committed: 0, totalNights }, error: null };
      const upsertRows: (ScoreRow & { team_id: number })[] = scoreRows.map((r) => ({ ...r, team_id: teamId }));
      const result = await client.from('scoring').upsert(upsertRows, { onConflict: 'player_id,season' });
      if (result.error) return { data: null, error: result.error };
      await writeAuditLog(
        client,
        teamId,
        'Attendance Scores Committed',
        null,
        null,
        `${scoreRows.length} players, ${totalNights} nights`
      );
      return { data: { committed: scoreRows.length, totalNights }, error: null };
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
