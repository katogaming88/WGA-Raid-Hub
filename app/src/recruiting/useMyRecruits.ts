import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { MyRecruit } from './myRecruits';

// My recruits' reads and writes (#1550). The database answers as the signed-in
// person and only ever with their own row, so hiding the page is a courtesy.

// The caller's link code in a guild, or null when they are not a recruiter
// there (or are switched off). Also tells the sidebar whether to show the page.
export function useMyRecruiterCode(guildId: number | undefined, enabled = true) {
  return useSupabaseQuery<string | null>(
    ['my-recruiter-code', guildId ?? 0],
    async (client) => {
      const { data, error } = await client.rpc('my_recruiter_code', { p_guild_id: guildId! });
      return { data: (data ?? null) as string | null, error };
    },
    { enabled: enabled && guildId !== undefined }
  );
}

export function useMyRecruits(enabled = true) {
  return useSupabaseQuery<MyRecruit[]>(
    ['my-recruits'],
    async (client) => {
      const { data, error } = await client.rpc('my_recruits');
      return { data: (data ?? []) as unknown as MyRecruit[], error };
    },
    { enabled }
  );
}

export function useAddMyNote() {
  return useSupabaseMutation<unknown, { id: number; body: string }>(
    (client, v) => client.rpc('add_recruit_note', { p_application_id: v.id, p_body: v.body }),
    { key: ['my-recruit-note'], refreshes: [['my-recruits'], ['recruit-record']] }
  );
}
