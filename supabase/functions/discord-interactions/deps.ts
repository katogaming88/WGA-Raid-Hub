// The production side of handler.ts's Deps (#1006): supabase-js with the
// service role, the platform fetch, Deno.env and the edge runtime's
// waitUntil. The only module here that reaches a network or an environment.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { Deps, InteractionsDb } from './handler.ts';
import type { WishlistSetupStatusRow } from './nudge.ts';

declare const EdgeRuntime: { waitUntil(work: Promise<unknown>): void };

function supabaseDb(): InteractionsDb {
  // Nobody signs in to Discord's request: every read is the service role,
  // and the signature check is what stands in front of it.
  let service: SupabaseClient<any> | undefined;
  const db = () => {
    if (!service) service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    return service;
  };

  return {
    async teamsInServer(serverId) {
      const { data, error } = await db()
        .from('team_discord_config')
        .select('team_id, teams(name)')
        .eq('guild_id', serverId);
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? [])
        .map((r) => ({ id: r.team_id as number, name: (r.teams?.name as string) ?? `Team ${r.team_id}` }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async setupStatus(teamId) {
      const { data, error } = await db().rpc('wishlist_setup_status', { p_team_id: teamId });
      if (error) throw new Error(`wishlist_setup_status failed: ${error.message}`);
      return (data as WishlistSetupStatusRow[] | null) ?? [];
    },
    async nudgedSince(discordIds, since) {
      if (discordIds.length === 0) return [];
      const { data, error } = await db()
        .from('discord_nudges_sent')
        .select('discord_id, category')
        .in('discord_id', discordIds)
        .gte('sent_at', since.toISOString());
      if (error) throw new Error(error.message);
      return ((data as any[] | null) ?? []).map((r) => ({ discordId: r.discord_id, category: r.category }));
    },
    async recordNudge(discordId, categories) {
      const rows = categories.map((category) => ({
        discord_id: discordId,
        category,
        sent_at: new Date().toISOString()
      }));
      // Tried twice. The DM went out either way; a lost row only means the
      // next run may nudge that raider again.
      for (let attempt = 1; attempt <= 2; attempt++) {
        const { error } = await db().from('discord_nudges_sent').upsert(rows);
        if (!error) return;
        if (attempt === 2) console.error('discord-interactions: nudge not recorded: ' + error.message);
      }
    },
    async hasTeamPermission(discordId, teamId, permission) {
      // my_permission_team_ids()'s rule, for a Discord account rather than
      // the signed-in user: the person's rank on the team, owners holding all.
      const { data, error } = await db()
        .from('team_members')
        .select('rank, people!inner(discord_id)')
        .eq('team_id', teamId)
        .eq('people.discord_id', discordId)
        .is('archived_at', null);
      if (error) throw new Error(error.message);
      const ranks = ((data as { rank: string }[] | null) ?? []).map((m) => m.rank);
      if (ranks.includes('owner')) return true;
      if (ranks.length === 0) return false;
      const granted = await db()
        .from('team_rank_permissions')
        .select('rank')
        .eq('team_id', teamId)
        .eq('permission', permission)
        .in('rank', ranks);
      if (granted.error) throw new Error(granted.error.message);
      return ((granted.data as unknown[] | null) ?? []).length > 0;
    }
  };
}

export function productionDeps(): Deps {
  return {
    fetch: globalThis.fetch,
    env: Deno.env,
    db: supabaseDb(),
    waitUntil: (work) => EdgeRuntime.waitUntil(work)
  };
}
