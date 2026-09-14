import { useSupabaseQuery } from '../data/query';
import { useSession } from './session';

export type TeamRole = 'raider' | 'officer' | 'team_leader';
export type Character = { playerId: number; nameRealm: string; urlCode: string | null };
export type TeamAccess = { teamId: number; teamMemberId: number; role: TeamRole; characters: Character[] };

// Everything the signed-in person is, loaded once per sign-in and shared
// through the cache (#1101 "who-am-I state").
export type Access = {
  siteAdmin: boolean;
  guildOfficer: boolean;
  boeManager: boolean;
  teams: TeamAccess[];
  // Said "I don't have a character, stop asking" (#512, account_preferences).
  dismissedNoCharacter: boolean;
};

export const NO_ACCESS: Access = {
  siteAdmin: false,
  guildOfficer: false,
  boeManager: false,
  teams: [],
  dismissedNoCharacter: false
};

type PersonJson = {
  site_admin?: boolean | null;
  guild_officer?: boolean | null;
  boe_manager?: boolean | null;
  teams?: {
    team_id: number;
    team_member_id: number;
    role: string;
    characters: { player_id: number; name_realm: string; url_code: string | null; archived_at: string | null }[];
  }[];
} | null;

const asRole = (role: string): TeamRole => (role === 'officer' || role === 'team_leader' ? role : 'raider');

// resolve_person() (#941) answers for a Discord id, and the caller's own id
// comes from current_discord_id(), which reads auth.identities (#1135) rather
// than anything the browser can rewrite. Archived characters keep their link
// (#941) but are not claims, so they are dropped here.
export function toAccess(person: PersonJson, dismissedNoCharacter: boolean): Access {
  if (!person) return { ...NO_ACCESS, dismissedNoCharacter };
  return {
    siteAdmin: person.site_admin === true,
    guildOfficer: person.guild_officer === true,
    boeManager: person.boe_manager === true,
    teams: (person.teams ?? []).map((t) => ({
      teamId: t.team_id,
      teamMemberId: t.team_member_id,
      role: asRole(t.role),
      characters: t.characters
        .filter((c) => c.archived_at === null)
        .map((c) => ({ playerId: c.player_id, nameRealm: c.name_realm, urlCode: c.url_code }))
    })),
    dismissedNoCharacter
  };
}

export const accessKey = (userId: string | null) => ['access', userId] as const;

export function useAccess() {
  const { user } = useSession();
  return useSupabaseQuery<Access>(
    accessKey(user?.id ?? null),
    async (client) => {
      const [discord, dismissed] = await Promise.all([
        client.rpc('current_discord_id'),
        client
          .from('account_preferences')
          .select('id')
          .eq('auth_user_id', user!.id)
          .is('team_id', null)
          .eq('key', 'no_character_dismissed')
          .maybeSingle()
      ]);
      if (discord.error) return { data: null, error: discord.error };
      if (dismissed.error) return { data: null, error: dismissed.error };
      if (!discord.data) return { data: toAccess(null, dismissed.data !== null), error: null };
      const person = await client.rpc('resolve_person', { p_discord_id: discord.data });
      if (person.error) return { data: null, error: person.error };
      return { data: toAccess(person.data as PersonJson, dismissed.data !== null), error: null };
    },
    { enabled: user !== null }
  );
}

// What a page can ask. The database enforces every one of these on its own;
// this only decides what to show, so a wrong answer costs a button, never data.
export type Ability =
  // Officer pages and controls on a team: its officers and leader, a site
  // admin, or a guild officer (guild-wide view, #607).
  | 'viewOfficerTools'
  // Officer writes on a team. Leaves out guild officers: #607 gives them only
  // a few writes on other teams (player edits, attendance, bios), which the
  // officer pages add as their own abilities when they are built (#1103).
  | 'actAsOfficer'
  | 'leadTeam'
  | 'adminSite'
  | 'manageBoe';

export function teamRole(access: Access, teamId: number | null | undefined): TeamRole | null {
  if (teamId == null) return null;
  return access.teams.find((t) => t.teamId === teamId)?.role ?? null;
}

export function can(access: Access | null | undefined, ability: Ability, teamId?: number | null): boolean {
  if (!access) return false;
  const role = teamRole(access, teamId);
  const staffsTeam = role === 'officer' || role === 'team_leader';
  switch (ability) {
    case 'viewOfficerTools':
      return staffsTeam || access.siteAdmin || access.guildOfficer;
    case 'actAsOfficer':
      return staffsTeam || access.siteAdmin;
    case 'leadTeam':
      return role === 'team_leader' || access.siteAdmin;
    case 'adminSite':
      return access.siteAdmin;
    case 'manageBoe':
      return access.boeManager || access.siteAdmin;
  }
}

export function charactersOn(access: Access | null | undefined, teamId: number | null | undefined): Character[] {
  if (!access || teamId == null) return [];
  return access.teams.find((t) => t.teamId === teamId)?.characters ?? [];
}

export function hasAnyCharacter(access: Access): boolean {
  return access.teams.some((t) => t.characters.length > 0);
}
