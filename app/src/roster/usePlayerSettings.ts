import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';

// Player settings (#1360): what an officer sets on one roster character, in
// the panel the roster row menu and the Profile open. Ported from
// js/tabs/tab-roster.js's updateRosterFieldSupabase() and
// updateClassSpecSupabase(), with the same columns and audit entries.

export type SettingsPlayer = {
  id: number;
  name_realm: string;
  class_spec_id: number | null;
  join_date: string | null;
  is_trial: boolean;
  is_bench: boolean;
  is_backup_tank: boolean;
  is_backup_healer: boolean;
  m_plus_excluded: boolean;
  officer_notes: string | null;
};

export type Flag = 'is_trial' | 'is_bench' | 'is_backup_tank' | 'is_backup_healer' | 'm_plus_excluded';

// The switches, in the panel's order, each with what it means and the audit
// wording the current site writes.
export const FLAGS: { flag: Flag; label: string; help: string; audit: string; on: string; off: string }[] = [
  {
    flag: 'is_trial',
    label: 'Trial',
    help: 'New to the team, still being looked at.',
    audit: 'Trial Status Changed',
    on: 'Trial added',
    off: 'Trial removed'
  },
  {
    flag: 'is_bench',
    label: 'Bench',
    help: 'Sits out unless asked in.',
    audit: 'Bench Status Changed',
    on: 'Moved to bench',
    off: 'Removed from bench'
  },
  {
    flag: 'is_backup_tank',
    label: 'Backup tank',
    help: 'Can tank when a tank is out.',
    audit: 'Backup Tank Status Changed',
    on: 'Marked as backup tank',
    off: 'Backup tank removed'
  },
  {
    flag: 'is_backup_healer',
    label: 'Backup healer',
    help: 'Can heal when a healer is out.',
    audit: 'Backup Healer Status Changed',
    on: 'Marked as backup healer',
    off: 'Backup healer removed'
  },
  {
    flag: 'm_plus_excluded',
    label: 'Left out of M+',
    help: 'Not counted in Mythic+ checks.',
    audit: 'M+ Exclusion Toggled',
    on: 'Excluded',
    off: 'Exclusion removed'
  }
];

const settingsKey = (teamId: number, playerId: number) => ['player-settings', teamId, playerId] as const;

export function usePlayerSettings(teamId: number, playerId: number) {
  return useSupabaseQuery<SettingsPlayer | null>(settingsKey(teamId, playerId), async (client) => {
    const [player, note] = await Promise.all([
      client
        .from('players')
        .select(
          'id, name_realm, class_spec_id, join_date, is_trial, is_bench, is_backup_tank, is_backup_healer, m_plus_excluded'
        )
        .eq('id', playerId)
        .eq('team_id', teamId)
        .maybeSingle(),
      client.from('player_officer_notes').select('officer_notes').eq('player_id', playerId).maybeSingle()
    ]);
    if (player.error) return { data: null, error: player.error };
    if (note.error) return { data: null, error: note.error };
    return {
      data: player.data ? { ...player.data, officer_notes: note.data?.officer_notes ?? null } : null,
      error: null
    };
  });
}

async function writeAuditLog(client: Client, teamId: number, action: string, playerId: number, detail: string) {
  // Best-effort like useNames.ts's writeAuditLog: a failed audit log entry
  // does not undo the write it was describing.
  try {
    await client.rpc('write_audit_log', {
      p_team_id: teamId,
      p_action: action,
      p_target_type: 'players',
      p_target_id: playerId,
      p_detail: detail
    });
  } catch {
    // The write is already recorded either way.
  }
}

// One change from the panel. Each saves on its own, the moment it is made,
// so a failed one never takes others with it (the current site's one Save
// chained four writes and kept the first ones when a later one failed).
export type SettingsChange =
  | { kind: 'flag'; flag: Flag; value: boolean }
  | { kind: 'spec'; classSpecId: number; label: string }
  | { kind: 'joinDate'; value: string | null }
  | { kind: 'note'; value: string | null };

export function useSavePlayerSetting(teamId: number) {
  return useSupabaseMutation<null, { playerId: number; change: SettingsChange }>(
    async (client, { playerId, change }) => {
      if (change.kind === 'note') {
        // The note lives on player_officer_notes since #925. Clearing one
        // updates the row in place, so a player with none never gains a
        // blank row (#1133).
        const result = change.value
          ? await client
              .from('player_officer_notes')
              .upsert(
                { player_id: playerId, team_id: teamId, officer_notes: change.value },
                { onConflict: 'player_id' }
              )
          : await client.from('player_officer_notes').update({ officer_notes: null }).eq('player_id', playerId);
        if (result.error) return { data: null, error: result.error };
        await writeAuditLog(
          client,
          teamId,
          'Officer Note Changed',
          playerId,
          change.value ? `Changed to ${change.value}` : 'Cleared'
        );
        return { data: null, error: null };
      }
      const values =
        change.kind === 'flag'
          ? { [change.flag]: change.value }
          : change.kind === 'spec'
            ? { class_spec_id: change.classSpecId }
            : { join_date: change.value };
      const result = await client.from('players').update(values).eq('id', playerId).eq('team_id', teamId);
      if (result.error) return { data: null, error: result.error };
      if (change.kind === 'flag') {
        const f = FLAGS.find((x) => x.flag === change.flag)!;
        await writeAuditLog(client, teamId, f.audit, playerId, change.value ? f.on : f.off);
      } else if (change.kind === 'spec') {
        await writeAuditLog(client, teamId, 'Spec Changed', playerId, `Changed to ${change.label}`);
      } else {
        await writeAuditLog(client, teamId, 'Join Date Changed', playerId, `Changed to ${change.value ?? 'none'}`);
      }
      return { data: null, error: null };
    },
    {
      key: ['save-player-setting', teamId],
      // The roster's tags and specs and the Profile's details read the same
      // columns.
      refreshes: [
        ['player-settings', teamId],
        ['roster', teamId],
        ['profile-player', teamId]
      ]
    }
  );
}
