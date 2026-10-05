import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { NameRow } from './names';

const key = (teamId: number) => ['names', teamId] as const;

async function writeAuditLog(
  client: Client,
  teamId: number,
  action: string,
  targetId: number | null,
  detail: string | null
) {
  // Best-effort like useAttendance.ts's writeAuditLog: a failed audit log
  // entry does not undo the write it was describing.
  try {
    await client.rpc('write_audit_log', {
      p_team_id: teamId,
      p_action: action,
      ...(targetId !== null ? { p_target_type: 'names', p_target_id: targetId } : {}),
      p_detail: detail
    });
  } catch {
    // The write is already recorded either way.
  }
}

export function useNames(teamId: number) {
  return useSupabaseQuery<NameRow[]>(key(teamId), (client) =>
    readAll<NameRow>((from, to) =>
      client.from('names').select('id, label, team_member_id, role').eq('team_id', teamId).order('id').range(from, to)
    )
  );
}

// Officer: a bare Name, unclaimed until someone claims or is assigned it.
// role is the raid role it's expected to fill, so it can sit under that tab
// before it has a character; null when the officer doesn't know yet.
export function useCreateName(teamId: number) {
  return useSupabaseMutation<null, { label: string; role: string | null }>(
    async (client, { label, role }) => {
      const result = await client.from('names').insert({ team_id: teamId, label, role });
      if (result.error) return result;
      await writeAuditLog(client, teamId, 'Name Created', null, role ? `${label} (${role})` : label);
      return { data: null, error: null };
    },
    { key: ['create-name', teamId], refreshes: [key(teamId)] }
  );
}

// role is only meaningful while the Name is still bare -- ignored by the
// database once claimed, but the caller only offers the field then too.
export function useRenameName(teamId: number) {
  return useSupabaseMutation<null, { nameId: number; label: string; role: string | null }>(
    async (client, { nameId, label, role }) => {
      const result = await client.from('names').update({ label, role }).eq('id', nameId);
      if (result.error) return result;
      await writeAuditLog(client, teamId, 'Name Renamed', nameId, role ? `${label} (${role})` : label);
      return { data: null, error: null };
    },
    { key: ['rename-name', teamId], refreshes: [key(teamId)] }
  );
}

// Officer: fixes a wrong self-service claim. The label survives, bare.
export function useRemoveNameClaim(teamId: number) {
  return useSupabaseMutation<null, { nameId: number }>(
    async (client, { nameId }) => {
      const result = await client.from('names').update({ team_member_id: null }).eq('id', nameId);
      if (result.error) return result;
      await writeAuditLog(client, teamId, 'Name Claim Removed', nameId, null);
      return { data: null, error: null };
    },
    { key: ['remove-name-claim', teamId], refreshes: [key(teamId)] }
  );
}

// Self-service: the raider picks their own bare Name off the list.
export function useClaimName(teamId: number) {
  return useSupabaseMutation<null, { nameId: number }>(
    async (client, { nameId }) => {
      const result = await client.rpc('claim_name', { p_team_id: teamId, p_name_id: nameId });
      return { data: null, error: result.error };
    },
    { key: ['claim-name', teamId], refreshes: [key(teamId), ['access']] }
  );
}

// The six reasons archive_team_member() and archive_player() both take
// (player_officer_notes.archived_reason), so a membership and its
// characters are archived with the same vocabulary.
export const ARCHIVE_REASONS: { value: string; label: string }[] = [
  { value: 'schedule_conflict', label: 'Schedule conflict' },
  { value: 'performance', label: 'Performance' },
  { value: 'drama', label: 'Drama' },
  { value: 'moved_guilds', label: 'Moved guilds' },
  { value: 'switching_mains', label: 'Switching mains' },
  { value: 'other', label: 'Other' }
];

// Officer: someone left. Archives the membership and their active
// characters (never deletes either, #1423), so the roster read needs
// refreshing too, alongside this team's Names, and so does the membership
// read a name-only row depends on.
export function useArchiveTeamMember(teamId: number) {
  return useSupabaseMutation<null, { teamMemberId: number; reason: string; detail: string }>(
    async (client, { teamMemberId, reason, detail }) => {
      const result = await client.rpc('archive_team_member', {
        p_team_id: teamId,
        p_team_member_id: teamMemberId,
        p_reason: reason,
        p_detail: detail
      });
      return { data: null, error: result.error };
    },
    { key: ['archive-team-member', teamId], refreshes: [key(teamId), ['roster', teamId], ['team-alts', teamId]] }
  );
}

// Officer: removes a bare Name outright (never claimed), a plain table
// delete under the same officer-write policy create/rename/assign use.
export function useDeleteName(teamId: number) {
  return useSupabaseMutation<null, { nameId: number }>(
    async (client, { nameId }) => {
      const result = await client.from('names').delete().eq('id', nameId);
      if (result.error) return result;
      await writeAuditLog(client, teamId, 'Name Deleted', nameId, null);
      return { data: null, error: null };
    },
    { key: ['delete-name', teamId], refreshes: [key(teamId)] }
  );
}
