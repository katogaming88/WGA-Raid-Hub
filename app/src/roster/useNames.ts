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
      client.from('names').select('id, label, team_member_id').eq('team_id', teamId).order('id').range(from, to)
    )
  );
}

// Officer: a bare Name, unclaimed until someone claims or is assigned it.
export function useCreateName(teamId: number) {
  return useSupabaseMutation<null, { label: string }>(
    async (client, { label }) => {
      const result = await client.from('names').insert({ team_id: teamId, label });
      if (result.error) return result;
      await writeAuditLog(client, teamId, 'Name Created', null, label);
      return { data: null, error: null };
    },
    { key: ['create-name', teamId], refreshes: [key(teamId)] }
  );
}

export function useRenameName(teamId: number) {
  return useSupabaseMutation<null, { nameId: number; label: string }>(
    async (client, { nameId, label }) => {
      const result = await client.from('names').update({ label }).eq('id', nameId);
      if (result.error) return result;
      await writeAuditLog(client, teamId, 'Name Renamed', nameId, label);
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

// Officer: someone left. Takes the names row down with the membership.
export function useDeleteTeamMember(teamId: number) {
  return useSupabaseMutation<null, { teamMemberId: number }>(
    async (client, { teamMemberId }) => {
      const result = await client.rpc('delete_team_member', { p_team_id: teamId, p_team_member_id: teamMemberId });
      return { data: null, error: result.error };
    },
    { key: ['delete-team-member', teamId], refreshes: [key(teamId)] }
  );
}
