import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Per-team Discord config for the consolidated multi-tenant bot (#991).
// Before this, one full bot process served exactly one team, with its
// guild id/channel ids/ping role ids/script URLs baked in as env vars. One
// process now serves every team, so this module is the runtime lookup that
// replaces those env vars: read team_discord_config (joined with teams for
// slug/name) into an in-memory cache, refreshed on an interval rather than
// pushed, so adding a team's row doesn't require a bot restart.

export interface TeamConfig {
  teamId: number;
  slug: string;
  name: string;
  guildId: string;
  officerChannelId: string;
  // Both fall back to officerChannelId -- see getAttendanceChannelId/
  // getSignupChannelId below. Preserves the pre-#991 behavior where
  // ATTENDANCE_CHANNEL_ID defaulted to CHANNEL_ID, and there was no
  // separate signup channel concept at all.
  attendanceChannelId: string | null;
  signupChannelId: string | null;
  mplusPingRoleId: string | null;
  rosterPingRoleId: string | null;
  rsvpPingRoleId: string | null;
  appsScriptUrl: string | null;
  rosterScriptUrl: string | null;
}

export function attendanceChannelId(cfg: TeamConfig): string {
  return cfg.attendanceChannelId || cfg.officerChannelId;
}

export function signupChannelId(cfg: TeamConfig): string {
  return cfg.signupChannelId || cfg.officerChannelId;
}

interface TeamDiscordConfigRow {
  team_id: number;
  guild_id: string;
  officer_channel_id: string;
  attendance_channel_id: string | null;
  signup_channel_id: string | null;
  mplus_ping_role_id: string | null;
  roster_ping_role_id: string | null;
  rsvp_ping_role_id: string | null;
  apps_script_url: string | null;
  roster_script_url: string | null;
  teams: { slug: string; name: string } | { slug: string; name: string }[] | null;
}

async function loadTeamConfigs(supabase: SupabaseClient): Promise<TeamConfig[]> {
  const { data, error } = await supabase
    .from('team_discord_config')
    .select(
      'team_id, guild_id, officer_channel_id, attendance_channel_id, signup_channel_id, mplus_ping_role_id, roster_ping_role_id, rsvp_ping_role_id, apps_script_url, roster_script_url, teams(slug, name)'
    );
  if (error) throw new Error(`team_discord_config query failed: ${error.message}`);

  return ((data ?? []) as unknown as TeamDiscordConfigRow[]).map((row): TeamConfig => {
    // supabase-js types a to-one join as an array in some client versions --
    // normalize either shape rather than trusting the generated type.
    const team = Array.isArray(row.teams) ? row.teams[0] : row.teams;
    return {
      teamId: row.team_id,
      slug: team?.slug ?? String(row.team_id),
      name: team?.name ?? `Team ${row.team_id}`,
      guildId: row.guild_id,
      officerChannelId: row.officer_channel_id,
      attendanceChannelId: row.attendance_channel_id,
      signupChannelId: row.signup_channel_id,
      mplusPingRoleId: row.mplus_ping_role_id,
      rosterPingRoleId: row.roster_ping_role_id,
      rsvpPingRoleId: row.rsvp_ping_role_id,
      appsScriptUrl: row.apps_script_url,
      rosterScriptUrl: row.roster_script_url,
    };
  });
}

export class TeamConfigCache {
  private byTeamId = new Map<number, TeamConfig>();
  private bySlug = new Map<string, TeamConfig>();

  constructor(private readonly supabase: SupabaseClient) {}

  async refresh(): Promise<void> {
    const configs = await loadTeamConfigs(this.supabase);
    const byTeamId = new Map<number, TeamConfig>();
    const bySlug = new Map<string, TeamConfig>();
    for (const cfg of configs) {
      byTeamId.set(cfg.teamId, cfg);
      bySlug.set(cfg.slug, cfg);
    }
    // Swap both maps together so a concurrent lookup never sees one rebuilt
    // and the other still stale mid-refresh.
    this.byTeamId = byTeamId;
    this.bySlug = bySlug;
  }

  all(): TeamConfig[] {
    return [...this.byTeamId.values()];
  }

  // Deliberately no getByGuildId(): WGA's three teams share one Discord
  // server, so a guild id alone can map to more than one team and would
  // silently collide in a byGuildId map. Every command/route resolves the
  // team explicitly instead -- a required `team` slash-command option, or
  // the relay's `team` field -- see index.ts.

  // The relay's `team` field is always a teams.slug string (before #991,
  // discord-bot-webhook used the same value, upper-cased, to pick which
  // per-team BOT_WEBHOOK_URL_<TEAM> to call -- now it's forwarded in the
  // body instead, for the one shared bot to resolve here). Every Express
  // route in index.ts resolves through this.
  getBySlug(slug: string | null | undefined): TeamConfig | null {
    if (!slug) return null;
    return this.bySlug.get(slug) ?? null;
  }

  getByTeamId(teamId: number | null | undefined): TeamConfig | null {
    if (teamId === null || teamId === undefined) return null;
    return this.byTeamId.get(teamId) ?? null;
  }
}

// index.ts refreshes on this interval and re-registers slash commands in
// the same tick (a newly-added team needs to appear both in the cache and
// in every command's `team` choice list) -- a periodic pull is enough here,
// no push-based invalidation needed; 5 minutes balances "shows up without a
// restart" against not hammering the table.
export const TEAM_CONFIG_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
