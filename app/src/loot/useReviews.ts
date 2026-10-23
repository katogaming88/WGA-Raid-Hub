import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import { itemName, type ReviewRow } from './reviews';

const reviewsKey = (teamId: number) => ['loot-reviews', teamId] as const;

// A decision changes what counts as received: the raider's profile, the
// Priority page and Guild home's waiting count all read again.
const refreshes = (teamId: number) => [
  reviewsKey(teamId),
  ['self-received'],
  ['priority-data', teamId],
  ['guild-attention']
];

// Waiting and decided together, newest first. The admin Danger zone clears
// them each season, but a team-wide read pages anyway.
export function useReviews(teamId: number) {
  return useSupabaseQuery<ReviewRow[]>(reviewsKey(teamId), async (client) => {
    const rows = await readAll<ReviewRow>((from, to) =>
      client
        .from('self_received_requests')
        .select(
          'id, status, track, source, note, officer_notes, slot, submitted_at, player_id, players(name_realm, classes_specs(class)), items(name, slot, wow_item_id, is_ptr, icon)'
        )
        .eq('team_id', teamId)
        .order('id')
        .range(from, to)
    );
    if (rows.error) return rows;
    return { data: rows.data!.sort((a, b) => (a.submitted_at < b.submitted_at ? 1 : -1)), error: null };
  });
}

// Best-effort, like the current site's writeAuditLog() and notifyPlayer(): the
// decision is saved either way.
async function tell(client: Client, teamId: number, row: ReviewRow, action: string, detail: string, message: string) {
  try {
    await client.rpc('write_audit_log', {
      p_team_id: teamId,
      p_action: action,
      ...(row.player_id != null ? { p_target_type: 'players', p_target_id: row.player_id } : {}),
      p_detail: detail
    });
    if (row.player_id != null) await client.rpc('notify_player', { p_player_id: row.player_id, p_message: message });
  } catch {
    // Already saved.
  }
}

export type Decision = { row: ReviewRow; to: 'approved' | 'rejected' | 'pending'; reason?: string };

// A plain update, as on the current site: officers may update their team's
// rows, and the team-check trigger re-validates the player's team.
export function useDecide(teamId: number) {
  return useSupabaseMutation<null, Decision>(
    async (client, { row, to, reason }) => {
      const result = await client
        .from('self_received_requests')
        .update(to === 'rejected' ? { status: to, officer_notes: reason || null } : { status: to })
        .eq('id', row.id)
        .eq('team_id', teamId);
      if (result.error) return result;
      const item = itemName(row);
      if (to === 'approved') {
        await tell(
          client,
          teamId,
          row,
          'Self-Received Approved',
          item,
          `Your self-received item (${item}) was approved.`
        );
      } else if (to === 'rejected') {
        await tell(
          client,
          teamId,
          row,
          'Self-Received Rejected',
          item + (reason ? ` -- ${reason}` : ''),
          `Your self-received item (${item}) was rejected.${reason ? ` Reason: ${reason}` : ''}`
        );
      } else {
        await tell(
          client,
          teamId,
          row,
          'Self-Received Reverted',
          `Back to pending: ${item} (was ${row.status})`,
          `Your self-received item (${item}) was returned to pending review.`
        );
      }
      return { data: null, error: null };
    },
    { key: ['decide-review', teamId], refreshes: refreshes(teamId) }
  );
}

// delete_self_received_request() checks the officer against the row's own
// team and writes the audit entry itself, since the row is gone after.
export function useDeleteReview(teamId: number) {
  return useSupabaseMutation<null, ReviewRow>(
    async (client, row) => {
      const result = await client.rpc('delete_self_received_request', { p_id: row.id });
      return result.error ? { data: null, error: result.error } : { data: null, error: null };
    },
    { key: ['delete-review', teamId], refreshes: refreshes(teamId) }
  );
}
