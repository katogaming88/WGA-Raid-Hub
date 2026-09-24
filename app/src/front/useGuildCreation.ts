import { useSupabaseMutation, useSupabaseQuery } from '../data/query';

const openKey = ['guild-creation-open'] as const;

// Whether anyone signed in may create a guild (guild_creation_open(), public so
// the signed-out front page can read it). While it is false only a site admin
// can (#1226).
export function useGuildCreationOpen() {
  return useSupabaseQuery<boolean>(openKey, async (client) => {
    const { data, error } = await client.rpc('guild_creation_open');
    if (error) return { data: null, error };
    return { data: data === true, error: null };
  });
}

// The site admin's switch (admin_set_guild_creation_open()).
export function useSetGuildCreationOpen() {
  return useSupabaseMutation<void, { open: boolean }>(
    async (client, { open }) => {
      const { error } = await client.rpc('admin_set_guild_creation_open', { p_open: open });
      return { data: null, error };
    },
    { key: ['set-guild-creation-open'], refreshes: [openKey] }
  );
}

export type NewGuild = { name: string; region: string; realm: string; teamName: string };
export type CreatedGuild = { guildKey: string; teamKey: string };

// Creates the guild, its first team and the caller as team leader
// (create_guild()). Everyone's access changes, so it is read again.
export function useCreateGuild() {
  return useSupabaseMutation<CreatedGuild, NewGuild>(
    async (client, g) => {
      const { data, error } = await client.rpc('create_guild', {
        p_name: g.name,
        p_region: g.region,
        p_realm: g.realm,
        p_team_name: g.teamName
      });
      if (error) return { data: null, error };
      const row = (data as { guild_key: string; team_key: string }[] | null)?.[0];
      if (!row) return { data: null, error: { message: 'The guild was not created.' } };
      return { data: { guildKey: row.guild_key, teamKey: row.team_key }, error: null };
    },
    { key: ['create-guild'], refreshes: [['access'], ['roster']] }
  );
}
