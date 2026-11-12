// The production side of character-stats: supabase-js behind StatsDb, the
// Warcraft Logs credentials, and the per-isolate cache. The only module that
// imports supabase-js or reads the environment.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Cached, Deps, StatsDb } from './handler.ts';

function supabaseDb(): StatsDb {
  // The caller's own token answers who they are; the rest is the service
  // role, as in battlenet-characters (battlenet_account_id is granted to
  // nothing else).
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
    async battlenetAccountId(userId) {
      const { data, error } = await db().rpc('battlenet_account_id', { p_auth_user_id: userId });
      if (error) throw new Error(error.message);
      return (data as string | null) ?? null;
    },
    async seasonZone() {
      const { data: code, error: codeError } = await db().rpc('current_season');
      if (codeError) throw new Error(codeError.message);
      if (!code) return null;
      const { data, error } = await db()
        .from('raid_zones')
        .select('wcl_zone_id, name')
        .eq('season', code)
        .eq('is_mini_raid', false)
        .order('sort_index')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { wcl_zone_id: number; name: string } | null) ?? null;
    },
    async saveToApplication(userId, applicationId, blizzardId, numbers) {
      const { data: person, error: personError } = await db()
        .from('people')
        .select('id')
        .eq('auth_user_id', userId)
        .maybeSingle();
      if (personError) throw new Error(personError.message);
      if (!person) return false;
      const { data: app, error } = await db()
        .from('recruit_applications')
        .select(
          'id, mplus_score, logs_best_average, logs_median_average, mythic_bosses_killed, characters!inner(blizzard_id)'
        )
        .eq('id', applicationId)
        .eq('person_id', person.id)
        .eq('characters.blizzard_id', blizzardId)
        .is('closed_at', null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!app) return false;
      // Only the empty columns: a saved number never moves.
      const patch = Object.fromEntries(
        Object.entries(numbers).filter(([k, v]) => v !== null && (app as Record<string, unknown>)[k] === null)
      );
      if (Object.keys(patch).length === 0) return true;
      let update = db().from('recruit_applications').update(patch).eq('id', applicationId).is('closed_at', null);
      for (const k of Object.keys(patch)) update = update.is(k, null);
      const { error: updateError } = await update;
      if (updateError) throw new Error(updateError.message);
      return true;
    }
  };
}

const cache = new Map<string, Cached>();

export function productionDeps(): Deps {
  const clientId = Deno.env.get('WCL_CLIENT_ID');
  const clientSecret = Deno.env.get('WCL_CLIENT_SECRET');
  return {
    fetch: globalThis.fetch,
    db: supabaseDb(),
    wcl: clientId && clientSecret ? { clientId, clientSecret } : null,
    cache,
    now: Date.now
  };
}
