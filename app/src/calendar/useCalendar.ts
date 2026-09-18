import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { Answer, ScheduleChange, ScheduleRule } from './calendar';
import { isStaleSave, type EncounterRow, type NightBossRow, type PlaceRow, type SeasonRow } from './lineup';

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

// Boss lineups (#1216)

export const lineupKey = (teamId: number) => ['boss-lineup', teamId] as const;

// Every season's dates, and every boss the progression sync has loaded. Both
// are small lookups every visitor can read.
export function useSeasons() {
  return useSupabaseQuery<SeasonRow[]>(['seasons'], (client) =>
    client.from('seasons').select('display_name, starts_at, ends_at').order('starts_at')
  );
}

export function useEncounters() {
  return useSupabaseQuery<EncounterRow[]>(['raid-encounters'], (client) =>
    client
      .from('raid_encounters')
      .select('id, name, sort_index, zone:raid_zones!inner(id, name, season, is_mini_raid, sort_index)')
      .order('id')
  );
}

// One night's plan: its bosses and who is in for each.
export type NightPlan = { bosses: NightBossRow[]; places: PlaceRow[] };

export function useNightPlan(teamId: number, date: string) {
  return useSupabaseQuery<NightPlan>([...lineupKey(teamId), 'night', date], async (client) => {
    const [bosses, places] = await Promise.all([
      client
        .from('raid_night_bosses')
        .select('raid_date, encounter_id, position, skipped, confirmed_at')
        .eq('team_id', teamId)
        .eq('raid_date', date)
        .order('position'),
      client
        .from('raid_night_lineups')
        .select('encounter_id, player_id')
        .eq('team_id', teamId)
        .eq('raid_date', date)
        .order('id')
    ]);
    const error = bosses.error ?? places.error;
    if (error) return { data: null, error };
    return {
      data: { bosses: (bosses.data ?? []) as NightBossRow[], places: (places.data ?? []) as PlaceRow[] },
      error: null
    };
  });
}

// The team's usual group for every boss.
export function useBossGroups(teamId: number) {
  return useSupabaseQuery<PlaceRow[]>([...lineupKey(teamId), 'groups'], (client) =>
    client.from('boss_groups').select('encounter_id, player_id').eq('team_id', teamId).order('id')
  );
}

export type BossSave = {
  encounterId: number;
  players: number[];
  // What the page last read, so a save made after someone else's is refused.
  expected: number[];
};

// The outcome of saving several bosses one after another: which went through
// and which were refused because someone else saved that boss first. Any
// other failure stops the run and throws.
export type SaveResult = { saved: number[]; stale: number[] };

async function saveEach(
  saves: BossSave[],
  one: (s: BossSave) => PromiseLike<{ error: { message: string } | null }>
): Promise<{ data: SaveResult | null; error: { message: string } | null }> {
  const result: SaveResult = { saved: [], stale: [] };
  for (const s of saves) {
    const { error } = await one(s);
    if (error && isStaleSave(error.message)) result.stale.push(s.encounterId);
    else if (error) return { data: null, error };
    else result.saved.push(s.encounterId);
  }
  return { data: result, error: null };
}

// "Save tonight": each changed boss's lineup for the night, one boss at a time,
// so two officers on different bosses never get in each other's way.
export function useSaveNight(teamId: number, date: string) {
  return useSupabaseMutation<SaveResult, BossSave[]>(
    (client, saves) =>
      saveEach(saves, (s) =>
        client.rpc('set_raid_night_lineup', {
          p_team_id: teamId,
          p_raid_date: date,
          p_encounter_id: s.encounterId,
          p_player_ids: s.players,
          p_expected_player_ids: s.expected
        })
      ),
    { key: ['save-night', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// "Save to the group": tonight first, for each boss changed tonight, then the
// usual groups. That order matters: a group save also rewrites coming nights
// nobody has saved for that boss, and tonight is saved by then, so it keeps
// what the officer set.
export type GroupSave = { night: BossSave[]; groups: BossSave[] };

export function useSaveGroups(teamId: number, date: string) {
  return useSupabaseMutation<SaveResult, GroupSave>(
    async (client, s) => {
      const night = await saveEach(s.night, (b) =>
        client.rpc('set_raid_night_lineup', {
          p_team_id: teamId,
          p_raid_date: date,
          p_encounter_id: b.encounterId,
          p_player_ids: b.players,
          p_expected_player_ids: b.expected
        })
      );
      if (night.error) return night;
      const refused = new Set(night.data!.stale);
      const groups = await saveEach(
        s.groups.filter((g) => !refused.has(g.encounterId)),
        (b) =>
          client.rpc('set_boss_group', {
            p_team_id: teamId,
            p_encounter_id: b.encounterId,
            p_player_ids: b.players,
            p_expected_player_ids: b.expected
          })
      );
      if (groups.error) return groups;
      return {
        data: {
          saved: [...new Set([...night.data!.saved, ...groups.data!.saved])].filter(
            (id) => !groups.data!.stale.includes(id) && !refused.has(id)
          ),
          stale: [...refused, ...groups.data!.stale]
        },
        error: null
      };
    },
    { key: ['save-groups', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// Fills a night from the groups now rather than waiting for the nightly job.
export function usePlanNight(teamId: number, date: string) {
  return useSupabaseMutation<number, null>(
    (client) => client.rpc('plan_raid_night', { p_team_id: teamId, p_raid_date: date }),
    { key: ['plan-night', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// "Skip" takes a boss off the night; "Put back" refills it from its group.
export function useSkipBoss(teamId: number, date: string) {
  return useSupabaseMutation<undefined, { encounterId: number; skipped: boolean }>(
    (client, s) =>
      client.rpc('set_raid_night_boss_skipped', {
        p_team_id: teamId,
        p_raid_date: date,
        p_encounter_id: s.encounterId,
        p_skipped: s.skipped
      }),
    { key: ['skip-boss', teamId], refreshes: [lineupKey(teamId)] }
  );
}
