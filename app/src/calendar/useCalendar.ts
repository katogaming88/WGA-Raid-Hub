import { useSession } from '../auth/session';
import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { visibleSeasons } from '../profile/profile';
import type { Answer, ScheduleChange, ScheduleRule } from './calendar';
import type { Role } from '../roster/roster';
import { asDifficulty, type Difficulty } from './schedule';
import {
  DEFAULT_ROLE_TARGETS,
  isStaleSave,
  type ComingBossRow,
  type EncounterRow,
  type LeaverRow,
  type NightBossRow,
  type PickRow,
  type PlaceRow,
  type Plan,
  type RaiderOrder,
  type BossTargets,
  type RoleTargets,
  type SeasonRow
} from './lineup';

// The Calendar page's reads and writes (#1102).

// The generated types say string, but both answer functions take null for
// "back to the default", which is how the current site clears an answer.
const orNull = (value: string | null) => value as string;

// The team's weekly raid nights, one row per night of the week, and the team
// default difficulty a night without its own follows (#1361). Both are
// public reads.
export type Schedule = { rules: ScheduleRule[]; teamDefault: Difficulty | null };

export function useSchedule(teamId: number) {
  return useSupabaseQuery<Schedule>(['calendar-schedule', teamId], async (client) => {
    const [rules, settings] = await Promise.all([
      // team-read-guard: one row per raid night of the week
      client
        .from('raid_schedule')
        .select('weekday, start_time, duration_minutes, is_optional, difficulty, title')
        .eq('team_id', teamId)
        .eq('active', true)
        .order('weekday'),
      // team-read-guard: one row per team (team_id is the primary key)
      client.from('team_schedule_settings').select('default_difficulty').eq('team_id', teamId).maybeSingle()
    ]);
    const error = rules.error ?? settings.error;
    if (error) return { data: null, error };
    return {
      data: {
        rules: (rules.data ?? []) as ScheduleRule[],
        teamDefault: asDifficulty(settings.data?.default_difficulty)
      },
      error: null
    };
  });
}

// One-off changes between two dates: a cancelled night, an extra one, and a
// title for one date (#1478), keyed by date.
export type ScheduleChanges = { changes: ScheduleChange[]; titles: Record<string, string> };

export function useScheduleChanges(teamId: number, from: string, to: string) {
  return useSupabaseQuery<ScheduleChanges>(['calendar-changes', teamId, from, to], async (client) => {
    const [changes, titles] = await Promise.all([
      // team-read-guard: one-off changes inside a date window, a few a month
      client
        .from('raid_schedule_exceptions')
        .select('id, raid_date, exception_type, start_time, duration_minutes, is_optional, note, difficulty')
        .eq('team_id', teamId)
        .gte('raid_date', from)
        .lte('raid_date', to)
        .order('raid_date'),
      // team-read-guard: renamed nights inside a date window, a few a month
      client
        .from('raid_night_titles')
        .select('raid_date, title')
        .eq('team_id', teamId)
        .gte('raid_date', from)
        .lte('raid_date', to)
    ]);
    const error = changes.error ?? titles.error;
    if (error) return { data: null, error };
    return {
      data: {
        changes: (changes.data ?? []) as ScheduleChange[],
        titles: Object.fromEntries((titles.data ?? []).map((t) => [t.raid_date, t.title]))
      },
      error: null
    };
  });
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
    const { data, error } = await readAll<Answer>((start, end) =>
      client
        .from('raid_rsvps')
        .select('player_id, raid_date, status, note, updated_at')
        .eq('team_id', teamId)
        .gte('raid_date', from)
        .lte('raid_date', to)
        .order('raid_date')
        .order('player_id')
        .range(start, end)
    );
    return { data: (data ?? []) as Answer[], error };
  }
  const [team, own] = await Promise.all([
    client.rpc('team_rsvp_answers', { p_team_id: teamId, p_from: from, p_to: to }),
    access.playerIds.length
      ? // team-read-guard: the signed-in user's own characters over a date window
        client
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

// The Discord bot keeps the signup sheet current. A failed call does not undo
// the answer, which is already saved.
async function tellBot(client: Client, body: Record<string, unknown>) {
  try {
    await client.functions.invoke('discord-bot-webhook', { body });
  } catch {
    // The answer is saved either way.
  }
}

const refreshes = (teamId: number) => [answersKey(teamId), ['calendar-month', teamId]];

export type OwnAnswer = { date: string; status: string | null; note: string; teamKey: string };

// The reader's own answer. A null status goes back to the default.
// set_own_rsvp() queues the RSVP change for Discord itself (#962).
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
      await tellBot(client, { action: 'signupSheetSync', team: a.teamKey, teamId, payload: { raidDate: a.date } });
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
      await tellBot(client, { action: 'signupSheetSync', team: a.teamKey, teamId, payload: { raidDate: a.date } });
      return { data: null, error: null };
    },
    { key: ['officer-set-answer', teamId], refreshes: refreshes(teamId) }
  );
}

// Boss lineups (#1216)

export const lineupKey = (teamId: number) => ['boss-lineup', teamId] as const;

// The seasons a team sees, oldest first (started ones plus the next,
// visibleSeasons()), and every boss the progression sync has loaded. Both
// are small lookups every visitor can read.
export function useSeasons() {
  return useSupabaseQuery<SeasonRow[]>(['seasons'], async (client) => {
    const { data, error } = await client
      .from('seasons')
      .select('code, display_name, starts_at, ends_at')
      .order('starts_at', { nullsFirst: false })
      .order('position');
    return error ? { data: null, error } : { data: visibleSeasons(data ?? []), error: null };
  });
}

export function useEncounters() {
  return useSupabaseQuery<EncounterRow[]>(['raid-encounters'], (client) =>
    client
      .from('raid_encounters')
      .select(
        'id, name, sort_index, cap, wcl_encounter_id, zone:raid_zones!inner(id, name, season, is_mini_raid, sort_index)'
      )
      .order('id')
  );
}

// Each raider's pick on a boss (#1580), with the alt's row: a teammate reads an
// alt picked for their team, an officer every alt on it.
const PICK_COLUMNS = 'character_id, class_spec_id, character:characters(id, name, class_name, spec_name)';

// One night's plan: its bosses and who is in for each, on one half.
export type NightPlan = { bosses: NightBossRow[]; places: PlaceRow[] };

export function useNightPlan(teamId: number, date: string, plan: Plan) {
  return useSupabaseQuery<NightPlan>([...lineupKey(teamId), 'night', date, plan], async (client) => {
    const [bosses, places] = await Promise.all([
      // team-read-guard: one raid night, one row per boss
      client
        .from('raid_night_bosses')
        .select('raid_date, encounter_id, position, skipped, skipped_for_kill_id, confirmed_at')
        .eq('team_id', teamId)
        .eq('raid_date', date)
        .eq('plan', plan)
        .order('position'),
      // team-read-guard: one raid night, one row per boss and raider in the lineup, a few hundred at most
      client
        .from('raid_night_lineups')
        .select(`encounter_id, player_id, ${PICK_COLUMNS}`)
        .eq('team_id', teamId)
        .eq('raid_date', date)
        .eq('plan', plan)
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

// The team's usual group for every boss, with each raider's name so the Boss
// groups page can name someone who left the roster but is still in a group.
export function useBossGroups(teamId: number, plan: Plan) {
  return useSupabaseQuery<LeaverRow[]>([...lineupKey(teamId), 'groups', plan], (client) =>
    // team-read-guard: one row per boss and raider in the usual groups, a few hundred at most
    client
      .from('boss_groups')
      .select(`encounter_id, player_id, ${PICK_COLUMNS}, player:players(name_realm, nickname)`)
      .eq('team_id', teamId)
      .eq('plan', plan)
      .order('id')
  );
}

// Every boss on the team's coming raid nights, on one plan's half, for what a
// group save changes.
export function useComingNights(teamId: number, today: string, plan: Plan) {
  return useSupabaseQuery<ComingBossRow[]>([...lineupKey(teamId), 'coming', today, plan], (client) =>
    // team-read-guard: coming nights that already have a boss plan, one row per boss
    client
      .from('raid_night_bosses')
      .select('raid_date, encounter_id, skipped, confirmed_at')
      .eq('team_id', teamId)
      .eq('plan', plan)
      .gte('raid_date', today)
      .order('raid_date')
      .order('position')
  );
}

export type BossSave = {
  encounterId: number;
  players: number[];
  // What the page last read, so a save made after someone else's is refused.
  expected: number[];
  // Who plays another character or spec (#1580), and what was read.
  picks: PickRow[];
  expectedPicks: PickRow[];
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

// Save, "Just this night": each changed boss's lineup for the night, one boss at a time,
// so two officers on different bosses never get in each other's way.
export function useSaveNight(teamId: number, date: string, plan: Plan) {
  return useSupabaseMutation<SaveResult, BossSave[]>(
    (client, saves) =>
      saveEach(saves, (s) =>
        client.rpc('set_raid_night_lineup', {
          p_team_id: teamId,
          p_raid_date: date,
          p_encounter_id: s.encounterId,
          p_player_ids: s.players,
          p_expected_player_ids: s.expected,
          p_picks: s.picks,
          p_expected_picks: s.expectedPicks,
          p_plan: plan
        })
      ),
    { key: ['save-night', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// Save, "this night and every night after": tonight first, for each boss changed tonight, then the
// usual groups. That order matters: a group save also rewrites coming nights
// nobody has saved for that boss, and tonight is saved by then, so it keeps
// what the officer set.
export type GroupSave = { night: BossSave[]; groups: BossSave[] };

export function useSaveGroups(teamId: number, date: string, plan: Plan) {
  return useSupabaseMutation<SaveResult, GroupSave>(
    async (client, s) => {
      const night = await saveEach(s.night, (b) =>
        client.rpc('set_raid_night_lineup', {
          p_team_id: teamId,
          p_raid_date: date,
          p_encounter_id: b.encounterId,
          p_player_ids: b.players,
          p_expected_player_ids: b.expected,
          p_picks: b.picks,
          p_expected_picks: b.expectedPicks,
          p_plan: plan
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
            p_expected_player_ids: b.expected,
            p_picks: b.picks,
            p_expected_picks: b.expectedPicks,
            p_plan: plan
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

// The team's order for raiders within each role section (#1683): player id to
// place. A section with nothing here is A-Z.
export function useRaiderOrder(teamId: number) {
  return useSupabaseQuery<RaiderOrder>([...lineupKey(teamId), 'raider-order'], async (client) => {
    // team-read-guard: at most one row per raider on the team, far under the
    // 1000-row page.
    const { data, error } = await client
      .from('team_raider_order')
      .select('player_id, role, position')
      .eq('team_id', teamId);
    return error
      ? { data: null, error }
      : {
          data: new Map((data ?? []).map((r) => [r.player_id, { role: r.role as Role, position: r.position }])),
          error: null
        };
  });
}

// One section's order, saved the moment a raider is moved; an empty list puts
// the section back to A-Z.
export function useSaveRaiderOrder(teamId: number) {
  return useSupabaseMutation<null, { role: Role; playerIds: number[] }>(
    async (client, s) => {
      const { error } = await client.rpc('set_lineup_raider_order', {
        p_team_id: teamId,
        p_role: s.role,
        p_player_ids: s.playerIds
      });
      return { data: null, error };
    },
    { key: ['save-raider-order', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// "Save groups" on the Boss groups page: each changed boss's usual group, one
// boss at a time, like a night's save.
export function useSaveBossGroups(teamId: number, plan: Plan) {
  return useSupabaseMutation<SaveResult, BossSave[]>(
    (client, saves) =>
      saveEach(saves, (s) =>
        client.rpc('set_boss_group', {
          p_team_id: teamId,
          p_encounter_id: s.encounterId,
          p_player_ids: s.players,
          p_expected_player_ids: s.expected,
          p_picks: s.picks,
          p_expected_picks: s.expectedPicks,
          p_plan: plan
        })
      ),
    { key: ['save-boss-groups', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// A night's pull order (#1679): every boss on it, first pull first; with
// everyNight, also the team's order, and every coming night follows it.
export type OrderSave = { order: number[]; expected: number[]; everyNight: boolean };

export function useSaveOrder(teamId: number, date: string, plan: Plan) {
  return useSupabaseMutation<null, OrderSave>(
    async (client, s) => {
      const { error } = await client.rpc('set_raid_night_boss_order', {
        p_team_id: teamId,
        p_raid_date: date,
        p_encounter_ids: s.order,
        p_expected_ids: s.expected,
        p_every_night: s.everyNight,
        p_plan: plan
      });
      return { data: null, error };
    },
    { key: ['save-order', teamId], refreshes: [lineupKey(teamId)] }
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
export function useSkipBoss(teamId: number, date: string, plan: Plan) {
  return useSupabaseMutation<undefined, { encounterId: number; skipped: boolean }>(
    (client, s) =>
      client.rpc('set_raid_night_boss_skipped', {
        p_team_id: teamId,
        p_raid_date: date,
        p_encounter_id: s.encounterId,
        p_skipped: s.skipped,
        p_plan: plan
      }),
    { key: ['skip-boss', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// A team's tanks-wanted and healers-wanted counts for the lineup's "Needs a
// look" check (#1244), and each boss's own (#1682). A team with no row yet
// uses today's default.
export function useLineupRoleTargets(teamId: number) {
  return useSupabaseQuery<RoleTargets>([...lineupKey(teamId), 'role-targets'], async (client) => {
    const [team, bosses] = await Promise.all([
      client.from('team_lineup_settings').select('tanks_wanted, healers_wanted').eq('team_id', teamId).maybeSingle(),
      // team-read-guard: one row per boss with its own targets, at most the
      // raid list's bosses, far under the 1000-row page.
      client.from('team_boss_role_targets').select('encounter_id, tanks, healers, melee, ranged').eq('team_id', teamId)
    ]);
    const error = team.error ?? bosses.error;
    if (error) return { data: null, error };
    const base = team.data
      ? { tanks: team.data.tanks_wanted, healers: team.data.healers_wanted }
      : DEFAULT_ROLE_TARGETS;
    return {
      data: { ...base, bosses: new Map((bosses.data ?? []).map(({ encounter_id, ...own }) => [encounter_id, own])) },
      error: null
    };
  });
}

// One boss's standing targets (#1682), saved the moment an officer presses
// - or +; all null puts the boss back on the team's targets.
export function useSetBossTargets(teamId: number) {
  return useSupabaseMutation<void, { encounterId: number; targets: BossTargets }>(
    (client, s) =>
      client.rpc('set_boss_role_targets', {
        p_team_id: teamId,
        p_encounter_id: s.encounterId,
        ...(s.targets.tanks !== null && { p_tanks: s.targets.tanks }),
        ...(s.targets.healers !== null && { p_healers: s.targets.healers }),
        ...(s.targets.melee !== null && { p_melee: s.targets.melee }),
        ...(s.targets.ranged !== null && { p_ranged: s.targets.ranged })
      }),
    { key: ['save-boss-targets', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// The Boss groups page's "Role targets" editor.
export function useSetLineupRoleTargets(teamId: number) {
  return useSupabaseMutation<void, RoleTargets>(
    (client, targets) =>
      client.rpc('set_lineup_role_targets', { p_team_id: teamId, p_tanks: targets.tanks, p_healers: targets.healers }),
    { key: ['save-role-targets', teamId], refreshes: [lineupKey(teamId)] }
  );
}

// A boss's cap override (#1244): a flex fight like Nymrissa Wavecaller or
// Kith'ix that allows more than the raid's own cap. Blizzard's number, the same
// for every guild, so a site admin's to set (#1324); null clears the override
// back to the raid's cap.
export function useSetEncounterCap() {
  return useSupabaseMutation<void, { encounterId: number; cap: number | null }>(
    // p_cap is optional (default null): omitting it, rather than sending a
    // literal null, is how a clear reaches the same place through Postgrest's
    // generated arg type.
    (client, s) =>
      client.rpc('set_encounter_cap', {
        p_encounter_id: s.encounterId,
        ...(s.cap !== null && { p_cap: s.cap })
      }),
    { key: ['set-encounter-cap'], refreshes: [['raid-encounters']] }
  );
}

// Each officer's Boss Lineup cell style (#1681): Names unless they picked
// Solid bars. One account_preferences row per account, guild-wide.
export type CellStyle = 'names' | 'bars';
const cellStyleKey = (userId: string | null) => ['lineup-cell-style', userId] as const;

export function useCellStyle() {
  const { user } = useSession();
  return useSupabaseQuery<CellStyle>(
    cellStyleKey(user?.id ?? null),
    async (client) => {
      const { data, error } = await client
        .from('account_preferences')
        .select('value')
        .eq('auth_user_id', user!.id)
        .is('team_id', null)
        .eq('key', 'lineup_cell_style')
        .maybeSingle();
      if (error) return { data: null, error };
      return { data: data?.value === 'bars' ? 'bars' : 'names', error: null };
    },
    { enabled: user !== null }
  );
}

export function useSaveCellStyle() {
  const { user } = useSession();
  return useSupabaseMutation<null, CellStyle>(
    async (client, style) => {
      const { error } = await client
        .from('account_preferences')
        .upsert(
          { auth_user_id: user!.id, team_id: null, key: 'lineup_cell_style', value: style },
          { onConflict: 'auth_user_id,team_id,key' }
        );
      return { data: null, error };
    },
    { key: ['save-cell-style'], refreshes: [cellStyleKey(user?.id ?? null)] }
  );
}
