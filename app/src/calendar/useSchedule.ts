import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import {
  asDifficulty,
  DIFFICULTY_LABELS,
  nightAuditDetail,
  nightRow,
  type Difficulty,
  type ExtraNight,
  type NightDraft,
  type WeeklyNight
} from './schedule';

// The officer's raid schedule (#1361): reads and writes, ported from the
// current site's Schedule tab (js/tabs/tab-schedule.js). Writes go straight to
// the tables under their officer write rule, as that tab's do, and each one
// logs the same audit entry it does.

async function audit(
  client: Client,
  teamId: number,
  action: string,
  targetType: string,
  targetId: number | null,
  detail: string | null
) {
  // Best-effort like the current site's writeAuditLog(): a failed entry does
  // not undo the change it describes.
  try {
    await client.rpc('write_audit_log', {
      p_team_id: teamId,
      p_action: action,
      p_target_type: targetType,
      ...(targetId !== null && { p_target_id: targetId }),
      ...(detail !== null && { p_detail: detail })
    });
  } catch {
    // The change is saved either way.
  }
}

export const scheduleEditorKey = (teamId: number) => ['schedule-editor', teamId] as const;

// Everything that shows raid nights reads again after a change: this editor,
// the Calendar's month and night pages, Home's calendar and the guild page.
const refreshes = (teamId: number) => [
  scheduleEditorKey(teamId),
  ['calendar-schedule', teamId],
  ['calendar-changes', teamId],
  ['calendar-month', teamId],
  ['guild-team-cards']
];

export type ScheduleEditorData = { teamDefault: Difficulty | null; nights: WeeklyNight[] };

// The team default and every weekly night, the switched-off ones included.
export function useScheduleEditor(teamId: number, enabled: boolean) {
  return useSupabaseQuery<ScheduleEditorData>(
    scheduleEditorKey(teamId),
    async (client) => {
      const [settings, nights] = await Promise.all([
        // team-read-guard: one row per team (team_id is the primary key)
        client.from('team_schedule_settings').select('default_difficulty').eq('team_id', teamId).maybeSingle(),
        // team-read-guard: one row per weekday and start time a team raids
        client
          .from('raid_schedule')
          .select('id, weekday, start_time, timezone, duration_minutes, active, is_optional, difficulty')
          .eq('team_id', teamId)
          .order('weekday')
          .order('start_time')
      ]);
      const error = settings.error ?? nights.error;
      if (error) return { data: null, error };
      return {
        data: {
          teamDefault: asDifficulty(settings.data?.default_difficulty),
          nights: (nights.data ?? []) as WeeklyNight[]
        },
        error: null
      };
    },
    { enabled }
  );
}

export function useSaveTeamDefault(teamId: number) {
  return useSupabaseMutation<null, Difficulty | null>(
    async (client, difficulty) => {
      const { error } = await client
        .from('team_schedule_settings')
        .upsert({ team_id: teamId, default_difficulty: difficulty }, { onConflict: 'team_id' });
      if (error) return { data: null, error };
      await audit(
        client,
        teamId,
        'Raid Difficulty Default Updated',
        'team_schedule_settings',
        teamId,
        difficulty ? DIFFICULTY_LABELS[difficulty] : 'Not set'
      );
      return { data: null, error: null };
    },
    { key: ['save-team-default', teamId], refreshes: refreshes(teamId) }
  );
}

// A weekly night: an update when it has an id, otherwise a new one.
export function useSaveWeeklyNight(teamId: number) {
  return useSupabaseMutation<null, NightDraft>(
    async (client, draft) => {
      const row = nightRow(draft);
      if (draft.id !== null) {
        const { error } = await client.from('raid_schedule').update(row).eq('id', draft.id);
        if (error) return { data: null, error };
        await audit(client, teamId, 'Raid Schedule Updated', 'raid_schedule', draft.id, nightAuditDetail(draft));
        return { data: null, error: null };
      }
      const { data, error } = await client
        .from('raid_schedule')
        .insert({ team_id: teamId, ...row })
        .select('id')
        .maybeSingle();
      if (error) return { data: null, error };
      await audit(client, teamId, 'Raid Schedule Added', 'raid_schedule', data?.id ?? null, nightAuditDetail(draft));
      return { data: null, error: null };
    },
    { key: ['save-weekly-night', teamId], refreshes: refreshes(teamId) }
  );
}

export function useRemoveWeeklyNight(teamId: number) {
  return useSupabaseMutation<null, number>(
    async (client, id) => {
      const { error } = await client.from('raid_schedule').delete().eq('id', id);
      if (error) return { data: null, error };
      await audit(client, teamId, 'Raid Schedule Removed', 'raid_schedule', id, null);
      return { data: null, error: null };
    },
    { key: ['remove-weekly-night', teamId], refreshes: refreshes(teamId) }
  );
}

// One date's change: a usual night called off, or an extra night added.
export type DateChange =
  | { kind: 'cancelled'; date: string; note: string; teamMemberId: number | null }
  | ({ kind: 'added'; date: string; teamMemberId: number | null } & ExtraNight);

export function useAddDateChange(teamId: number) {
  return useSupabaseMutation<null, DateChange>(
    async (client, c) => {
      const added = c.kind === 'added';
      const { data, error } = await client
        .from('raid_schedule_exceptions')
        .insert({
          team_id: teamId,
          raid_date: c.date,
          exception_type: c.kind,
          start_time: added ? c.start : null,
          duration_minutes: added ? Number(c.duration) : null,
          is_optional: added ? c.optional : false,
          difficulty: added ? c.difficulty : null,
          note: c.note.trim() || null,
          created_by: c.teamMemberId
        })
        .select('id')
        .maybeSingle();
      if (error) return { data: null, error };
      await audit(
        client,
        teamId,
        added ? 'Raid Night Added' : 'Raid Night Cancelled',
        'raid_schedule_exceptions',
        data?.id ?? null,
        c.date
      );
      return { data: null, error: null };
    },
    { key: ['add-date-change', teamId], refreshes: refreshes(teamId) }
  );
}

// Undoes a date's change: brings a cancelled night back, or takes an extra
// night off the calendar.
export function useRemoveDateChange(teamId: number) {
  return useSupabaseMutation<null, number>(
    async (client, id) => {
      const { error } = await client.from('raid_schedule_exceptions').delete().eq('id', id);
      if (error) return { data: null, error };
      await audit(client, teamId, 'Raid Schedule Exception Removed', 'raid_schedule_exceptions', id, null);
      return { data: null, error: null };
    },
    { key: ['remove-date-change', teamId], refreshes: refreshes(teamId) }
  );
}
