// The production side of handler.ts's Deps (#1006): supabase-js over the
// caller's session, the platform fetch, Deno.env. The only module here that
// reaches a network or an environment.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, OwnAdd, RelayDb } from './handler.ts';

type OwnAddRow = {
  audit_id: number;
  team_slug: string;
  member: string | null;
  name_realm: string;
  class_spec: string;
  added_at: string;
};

function supabaseDb(): RelayDb {
  // Every read is the caller's own, as the caller: no service role here.
  const caller = (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

  return {
    async getUser(authHeader) {
      const {
        data: { user }
      } = await caller(authHeader).auth.getUser();
      return user ? { id: user.id } : null;
    },
    async latestOwnAdd(authHeader, team): Promise<OwnAdd | null> {
      const { data, error } = await caller(authHeader).rpc('my_recent_own_add', { p_team_slug: team });
      if (error) throw new Error(error.message);
      const row = ((data as OwnAddRow[] | null) ?? [])[0];
      if (!row) return null;
      return {
        auditId: row.audit_id,
        team: row.team_slug,
        member: row.member ?? 'A member',
        nameRealm: row.name_realm,
        classSpec: row.class_spec,
        addedAt: row.added_at
      };
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, env: Deno.env, db: supabaseDb() };
}
