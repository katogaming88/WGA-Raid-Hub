import { useQueryClient } from '@tanstack/react-query';
import { readAll, useSupabaseMutation, useSupabaseQuery } from '../data/query';
import type { Client } from '../lib/supabase';
import type { LootRow, SeasonWindow } from '../profile/profile';
import type { CharactersAnswer, EarlierPair, EarlierPlayer, SavedCharacter } from './characters';

const CHARACTER_COLUMNS = 'id, person_id, name, realm, class_name, spec_name, item_level';

// The person behind a roster row. Read through the membership, which only the
// raider and their team's officers can read, so anyone else gets null.
export function usePersonOfPlayer(playerId: number, enabled: boolean) {
  return useSupabaseQuery<number | null>(
    ['person-of-player', playerId],
    async (client) => {
      const { data, error } = await client
        .from('players')
        .select('team_members(person_id)')
        .eq('id', playerId)
        .maybeSingle();
      if (error) return { data: null, error };
      const member = (data as { team_members: { person_id: number } | null } | null)?.team_members;
      return { data: member?.person_id ?? null, error: null };
    },
    { enabled }
  );
}

// A person's saved characters, for the profile's Characters card.
export function usePersonCharacters(personId: number | null) {
  return useSupabaseQuery<SavedCharacter[]>(
    ['person-characters', personId],
    (client) => client.from('characters').select(CHARACTER_COLUMNS).eq('person_id', personId!),
    { enabled: personId !== null }
  );
}

// Every alt of the team's raiders, for the officer roster. Memberships and
// characters are both readable only by the team's officers.
export function useTeamAlts(teamId: number, enabled: boolean) {
  return useSupabaseQuery<{ personByMember: Map<number, number>; characters: SavedCharacter[] }>(
    ['team-alts', teamId],
    async (client) => {
      const members = await client.from('team_members').select('id, person_id').eq('team_id', teamId);
      if (members.error) return { data: null, error: members.error };
      const rows = (members.data ?? []) as { id: number; person_id: number }[];
      const personByMember = new Map(rows.map((m) => [m.id, m.person_id]));
      const people = [...new Set(rows.map((m) => m.person_id))];
      if (!people.length) return { data: { personByMember, characters: [] }, error: null };
      const characters = await client.from('characters').select(CHARACTER_COLUMNS).in('person_id', people);
      if (characters.error) return { data: null, error: characters.error };
      return { data: { personByMember, characters: (characters.data ?? []) as SavedCharacter[] }, error: null };
    },
    { enabled }
  );
}

export type EarlierLoot = {
  pairs: EarlierPair[];
  players: Map<number, EarlierPlayer>;
  loot: (LootRow & { player_id: number | null })[];
};

const NO_EARLIER: EarlierLoot = { pairs: [], players: new Map(), loot: [] };

// This season's loot on the team's earlier characters (Kat, 2026-09-15): old
// mains, and characters on a team the raider left. earlier_characters() answers
// every row for the team's officers and only their own rows for a raider.
export function useEarlierLoot(teamId: number, season: SeasonWindow | null, enabled: boolean) {
  return useSupabaseQuery<EarlierLoot>(
    ['earlier-loot', teamId, season?.code ?? null],
    async (client: Client) => {
      const pairs = await client.rpc('earlier_characters', { p_team_id: teamId });
      if (pairs.error) return { data: null, error: pairs.error };
      const found = (pairs.data ?? []) as EarlierPair[];
      const ids = [...new Set(found.map((p) => p.earlier_player_id))];
      if (!ids.length) return { data: NO_EARLIER, error: null };
      const players = await client.from('players').select('id, name_realm, team_id').in('id', ids);
      if (players.error) return { data: null, error: players.error };
      // Paged, like the roster's own loot read: a season past 1000 rows would
      // otherwise stop counting silently.
      const loot = await readAll<EarlierLoot['loot'][number]>((from, to) => {
        let q = client
          .from('rclc_loot')
          .select('id, player_id, track, season, awarded_at, items(name)')
          .in('player_id', ids);
        if (season?.code) q = q.eq('season', season.code);
        return q.order('id').range(from, to);
      });
      if (loot.error) return { data: null, error: loot.error };
      return {
        data: {
          pairs: found,
          players: new Map(((players.data ?? []) as EarlierPlayer[]).map((p) => [p.id, p])),
          loot: (loot.data ?? []) as EarlierLoot['loot']
        },
        error: null
      };
    },
    { enabled: enabled && season !== null }
  );
}

// A refusal from the battlenet-characters function, with its status, so the
// picker can offer the way out that fits (sign in again, connect Battle.net).
export class FunctionRefusal extends Error {
  constructor(
    message: string,
    readonly status: number | null
  ) {
    super(message);
    this.name = 'FunctionRefusal';
  }
}

export const refusalStatus = (error: unknown): number | null => {
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof FunctionRefusal ? cause.status : null;
};

// supabase-js reports a function's non-2xx answer as a generic error with the
// Response attached; the function's own message is in its body.
async function refusalOf(error: { message: string; context?: unknown }): Promise<FunctionRefusal> {
  const response = error.context;
  if (!(response instanceof Response)) return new FunctionRefusal(error.message, null);
  let message = error.message;
  try {
    const body = (await response.clone().json()) as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // Not JSON: keep supabase-js's message.
  }
  return new FunctionRefusal(message, response.status);
}

// The raider's characters from Battle.net. Without `save` it only lists (and
// links roster matches); with it, the picked ids are saved as alts.
export function useBattlenetCharacters() {
  const queryClient = useQueryClient();
  return useSupabaseMutation<CharactersAnswer, { token: string; save?: number[]; allLevels?: boolean }>(
    async (client, body) => {
      const { data, error } = await client.functions.invoke('battlenet-characters', { body });
      if (error) {
        // unwrap() keeps it as the thrown error's cause, for refusalStatus().
        return { data: null, error: await refusalOf(error as { message: string; context?: unknown }) };
      }
      const answer = data as { characters?: CharactersAnswer['characters']; roster?: CharactersAnswer['roster'] };
      // A roster character just linked changes what the signed-in person can
      // open, so their access and the roster are read again.
      if (answer.roster?.some((r) => r.outcome === 'linked')) {
        await Promise.all(
          [['access'], ['roster'], ['profile-player'], ['person-of-player']].map((queryKey) =>
            queryClient.invalidateQueries({ queryKey })
          )
        );
      }
      return { data: { characters: answer.characters ?? [], roster: answer.roster ?? [] }, error: null };
    },
    {
      key: ['battlenet-characters'],
      refreshes: [['person-characters'], ['team-alts']]
    }
  );
}
