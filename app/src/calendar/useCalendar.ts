import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { Answer, ScheduleChange, ScheduleRule } from './calendar';

// The Calendar page's reads and writes (#1102).

// The generated types say string, but both answer functions take null for
// "back to the default", which is how the current site clears an answer.
const orNull = (value: string | null) => value as string;

// The team's weekly raid nights: one row per night of the week.
export function useSchedule(teamId: number) {
  return useSupabaseQuery<ScheduleRule[]>(['calendar-schedule', teamId], (client) =>
    client
      .from('raid_schedule')
      .select('weekday, start_time, duration_minutes, is_optional')
      .eq('team_id', teamId)
      .eq('active', true)
      .order('weekday')
  );
}

// One-off changes (a cancelled night, an extra one) between two dates.
export function useScheduleChanges(teamId: number, from: string, to: string) {
  return useSupabaseQuery<ScheduleChange[]>(['calendar-changes', teamId, from, to], (client) =>
    client
      .from('raid_schedule_exceptions')
      .select('raid_date, exception_type, start_time, duration_minutes, is_optional, note')
      .eq('team_id', teamId)
      .gte('raid_date', from)
      .lte('raid_date', to)
      .order('raid_date')
  );
}

// Whose answers the reader may see (docs/database-decisions.md, 2026-09-16):
// - officers: everyone's, with notes
// - raiders on the team: everyone's without notes, plus their own notes
// - anyone else, and anyone signed out: none
export type AnswerAccess = { kind: 'officer' } | { kind: 'raider'; playerIds: number[] } | { kind: 'none' };

export const answersKey = (teamId: number) => ['calendar-answers', teamId] as const;

async function readAnswers(client: Client, teamId: number, from: string, to: string, access: AnswerAccess) {
  if (access.kind === 'none') return { data: [] as Answer[], error: null };
  if (access.kind === 'officer') {
    const { data, error } = await client
      .from('raid_rsvps')
      .select('player_id, raid_date, status, note, updated_at')
      .eq('team_id', teamId)
      .gte('raid_date', from)
      .lte('raid_date', to)
      .order('raid_date');
    return { data: (data ?? []) as Answer[], error };
  }
  const [team, own] = await Promise.all([
    client.rpc('team_rsvp_answers', { p_team_id: teamId, p_from: from, p_to: to }),
    access.playerIds.length
      ? client
          .from('raid_rsvps')
          .select('player_id, raid_date, note')
          .eq('team_id', teamId)
          .in('player_id', access.playerIds)
          .gte('raid_date', from)
          .lte('raid_date', to)
      : Promise.resolve({ data: [], error: null })
  ]);
  const error = team.error ?? own.error;
  if (error) return { data: null, error };
  const notes = new Map(
    ((own.data ?? []) as { player_id: number; raid_date: string; note: string | null }[]).map((r) => [
      `${r.player_id}|${r.raid_date}`,
      r.note
    ])
  );
  const rows = ((team.data ?? []) as Answer[]).map((a) => ({
    ...a,
    note: notes.get(`${a.player_id}|${a.raid_date}`) ?? null
  }));
  return { data: rows, error: null };
}

export function useAnswers(teamId: number, from: string, to: string, access: AnswerAccess, enabled = true) {
  const who = access.kind === 'raider' ? access.playerIds : access.kind;
  return useSupabaseQuery<Answer[]>(
    [...answersKey(teamId), from, to, who],
    (client) => readAnswers(client, teamId, from, to, access),
    { enabled }
  );
}

// The Discord bot posts an answer and keeps the signup sheet current. A failed
// post does not undo the answer, which is already saved.
async function tellBot(client: Client, body: Record<string, unknown>) {
  try {
    await client.functions.invoke('discord-bot-webhook', { body });
  } catch {
    // The answer is saved either way.
  }
}

const refreshes = (teamId: number) => [answersKey(teamId), ['calendar-month', teamId]];

export type OwnAnswer = { date: string; status: string | null; note: string; teamKey: string; nameRealm: string };

// The reader's own answer. A null status goes back to the default.
export function useSetOwnAnswer(teamId: number) {
  return useSupabaseMutation<null, OwnAnswer>(
    async (client, a) => {
      const { error } = await client.rpc('set_own_rsvp', {
        p_team_id: teamId,
        p_raid_date: a.date,
        p_status: orNull(a.status),
        p_note: orNull(a.status === null ? null : a.note)
      });
      if (error) return { data: null, error };
      if (a.status !== null) {
        await tellBot(client, {
          action: 'rsvp',
          team: a.teamKey,
          payload: { charName: a.nameRealm, raidDate: a.date, status: a.status, note: a.note }
        });
      }
      await tellBot(client, { action: 'signupSheetSync', team: a.teamKey, payload: { raidDate: a.date } });
      return { data: null, error: null };
    },
    { key: ['set-own-answer', teamId], refreshes: refreshes(teamId) }
  );
}

export type OfficerAnswer = { date: string; playerId: number; status: string | null; note: string; teamKey: string };

// An officer setting a raider's answer, with a reason the raider sees.
export function useOfficerSetAnswer(teamId: number) {
  return useSupabaseMutation<null, OfficerAnswer>(
    async (client, a) => {
      const { error } = await client.rpc('officer_set_rsvp', {
        p_team_id: teamId,
        p_player_id: a.playerId,
        p_raid_date: a.date,
        p_status: orNull(a.status),
        p_note: orNull(a.note.trim() || null)
      });
      if (error) return { data: null, error };
      await tellBot(client, { action: 'signupSheetSync', team: a.teamKey, payload: { raidDate: a.date } });
      return { data: null, error: null };
    },
    { key: ['officer-set-answer', teamId], refreshes: refreshes(teamId) }
  );
}

export type RotatorWeek = { date: string; weekStart: string; playerId: number; isIn: boolean; teamKey: string };

// An officer putting a rotator in (or back out) for every raid night of a week.
export function useRotatorWeek(teamId: number) {
  return useSupabaseMutation<null, RotatorWeek>(
    async (client, w) => {
      const { error } = await client.rpc('officer_set_rotator_week', {
        p_team_id: teamId,
        p_player_id: w.playerId,
        p_week_start: w.weekStart,
        p_in: w.isIn
      });
      if (error) return { data: null, error };
      await tellBot(client, { action: 'signupSheetSync', team: w.teamKey, payload: { raidDate: w.date } });
      return { data: null, error: null };
    },
    { key: ['rotator-week', teamId], refreshes: refreshes(teamId) }
  );
}
