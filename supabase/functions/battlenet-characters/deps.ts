// The production side of battlenet-characters: supabase-js behind the named
// CharactersDb interface handler.ts reads through (#1006). The only module
// that imports supabase-js.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { CharactersDb, Deps, RosterLink } from './handler.ts';

function supabaseDb(): CharactersDb {
  // The caller's own token answers who they are. Everything else is the
  // service role: the three database functions it calls are granted to nothing
  // else, because they write on the person's behalf only after this function
  // has checked the Battle.net token.
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
    async personId(userId) {
      const { data, error } = await db().from('people').select('id').eq('auth_user_id', userId).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as { id: number } | null)?.id ?? null;
    },
    async linkRosterCharacters(personId, characters) {
      const { data, error } = await db().rpc('link_battlenet_roster_characters', {
        p_person_id: personId,
        p_characters: characters
      });
      if (error) throw new Error(error.message);
      return (data as RosterLink[] | null) ?? [];
    },
    async saveCharacters(personId, characters) {
      const { error } = await db().rpc('save_battlenet_characters', {
        p_person_id: personId,
        p_characters: characters
      });
      if (error) throw new Error(error.message);
    },
    async savedBlizzardIds(personId) {
      const { data, error } = await db().from('characters').select('blizzard_id').eq('person_id', personId);
      if (error) throw new Error(error.message);
      return ((data as Array<{ blizzard_id: number | string }> | null) ?? []).map((r) => Number(r.blizzard_id));
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, db: supabaseDb() };
}
