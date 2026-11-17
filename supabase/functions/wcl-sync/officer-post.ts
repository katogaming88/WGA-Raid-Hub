// #1847: after the hourly run, the bot posts each new raid night's attendance
// problems to the team's officer channel, once, and later runs edit that post
// as officers set statuses, down to "all set" (Kat, 2026-11-16).
//
// * Only nights from the last week post, so the backlog already waiting
//   never floods the channel when this turns on.
// * Each line is the reason the site's Needs a look list shows (#1846).
// * No officer channel, or a local stack: no post. Names are plain text and
//   nothing is pinged.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { isProductionStack } from '../_shared/discord-destination.ts';
import { truncate } from '../_shared/discord-text.ts';

export const ALL_SET = 'all set';
export const NEW_NIGHT_DAYS = 7;
const API = 'https://discord.com/api/v10';
const CALL_TIMEOUT_MS = 10_000;
const COLOR = 0x5b9cf5;
// Discord's cap on an embed description.
const DESCRIPTION_MAX = 4096;
const LATE_FLAG = 'WCL (Late?)';
const ABSENT_FLAG = 'WCL (Absent?)';

type Io = { fetch: typeof fetch; env(name: string): string | undefined };
export type PostItem = { name: string; reason: string };
export type Night = { date: string; items: PostItem[]; strangers: string[] };

// "Tue Nov 10" for YYYY-MM-DD, the calendar day as written.
export function nightLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
    .format(new Date(date + 'T00:00:00Z'))
    .replace(',', '');
}

const capitalized = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function contentKey(night: Night): string {
  return night.items.length ? JSON.stringify([night.items, night.strangers]) : ALL_SET;
}

// The message for one night: what needs a look, or that it is all set.
export function postBody(night: Night, link: string | null) {
  const label = nightLabel(night.date);
  const open = link ? `\n[Open Attendance](${link})` : '';
  if (!night.items.length) {
    return {
      embeds: [
        {
          title: `Attendance, ${label}: all set`,
          description: 'Every item has a status.' + open,
          color: COLOR
        }
      ],
      allowed_mentions: { parse: [] }
    };
  }
  const lines = night.items.map((i) => `**${i.name}**: ${i.reason}`);
  if (night.strangers.length) {
    lines.push(`In the log but not on the roster: ${night.strangers.map(capitalized).join(', ')}.`);
  }
  const tail = '\nScores are waiting on these.' + open;
  return {
    embeds: [
      {
        title: `Attendance, ${label}: ${night.items.length} need${night.items.length === 1 ? 's' : ''} a look`,
        description: truncate(lines.join('\n'), DESCRIPTION_MAX - tail.length) + tail,
        color: COLOR
      }
    ],
    allowed_mentions: { parse: [] }
  };
}

function check<T>({ data, error }: { data: T; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data;
}

// Every row, a page at a time: PostgREST stops at 1000 without an error.
async function readAll(
  page: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>
): Promise<any[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    const got = check(await page(from, from + 999)) ?? [];
    rows.push(...got);
    if (got.length < 1000) return rows;
  }
}

// The first boss, in pull order and not skipped, each raider was lined up for
// that night, by player id: the site's firstLineupBoss().
async function firstBosses(supabase: SupabaseClient<any>, teamId: number, date: string) {
  const bosses = check(
    await supabase
      .from('raid_night_bosses')
      .select('encounter_id, position, skipped, raid_encounters(name)')
      .eq('team_id', teamId)
      .eq('raid_date', date)
  ) as any[];
  const order = new Map<number, { position: number; name: string }>();
  for (const b of bosses || []) {
    if (!b.skipped) order.set(b.encounter_id, { position: b.position, name: b.raid_encounters?.name ?? '' });
  }
  const first = new Map<number, { position: number; name: string }>();
  if (!order.size) return first;
  const places = check(
    await supabase
      .from('raid_night_lineups')
      .select('encounter_id, player_id')
      .eq('team_id', teamId)
      .eq('raid_date', date)
  ) as any[];
  for (const p of places || []) {
    const boss = order.get(p.encounter_id);
    const seen = first.get(p.player_id);
    if (boss && (!seen || boss.position < seen.position)) first.set(p.player_id, boss);
  }
  return first;
}

// What each night lists, the way the site's needsALook() words it.
async function readNights(
  supabase: SupabaseClient<any>,
  teamId: number,
  dates: string[],
  flagged: any[]
): Promise<Night[]> {
  const players = (await readAll((from, to) =>
    supabase
      .from('players')
      .select('id, name_realm, nickname')
      .eq('team_id', teamId)
      .is('archived_at', null)
      .order('id')
      .range(from, to)
  )) as Array<{ id: number; name_realm: string; nickname: string | null }>;
  const nameOf = new Map(players.map((p) => [p.id, p.nickname?.trim() || p.name_realm.split('-')[0]!.trim()]));
  const nights: Night[] = [];
  for (const date of dates) {
    const rows = flagged.filter((r) => r.raid_date === date && nameOf.has(r.player_id));
    // One night per call: an answer holds at most one row per team player (#1861).
    const rsvps = rows.some((r) => r.source === ABSENT_FLAG)
      ? (check(await supabase.rpc('attendance_rsvps_before_start', { p_team_id: teamId, p_dates: [date] })) as any[])
      : [];
    const tentative = new Set((rsvps || []).filter((r) => r.status === 'Tentative').map((r) => r.player_id));
    const bosses = rows.some((r) => r.source === LATE_FLAG) ? await firstBosses(supabase, teamId, date) : new Map();
    const items = rows
      .map((r) => {
        const boss = bosses.get(r.player_id)?.name;
        const reason =
          r.source === LATE_FLAG
            ? boss
              ? `Missed ${boss}, the first boss they were in the lineup for.`
              : 'Missed the first pull.'
            : tentative.has(r.player_id)
              ? 'Said Tentative in the Calendar, not in the log.'
              : 'On the roster, not in the log.';
        return { name: nameOf.get(r.player_id)!, reason };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const strangers = (
      check(
        await supabase
          .from('attendance_log_names')
          .select('character_name')
          .eq('team_id', teamId)
          .eq('raid_date', date)
          .order('character_name')
      ) as any[]
    ).map((n) => n.character_name as string);
    nights.push({ date, items, strangers });
  }
  return nights;
}

export type PostResult = { posted: number; edited: number } | 'local' | 'no channel';

// Brings the team's night posts up to date after a run.
export async function postAttendanceProblems(
  supabase: SupabaseClient<any>,
  io: Io,
  teamId: number,
  now: Date
): Promise<PostResult> {
  if (!isProductionStack({ get: io.env })) return 'local';
  const token = io.env('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
  const config = check(
    await supabase
      .from('team_discord_config')
      .select('guild_id, officer_channel_id')
      .eq('team_id', teamId)
      .maybeSingle()
  ) as { guild_id: string | null; officer_channel_id: string | null } | null;
  const channelId = config?.officer_channel_id;
  if (!channelId) return 'no channel';

  const seasonStart = check(await supabase.rpc('team_season_start', { p_team_id: teamId })) as string | null;
  const since = new Date(now.getTime() - NEW_NIGHT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const from = seasonStart && seasonStart > since ? seasonStart : since;
  const [flagged, posts] = await Promise.all([
    readAll((f, t) => {
      const q = supabase
        .from('attendance')
        .select('id, player_id, raid_date, source')
        .eq('team_id', teamId)
        .is('status', null)
        .in('source', [LATE_FLAG, ABSENT_FLAG])
        .eq('report_excluded', false);
      return (seasonStart ? q.gte('raid_date', seasonStart) : q).order('id').range(f, t);
    }),
    // Every post this season, all set ones too, so a night that needs a
    // look again edits its own post rather than posting a second
    // (CodeRabbit on PR #1862).
    readAll((f, t) => {
      const q = supabase
        .from('team_attendance_posts')
        .select('raid_date, channel_id, message_id, content_key')
        .eq('team_id', teamId);
      return (seasonStart ? q.gte('raid_date', seasonStart) : q).order('raid_date').range(f, t);
    })
  ]);
  const postOf = new Map(posts.map((p) => [p.raid_date as string, p]));
  // New nights with items, and every night whose post still lists some.
  const open = posts.filter((p) => p.content_key !== ALL_SET).map((p) => p.raid_date as string);
  const dates = [...new Set([...flagged.map((r) => r.raid_date).filter((d) => d >= from), ...open])].sort();
  if (!dates.length) return { posted: 0, edited: 0 };

  const discord = async (method: string, path: string, body?: unknown) => {
    const res = await io.fetch(API + path, {
      method,
      headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const team = check(await supabase.from('teams').select('slug, guilds(slug)').eq('id', teamId).maybeSingle()) as {
    slug: string;
    guilds: { slug: string } | null;
  } | null;
  const site = io.env('SITE_URL')?.replace(/\/$/, '');
  const link = site && team?.guilds ? `${site}/g/${team.guilds.slug}/t/${team.slug}/officer/attendance` : null;

  // The channel must be in the team's own server, as for the lineup post.
  let channelOk: boolean | null = null;
  const canPost = async () => {
    if (channelOk === null) {
      const channel = await discord('GET', `/channels/${channelId}`);
      channelOk = channel.status === 200 && channel.body?.guild_id === config?.guild_id;
    }
    return channelOk;
  };

  const counts = { posted: 0, edited: 0 };
  for (const night of await readNights(supabase, teamId, dates, flagged)) {
    const key = contentKey(night);
    const row = postOf.get(night.date);
    // The team picked another officer channel since: items left are posted
    // there, and the old post taken down (CodeRabbit on PR #1862).
    const moved = !!row && row.channel_id !== channelId && night.items.length > 0;
    if (row?.content_key === key && !moved) continue;
    if (!row && !night.items.length) continue;
    const body = postBody(night, link);
    if (row && !moved) {
      const edited = await discord('PATCH', `/channels/${row.channel_id}/messages/${row.message_id}`, body);
      // 403 or 404: deleted in Discord, or out of the bot's reach now.
      const gone = edited.status === 403 || edited.status === 404;
      if (edited.status !== 200 && !gone) throw new Error(`Discord answered ${edited.status} to the edit`);
      // A gone post with nothing left is as good as edited to "all set".
      if (!gone || !night.items.length) {
        check(
          await supabase
            .from('team_attendance_posts')
            .update({ content_key: key })
            .eq('team_id', teamId)
            .eq('raid_date', night.date)
        );
        counts.edited++;
        continue;
      }
      // Gone with items left: posted again below.
    }
    if (!(await canPost())) {
      console.error(`wcl-sync: team ${teamId}'s officer channel is not in its server`);
      return counts;
    }
    if (moved) await discord('DELETE', `/channels/${row.channel_id}/messages/${row.message_id}`).catch(() => null);
    const sent = await discord('POST', `/channels/${channelId}/messages`, body);
    if (sent.status !== 200 || !sent.body?.id) throw new Error(`Discord answered ${sent.status} to the post`);
    const saved = await supabase
      .from('team_attendance_posts')
      .upsert(
        { team_id: teamId, raid_date: night.date, channel_id: channelId, message_id: sent.body.id, content_key: key },
        { onConflict: 'team_id,raid_date' }
      );
    if (saved.error) {
      // Unrecorded, the next run would post a second; take this one back.
      await discord('DELETE', `/channels/${channelId}/messages/${sent.body.id}`).catch(() => null);
      throw new Error(saved.error.message);
    }
    counts.posted++;
  }
  return counts;
}
