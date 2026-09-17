import { createContext, useContext } from 'react';
import { useSupabaseQuery } from './query';

export type Place = { id: number; key: string; name: string };
export type TeamSummary = Place & { archived: boolean };
export type Address = { guild: Place; team: Place | null; teams: TeamSummary[] };

export type Resolved = {
  guildId: number;
  guildKey: string;
  teamId: number | null;
  teamKey: string | null;
  isCanonical: boolean;
};

// resolve_address() (#1114) turns the keys in an address into ids and each
// part's current key. No row means the address does not exist; is_canonical
// false means it used a retired key or different capitals, and the page should
// move to the current address rather than show a 404.
export function useResolvedAddress(guildKey: string, teamKey: string | undefined) {
  return useSupabaseQuery<Resolved | null>(['address', guildKey, teamKey ?? null], async (client) => {
    const { data, error } = await client.rpc('resolve_address', {
      p_guild_key: guildKey,
      ...(teamKey ? { p_team_key: teamKey } : {})
    });
    if (error) return { data: null, error };
    const row = data?.[0];
    return {
      data: row
        ? {
            guildId: row.guild_id,
            guildKey: row.guild_key,
            teamId: row.team_id ?? null,
            teamKey: row.team_key ?? null,
            isCanonical: row.is_canonical
          }
        : null,
      error: null
    };
  });
}

export function useGuild(guildId: number | undefined) {
  return useSupabaseQuery<{ id: number; name: string; url_key: string }>(
    ['guild', guildId],
    (client) => client.from('guilds').select('id, name, url_key').eq('id', guildId!).single(),
    { enabled: guildId !== undefined }
  );
}

// Where the guild plays (#1102): the region and home realm its Raider.IO and
// Armory links are built from. Null for a guild that has not set them.
export function useGuildDetails(guildId: number) {
  return useSupabaseQuery<{ region: string | null; realm: string | null }>(['guild-details', guildId], (client) =>
    client.from('guilds').select('region, realm').eq('id', guildId).single()
  );
}

// In team id order, the order the guild created them (Kat, 2026-09-13), not
// alphabetical.
export function useGuildTeams(guildId: number | undefined) {
  return useSupabaseQuery<{ id: number; name: string; slug: string; archived_at: string | null }[]>(
    ['guild-teams', guildId],
    (client) => client.from('teams').select('id, name, slug, archived_at').eq('guild_id', guildId!).order('id'),
    { enabled: guildId !== undefined }
  );
}

// The address a non-canonical one should become: the same page under the
// current guild and team keys.
export function canonicalPath(pathname: string, resolved: Resolved): string {
  const parts = pathname.split('/');
  // ['', 'g', guildKey, 't', teamKey, ...rest]
  parts[2] = resolved.guildKey;
  if (parts[3] === 't' && resolved.teamKey) parts[4] = resolved.teamKey;
  return parts.join('/');
}

const AddressContext = createContext<Address | null>(null);
export const AddressProvider = AddressContext.Provider;

// The guild and team the current page is for. Only available inside the shell,
// once the address has resolved.
export function useAddress(): Address {
  const address = useContext(AddressContext);
  if (!address) throw new Error('useAddress is only available on a resolved page');
  return address;
}

export function useTeam(): Place {
  const { team } = useAddress();
  if (!team) throw new Error('useTeam is only available on a team page');
  return team;
}
