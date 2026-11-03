// The production side of handler.ts's Deps (#1006): supabase-js, the platform
// fetch, Deno.env. The only module here that reaches a network or an
// environment.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { sheetDb } from '../_shared/signup-sheet-db.ts';
import type { Deps, QueuedPost, RelayDb } from './handler.ts';

type QueuedRow = {
  id: number;
  team_id: number;
  kind: QueuedPost['kind'];
  action: string;
  payload: QueuedPost['payload'];
  created_at: string;
  attempts: number;
};

let service: SupabaseClient<any> | undefined;
const serviceClient = () => {
  if (!service) service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return service;
};

function supabaseDb(): RelayDb {
  // Who the caller is, and whether they may change the team's Discord
  // settings, are read as the caller. The rest is the service role: the
  // team's Discord settings and the post queue are not the caller's to read.
  const caller = (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
  const db = serviceClient;

  return {
    async getUser(authHeader) {
      const {
        data: { user }
      } = await caller(authHeader).auth.getUser();
      return user ? { id: user.id } : null;
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
    async claimPosts() {
      const { data, error } = await db().rpc('claim_discord_posts');
      if (error) throw new Error(error.message);
      return ((data as QueuedRow[] | null) ?? []).map((r) => ({
        id: r.id,
        teamId: r.team_id,
        kind: r.kind,
        action: r.action,
        payload: r.payload,
        createdAt: r.created_at,
        attempts: r.attempts
      }));
    },
    async finishPost(id, finish) {
      const { error } = await db()
        .from('discord_post_queue')
        .update({
          status: finish.status,
          last_error: finish.lastError,
          claimed_at: null,
          ...(finish.nextTryAt ? { next_try_at: finish.nextTryAt } : {}),
          ...(finish.status === 'posted' ? { posted_at: new Date().toISOString() } : {})
        })
        .eq('id', id);
      // Left claimed, the row is taken again after ten minutes.
      if (error) console.error(`discord-bot-webhook: queued post ${id} not updated: ${error.message}`);
    },
    async canManageDiscord(authHeader, teamId) {
      // team_discord_settings() refuses anyone without Change Discord settings.
      const { error } = await caller(authHeader).rpc('team_discord_settings', { p_team_id: teamId });
      return !error;
    },
    async onTeam(authHeader, teamId) {
      const { data, error } = await caller(authHeader).rpc('my_team_role', { p_team_id: teamId });
      return !error && data !== null;
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
  return { fetch: globalThis.fetch, env: Deno.env, db: supabaseDb(), sheets: sheetDb(serviceClient) };
}
