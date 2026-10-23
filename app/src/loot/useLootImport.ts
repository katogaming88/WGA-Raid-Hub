import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import { resolveActorNames, resolveTargetNames, type AuditRow } from '../settings/useAudit';
import { groupImports, type ImportCounts, type ImportEvent, type RclcRow } from './lootImport';

export const IMPORT_ACTION = 'Loot Imported (RCLC)';

export type ImportHistory = {
  events: ImportEvent[];
  actorNames: Record<string, string>;
  playerNames: Record<number, string>;
  seasonNames: Record<string, string>;
};

const historyKey = (teamId: number) => ['loot-import-history', teamId] as const;

// Read from audit_log, not rclc_loot: only a real paste logs this action,
// while rclc_loot also holds the rows the #320 history import merged in.
export function useImportHistory(teamId: number) {
  return useSupabaseQuery<ImportHistory>(historyKey(teamId), async (client) => {
    const [rows, seasons] = await Promise.all([
      readAll<AuditRow>((from, to) =>
        client
          .from('audit_log')
          .select('id, actor_id, action, target_type, target_id, detail, created_at')
          .eq('team_id', teamId)
          .eq('action', IMPORT_ACTION)
          .order('id')
          .range(from, to)
      ),
      client.from('seasons').select('code, display_name')
    ]);
    if (rows.error) return { data: null, error: rows.error };
    if (seasons.error) return { data: null, error: seasons.error };
    const [actorNames, playerNames] = await Promise.all([
      resolveActorNames(client, rows.data!, teamId),
      resolveTargetNames(client, rows.data!, teamId)
    ]);
    return {
      data: {
        events: groupImports(rows.data!),
        actorNames,
        playerNames,
        seasonNames: Object.fromEntries((seasons.data ?? []).map((s) => [s.code, s.display_name]))
      },
      error: null
    };
  });
}

export function useImportLoot(teamId: number) {
  return useSupabaseMutation<ImportCounts, { season: string; rows: RclcRow[] }>(
    (client, { season, rows }) =>
      client.rpc('import_rclc_loot', { p_team_id: teamId, p_season: season, p_rows: rows }) as PromiseLike<{
        data: ImportCounts | null;
        error: { message: string } | null;
      }>,
    // New awards change who has what, so the Priority page reads again.
    { key: ['import-loot', teamId], refreshes: [historyKey(teamId), ['priority-data', teamId]] }
  );
}
