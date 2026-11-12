import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { refusalOf } from '../characters/useCharacters';
import type { Client } from '../lib/supabase';
import {
  questionPayload,
  settingsOf,
  type OwnDraft,
  type QuestionList,
  type Settings,
  type SpecRow,
  type SpotRow,
  type StarterAnswer
} from './recruiting';

// The Recruiting settings page's reads and writes (#1548). Every call here is
// asked of the database as the signed-in officer; it refuses anyone without
// Edit recruiting on the team.

export type SavedSettings = { settings: Settings; spots: SpotRow[] };

const settingsKey = (teamId: number) => ['recruiting-settings', teamId] as const;
const questionsKey = (teamId: number) => ['recruiting-questions', teamId] as const;

export function useRecruitingSettings(teamId: number) {
  return useSupabaseQuery<SavedSettings>(settingsKey(teamId), async (client) => {
    const { data, error } = await client.rpc('team_recruiting_settings', { p_team_id: teamId });
    if (error || !data) return { data: null, error };
    const row = data as unknown as Record<string, unknown>;
    return { data: { settings: settingsOf(row), spots: (row['spots'] ?? []) as SpotRow[] }, error: null };
  });
}

export function useQuestionList(teamId: number) {
  return useSupabaseQuery<QuestionList>(questionsKey(teamId), async (client) => {
    const { data, error } = await client.rpc('team_application_questions', { p_team_id: teamId });
    return { data: data as unknown as QuestionList, error };
  });
}

// Every spec, for the spot picker: open to anyone.
export function useSpecs() {
  return useSupabaseQuery<SpecRow[]>(['class-specs-all'], (client) =>
    client.from('classes_specs').select('id, class, spec, role').order('class').order('spec')
  );
}

export type Viewer = {
  display_name: string;
  viewer_group: 'officer' | 'assistant' | 'guild_admin';
  discord_linked: boolean;
};

// Who the team's tickets would add, with whether each has linked Discord (#1814).
export function useTicketViewers(teamId: number) {
  return useSupabaseQuery<Viewer[]>(['ticket-viewers', teamId], async (client) => {
    const { data, error } = await client.rpc('team_ticket_viewers', { p_team_id: teamId });
    return { data: (data ?? []) as Viewer[], error };
  });
}

export type SaveInput = {
  teamId: number;
  changes: Partial<Settings> | null;
  spots: SpotRow[] | null;
  // Both together or neither: save_team_application_questions() takes the
  // whole list of the team's own questions, so leaving them out would delete them.
  questions: { starters: Record<string, StarterAnswer>; own: OwnDraft[] } | null;
};

// Saves what changed, a part at a time. A part that is refused stops the rest,
// and everything saved before it stays saved, so the page reads again either
// way and shows what the database holds.
export function useSaveRecruiting() {
  return useSupabaseMutation<null, SaveInput>(
    async (client, v) => {
      if (v.changes) {
        const r = await client.rpc('save_team_recruiting', { p_team_id: v.teamId, p_changes: v.changes as never });
        if (r.error) return { data: null, error: r.error };
      }
      if (v.spots) {
        const r = await client.rpc('set_team_recruiting_spots', { p_team_id: v.teamId, p_spots: v.spots as never });
        if (r.error) return { data: null, error: r.error };
      }
      if (v.questions) {
        const r = await client.rpc('save_team_application_questions', {
          p_team_id: v.teamId,
          p_starters: v.questions.starters as never,
          p_questions: questionPayload(v.questions.own) as never
        });
        if (r.error) return { data: null, error: r.error };
      }
      return { data: null, error: null };
    },
    {
      key: ['save-recruiting'],
      refreshes: [
        ['recruiting-settings'],
        ['recruiting-questions'],
        ['ticket-viewers'],
        ['team-recruits'],
        ['recruiting-page']
      ]
    }
  );
}

// ---------------------------------------------------------------------------
// Find my ticket (#1542): one message per Discord server, posted by the bot
// where the officer picks. Its own action, not part of Save, since it posts in
// Discord at once.

async function findTicket<T>(client: Client, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke('discord-settings', {
    body: { action: 'find_ticket', ...body }
  });
  if (error) return { data: null, error: await refusalOf(error as { message: string; context?: unknown }) };
  return { data: data as T, error: null };
}

export function useFindTicketChannel(teamId: number, enabled: boolean) {
  return useSupabaseQuery<{ channelId: string | null }>(
    ['find-ticket', teamId],
    (client) => findTicket<{ channelId: string | null }>(client, { teamId }),
    { enabled }
  );
}

export function useSetFindTicketChannel(teamId: number) {
  return useSupabaseMutation<{ channelId: string | null }, string | null>(
    (client, channelId) => findTicket<{ channelId: string | null }>(client, { teamId, channelId }),
    { key: ['set-find-ticket', teamId], refreshes: [['find-ticket', teamId]] }
  );
}
