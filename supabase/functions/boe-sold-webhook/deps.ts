// The production side of handler.ts's Deps (#1006): supabase-js over the
// caller's session and the service role, the platform fetch, Deno.env. This
// is the only module here that reaches a network or an environment, so it is
// the one thing tests/edge/ cannot cover and the rehearsal against the local
// stack does (docs/supabase-local-dev-setup.md, section 11).
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, SaleDb, SaleRow } from './handler.ts';

const SALE_COLUMNS =
  'id, team_id, finder_name, item_name, track, upgrade_rank, status, sale_price, ah_fee, guild_cut, finder_payout, payout_donated';

export function supabaseDb(): SaleDb {
  // The caller's own JWT forwarded, so is_boe_manager()/is_site_admin() and
  // resolve_boe_finder_discord_id() resolve auth.uid() exactly as they would
  // for a direct frontend call. One client per header for the request.
  const callers = new Map<string, SupabaseClient<any>>();
  const caller = (authHeader: string) => {
    let client = callers.get(authHeader);
    if (!client) {
      client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: authHeader } }
      });
      callers.set(authHeader, client);
    }
    return client;
  };

  // Service role for the row and the manager list: boe_managers has no
  // authenticated grant at all, so a manager holding only the grant would
  // read an empty list and the closing line would name nobody. The finder
  // used to need it too, for the same shape of reason; that walk now happens
  // inside resolve_boe_finder_discord_id, which is security definer and does
  // it on the caller's behalf (#918), and which is also what lets a BoE
  // manager holding no officer role anywhere read the rows behind it.
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
    async isBoeManager(authHeader) {
      const { data } = await caller(authHeader).rpc('is_boe_manager');
      return data === true;
    },
    async isSiteAdmin(authHeader) {
      const { data } = await caller(authHeader).rpc('is_site_admin');
      return data === true;
    },
    async readSale(id) {
      const { data, error } = await db().from('boe_items').select(SALE_COLUMNS).eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return (data as SaleRow | null) ?? null;
    },
    async resolveFinderDiscordId(authHeader, id) {
      const { data } = await caller(authHeader).rpc('resolve_boe_finder_discord_id', { p_boe_id: id });
      return data || null;
    },
    async managerDiscordIds() {
      // A grant that is not yet active still carries a discord_id, so the
      // mention works before that person has ever signed in.
      const { data } = await db().from('boe_managers').select('discord_id').not('discord_id', 'is', null);
      return (data || []).map((m: { discord_id: string }) => m.discord_id);
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, env: Deno.env, db: supabaseDb() };
}
