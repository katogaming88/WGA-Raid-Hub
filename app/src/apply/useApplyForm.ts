import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { refusalOf } from '../characters/useCharacters';
import type { CharactersAnswer } from '../characters/characters';
import type { ApplicationForm, Recruiter, SpecRow } from './form';

// The form's reads and writes (#1547). Every call here is by the signed-in
// applicant for themselves; the database and the Edge Functions check it.

// team_application_form(): the questions that are on, for anyone signed in
// while the team takes applications.
export function useApplicationForm(teamId: number | undefined) {
  return useSupabaseQuery<ApplicationForm>(
    ['application-form', teamId ?? null],
    async (client) => {
      const { data, error } = await client.rpc('team_application_form', { p_team_id: teamId! });
      return { data: data as unknown as ApplicationForm, error };
    },
    { enabled: teamId !== undefined }
  );
}

// The recruiters on "Who sent you?" (#1537): public names, open to anyone.
export function useActiveRecruiters(guildKey: string) {
  return useSupabaseQuery<Recruiter[]>(['active-recruiters', guildKey], async (client) => {
    const { data, error } = await client.rpc('guild_active_recruiters', { p_guild_key: guildKey });
    return { data: (data ?? []) as Recruiter[], error };
  });
}

// A class's specs and their roles, to tell whether the team wants the picked
// character and to offer its other specs.
export function useClassSpecs(className: string | null) {
  return useSupabaseQuery<SpecRow[]>(
    ['class-specs', className],
    (client) => client.from('classes_specs').select('spec, role').eq('class', className!).order('spec'),
    { enabled: className !== null }
  );
}

// What character-stats (#1538) works out for one character. Each number can
// be null on its own; `failed` names the sources that could not be read.
export type CharacterStats = {
  item_level: number | null;
  mplus_score: number | null;
  heroic_logs: { best: number | null; median: number | null } | null;
  mythic_logs: { best: number | null; median: number | null } | null;
  mythic_bosses_killed: { killed: number; total: number } | null;
};
export type StatsAnswer = {
  failed: ('blizzard_profile' | 'mythic_keystone' | 'warcraft_logs')[];
  character: CharacterStats;
};

export function useCharacterStats() {
  return useSupabaseMutation<StatsAnswer, { token: string; blizzardId: number }>(
    async (client, v) => {
      const { data, error } = await client.functions.invoke('character-stats', {
        body: { token: v.token, character: v.blizzardId }
      });
      if (error) return { data: null, error: await refusalOf(error as { message: string; context?: unknown }) };
      return { data: data as StatsAnswer, error: null };
    },
    { key: ['character-stats'], refreshes: [] }
  );
}

export type SendInput = {
  teamId: number;
  blizzardId: number;
  // Every character already saved goes back with the pick, since the save
  // replaces the whole set (as the Join page does).
  saved: number[];
  token: string;
  answers: Record<string, string | boolean>;
  recruiterCode: string | null;
  friendName: string | null;
  otherSpecs: string[];
  timeZone: string | null;
};

// 'authorize' carries Discord's consent address; the others need no trip.
export type JoinStep = { status: 'off' | 'already_member' } | { status: 'authorize'; url: string };
export type Sent = { id: number; join: JoinStep };

// Sending, in order: save the picked character (Blizzard confirms it is theirs),
// find its saved row, send the application, ask the numbers to be kept on it,
// then ask Discord's step what to do next. A failure after the application
// exists never loses it: the join step falling over just shows no step, and My
// applications still has the application.
export function useSendApplication() {
  return useSupabaseMutation<Sent, SendInput>(
    async (client, v) => {
      const saved = await client.functions.invoke('battlenet-characters', {
        body: {
          token: v.token,
          save: v.saved.includes(v.blizzardId) ? v.saved : [...v.saved, v.blizzardId],
          allLevels: true
        }
      });
      if (saved.error)
        return { data: null, error: await refusalOf(saved.error as { message: string; context?: unknown }) };
      const row = await client.from('characters').select('id').eq('blizzard_id', v.blizzardId).maybeSingle();
      if (row.error || !row.data)
        return { data: null, error: row.error ?? { message: 'That character did not save. Try again.' } };

      const sent = await client.rpc('send_application', {
        p_team_id: v.teamId,
        p_character_id: (row.data as { id: number }).id,
        p_answers: v.answers,
        // The generated types mark every argument required; the function takes null.
        p_recruiter_code: v.recruiterCode as string,
        p_friend_name: v.friendName as string,
        p_time_zone: v.timeZone as string,
        p_other_specs: v.otherSpecs
      });
      if (sent.error) return { data: null, error: sent.error };
      const id = sent.data as unknown as number;

      // Best effort: the numbers are kept on the application, and a source
      // being down must not undo a sent application.
      await client.functions
        .invoke('character-stats', { body: { token: v.token, character: v.blizzardId, application: id } })
        .catch(() => undefined);

      const join = await client.functions.invoke('discord-join', { body: { action: 'start', application: id } });
      const answer = join.error ? null : (join.data as { status?: string; url?: string } | null);
      const step: JoinStep =
        answer?.status === 'authorize' && answer.url
          ? { status: 'authorize', url: answer.url }
          : { status: answer?.status === 'already_member' ? 'already_member' : 'off' };
      // No trip to Discord's consent screen: the ticket (or officer thread, or
      // post) can be made now. Otherwise the return page makes it.
      if (step.status !== 'authorize') await openTicket(client, id);
      return { data: { id, join: step }, error: null };
    },
    { key: ['send-application'], refreshes: [['my-applications']] }
  );
}

// recruit-ticket (#1541): what the bot makes in Discord for the application,
// by the team's setting. Calling again makes nothing new. Best effort: the
// application is sent either way, and the officers can add a recruit by hand.
async function openTicket(client: Client, application: number) {
  await client.functions.invoke('recruit-ticket', { body: { application } }).catch(() => undefined);
}

export type Finished =
  { status: 'joined' | 'already_member' | 'off' } | { status: 'failed'; reason: string; invite: string | null };

// The page Discord sends the applicant back to hands over its code, signed in
// as them (#1540).
export function useFinishDiscordJoin() {
  return useSupabaseMutation<
    Finished,
    { state: string; code: string | null; error: string | null; application: number | null }
  >(
    async (client, v) => {
      const { data, error } = await client.functions.invoke('discord-join', {
        body: v.code
          ? { action: 'finish', state: v.state, code: v.code }
          : { action: 'finish', state: v.state, error: v.error ?? 'access_denied' }
      });
      if (error) return { data: null, error: await refusalOf(error as { message: string; context?: unknown }) };
      // In the server now: the ticket can be made. A failed join asks too,
      // and is answered "not in the server" until they use the invite.
      if (v.application !== null) await openTicket(client, v.application);
      return { data: data as Finished, error: null };
    },
    { key: ['finish-discord-join'], refreshes: [['my-applications']] }
  );
}

// ---------------------------------------------------------------------------
// My applications

export type MyApplication = {
  id: number;
  team_id: number;
  team_name: string;
  team_slug: string;
  guild_key: string;
  name_realm: string;
  status: string;
  applied_at: string;
  closed_at: string | null;
  trial_starts_on: string | null;
  trial_ends_on: string | null;
  // The ticket and the Discord step (#1810).
  ticket_url: string | null;
  joined_discord: boolean;
  join_failed: boolean;
  add_to_server: boolean;
};

export function useMyApplications(enabled: boolean) {
  return useSupabaseQuery<MyApplication[]>(
    ['my-applications'],
    async (client) => {
      const { data, error } = await client.rpc('my_applications');
      return { data: (data ?? []) as unknown as MyApplication[], error };
    },
    { enabled }
  );
}

export function useWithdrawApplication() {
  return useSupabaseMutation<null, number>(
    async (client, id) => {
      const { error } = await client.rpc('withdraw_application', { p_application_id: id });
      return { data: null, error };
    },
    { key: ['withdraw-application'], refreshes: [['my-applications']] }
  );
}

// Re-exported so the form reads the characters the way the Join page does.
export type { CharactersAnswer };
