// The production side of discord-join: supabase-js behind JoinDb. The only
// module that imports supabase-js.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Application, Deps, JoinDb } from './handler.ts';

function supabaseDb(): JoinDb {
  // The caller's own token answers who they are. The reads and the history
  // row are the service role's, scoped here to the caller's own application:
  // recruit_applications and recruit_events are granted to nothing else.
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
    async application(authUserId, applicationId) {
      const { data: person, error: personError } = await db()
        .from('people')
        .select('id, discord_id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (personError) throw new Error(personError.message);
      if (!person) return null;
      const { data: app, error } = await db()
        .from('recruit_applications')
        .select('id, team_id, person_id, name_realm')
        .eq('id', applicationId)
        .eq('person_id', person.id)
        .is('closed_at', null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!app) return null;
      const [{ data: recruiting, error: rError }, { data: discord, error: dError }] = await Promise.all([
        db().from('team_recruiting').select('add_to_server').eq('team_id', app.team_id).maybeSingle(),
        db().from('team_discord_config').select('guild_id, officer_channel_id').eq('team_id', app.team_id).maybeSingle()
      ]);
      if (rError) throw new Error(rError.message);
      if (dError) throw new Error(dError.message);
      return {
        id: app.id,
        team_id: app.team_id,
        person_id: app.person_id,
        name_realm: app.name_realm,
        discord_id: person.discord_id ?? null,
        add_to_server: recruiting?.add_to_server === true,
        server_id: discord?.guild_id ?? null,
        officer_channel_id: discord?.officer_channel_id ?? null
      } satisfies Application;
    },
    async addEvent(applicationId, kind, actor, detail) {
      const { error } = await db()
        .from('recruit_events')
        .insert({ application_id: applicationId, kind, actor_person_id: actor, detail });
      if (error) throw new Error(error.message);
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, db: supabaseDb(), env: Deno.env };
}
