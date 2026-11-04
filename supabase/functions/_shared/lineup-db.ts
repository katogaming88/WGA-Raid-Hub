// The production LineupDb (#1709): supabase-js as the service role, like
// signup-sheet-db.ts. discord-bot-webhook and discord-interactions each hand
// over their own service client.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { LineupBoss, LineupDb, TeamLineup } from './lineup-post.ts';
import { sheetDb } from './signup-sheet-db.ts';

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

export function lineupDb(client: () => SupabaseClient<any>): LineupDb {
  const sheets = sheetDb(client);

  async function lineups(teamId: number | null): Promise<TeamLineup[]> {
    let query = client()
      .from('team_discord_posts')
      .select('team_id, channel_id, ping_role_id, post_weekday, post_time, post_timezone')
      .eq('kind', 'weekly_lineup')
      .not('channel_id', 'is', null);
    if (teamId !== null) query = query.eq('team_id', teamId);
    const rows = (must(await query, 'team_discord_posts') as any[] | null) ?? [];
    if (rows.length === 0) return [];
    const configs =
      (must(
        await client()
          .from('team_discord_config')
          .select('team_id, guild_id, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, teams(name, slug)')
          .in(
            'team_id',
            rows.map((r) => r.team_id)
          ),
        'team_discord_config'
      ) as any[] | null) ?? [];
    return rows.flatMap((r) => {
      const c = configs.find((x) => x.team_id === r.team_id);
      if (!c?.guild_id) return [];
      return [
        {
          team: {
            id: r.team_id,
            name: c.teams?.name ?? `Team ${r.team_id}`,
            slug: c.teams?.slug ?? '',
            serverId: c.guild_id,
            quietHours: c.quiet_hours_start
              ? { start: c.quiet_hours_start, end: c.quiet_hours_end, timezone: c.quiet_hours_timezone }
              : null
          },
          setting: {
            channelId: r.channel_id,
            pingRoleId: r.ping_role_id,
            weekday: r.post_weekday,
            time: r.post_time,
            timezone: r.post_timezone
          }
        }
      ];
    });
  }

  return {
    allLineups: () => lineups(null),
    async teamLineup(teamId) {
      return (await lineups(teamId))[0] ?? null;
    },
    night: sheets.night,
    roster: sheets.roster,
    async bosses(teamId, raidDate): Promise<LineupBoss[]> {
      const [bosses, lineup] = await Promise.all([
        client()
          .from('raid_night_bosses')
          .select('encounter_id, position, skipped, raid_encounters(name)')
          .eq('team_id', teamId)
          .eq('raid_date', raidDate),
        client()
          .from('raid_night_lineups')
          .select('encounter_id, player_id')
          .eq('team_id', teamId)
          .eq('raid_date', raidDate)
      ]);
      const rows = (must(bosses, 'raid_night_bosses') as any[] | null) ?? [];
      const ins = (must(lineup, 'raid_night_lineups') as any[] | null) ?? [];
      return rows
        .filter((b) => !b.skipped)
        .map((b) => ({
          name: b.raid_encounters?.name ?? `Boss ${b.encounter_id}`,
          position: b.position,
          playerIds: ins.filter((l) => l.encounter_id === b.encounter_id).map((l) => l.player_id as number)
        }))
        .sort((a, b) => a.position - b.position);
    },
    async postedLineup(teamId, weekOf) {
      const row = must(
        await client()
          .from('team_lineup_posts')
          .select('message_id')
          .eq('team_id', teamId)
          .eq('week_of', weekOf)
          .maybeSingle(),
        'team_lineup_posts'
      ) as { message_id: string } | null;
      return row?.message_id ?? null;
    },
    async saveLineup(teamId, weekOf, channelId, messageId) {
      const { error } = await client()
        .from('team_lineup_posts')
        .insert({ team_id: teamId, week_of: weekOf, channel_id: channelId, message_id: messageId });
      // Another run's post is already on record.
      if (error?.code === '23505') return false;
      if (error) throw new Error('team_lineup_posts: ' + error.message);
      return true;
    },
    async forgetLineup(teamId, weekOf, messageId) {
      must(
        await client()
          .from('team_lineup_posts')
          .delete()
          .eq('team_id', teamId)
          .eq('week_of', weekOf)
          .eq('message_id', messageId),
        'team_lineup_posts'
      );
    },
    async markPosted(teamId) {
      const { error } = await client()
        .from('team_discord_posts')
        .update({ last_posted_at: new Date().toISOString() })
        .eq('team_id', teamId)
        .eq('kind', 'weekly_lineup');
      if (error) console.error('lineup post: last_posted_at not saved: ' + error.message);
    }
  };
}
