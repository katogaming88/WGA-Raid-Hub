import type { UseQueryResult } from '@tanstack/react-query';
import { previewTeamKeys } from '../config';
import { useAddress } from '../data/address';
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
    archived_at?: string | null;
    characters: { player_id: number; name_realm: string; url_code: string | null; archived_at: string | null }[];
  }[];
} | null;

const asRole = (role: string): TeamRole => (role === 'officer' || role === 'team_leader' ? role : 'raider');

// resolve_person() (#941) answers for a Discord id, and the caller's own id
// comes from current_discord_id(), which reads auth.identities (#1135) rather
// than anything the browser can rewrite. Archived characters keep their link
// (#941) but are not claims, so they are dropped here, and so is a team whose
// membership an officer archived (#1400), which resolve_person() still returns
// so an officer looking the person up sees it.
export function toAccess(person: PersonJson, dismissedNoCharacter: boolean): Access {
  if (!person) return { ...NO_ACCESS, dismissedNoCharacter };
  return {
    siteAdmin: person.site_admin === true,
    guildOfficer: person.guild_officer === true,
    boeManager: person.boe_manager === true,
    teams: (person.teams ?? [])
      .filter((t) => !t.archived_at)
      .map((t) => ({
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

// The teams this person may see on the preview (#1676): null shows every
// team (no list set, or a site admin), undefined while their access loads.
// A guard against editing a real team by mistake, not a lock: the database
// lets them do whatever it lets them do on the current site.
export function usePreviewTeams(): ReadonlySet<string> | null | undefined {
  const keys = previewTeamKeys();
  const { user } = useSession();
  const access = useAccess();
  if (!keys) return null;
  if (user && access.isPending) return undefined;
  return access.data?.siteAdmin ? null : new Set(keys);
}

// What the signed-in person's rank may do on the open team and its guild,
// from my_permissions() (#1649): the same grids the database asks, so a screen
// shows what the database will let them do.
export type Permissions = { team: ReadonlySet<string>; guild: ReadonlySet<string> };
export const NO_PERMISSIONS: Permissions = { team: new Set(), guild: new Set() };

export function usePermissions(teamId: number | null | undefined, guildId: number | null | undefined) {
  const { user } = useSession();
  return useSupabaseQuery<Permissions>(
    ['permissions', user?.id ?? null, teamId ?? null, guildId ?? null],
    async (client) => {
      const { data, error } = await client.rpc('my_permissions', {
        ...(teamId != null ? { p_team_id: teamId } : {}),
        ...(guildId != null ? { p_guild_id: guildId } : {})
      });
      if (error) return { data: null, error };
      const grid = data as { team?: string[]; guild?: string[] } | null;
      return { data: { team: new Set(grid?.team ?? []), guild: new Set(grid?.guild ?? []) }, error: null };
    },
    { enabled: user !== null && (teamId != null || guildId != null) }
  );
}

// What a page can ask. The database enforces every one of these on its own;
// this only decides what to show, so a wrong answer costs a button, never data.
// Each one names the permission it reads, on the open team or its guild.
// A site admin passes the team ones: the database lets them.
export type Ability =
  // Any officer page at all: the person's rank has some officer tool on the team.
  | 'viewOfficerTools'
  | 'editRoster'
  | 'editSchedule'
  | 'seeRsvps'
  | 'manageAttendance'
  | 'viewReports'
  | 'viewLoot'
  | 'manageLoot'
  | 'viewAuditLog'
  // Team settings and the team's officer cards. No grid permission means "Team
  // Owner" (team_settings writes are the Owner's), so these ask
  // promote_assistants, which only an Officer and the Owner hold, until a
  // settings permission exists.
  | 'manageTeam'
  // Saving team settings that are the Owner's alone (loot buttons, signups).
  | 'leadTeam'
  | 'adminSite'
  // BoE sales, guild-wide: record_boe or pay_any_boe on the guild grid.
  | 'manageBoe'
  // Editing a raid boss's own data (its cap, #1244): the cap is Blizzard's,
  // the same for every guild, so only a site admin keeps it right (#1324).
  | 'manageRaidReference'
  // The Guild officers page's bios (#1361): edit_all_bios, or edit_own_bio
  // for the caller's own card (#1647).
  | 'editGuildOfficers'
  // Guild settings (#1644): adding, renaming, archiving and unlisting teams.
  | 'manageTeams'
  // Into a guild's pages without a team of one's own (#1264): the guild
  // grid's "See every team (read-only)".
  | 'viewEveryTeam';

const OFFICER_TOOLS = [
  'edit_roster',
  'edit_schedule',
  'see_rsvps',
  'attendance',
  'manage_signups',
  'view_reports',
  'view_loot',
  'manage_loot',
  'pay_boe_cuts',
  'view_team_audit_log'
];

export function teamRole(access: Access, teamId: number | null | undefined): TeamRole | null {
  if (teamId == null) return null;
  return access.teams.find((t) => t.teamId === teamId)?.role ?? null;
}

export function can(
  access: Access | null | undefined,
  ability: Ability,
  perms: Permissions | null | undefined,
  teamId?: number | null
): boolean {
  if (!access) return false;
  const team = (...names: string[]) => names.some((n) => perms?.team.has(n));
  const guild = (...names: string[]) => names.some((n) => perms?.guild.has(n));
  const admin = access.siteAdmin;
  switch (ability) {
    case 'viewOfficerTools':
      return admin || team(...OFFICER_TOOLS);
    case 'editRoster':
      return admin || team('edit_roster');
    case 'editSchedule':
      return admin || team('edit_schedule');
    case 'seeRsvps':
      return admin || team('see_rsvps');
    case 'manageAttendance':
      return admin || team('attendance');
    case 'viewReports':
      return admin || team('view_reports');
    case 'viewLoot':
      return admin || team('view_loot', 'manage_loot');
    case 'manageLoot':
      return admin || team('manage_loot');
    case 'viewAuditLog':
      return admin || team('view_team_audit_log');
    case 'manageTeam':
      return admin || team('promote_assistants');
    case 'leadTeam':
      return admin || teamRole(access, teamId) === 'team_leader';
    case 'adminSite':
      return admin;
    case 'manageBoe':
      return admin || guild('record_boe', 'pay_any_boe');
    case 'manageTeams':
      return guild('create_teams', 'rename_archive_teams');
    case 'viewEveryTeam':
      return guild('view_every_team');
    case 'manageRaidReference':
      return admin;
    case 'editGuildOfficers':
      return admin || guild('edit_all_bios', 'edit_own_bio');
  }
}

// What `can` answers for the open page: the team and guild it is on.
// `loading` is true while either is still loading, so a page can wait
// instead of flashing "closed".
export function useCan(teamId: number | null | undefined, guildId: number | null | undefined) {
  const access = useAccess();
  const perms = usePermissions(teamId, guildId);
  const loading = access.isPending || (perms.isPending && perms.fetchStatus !== 'idle');
  return {
    loading,
    error: access.isError || perms.isError,
    // The read to show while loading or failed: access first, then permissions.
    query: (access.isSuccess ? perms : access) as UseQueryResult<unknown>,
    can: (ability: Ability) => can(access.data, ability, perms.data, teamId)
  };
}

export function charactersOn(access: Access | null | undefined, teamId: number | null | undefined): Character[] {
  if (!access || teamId == null) return [];
  return access.teams.find((t) => t.teamId === teamId)?.characters ?? [];
}

export function hasAnyCharacter(access: Access): boolean {
  return access.teams.some((t) => t.characters.length > 0);
}

// The teams where the caller's rank has one team permission, for lists that
// span teams (BoE rows, the guild home's waiting work).
export function usePermissionTeams(permission: string) {
  const { user } = useSession();
  return useSupabaseQuery<ReadonlySet<number>>(
    ['permission-teams', user?.id ?? null, permission],
    async (client) => {
      const { data, error } = await client.rpc('my_permission_team_ids', { p_permission: permission });
      if (error) return { data: null, error };
      return { data: new Set<number>(data ?? []), error: null };
    },
    { enabled: user !== null }
  );
}

// useCan for the page being shown: its team (none on a guild page) and guild.
export function usePageCan() {
  const { team, guild } = useAddress();
  return useCan(team?.id, guild.id);
}
