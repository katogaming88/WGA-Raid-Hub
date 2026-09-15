// The production side of handler.ts's Deps (#932): supabase-js over the
// service role, the platform fetch, Deno.env. This is the only module here
// that reaches a network or an environment, so it is the one thing
// tests/edge/ cannot cover and the rehearsal against the local stack does
// (docs/supabase-local-dev-setup.md, section 11).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, ProgressDb, SavedEncounter, TeamRow } from './handler.ts';

export function supabaseDb(): ProgressDb {
  // Service role: this writes progress for every team at once, which no
  // per-team RLS policy grants to an unauthenticated caller (see handler.ts).
  let service: SupabaseClient<any> | undefined;
  const db = () => {
    if (!service) {
      service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    }
    return service;
  };

  return {
    async teams() {
      const { data, error } = await db().from('teams').select('id, wcl_guild_id').not('wcl_guild_id', 'is', null);
      if (error) throw new Error(error.message);
      return (data || []) as TeamRow[];
    },
    async teamConfig(teamId) {
      const { data, error } = await db().from('team_settings').select('config').eq('team_id', teamId).maybeSingle();
      if (error) throw new Error(error.message);
      return ((data as any)?.config as Record<string, unknown>) || {};
    },
    async upsertRaidZone(row) {
      const { data, error } = await db()
        .from('raid_zones')
        .upsert(row, { onConflict: 'wcl_zone_id,season' })
        .select('id')
        .single();
      if (error || !data) throw new Error(error?.message || 'Failed to upsert raid_zones');
      return data.id as number;
    },
    async upsertEncounters(rows) {
      const { data, error } = await db()
        .from('raid_encounters')
        .upsert(rows, { onConflict: 'zone_id,wcl_encounter_id' })
        .select('id, wcl_encounter_id');
      if (error) throw new Error(error.message);
      return (data || []) as SavedEncounter[];
    },
    async upsertProgress(rows) {
      const { error } = await db().from('team_raid_progress').upsert(rows, { onConflict: 'team_id,encounter_id' });
      if (error) throw new Error(error.message);
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, env: Deno.env, db: supabaseDb() };
}
