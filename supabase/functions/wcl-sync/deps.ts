// The production side of handler.ts's Deps (#1013): the caller's own JWT
// forwarded on a supabase-js client, so RLS and my_team_role resolve exactly
// as they would for a direct frontend call. The only module in this function
// that imports supabase-js at runtime.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps } from './handler.ts';

export function productionDeps(): Deps {
  return {
    supabase: (authHeader) =>
      createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } }
      })
  };
}
