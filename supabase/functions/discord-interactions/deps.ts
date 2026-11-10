// The production side of handler.ts's Deps (#1006): supabase-js with the
// service role, the platform fetch, Deno.env and the edge runtime's
// waitUntil. The only module here that reaches a network or an environment.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { sheetDb } from '../_shared/signup-sheet-db.ts';
import { drawPicture, drawSvg } from '../_shared/sheet-picture-draw.ts';
import { lineupDb } from '../_shared/lineup-db.ts';
import type { Deps, InteractionsDb } from './handler.ts';
import type { WishlistSetupStatusRow } from './nudge.ts';
import type { RecruitAction, RecruitDb } from './recruit.ts';

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

// Nobody signs in to Discord's request: every read is the service role, and
// the signature check is what stands in front of it.
let service: SupabaseClient<any> | undefined;
const serviceClient = () => {
  if (!service) service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return service;
};

function supabaseDb(): InteractionsDb {
  const db = serviceClient;

  return {
    async teamsInServer(serverId) {
      const { data, error } = await db()
        .from('team_discord_config')
        .select('team_id, teams(name)')
        .eq('guild_id', serverId);
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? [])
        .map((r) => ({ id: r.team_id as number, name: (r.teams?.name as string) ?? `Team ${r.team_id}` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async setupStatus(teamId) {
      const { data, error } = await db().rpc('wishlist_setup_status', { p_team_id: teamId });
      if (error) throw new Error(`wishlist_setup_status failed: ${error.message}`);
      return (data as WishlistSetupStatusRow[] | null) ?? [];
    },
    async nudgedSince(discordIds, since) {
      if (discordIds.length === 0) return [];
      const { data, error } = await db()
        .from('discord_nudges_sent')
        .select('discord_id, category')
        .in('discord_id', discordIds)
        .gte('sent_at', since.toISOString());
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? []).map((r) => ({ discordId: r.discord_id, category: r.category }));
    },
    async recordNudge(discordId, categories) {
      const rows = categories.map((category) => ({
        discord_id: discordId,
        category,
        sent_at: new Date().toISOString()
      }));
      // Tried twice. The DM went out either way; a lost row only means the
      // next run may nudge that raider again.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { error } = await db().from('discord_nudges_sent').upsert(rows);
        if (!error) return;
        if (attempt === 2) console.error('discord-interactions: nudge not recorded: ' + error.message);
      }
    },
    async missingSignups(teamId) {
      const open = await db()
        .from('team_seasons')
        .select('season_code, seasons(display_name, starts_at)')
        .eq('team_id', teamId)
        .eq('signups_open', true);
      if (open.error) throw new Error(open.error.message);
      // The soonest season open for signups, as signup() reads one.
      const season = ((open.data as any[] | null) ?? []).sort((a, b) =>
        String(a.seasons?.starts_at ?? '9999').localeCompare(String(b.seasons?.starts_at ?? '9999'))
      )[0];
      if (!season) return null;
      // PostgREST cuts a read at 1000 rows without an error, so both page.
      const page = async (read: (from: number, to: number) => PromiseLike<{ data: unknown; error: any }>) => {
        const rows: any[] = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await read(from, from + 999);
          if (error) throw new Error(error.message);
          const got = (data as any[] | null) ?? [];
          rows.push(...got);
          if (got.length < 1000) return rows;
        }
      };
      const [players, signups] = await Promise.all([
        page((from, to) =>
          db()
            .from('players')
            .select('id, name_realm, classes_specs(role), team_members(people(discord_id))')
            .eq('team_id', teamId)
            .is('archived_at', null)
            .order('id')
            .range(from, to)
        ),
        page((from, to) =>
          db()
            .from('season_signups')
            .select('id, signup_name_realm, swap_from_name_realm')
            .eq('team_id', teamId)
            .eq('season', season.season_code)
            .neq('status', 'rejected')
            .order('id')
            .range(from, to)
        )
      ]);
      // As the site's list reads it: a live signup covers the character it
      // names and, for a main swap, the one it replaces.
      const covered = new Set<string>();
      for (const s of signups) {
        if (s.signup_name_realm) covered.add(String(s.signup_name_realm).toLowerCase());
        if (s.swap_from_name_realm) covered.add(String(s.swap_from_name_realm).toLowerCase());
      }
      return {
        seasonName: (season.seasons?.display_name as string) ?? (season.season_code as string),
        roster: players.map((p) => ({
          nameRealm: p.name_realm as string,
          role: (p.classes_specs?.role as string | null) ?? null,
          discordId: (p.team_members?.people?.discord_id as string | null) ?? null,
          signedUp: covered.has(String(p.name_realm).toLowerCase())
        }))
      };
    },
    async hasTeamPermission(discordId, teamId, permission) {
      // my_permission_team_ids()'s rule, for a Discord account rather than
      // the signed-in user: the person's rank on the team, owners holding all.
      const { data, error } = await db()
        .from('team_members')
        .select('rank, people!inner(discord_id)')
        .eq('team_id', teamId)
        .eq('people.discord_id', discordId)
        .is('archived_at', null);
      if (error) throw new Error(error.message);
      const ranks = ((data as { rank: string }[] | null) ?? []).map((m) => m.rank);
      if (ranks.includes('owner')) return true;
      if (ranks.length === 0) return false;
      const granted = await db()
        .from('team_rank_permissions')
        .select('rank')
        .eq('team_id', teamId)
        .eq('permission', permission)
        .in('rank', ranks);
      if (granted.error) throw new Error(granted.error.message);
      return ((granted.data as unknown[] | null) ?? []).length > 0;
    },
    async member(discordId, teamId) {
      const person = await db().from('people').select('id, auth_user_id').eq('discord_id', discordId).maybeSingle();
      if (person.error) throw new Error(person.error.message);
      const p = person.data as { id: number; auth_user_id: string | null } | null;
      if (!p) return null;
      const [members, players] = await Promise.all([
        db().from('team_members').select('id').eq('team_id', teamId).eq('person_id', p.id).is('archived_at', null),
        db()
          .from('players')
          .select('id, name_realm, archived_at, team_members!inner(person_id)')
          .eq('team_id', teamId)
          .eq('team_members.person_id', p.id)
          .order('id')
      ]);
      if (members.error) throw new Error(members.error.message);
      if (players.error) throw new Error(players.error.message);
      return {
        personId: p.id,
        authUserId: p.auth_user_id,
        onTeam: ((members.data as unknown[] | null) ?? []).length > 0,
        players: ((players.data as any[] | null) ?? []).map((r) => ({
          id: r.id as number,
          nameRealm: r.name_realm as string,
          archived: r.archived_at !== null
        }))
      };
    },
    async signup(member, teamId) {
      const open = await db()
        .from('team_seasons')
        .select('season_code, seasons(display_name, starts_at)')
        .eq('team_id', teamId)
        .eq('signups_open', true);
      if (open.error) throw new Error(open.error.message);
      // The soonest season open for signups, as get_own_signup() reads one.
      const season = ((open.data as any[] | null) ?? []).sort((a, b) =>
        String(a.seasons?.starts_at ?? '9999').localeCompare(String(b.seasons?.starts_at ?? '9999'))
      )[0];
      if (!season) return null;
      // Older signups carry only the sign-in account, newer ones the person.
      const who = member.authUserId
        ? `person_id.eq.${member.personId},auth_user_id.eq.${member.authUserId}`
        : `person_id.eq.${member.personId}`;
      const own = await db()
        .from('season_signups')
        .select('status')
        .eq('team_id', teamId)
        .eq('season', season.season_code)
        .or(who)
        .order('submitted_at', { ascending: false })
        .limit(1);
      if (own.error) throw new Error(own.error.message);
      const row = ((own.data as { status: string }[] | null) ?? [])[0];
      return { seasonName: season.seasons?.display_name ?? season.season_code, status: row?.status ?? null };
    },
    async awards(teamId, playerIds) {
      if (playerIds.length === 0) return { awards: [], list: null };
      const season = await db().rpc('current_season');
      if (season.error) throw new Error(season.error.message);
      const [loot, settings] = await Promise.all([
        db()
          .from('rclc_loot')
          .select('awarded_at, response, items(name)')
          .eq('team_id', teamId)
          .eq('season', season.data as string)
          .in('player_id', playerIds),
        db().from('team_settings').select('lootResponses:config->lootResponses').eq('team_id', teamId).maybeSingle()
      ]);
      if (loot.error) throw new Error(loot.error.message);
      if (settings.error) throw new Error(settings.error.message);
      return {
        awards: ((loot.data as any[] | null) ?? []).map((r) => ({
          itemName: r.items?.name ?? null,
          awardedAt: r.awarded_at as string,
          response: r.response as string | null
        })),
        list: (settings.data as { lootResponses?: unknown } | null)?.lootResponses ?? null
      };
    },
    async setRsvp(discordId, teamId, raidDate, status, note) {
      const { error } = await db().rpc('discord_set_rsvp', {
        p_discord_id: discordId,
        p_team_id: teamId,
        p_raid_date: raidDate,
        p_status: status,
        p_note: note
      });
      return error ? error.message : null;
    },
    async inviteCode(teamId) {
      const { data, error } = await db()
        .from('team_invite_links')
        .select('code, expires_at')
        .eq('team_id', teamId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as { code: string; expires_at: string | null } | null;
      if (!row || (row.expires_at && new Date(row.expires_at) <= new Date())) return null;
      return row.code;
    },
    async posts(teamId) {
      const { data, error } = await db()
        .from('team_discord_posts')
        .select('kind, channel_id')
        .eq('team_id', teamId)
        .not('channel_id', 'is', null);
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? []).map((r) => ({ kind: r.kind as string, channelId: r.channel_id as string }));
    }
  };
}

// The recruiting buttons' reads and actions (#1542). The bot_* functions take
// the presser's Discord id and decide on their own whether that person may act.
const RECRUIT_RPC: Record<RecruitAction, string> = {
  trial: 'bot_start_recruit_trial',
  decline: 'bot_close_recruit',
  note: 'bot_add_recruit_note',
  joined: 'bot_mark_recruit_joined',
  extend: 'bot_extend_recruit_trial',
  not_joining: 'bot_mark_recruit_not_joining'
};

function recruitDb(): RecruitDb {
  const db = serviceClient;
  return {
    async recruit(applicationId) {
      const { data, error } = await db()
        .from('recruit_applications')
        // Through team_recruiting, its only path to teams; people by person_id, since
        // recruiter_person_id is a second key to people (CodeRabbit on #1800).
        .select(
          'name_realm, status, trial_ends_on, discord_channel_id, team_recruiting(teams(name)),' +
            ' people!recruit_applications_person_id_fkey(discord_id)'
        )
        .eq('id', applicationId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      const r = data as any;
      return {
        teamName: r.team_recruiting?.teams?.name ?? 'this team',
        nameRealm: r.name_realm,
        status: r.status,
        trialEndsOn: r.trial_ends_on ?? null,
        ticketChannelId: r.discord_channel_id ?? null,
        applicantDiscordId: r.people?.discord_id ?? null
      };
    },
    async act(action, applicationId, discordId, args) {
      const base = { p_application_id: applicationId, p_actor_discord_id: discordId };
      const params: Record<string, unknown> =
        action === 'decline'
          ? { ...base, p_status: 'declined', p_reason: args.reason ?? null }
          : action === 'note'
            ? { ...base, p_body: args.reason ?? '' }
            : action === 'extend'
              ? { ...base, p_reason: args.reason ?? '' }
              : action === 'not_joining'
                ? { ...base, p_reason: args.reason ?? '', p_detail: args.detail || null }
                : base;
      const { data, error } = await db().rpc(RECRUIT_RPC[action], params);
      // P0001 is a raise exception: a refusal worded for people.
      if (error) return { ok: false, refused: error.code === 'P0001', message: error.message };
      return { ok: true, value: data };
    },
    async openTickets(serverId, discordId) {
      // The server's teams, then the presser's open records on them that have a ticket.
      const { data: teams, error: teamsError } = await db()
        .from('team_discord_config')
        .select('team_id, teams(name, guilds(url_key))')
        .eq('guild_id', serverId);
      if (teamsError) throw new Error(teamsError.message);
      const rows = (teams as any[] | null) ?? [];
      const guildKey = rows.map((t) => t.teams?.guilds?.url_key).find(Boolean) ?? null;
      const { data: person, error: personError } = await db()
        .from('people')
        .select('id')
        .eq('discord_id', discordId)
        .maybeSingle();
      if (personError) throw new Error(personError.message);
      if (!person || rows.length === 0) return { tickets: [], guildKey };
      const names = new Map(rows.map((t) => [t.team_id as number, (t.teams?.name as string) ?? 'the team']));
      const { data: open, error } = await db()
        .from('recruit_applications')
        .select('team_id, discord_channel_id')
        .eq('person_id', (person as { id: number }).id)
        .is('closed_at', null)
        .not('discord_channel_id', 'is', null)
        .in('team_id', [...names.keys()]);
      if (error) throw new Error(error.message);
      return {
        tickets: ((open as any[] | null) ?? []).map((a) => ({
          teamName: names.get(a.team_id) ?? 'the team',
          channelId: a.discord_channel_id as string
        })),
        guildKey
      };
    }
  };
}

export function productionDeps(): Deps {
  return {
    fetch: globalThis.fetch,
    env: Deno.env,
    db: supabaseDb(),
    sheets: sheetDb(serviceClient),
    drawPicture: (picture) => drawPicture(picture),
    lineups: lineupDb(serviceClient),
    recruits: recruitDb(),
    drawSvg: (svg) => drawSvg(svg),
    waitUntil: (work) => EdgeRuntime.waitUntil(work)
  };
}
