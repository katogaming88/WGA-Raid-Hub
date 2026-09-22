import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { BoeCatalogRow, BoeItemRow, BoeListingRow } from './boe';

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

// The lifecycle view's two reads (#1305), unfiltered by team like the current
// site's buildBoeManage(): RLS already scopes a raider to their own rows and
// an officer to their staffed teams, so an unfiltered read renders correctly
// for every role. Paged past the 1000-row API cap since both tables only grow.
export function useBoeItems(enabled = true) {
  return useSupabaseQuery<BoeItemRow[]>(
    ['boe-items'],
    (client) =>
      readAll<BoeItemRow>((from, to) =>
        client
          .from('boe_items')
          .select(
            'id, team_id, finder_name, item_name, track, upgrade_rank, note, status, found_at, sold_at, payout_paid_at, retired_at, sale_price, finder_payout, guild_cut, ah_fee, payout_donated'
          )
          .order('id', { ascending: true })
          .range(from, to)
      ),
    { enabled }
  );
}

export function useBoeListings(enabled = true) {
  return useSupabaseQuery<BoeListingRow[]>(
    ['boe-listings'],
    (client) =>
      readAll<BoeListingRow>((from, to) =>
        client
          .from('boe_listings')
          .select('id, boe_item_id, listed_at, price, note')
          .order('id', { ascending: true })
          .range(from, to)
      ),
    { enabled }
  );
}

export function useRecordListing() {
  return useSupabaseMutation<void, { id: number; price: number; note: string | null }>(
    (client, v) =>
      client.rpc('boe_record_listing', { p_id: v.id, p_price: v.price, ...(v.note ? { p_note: v.note } : {}) }),
    { key: ['boe-record-listing'], refreshes: [['boe-items'], ['boe-listings'], ['guild-attention']] }
  );
}

export type SaleSplit = { sale_price: number; finder_payout: number; guild_cut: number; ah_fee: number };

export function useRecordSale() {
  return useSupabaseMutation<SaleSplit[], { id: number; price: number }>(
    async (client, v) => {
      const result = await client.rpc('boe_record_sale', { p_id: v.id, p_sale_price: v.price });
      if (result.error) return result;
      // The finder hears their BoE sold from Discord (#873), fire and forget:
      // the row update above is the write of record, and an outage here must
      // not make a recorded sale look like it failed.
      client.functions.invoke('boe-sold-webhook', { body: { id: v.id } }).catch(() => {});
      return result;
    },
    { key: ['boe-record-sale'], refreshes: [['boe-items'], ['guild-attention']] }
  );
}

export function useMarkPaid() {
  return useSupabaseMutation<void, { id: number; donated: boolean }>(
    (client, v) => client.rpc('boe_mark_paid', { p_id: v.id, p_donated: v.donated }),
    { key: ['boe-mark-paid'], refreshes: [['boe-items']] }
  );
}

export function useRetireBoe() {
  return useSupabaseMutation<void, { id: number }>((client, v) => client.rpc('boe_retire', { p_id: v.id }), {
    key: ['boe-retire'],
    refreshes: [['boe-items'], ['guild-attention']]
  });
}

export function useRevertBoe() {
  return useSupabaseMutation<string, { id: number }>((client, v) => client.rpc('boe_revert', { p_id: v.id }), {
    key: ['boe-revert'],
    refreshes: [['boe-items'], ['guild-attention']]
  });
}

export function useEditBoeItem() {
  return useSupabaseMutation<
    void,
    {
      id: number;
      itemName: string;
      track: string | null;
      note: string | null;
      itemId: number | null;
      rank: string | null;
    }
  >(
    // The generated Args type marks these non-nullable text params, but the
    // function accepts null for each (clearing a track, note, catalog link
    // or rank); the generator has no way to see that from the SQL signature.
    (client, v) =>
      client.rpc('boe_edit_item', {
        p_id: v.id,
        p_item_name: v.itemName,
        p_track: v.track as string,
        p_note: v.note as string,
        p_item_id: v.itemId as number,
        p_upgrade_rank: v.rank as string
      }),
    { key: ['boe-edit-item'], refreshes: [['boe-items']] }
  );
}
