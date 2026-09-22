import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { BoeCatalogRow } from './boe';

// The BoE catalog (#1304), select-only like the current site (#877): a BoE
// missing from the catalog can't be reported until the catalog gains one.
export function useBoeCatalog() {
  return useSupabaseQuery<BoeCatalogRow[]>(['boe-catalog'], (client) =>
    client.from('items').select('id, name, wcl_zone_id').eq('is_boe', true)
  );
}

export type BoeReport = {
  teamId: number;
  nameRealm: string;
  itemName: string;
  track: string;
  rank: string;
  note: string | null;
  donate: boolean;
};

// Best-effort Discord notice; the RPC insert is the write of record, so a
// failed notice does not undo it (same stance as profile/useProfile.ts's
// notifyOfficers).
async function notifyBoeWebhook(client: Client, id: number) {
  try {
    await client.functions.invoke('boe-webhook', { body: { id } });
  } catch {
    // The find is already recorded either way.
  }
}

export function useSubmitBoeFound() {
  return useSupabaseMutation<number, BoeReport>(
    async (client, report) => {
      const { data, error } = await client.rpc('submit_boe_found', {
        p_team_id: report.teamId,
        p_name_realm: report.nameRealm,
        p_item_name: report.itemName,
        p_track: report.track,
        p_donate: report.donate,
        p_upgrade_rank: report.rank,
        ...(report.note ? { p_note: report.note } : {})
      });
      if (error) return { data: null, error };
      await notifyBoeWebhook(client, data);
      return { data, error: null };
    },
    { key: ['submit-boe-found'], refreshes: [['guild-attention']] }
  );
}
