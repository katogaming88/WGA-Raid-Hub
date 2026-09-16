import { useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { ClassSpec, ReviewRow, SwapRequest } from './mainSwap';

// Reading and writing main swap requests (#631, #942 step 5c). Who may read
// one is the database's call: the raider it belongs to, their team's officers,
// site admins and guild officers. The three writes are functions, because each
// is a roster change wearing a request's clothes.

const REQUEST_COLUMNS =
  'id, team_id, person_id, from_player_id, character_id, name_realm, class_spec_id, note, status, requested_at';

// The raider's own request waiting on this team, if there is one.
export function useMyMainSwap(teamId: number, personId: number | null) {
  return useSupabaseQuery<SwapRequest | null>(
    ['my-main-swap', teamId, personId],
    async (client) => {
      const { data, error } = await client
        .from('main_swap_requests')
        .select(REQUEST_COLUMNS)
        .eq('team_id', teamId)
        .eq('person_id', personId!)
        .eq('status', 'pending')
        .order('id')
        .limit(1);
      if (error) return { data: null, error };
      return { data: ((data ?? []) as unknown as SwapRequest[])[0] ?? null, error: null };
    },
    { enabled: personId !== null }
  );
}

// Every request waiting on the team, for the officer panel on the roster.
// players is named twice on this table (the character they are on, and the one
// an approval landed on), so the read names the foreign key it means.
export function useTeamMainSwaps(teamId: number, enabled: boolean) {
  return useSupabaseQuery<ReviewRow[]>(
    ['team-main-swaps', teamId],
    async (client) => {
      const { data, error } = await client
        .from('main_swap_requests')
        .select(
          `${REQUEST_COLUMNS}, from_player:players!main_swap_requests_from_player_id_fkey(name_realm), classes_specs(class, spec, role)`
        )
        .eq('team_id', teamId)
        .eq('status', 'pending')
        .order('requested_at');
      if (error) return { data: null, error };
      return { data: (data ?? []) as unknown as ReviewRow[], error: null };
    },
    { enabled }
  );
}

// Every class and spec, for the dialog's spec picker. A lookup table the whole
// app can read, so it is cached under its own key with no team in it.
export function useClassSpecs() {
  return useSupabaseQuery<ClassSpec[]>(['class-specs'], (client) =>
    client.from('classes_specs').select('id, class, spec, role')
  );
}

// After a write, everything that could now be wrong. An approval moves a
// raider onto another character, so the roster, the profile, what the signed-in
// person may open and the alt lists all read again.
const AFTER_REVIEW = [
  ['my-main-swap'],
  ['team-main-swaps'],
  ['roster'],
  ['profile-player'],
  ['person-of-player'],
  ['person-characters'],
  ['team-alts'],
  ['earlier-loot'],
  ['access']
];

export type MainSwapAsk = { characterId: number; classSpecId: number; note: string };

export function useRequestMainSwap(teamId: number) {
  return useSupabaseMutation<number, MainSwapAsk>(
    async (client, ask) => {
      const { data, error } = await client.rpc('request_main_swap', {
        p_team_id: teamId,
        p_character_id: ask.characterId,
        p_class_spec_id: ask.classSpecId,
        p_note: ask.note
      });
      return { data: data as number, error };
    },
    { key: ['request-main-swap', teamId], refreshes: [['my-main-swap'], ['team-main-swaps']] }
  );
}

export function useCancelMainSwap(teamId: number) {
  return useSupabaseMutation<null, { requestId: number }>(
    async (client, { requestId }) => {
      const { error } = await client.rpc('cancel_main_swap_request', { p_request_id: requestId });
      return { data: null, error };
    },
    { key: ['cancel-main-swap', teamId], refreshes: [['my-main-swap'], ['team-main-swaps']] }
  );
}

export function useReviewMainSwap(teamId: number) {
  return useSupabaseMutation<number | null, { requestId: number; approve: boolean; note: string }>(
    async (client, review) => {
      const { data, error } = await client.rpc('review_main_swap_request', {
        p_request_id: review.requestId,
        p_approve: review.approve,
        p_note: review.note
      });
      return { data: (data as number | null) ?? null, error };
    },
    { key: ['review-main-swap', teamId], refreshes: AFTER_REVIEW }
  );
}
