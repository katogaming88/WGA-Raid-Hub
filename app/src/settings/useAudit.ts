import { readAll, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { formatAuditDetail, type AuditEntry } from './audit';

// Officer Settings: Audit log (#1358, #1103 row 1). audit_log only ever
// grows: every officer action appends a row and nothing prunes it. Team 1 was
// at 944 of the 1000-row cap when this was paged on the current site (#707),
// so the read goes through readAll() here too.

type AuditRow = {
  id: number;
  actor_id: string | null;
  action: string | null;
  target_type: string | null;
  target_id: number | null;
  detail: unknown;
  created_at: string;
};

const auditKey = (teamId: number) => ['audit-log', teamId] as const;

export function useAuditLog(teamId: number) {
  return useSupabaseQuery<AuditEntry[]>(auditKey(teamId), async (client) => {
    const rows = await readAll<AuditRow>((from, to) =>
      client
        .from('audit_log')
        .select('id, actor_id, action, target_type, target_id, detail, created_at')
        .eq('team_id', teamId)
        .order('id')
        .range(from, to)
    );
    if (rows.error) return { data: null, error: rows.error };

    const [actorNames, targetNames] = await Promise.all([
      resolveActorNames(client, rows.data!, teamId),
      resolveTargetNames(client, rows.data!, teamId)
    ]);

    const entries: AuditEntry[] = rows.data!.map((row) => ({
      id: row.id,
      ts: row.created_at,
      changedBy: row.actor_id ? (actorNames[row.actor_id] ?? '') : '',
      action: row.action ?? '',
      target: row.target_type === 'players' && row.target_id != null ? (targetNames[row.target_id] ?? '') : '',
      detail: formatAuditDetail(row.detail)
    }));
    entries.sort((a, b) => (a.ts === b.ts ? b.id - a.id : a.ts < b.ts ? 1 : -1));
    return { data: entries, error: null };
  });
}

function uniqueNonNull<T>(values: (T | null)[]): T[] {
  return [...new Set(values.filter((v): v is T => v != null))];
}

// Resolves each distinct actor_id through resolve_actor_name(). A failed
// lookup (the caller isn't authorized for this team, or the actor no longer
// resolves to anything) degrades to a blank name rather than blocking the
// rest of the log from rendering.
async function resolveActorNames(client: Client, rows: AuditRow[], teamId: number): Promise<Record<string, string>> {
  const ids = uniqueNonNull(rows.map((r) => r.actor_id));
  if (!ids.length) return {};
  const results = await Promise.all(
    ids.map(async (id) => {
      const result = await client.rpc('resolve_actor_name', { p_actor_id: id, p_team_id: teamId });
      return [id, result.error ? '' : ((result.data as string | null) ?? '')] as const;
    })
  );
  return Object.fromEntries(results);
}

// target_type = 'players' is the only kind any officer write flow logs today
// -- extend this when a new target_type shows up in practice instead of
// guessing at a generic resolver now.
async function resolveTargetNames(client: Client, rows: AuditRow[], teamId: number): Promise<Record<number, string>> {
  const ids = uniqueNonNull(rows.filter((r) => r.target_type === 'players').map((r) => r.target_id));
  if (!ids.length) return {};
  const result = await client.from('players').select('id, name_realm').eq('team_id', teamId).in('id', ids);
  if (result.error) return {};
  const players = (result.data ?? []) as { id: number; name_realm: string }[];
  return Object.fromEntries(players.map((p) => [p.id, p.name_realm]));
}
