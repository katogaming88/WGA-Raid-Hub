// The production side of handler.ts's Deps (#1006): supabase-js over the
// caller's session and the service role, the platform fetch, Deno.env. The
// only module here that reaches a network or an environment.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, OwnAdd, RelayDb } from './handler.ts';

// add_own_character()'s detail: the spec label, then this.
const OWN_ADD_SUFFIX = ', added by the member';

function supabaseDb(): RelayDb {
  const caller = (authHeader: string) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

  // Service role for the reads: audit_log is officer-only, and the caller has
  // already been named by their own token.
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
    async latestOwnAdd(userId, since): Promise<OwnAdd | null> {
      // The same caller may also be an officer adding someone else, whose
      // rows share the action; the detail tells them apart. No row limit, so
      // a run of those adds cannot push the caller's own out of the read: it
      // is one person's adds over a few minutes. detail is jsonb, which
      // PostgREST cannot match with like, so the filter is here.
      const { data: rows, error } = await db()
        .from('audit_log')
        .select('id, team_id, target_id, detail, created_at')
        .eq('actor_id', userId)
        .eq('action', 'Player Added')
        .eq('target_type', 'players')
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      const row = (rows ?? []).find((r) => typeof r.detail === 'string' && r.detail.endsWith(OWN_ADD_SUFFIX));
      if (!row) return null;

      const [player, team] = await Promise.all([
        db().from('players').select('name_realm, team_member_id').eq('id', row.target_id).maybeSingle(),
        db().from('teams').select('slug').eq('id', row.team_id).maybeSingle()
      ]);
      if (player.error) throw new Error(player.error.message);
      if (team.error) throw new Error(team.error.message);
      if (!player.data || !team.data) return null;

      const name = player.data.team_member_id
        ? await db().from('names').select('label').eq('team_member_id', player.data.team_member_id).maybeSingle()
        : null;
      if (name?.error) throw new Error(name.error.message);

      return {
        auditId: row.id,
        team: team.data.slug,
        member: name?.data?.label ?? 'A member',
        nameRealm: player.data.name_realm,
        classSpec: row.detail.slice(0, -OWN_ADD_SUFFIX.length),
        addedAt: row.created_at
      };
    }
  };
}

export function productionDeps(): Deps {
  return { fetch: globalThis.fetch, env: Deno.env, db: supabaseDb() };
}
