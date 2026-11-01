// The production side of discord-settings: supabase-js behind the named
// SettingsDb interface handler.ts reads through (#1006). The only module that
// imports supabase-js.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, SettingsDb } from './handler.ts';

function supabaseDb(): SettingsDb {
  // The caller's own token answers who they are and whether they may see the
  // team's Discord settings. The service role reads their person row and
  // writes discord_server_access, which nothing else can.
  const caller = (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

  let service: SupabaseClient<any> | undefined;
  const db = () => {
    if (!service) {
      service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    }
    return service;
  };

  return {
    async getUser(authHeader) {
      const {
        data: { user }
      } = await caller(authHeader).auth.getUser();
      return user ? { id: user.id } : null;
    },
    async teamServer(authHeader, teamId) {
      const { data, error } = await caller(authHeader).rpc('team_discord_settings', { p_team_id: teamId });
      if (error) {
        if (/Not authorized|Not signed in/.test(error.message)) return 'forbidden';
        throw new Error(error.message);
      }
      return { serverId: (data as { server_id: string | null } | null)?.server_id ?? null };
    },
    async person(userId) {
      const { data, error } = await db()
        .from('people')
        .select('id, discord_id')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const row = data as { id: number; discord_id: string | null } | null;
      return row ? { id: row.id, discordId: row.discord_id } : null;
    },
    async recordAccess(personId, serverIds) {
      const now = new Date().toISOString();
      const { error } = await db()
        .from('discord_server_access')
        .upsert(serverIds.map((id) => ({ person_id: personId, server_id: id, verified_at: now })));
      if (error) throw new Error(error.message);
    },
    async teamName(teamId) {
      const { data, error } = await db().from('teams').select('name').eq('id', teamId).single();
      if (error) throw new Error(error.message);
      return (data as { name: string }).name;
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, db: supabaseDb(), botToken: Deno.env.get('DISCORD_BOT_TOKEN') };
}
