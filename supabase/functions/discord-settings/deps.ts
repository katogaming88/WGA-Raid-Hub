// The production side of discord-settings: supabase-js behind the named
// SettingsDb interface handler.ts reads through (#1006). The only module that
// imports supabase-js.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, SettingsDb } from './handler.ts';
import type { FindTicketDb } from './find-ticket.ts';

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

// Find my ticket's reads and writes (#1542). The caller's own token asks
// team_recruiting_settings(), which refuses anyone who may not edit the
// team's recruiting; discord_find_ticket is the service role's only.
function findTicketDb(): FindTicketDb {
  const caller = (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
  let service: SupabaseClient<any> | undefined;
  const db = () =>
    (service ??= createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!));
  const check = <T>({ data, error }: { data: T; error: { message: string } | null }) => {
    if (error) throw new Error(error.message);
    return data;
  };

  return {
    async mayEditRecruiting(authHeader, teamId) {
      const { error } = await caller(authHeader).rpc('team_recruiting_settings', { p_team_id: teamId });
      if (!error) return true;
      if (/Not authorized|Not signed in/.test(error.message)) return false;
      throw new Error(error.message);
    },
    async serverOf(teamId) {
      const row = check(
        await db().from('team_discord_config').select('guild_id').eq('team_id', teamId).maybeSingle()
      ) as { guild_id: string | null } | null;
      return row?.guild_id ?? null;
    },
    async ticketTeamIn(serverId) {
      const teams = check(await db().from('team_discord_config').select('team_id').eq('guild_id', serverId)) as {
        team_id: number;
      }[];
      if (teams.length === 0) return false;
      const { count, error } = await db()
        .from('team_recruiting')
        .select('team_id', { count: 'exact', head: true })
        .in(
          'team_id',
          teams.map((t) => t.team_id)
        )
        .eq('discord_mode', 'ticket');
      if (error) throw new Error(error.message);
      return (count ?? 0) > 0;
    },
    async current(serverId) {
      const row = check(
        await db().from('discord_find_ticket').select('channel_id, message_id').eq('server_id', serverId).maybeSingle()
      ) as { channel_id: string; message_id: string | null } | null;
      return row ? { channelId: row.channel_id, messageId: row.message_id } : null;
    },
    async save(serverId, value, userId) {
      const person = check(await db().from('people').select('id').eq('auth_user_id', userId).maybeSingle()) as {
        id: number;
      } | null;
      check(
        await db()
          .from('discord_find_ticket')
          .upsert({
            server_id: serverId,
            channel_id: value.channelId,
            message_id: value.messageId,
            updated_by: person?.id ?? null
          })
      );
    },
    async clear(serverId) {
      check(await db().from('discord_find_ticket').delete().eq('server_id', serverId));
    }
  };
}

export function productionDeps(): Deps {
  return {
    fetch: globalThis.fetch,
    db: supabaseDb(),
    botToken: Deno.env.get('DISCORD_BOT_TOKEN'),
    findTicket: findTicketDb()
  };
}
