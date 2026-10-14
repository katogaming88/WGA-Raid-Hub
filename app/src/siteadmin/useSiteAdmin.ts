import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

// The Site admin page (#1364): what belongs to the whole site, not to any one
// guild. Every call here is site-admin only in the database (is_site_admin()
// inside each admin_* function); the page gate only decides what to show.

export type SiteAdminRow = { id: number; discord_id: string | null; display_name: string | null };

const adminsKey = ['site-admins'] as const;

export function useSiteAdmins() {
  return useSupabaseQuery<SiteAdminRow[]>(adminsKey, (client) => client.rpc('admin_list_site_admins'));
}

// admin_revoke() refuses the last site admin, so the page cannot lock the site out.
export function useRevokeSiteAdmin() {
  return useSupabaseMutation<void, { discordId: string }>(
    (client, v) => client.rpc('admin_revoke_site_admin', { p_discord_id: v.discordId }),
    { key: ['revoke-site-admin'], refreshes: [adminsKey] }
  );
}

export type SiteSwitches = { maintenanceMode: boolean; maintenanceMessage: string; guildCreationOpen: boolean };

const switchesKey = ['site-switches'] as const;

// site_settings is one public row (id 1).
export function useSiteSwitches() {
  return useSupabaseQuery<SiteSwitches>(switchesKey, async (client) => {
    const result = await client
      .from('site_settings')
      .select('maintenance_mode, maintenance_message, guild_creation_open')
      .eq('id', 1)
      .maybeSingle();
    if (result.error) return { data: null, error: result.error };
    return {
      data: {
        maintenanceMode: result.data?.maintenance_mode === true,
        maintenanceMessage: result.data?.maintenance_message ?? '',
        guildCreationOpen: result.data?.guild_creation_open === true
      },
      error: null
    };
  });
}

export function useSetMaintenance() {
  return useSupabaseMutation<void, { enabled: boolean; message: string }>(
    (client, v) =>
      client.rpc('admin_set_maintenance_mode', {
        p_enabled: v.enabled,
        ...(v.message.trim() ? { p_message: v.message.trim() } : {})
      }),
    { key: ['set-maintenance'], refreshes: [switchesKey] }
  );
}

// -- Look someone up ------------------------------------------------------
// Read-only, and no new database work: a site admin already reads every
// guild's teams, characters and memberships (#1364 "The lookup needs no new
// database work"). Names are matched anywhere in the text, case aside.

type Guild = { name: string; url_key: string };
type Team = { name: string; slug: string; archived_at: string | null; guilds: Guild | null };

export type CharacterHit = {
  id: number;
  name_realm: string;
  url_code: string | null;
  archived_at: string | null;
  teams: Team | null;
  team_members: { role: string; discord_id: string | null; archived_at: string | null } | null;
};
export type TeamHit = { id: number; name: string; slug: string; archived_at: string | null; guilds: Guild | null };
export type GuildHit = { id: number; name: string; url_key: string; realm: string | null; region: string | null };
export type LookupResult = { characters: CharacterHit[]; teams: TeamHit[]; guilds: GuildHit[] };

const LIMIT = 25;

// % and _ are wildcards in a LIKE pattern; a name never needs them, so a typed
// one is matched as itself.
export function likePattern(text: string): string {
  return `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function useLookup(text: string) {
  const term = text.trim();
  return useSupabaseQuery<LookupResult>(
    ['site-lookup', term],
    async (client) => {
      const pattern = likePattern(term);
      const [characters, teams, guilds] = await Promise.all([
        client
          .from('players')
          .select(
            'id, name_realm, url_code, archived_at, teams(name, slug, archived_at, guilds(name, url_key)), team_members(role, discord_id, archived_at)'
          )
          .ilike('name_realm', pattern)
          .order('name_realm')
          .limit(LIMIT),
        client
          .from('teams')
          .select('id, name, slug, archived_at, guilds(name, url_key)')
          .ilike('name', pattern)
          .order('name')
          .limit(LIMIT),
        client
          .from('guilds')
          .select('id, name, url_key, realm, region')
          .ilike('name', pattern)
          .order('name')
          .limit(LIMIT)
      ]);
      const failed = characters.error ?? teams.error ?? guilds.error;
      if (failed) return { data: null, error: failed };
      return {
        data: {
          characters: (characters.data ?? []) as unknown as CharacterHit[],
          teams: (teams.data ?? []) as unknown as TeamHit[],
          guilds: (guilds.data ?? []) as GuildHit[]
        },
        error: null
      };
    },
    { enabled: term.length >= 2 }
  );
}

export { LIMIT as LOOKUP_LIMIT };
