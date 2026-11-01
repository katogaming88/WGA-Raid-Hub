// The production side of handler.ts's Deps (#1006): supabase-js, the platform
// fetch, Deno.env. The only module here that reaches a network or an
// environment.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, OwnAdd, RelayDb } from './handler.ts';

type OwnAddRow = {
  audit_id: number;
  team_slug: string;
  member: string | null;
  name_realm: string;
  class_spec: string;
  added_at: string;
};

function supabaseDb(): RelayDb {
  // Who the caller is, and their own newest add, are read as the caller. The
  // rest is the service role: the team's Discord settings and the request
  // tables are not the caller's to read, and the relay only reads them to
  // decide where its own post goes.
  const caller = (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
  let service: SupabaseClient<any> | undefined;
  const db = () => {
    if (!service) service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    return service;
  };

  return {
    async getUser(authHeader) {
      const {
        data: { user }
      } = await caller(authHeader).auth.getUser();
      return user ? { id: user.id } : null;
    },
    async latestOwnAdd(authHeader, team): Promise<OwnAdd | null> {
      const { data, error } = await caller(authHeader).rpc('my_recent_own_add', { p_team_slug: team });
      if (error) throw new Error(error.message);
      const row = ((data as OwnAddRow[] | null) ?? [])[0];
      if (!row) return null;
      return {
        auditId: row.audit_id,
        team: row.team_slug,
        member: row.member ?? 'A member',
        nameRealm: row.name_realm,
        classSpec: row.class_spec,
        addedAt: row.added_at
      };
    },
    async team(key, id) {
      let query = db().from('teams').select('id').eq('slug', key);
      if (id !== null) query = query.eq('id', id);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const rows = (data as { id: number }[] | null) ?? [];
      if (rows.length > 1) return 'ambiguous';
      return rows[0] ?? null;
    },
    async postSetting(teamId, kind) {
      const [config, post] = await Promise.all([
        db().from('team_discord_config').select('guild_id').eq('team_id', teamId).maybeSingle(),
        db()
          .from('team_discord_posts')
          .select('channel_id, ping_role_id')
          .eq('team_id', teamId)
          .eq('kind', kind)
          .maybeSingle()
      ]);
      if (config.error) throw new Error(config.error.message);
      if (post.error) throw new Error(post.error.message);
      const server = (config.data as { guild_id: string } | null)?.guild_id;
      if (!server) return null;
      const row = post.data as { channel_id: string | null; ping_role_id: string | null } | null;
      return { serverId: server, channelId: row?.channel_id ?? null, roleId: row?.ping_role_id ?? null };
    },
    async serverOf(teamId) {
      const { data, error } = await db()
        .from('team_discord_config')
        .select('guild_id')
        .eq('team_id', teamId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { guild_id: string } | null)?.guild_id ?? null;
    },
    async recentRecord(table, teamId, nameRealm, since) {
      // A signup names its character itself; the rest point at a roster row.
      if (table === 'season_signups') {
        const { count, error } = await db()
          .from('season_signups')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .eq('signup_name_realm', nameRealm)
          .gte('submitted_at', since.toISOString());
        if (error) throw new Error(error.message);
        return (count ?? 0) > 0;
      }
      const players = await db().from('players').select('id').eq('team_id', teamId).eq('name_realm', nameRealm);
      if (players.error) throw new Error(players.error.message);
      const ids = ((players.data as { id: number }[] | null) ?? []).map((p) => p.id);
      if (ids.length === 0) return false;
      const { count, error } = await db()
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .in('player_id', ids)
        .gte(table === 'raid_rsvps' ? 'updated_at' : 'submitted_at', since.toISOString());
      if (error) throw new Error(error.message);
      return (count ?? 0) > 0;
    },
    async canManageDiscord(authHeader, teamId) {
      // team_discord_settings() refuses anyone without Change Discord settings.
      const { error } = await caller(authHeader).rpc('team_discord_settings', { p_team_id: teamId });
      return !error;
    },
    async markPosted(teamId, kind) {
      const { error } = await db()
        .from('team_discord_posts')
        .update({ last_posted_at: new Date().toISOString() })
        .eq('team_id', teamId)
        .eq('kind', kind);
      // "Last posted" is for the settings page; the post itself went out.
      if (error) console.error('discord-bot-webhook: last_posted_at not saved: ' + error.message);
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, env: Deno.env, db: supabaseDb() };
}
