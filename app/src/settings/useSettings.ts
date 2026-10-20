import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { asResponseList, seenResponses, shownLoot, type ResponseList, type SeenResponse } from './lootResponses';
import type { Client } from '../lib/supabase';
import type { Json } from '../../../js/database.types';
import type { FullAttendanceRow } from '../attendance/attendance';
import type { PlayerRow } from '../roster/roster';
import {
  asLootSystem,
  LOOT_SYSTEMS,
  normalizeRaids,
  rosterSnapshot,
  type LootSystem,
  type Raid,
  type SettingsHistoryEntry
} from './settings';

// Officer Settings (#1357, #1103 row 1), ported from js/tabs/tab-season.js
// and js/common.js's saveTeamSetting()/writeAuditLog(). Every write goes
// through set_team_setting, which is team-leader/site-admin only by RLS; a
// plain officer's save surfaces that rejection as this mutation's own error,
// same as the current site.

async function writeAuditLog(client: Client, teamId: number, action: string, detail: string | null) {
  // Best-effort like every other page's writeAuditLog(): a failed audit log
  // entry does not undo the write it was describing.
  try {
    await client.rpc('write_audit_log', { p_team_id: teamId, p_action: action, p_detail: detail });
  } catch {
    // The write is already recorded either way.
  }
}

function setTeamSetting(client: Client, teamId: number, updates: Record<string, unknown>, skipAudit = false) {
  return client.rpc('set_team_setting', {
    p_team_id: teamId,
    p_updates: updates as unknown as Json,
    p_skip_audit: skipAudit
  });
}

// -- General -----------------------------------------------------------

export type GeneralSettings = {
  seasonView: string | null;
  trialWeeks: number;
  trialAttend: number;
  targetTankCount: number | null;
  targetHealCount: number | null;
  warcraftLogsUrl: string;
  discordSignupChannelId: string | null;
  signupSheetLeadHours: number | null;
};

const generalKey = (teamId: number) => ['general-settings', teamId] as const;

export function useGeneralSettings(teamId: number) {
  return useSupabaseQuery<GeneralSettings>(generalKey(teamId), async (client) => {
    const result = await client
      .from('team_settings')
      .select(
        'seasonView:config->>seasonView, trialWeeks:config->trialWeeks, trialAttend:config->trialAttend, targetTankCount:config->targetTankCount, targetHealCount:config->targetHealCount, warcraftLogsUrl:config->externalLinks->>warcraftLogsUrl, discordSignupChannelId:config->>discordSignupChannelId, signupSheetLeadHours:config->signupSheetLeadHours'
      )
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const row = (result.data ?? {}) as Partial<GeneralSettings>;
    return {
      data: {
        seasonView: row.seasonView ?? null,
        trialWeeks: row.trialWeeks ?? 4,
        trialAttend: row.trialAttend ?? 75,
        targetTankCount: row.targetTankCount ?? null,
        targetHealCount: row.targetHealCount ?? null,
        warcraftLogsUrl: row.warcraftLogsUrl ?? '',
        discordSignupChannelId: row.discordSignupChannelId ?? null,
        signupSheetLeadHours: row.signupSheetLeadHours ?? null
      },
      error: null
    };
  });
}

// populateSeasonViewOptions(): the seasons selectable as a Season View, from
// raid_zones.season -- a season becomes pickable once its raid has been added
// there, not a free-typed value.
export function useSeasonViewOptions() {
  return useSupabaseQuery<string[]>(['season-view-options'], async (client) => {
    const result = await client.from('raid_zones').select('season');
    if (result.error) return { data: null, error: result.error };
    const rows = (result.data ?? []) as { season: string | null }[];
    const seasons = [...new Set(rows.map((r) => r.season).filter((s): s is string => !!s))];
    seasons.sort();
    return { data: seasons, error: null };
  });
}

// saveSeasonView(): audited generically (no friendly entry of its own), since
// it also has to invalidate the wishlist editor's own cached read of the same
// config key.
export function useSaveSeasonView(teamId: number) {
  return useSupabaseMutation<null, string | null>(
    async (client, seasonView) => {
      const result = await setTeamSetting(client, teamId, { seasonView });
      if (result.error) return { data: null, error: result.error };
      return { data: null, error: null };
    },
    { key: ['save-season-view', teamId], refreshes: [generalKey(teamId), ['wishlist-settings', teamId]] }
  );
}

export function useSaveTrialThresholds(teamId: number) {
  return useSupabaseMutation<null, { weeks: number; attend: number }>(
    async (client, { weeks, attend }) => {
      const result = await setTeamSetting(client, teamId, { trialWeeks: weeks, trialAttend: attend }, true);
      if (result.error) return { data: null, error: result.error };
      await writeAuditLog(client, teamId, 'Trial Thresholds Set', `${weeks} wk / ${attend}%`);
      return { data: null, error: null };
    },
    { key: ['save-trial-thresholds', teamId], refreshes: [generalKey(teamId)] }
  );
}

export function useSaveRosterTargets(teamId: number) {
  return useSupabaseMutation<null, { tank: number | null; heal: number | null }>(
    async (client, { tank, heal }) => {
      const result = await setTeamSetting(client, teamId, { targetTankCount: tank, targetHealCount: heal }, true);
      if (result.error) return { data: null, error: result.error };
      await writeAuditLog(
        client,
        teamId,
        'Roster Targets Set',
        `${tank == null ? '-' : tank} tank / ${heal == null ? '-' : heal} heal`
      );
      return { data: null, error: null };
    },
    { key: ['save-roster-targets', teamId], refreshes: [generalKey(teamId), ['role-targets', teamId]] }
  );
}

export function useSaveWclUrl(teamId: number) {
  return useSupabaseMutation<null, string>(
    async (client, url) => {
      const result = await setTeamSetting(client, teamId, { externalLinks: { warcraftLogsUrl: url } }, true);
      if (result.error) return { data: null, error: result.error };
      await writeAuditLog(client, teamId, 'WarcraftLogs Guild URL Set', url);
      return { data: null, error: null };
    },
    { key: ['save-wcl-url', teamId], refreshes: [generalKey(teamId)] }
  );
}

export function useSaveDiscordSignupSheet(teamId: number) {
  return useSupabaseMutation<null, { channelId: string | null; leadHours: number | null }>(
    async (client, { channelId, leadHours }) => {
      const result = await setTeamSetting(
        client,
        teamId,
        { discordSignupChannelId: channelId, signupSheetLeadHours: leadHours },
        true
      );
      if (result.error) return { data: null, error: result.error };
      await writeAuditLog(
        client,
        teamId,
        'Discord Signup Sheet Settings Set',
        `${channelId ?? ''} / ${leadHours ?? 48}h`
      );
      return { data: null, error: null };
    },
    { key: ['save-discord-signup-sheet', teamId], refreshes: [generalKey(teamId)] }
  );
}

export type ChannelVerifyResult = { ok: true; name: string } | { ok: false; error: string };

// verifyDiscordSignupChannel(): read-only, no team-leader role required,
// unlike Save above.
export function useVerifyDiscordChannel(teamSlug: string) {
  return useSupabaseMutation<ChannelVerifyResult, string>(
    async (client, channelId) => {
      const res = await client.functions.invoke('discord-bot-webhook', {
        body: { action: 'verifyChannel', team: teamSlug, payload: { channelId } }
      });
      if (res.error) return { data: null, error: { message: res.error.message } };
      const body = res.data as ChannelVerifyResult | null;
      return {
        data: body?.ok ? body : { ok: false, error: (body as { error?: string })?.error ?? 'Channel not found.' },
        error: null
      };
    },
    { key: ['verify-discord-channel', teamSlug], refreshes: [] }
  );
}

// -- Loot (#1560) --------------------------------------------------------

const lootKey = (teamId: number) => ['loot-settings', teamId] as const;

// Loot council (#1563): the team doesn't use wishlists; officers decide in
// game from the rolls. The wishlist and priority pages step aside for it.
export function useLootCouncil(teamId: number): boolean {
  const system = useLootSettings(teamId);
  return system.isSuccess && system.data === 'council';
}

export function useLootSettings(teamId: number) {
  return useSupabaseQuery<LootSystem>(lootKey(teamId), async (client) => {
    const result = await client
      .from('team_settings')
      .select('lootSystem:config->>lootSystem')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    return { data: asLootSystem((result.data as { lootSystem?: unknown } | null)?.lootSystem), error: null };
  });
}

// Only the loot system changes: saved priority orders are left in place, so
// switching back to the Priority system shows them again unchanged.
export function useSaveLootSystem(teamId: number) {
  return useSupabaseMutation<null, LootSystem>(
    async (client, lootSystem) => {
      const result = await setTeamSetting(client, teamId, { lootSystem }, true);
      if (result.error) return { data: null, error: result.error };
      await writeAuditLog(client, teamId, 'Loot System Set', LOOT_SYSTEMS.find((s) => s.id === lootSystem)!.name);
      return { data: null, error: null };
    },
    { key: ['save-loot-system', teamId], refreshes: [lootKey(teamId)] }
  );
}

// What gets counted as loot received (#1561): the saved button list (null
// until an officer saves one) and every response the team's imports used.
// rclc_loot passes 1000 rows per team, so the read is paged.
export type LootResponses = { list: ResponseList | null; seen: SeenResponse[] };

const lootResponsesKey = (teamId: number) => ['loot-responses', teamId] as const;

export function useLootResponses(teamId: number) {
  return useSupabaseQuery<LootResponses>(lootResponsesKey(teamId), async (client) => {
    const [settings, loot] = await Promise.all([
      client.from('team_settings').select('lootResponses:config->lootResponses').eq('team_id', teamId).maybeSingle(),
      readAll<{ response: string | null }>((from, to) =>
        client.from('rclc_loot').select('response').eq('team_id', teamId).order('id').range(from, to)
      )
    ]);
    if (settings.error) return { data: null, error: settings.error };
    if (loot.error) return { data: null, error: loot.error };
    return {
      data: {
        list: asResponseList((settings.data as { lootResponses?: unknown } | null)?.lootResponses),
        seen: seenResponses(loot.data!.map((r) => r.response))
      },
      error: null
    };
  });
}

// Loot rows as every reader shows them: each award judged by its own team's
// saved list (team_settings is public to read), Not handed out and Hidden
// dropped. A team with no list keeps today's rules.
export async function countedLoot<T extends { team_id: number | null; response: string | null }>(
  client: Client,
  rows: T[]
) {
  const teamIds = [...new Set(rows.map((r) => r.team_id).filter((id): id is number => id !== null))];
  if (!teamIds.length) return { data: shownLoot(rows, new Map()), error: null };
  const settings = await client
    // team-read-guard: one row per team, a handful of teams
    .from('team_settings')
    .select('team_id, lootResponses:config->lootResponses')
    .in('team_id', teamIds);
  if (settings.error) return { data: null, error: settings.error };
  const lists = new Map(
    (settings.data as { team_id: number; lootResponses?: unknown }[]).map((s) => [
      s.team_id,
      asResponseList(s.lootResponses)
    ])
  );
  return { data: shownLoot(rows, lists), error: null };
}

// Every loot read follows the list, so a save refreshes them all.
const LOOT_READS = [['loot'], ['home-loot'], ['roster-officer-data'], ['earlier-loot']] as const;

// set_loot_responses() writes its own audit entry, and admits officers, not
// only the team leader as set_team_setting does.
export function useSaveLootResponses(teamId: number) {
  return useSupabaseMutation<null, ResponseList>(
    async (client, list) => {
      const result = await client.rpc('set_loot_responses', {
        p_team_id: teamId,
        p_responses: list as unknown as Json
      });
      if (result.error) return { data: null, error: result.error };
      return { data: null, error: null };
    },
    { key: ['save-loot-responses', teamId], refreshes: [lootResponsesKey(teamId), ...LOOT_READS] }
  );
}

// -- Raid progression ----------------------------------------------------

const progressionKey = (teamId: number) => ['progression-settings', teamId] as const;

export function useProgressionSettings(teamId: number) {
  return useSupabaseQuery<Raid[]>(progressionKey(teamId), async (client) => {
    const result = await client
      .from('team_settings')
      .select('raidProgression:config->raidProgression')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const raids = (result.data as { raidProgression?: unknown } | null)?.raidProgression;
    return { data: normalizeRaids(raids), error: null };
  });
}

export function useSaveRaidProgression(teamId: number) {
  return useSupabaseMutation<null, Raid[]>(
    async (client, raids) => {
      const result = await setTeamSetting(client, teamId, { raidProgression: raids }, true);
      if (result.error) return { data: null, error: result.error };
      await writeAuditLog(client, teamId, 'Raid Progression Saved', `${raids.length} raid(s)`);
      return { data: null, error: null };
    },
    {
      key: ['save-raid-progression', teamId],
      refreshes: [progressionKey(teamId), ['raid-progression', teamId], ['home-progression', teamId]]
    }
  );
}

// -- Season History / WCL Performance Baseline ---------------------------

export const seasonHistoryKey = (teamId: number) => ['season-history', teamId] as const;

export function useSeasonHistorySettings(teamId: number) {
  return useSupabaseQuery<SettingsHistoryEntry[]>(seasonHistoryKey(teamId), async (client) => {
    const result = await client
      .from('team_settings')
      .select('history:config->seasonHistory')
      .eq('team_id', teamId)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    const history = (result.data as { history?: unknown } | null)?.history;
    return { data: Array.isArray(history) ? (history as SettingsHistoryEntry[]) : [], error: null };
  });
}

// _checkSeasonPerfFetchedStatus(): player_wcl_season_perf has a public-read
// policy, so this is a plain count, no RPC needed.
export function useSeasonPerfFetchedCount(teamId: number, seasonCode: string | null) {
  return useSupabaseQuery<number>(
    ['season-perf-fetched-count', teamId, seasonCode],
    async (client) => {
      const result = await client
        .from('player_wcl_season_perf')
        .select('player_id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('season', seasonCode as string);
      if (result.error) return { data: null, error: result.error };
      return { data: result.count ?? 0, error: null };
    },
    { enabled: !!seasonCode }
  );
}

export type SeasonPerfResult = { updated: number; noData: number };

// fetchSeasonPerf(): once-per-season fetch of the just-archived season's WCL
// character-page performance into player_wcl_season_perf, then a best-effort
// seed of scoring.performance_score for the live season (never overwriting a
// real Commit Attendance/Performance Scores write, via ignoreDuplicates).
export function useSeasonPerfFetch(teamId: number) {
  return useSupabaseMutation<SeasonPerfResult, { season: string; zoneId: number; liveSeasonCode: string | null }>(
    async (client, { season, zoneId, liveSeasonCode }) => {
      const res = await client.functions.invoke('wcl-sync', {
        body: { action: 'fetchSeasonPerf', teamId, season, zoneId }
      });
      if (res.error) return { data: null, error: { message: res.error.message } };
      const result = res.data as
        | (SeasonPerfResult & { success: true; players: { playerId: number; bestPerfAvg: number }[] })
        | { success: false; error: string };
      if (!result.success) return { data: null, error: { message: result.error || 'Unknown error' } };

      if (liveSeasonCode && result.players?.length) {
        const rows = result.players.map((p) => ({
          team_id: teamId,
          player_id: p.playerId,
          season: liveSeasonCode,
          performance_score: p.bestPerfAvg
        }));
        await client.from('scoring').upsert(rows, { onConflict: 'player_id,season', ignoreDuplicates: true });
      }
      return { data: { updated: result.updated, noData: result.noData }, error: null };
    },
    { key: ['season-perf-fetch', teamId], refreshes: [] }
  );
}

// -- Danger zone: Close/Archive Season -----------------------------------

// executeCloseSeason(): the books are counted over the window the database
// will record as the entry's start (#1269), so team_season_start() is read
// first and the roster snapshot is built from that exact window before
// close_season() is called -- the two must agree, since a close is one-way.
export function useCloseSeason(teamId: number) {
  return useSupabaseMutation<
    SettingsHistoryEntry[],
    { code: string; tierEnd: string | null; players: PlayerRow[]; attendanceRows: FullAttendanceRow[] }
  >(
    async (client, { code, tierEnd, players, attendanceRows }) => {
      const night = await client.rpc('team_season_start', { p_team_id: teamId, p_season: code });
      if (night.error) return { data: null, error: night.error };
      const snapshot = rosterSnapshot(players, attendanceRows, {
        start: (night.data as string | null) ?? null,
        end: tierEnd
      });
      const result = await client.rpc('close_season', {
        p_team_id: teamId,
        p_season: code,
        p_roster_snapshot: snapshot
      });
      if (result.error) return { data: null, error: result.error };
      const history = (result.data as { seasonHistory?: unknown })?.seasonHistory;
      return { data: Array.isArray(history) ? (history as SettingsHistoryEntry[]) : [], error: null };
    },
    { key: ['close-season', teamId], refreshes: [seasonHistoryKey(teamId), ['roster', teamId]] }
  );
}
