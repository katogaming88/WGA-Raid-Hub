// The production SheetDb (#960): supabase-js as the service role. The sheet
// tables are no signed-in user's to read; discord-bot-webhook and
// discord-interactions each hand over their own service client.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Night, SheetDb, SheetSetting, TeamSheets } from './signup-sheet.ts';

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function sheetDb(client: () => SupabaseClient<any>): SheetDb {
  async function teams(teamId: number | null): Promise<TeamSheets[]> {
    let query = client()
      .from('team_discord_signup_sheets')
      .select('id, team_id, channel_id, raid_days, keep_raids_posted, hours_before, ping_role_id');
    if (teamId !== null) query = query.eq('team_id', teamId);
    const rows = (must(await query, 'team_discord_signup_sheets') as any[] | null) ?? [];
    if (rows.length === 0) return [];
    const ids = [...new Set(rows.map((r) => r.team_id as number))];
    const configs =
      (must(
        await client()
          .from('team_discord_config')
          .select('team_id, guild_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, teams(name, slug)')
          .in('team_id', ids),
        'team_discord_config'
      ) as any[] | null) ?? [];
    return configs
      .filter((c) => c.guild_id)
      .map((c) => ({
        team: {
          id: c.team_id,
          name: c.teams?.name ?? `Team ${c.team_id}`,
          slug: c.teams?.slug ?? '',
          serverId: c.guild_id,
          quietHours: c.quiet_hours_start
            ? { start: c.quiet_hours_start, end: c.quiet_hours_end, timezone: c.quiet_hours_timezone }
            : null
        },
        sheets: rows
          .filter((r) => r.team_id === c.team_id)
          .map((r): SheetSetting => ({
            id: r.id,
            channelId: r.channel_id,
            raidDays: r.raid_days,
            keepRaidsPosted: r.keep_raids_posted,
            hoursBefore: r.hours_before,
            pingRoleId: r.ping_role_id
          }))
      }));
  }

  return {
    allSheets: () => teams(null),
    async teamSheets(teamId) {
      return (await teams(teamId))[0] ?? null;
    },
    async night(teamId, raidDate): Promise<Night> {
      const rows = must(
        await client().rpc('raid_night_info', { p_team_id: teamId, p_raid_date: raidDate }),
        'raid_night_info'
      ) as any[] | null;
      const row = rows?.[0];
      return {
        exists: !!row?.exists,
        startTime: row?.start_time ?? null,
        timezone: row?.timezone ?? null,
        isOptional: !!row?.is_optional
      };
    },
    async roster(teamId) {
      const rows = must(
        await client()
          .from('players')
          .select('id, name_realm, nickname, is_bench, classes_specs(role)')
          .eq('team_id', teamId)
          .is('archived_at', null),
        'players'
      ) as any[] | null;
      return (rows ?? []).map((p) => ({
        id: p.id,
        nameRealm: p.name_realm,
        nickname: p.nickname,
        isBench: !!p.is_bench,
        role: p.classes_specs?.role ?? null
      }));
    },
    async rsvps(teamId, raidDate) {
      const rows = must(
        await client().from('raid_rsvps').select('player_id, status').eq('team_id', teamId).eq('raid_date', raidDate),
        'raid_rsvps'
      ) as any[] | null;
      return (rows ?? []).map((r) => ({ playerId: r.player_id, status: r.status }));
    },
    async postedMessage(teamId, raidDate) {
      const row = must(
        await client()
          .from('raid_signup_sheets')
          .select('message_id')
          .eq('team_id', teamId)
          .eq('raid_date', raidDate)
          .maybeSingle(),
        'raid_signup_sheets'
      ) as { message_id: string | null } | null;
      return row?.message_id ?? null;
    },
    async claim(teamId, raidDate, channelId) {
      const rows = must(
        await client().rpc('claim_raid_signup_sheet', {
          p_team_id: teamId,
          p_raid_date: raidDate,
          p_channel_id: channelId
        }),
        'claim_raid_signup_sheet'
      ) as { message_id: string | null }[] | null;
      return rows?.[0]?.message_id ?? null;
    },
    async saveMessage(teamId, raidDate, messageId) {
      must(
        await client()
          .from('raid_signup_sheets')
          .update({ message_id: messageId, updated_at: new Date().toISOString() })
          .eq('team_id', teamId)
          .eq('raid_date', raidDate)
          .is('message_id', null),
        'raid_signup_sheets'
      );
    },
    async forgetMessage(teamId, raidDate, messageId) {
      must(
        await client()
          .from('raid_signup_sheets')
          .update({ message_id: null, updated_at: new Date().toISOString() })
          .eq('team_id', teamId)
          .eq('raid_date', raidDate)
          .eq('message_id', messageId),
        'raid_signup_sheets'
      );
    },
    async markPosted(sheetId) {
      const { error } = await client()
        .from('team_discord_signup_sheets')
        .update({ last_posted_at: new Date().toISOString() })
        .eq('id', sheetId);
      // "Last posted" is for the settings page; the sheet itself went out.
      if (error) console.error('signup sheet: last_posted_at not saved: ' + error.message);
    }
  };
}
