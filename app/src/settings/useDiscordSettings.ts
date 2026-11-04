import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { refusalOf } from '../characters/useCharacters';
import type { DiscordRead, DiscordSettings, PostKind } from './discord';

// The generated types mark every function argument as non-null; these
// functions take null on purpose (no channel is off, no role is no ping).
const orNull = <T>(value: T | null) => value as T;

const settingsKey = (teamId: number) => ['discord-settings', teamId] as const;
const serverKey = (teamId: number) => ['discord-server', teamId] as const;

// The team's saved Discord settings (#1712), for whoever may change them.
export function useDiscordSettings(teamId: number) {
  return useSupabaseQuery<DiscordSettings>(settingsKey(teamId), async (client) => {
    const result = await client.rpc('team_discord_settings', { p_team_id: teamId });
    return { data: (result.data as DiscordSettings | null) ?? null, error: result.error };
  });
}

async function invoke<T>(client: Client, body: Record<string, unknown>) {
  const { data, error } = await client.functions.invoke('discord-settings', { body });
  if (error) return { data: null, error: await refusalOf(error as { message: string; context?: unknown }) };
  return { data: data as T, error: null };
}

// What Discord says now (#994): the servers this officer shares with the bot,
// and the team's server with its channels and roles. Read again on "Check
// again", after the server changes, and when the page opens.
export function useDiscordServer(teamId: number) {
  return useSupabaseQuery<DiscordRead>(serverKey(teamId), (client) =>
    invoke<DiscordRead>(client, { teamId, action: 'load' })
  );
}

export function useSetDiscordServer(teamId: number) {
  return useSupabaseMutation<null, string>(
    async (client, serverId) => {
      const result = await client.rpc('set_team_discord_server', { p_team_id: teamId, p_server_id: serverId });
      return { data: null, error: result.error };
    },
    { key: ['set-discord-server', teamId], refreshes: [settingsKey(teamId), serverKey(teamId)] }
  );
}

export function useSetDiscordPost(teamId: number) {
  return useSupabaseMutation<null, { kind: PostKind; channelId: string | null; roleId: string | null }>(
    async (client, { kind, channelId, roleId }) => {
      const result = await client.rpc('set_team_discord_post', {
        p_team_id: teamId,
        p_kind: kind,
        p_channel_id: orNull(channelId),
        p_ping_role_id: orNull(roleId)
      });
      return { data: null, error: result.error };
    },
    { key: ['set-discord-post', teamId], refreshes: [settingsKey(teamId)] }
  );
}

// The weekly lineup post (#1709): no channel turns it off.
export type LineupDraft = {
  channelId: string | null;
  roleId: string | null;
  weekday: number;
  time: string;
  timezone: string;
};

export function useSetWeeklyLineup(teamId: number) {
  return useSupabaseMutation<null, LineupDraft>(
    async (client, draft) => {
      const result = await client.rpc('set_team_weekly_lineup_post', {
        p_team_id: teamId,
        p_channel_id: orNull(draft.channelId),
        p_ping_role_id: orNull(draft.roleId),
        p_weekday: draft.weekday,
        p_time: draft.time,
        p_timezone: draft.timezone
      });
      return { data: null, error: result.error };
    },
    { key: ['set-weekly-lineup', teamId], refreshes: [settingsKey(teamId)] }
  );
}

export type SheetDraft = {
  id: number | null;
  channelId: string;
  days: number[];
  keep: number | null;
  hours: number | null;
  roleId: string | null;
};

export function useSaveSignupSheet(teamId: number) {
  return useSupabaseMutation<null, SheetDraft>(
    async (client, sheet) => {
      const result = await client.rpc('save_team_discord_signup_sheet', {
        p_team_id: teamId,
        p_sheet_id: orNull(sheet.id),
        p_channel_id: sheet.channelId,
        p_raid_days: sheet.days,
        p_keep_raids_posted: orNull(sheet.keep),
        p_hours_before: orNull(sheet.hours),
        p_ping_role_id: orNull(sheet.roleId)
      });
      return { data: null, error: result.error };
    },
    { key: ['save-signup-sheet', teamId], refreshes: [settingsKey(teamId)] }
  );
}

export function useRemoveSignupSheet(teamId: number) {
  return useSupabaseMutation<null, number>(
    async (client, sheetId) => {
      const result = await client.rpc('remove_team_discord_signup_sheet', { p_team_id: teamId, p_sheet_id: sheetId });
      return { data: null, error: result.error };
    },
    { key: ['remove-signup-sheet', teamId], refreshes: [settingsKey(teamId)] }
  );
}

// null turns quiet hours off.
export function useSetQuietHours(teamId: number) {
  return useSupabaseMutation<null, { start: string; end: string; timezone: string } | null>(
    async (client, hours) => {
      const result = await client.rpc('set_team_discord_quiet_hours', {
        p_team_id: teamId,
        p_start: orNull(hours?.start ?? null),
        p_end: orNull(hours?.end ?? null),
        p_timezone: orNull(hours?.timezone ?? null)
      });
      return { data: null, error: result.error };
    },
    { key: ['set-quiet-hours', teamId], refreshes: [settingsKey(teamId)] }
  );
}

// A test message in a channel of the team's saved server, pinging nobody.
export function useSendTestMessage(teamId: number) {
  return useSupabaseMutation<null, { channelId: string; kind: PostKind | 'signup_sheet' }>(
    async (client, { channelId, kind }) => {
      const result = await invoke<unknown>(client, { teamId, action: 'test', channelId, kind });
      return { data: null, error: result.error };
    },
    { key: ['discord-test', teamId], refreshes: [] }
  );
}
