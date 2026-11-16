// The production side of handler.ts's Deps (#1013): the caller's own JWT
// forwarded on a supabase-js client, so RLS and has_team_permission resolve exactly
// as they would for a direct frontend call. The hourly attendance run
// (#1845) gets the service-role client instead, once its secret header
// checks out. The only module in this function that imports supabase-js at
// runtime.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps } from './handler.ts';

export function productionDeps(): Deps {
  return {
    supabase: (authHeader) =>
      createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } }
      }),
    service: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
    cronSecret: Deno.env.get('WCL_SYNC_SECRET')
  };
}
