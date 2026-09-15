// A person's characters beyond their roster row (#942 step 5b): the alts they
// pick from their Battle.net account, and the earlier characters whose loot
// still counts toward their season total. Kept apart from the components so
// the rules are tested without rendering.
//
// Kat's calls (2026-09-15):
// - Alts show only to the raider and their team's officers, never on a public
//   page. The characters table's read rules already match.
// - Choosing alts is computer-only, like the wishlist editor.
// - On the officer roster, alt rows start hidden.
// - A character another player claimed by mistake says so without naming
//   them, and sends the raider to their own team's officers first.

import type { LootRow } from '../profile/profile';

// What the battlenet-characters function answers with.
export type RosterOutcome = 'linked' | 'already_yours' | 'claimed_by_someone_else' | 'needs_discord';

export type RosterLink = { player_id: number; team_id: number; name_realm: string; outcome: RosterOutcome };

export type AccountCharacter = {
  blizzard_id: number;
  name: string;
  realm: string;
  realm_slug: string;
  class_name: string | null;
  spec_name: string | null;
  level: number;
  item_level: number | null;
  saved: boolean;
  roster: RosterLink | null;
};

export type CharactersAnswer = { characters: AccountCharacter[]; roster: RosterLink[] };

// The same key the database uses for name_realm_key: lower case, no spaces.
export const nameRealmKey = (nameRealm: string) => nameRealm.replace(/ /g, '').toLowerCase();

export type TeamNames = Map<number, string>;

// One row of the picker.
export type PickerRow =
  | { kind: 'choose'; character: AccountCharacter }
  | { kind: 'yours'; character: AccountCharacter; team: string }
  | { kind: 'claimed'; character: AccountCharacter; team: string }
  | { kind: 'needs-discord'; character: AccountCharacter; team: string };

export function pickerRows(answer: CharactersAnswer, teams: TeamNames): PickerRow[] {
  return answer.characters.map((character) => {
    const link = character.roster;
    if (!link) return { kind: 'choose', character };
    const team = teams.get(link.team_id) ?? 'A team';
    if (link.outcome === 'claimed_by_someone_else') return { kind: 'claimed', character, team };
    if (link.outcome === 'needs_discord') return { kind: 'needs-discord', character, team };
    return { kind: 'yours', character, team };
  });
}

// The ids picked as alts when the picker opens: what was saved before.
export const savedAlts = (rows: PickerRow[]) =>
  new Set(rows.filter((r) => r.kind === 'choose' && r.character.saved).map((r) => r.character.blizzard_id));

// "Linked: Grihz-Illidan was on Phoenix's roster, so it's now your roster
// character." One line per character the function just linked, including
// ones below max level, which the picker does not list.
export function linkedNotices(roster: RosterLink[], teams: TeamNames): string[] {
  return roster
    .filter((r) => r.outcome === 'linked')
    .map((r) => {
      const team = teams.get(r.team_id);
      return `${r.name_realm} was on ${team ? `${team}’s` : 'a team’s'} roster, so it’s now your roster character.`;
    });
}

// Characters as the characters table stores them.
export type SavedCharacter = {
  id: number;
  person_id: number;
  name: string;
  realm: string;
  class_name: string | null;
  spec_name: string | null;
  item_level: number | null;
};

// A person's alts: their saved characters, less any that is a roster row on
// this team (a character picked as an alt and later put on the roster).
export function altsOf(saved: SavedCharacter[], rosterNameRealms: string[]): SavedCharacter[] {
  const onRoster = new Set(rosterNameRealms.map(nameRealmKey));
  return saved
    .filter((c) => !onRoster.has(nameRealmKey(`${c.name}-${c.realm}`)))
    .sort((a, b) => (b.item_level ?? 0) - (a.item_level ?? 0) || a.name.localeCompare(b.name));
}

export const altCountLabel = (n: number) => `${n} ${n === 1 ? 'alt' : 'alts'}`;

// Loot from earlier characters (Kat, 2026-09-15). What earlier_characters()
// answers, with each earlier character's roster row.
export type EarlierPair = { player_id: number; earlier_player_id: number };
export type EarlierPlayer = { id: number; name_realm: string; team_id: number };

// Where an earlier item was received, for the loot list: the character's name
// for an old main on this team, the team's name for a team they left.
export function receivedOn(earlier: EarlierPlayer, teamId: number, teams: TeamNames): string {
  if (earlier.team_id === teamId) return earlier.name_realm.split('-')[0]!.trim();
  return teams.get(earlier.team_id) ?? 'another team';
}

// A roster row's loot with its earlier characters' loot added, each earlier row
// marked with where it was received. A row read twice (the team's own read
// already holds an old main's loot) counts once.
export function withEarlierLoot<T extends LootRow & { player_id?: number | null }>(
  playerId: number,
  own: T[],
  earlierLoot: (LootRow & { player_id: number | null })[],
  pairs: EarlierPair[],
  players: Map<number, EarlierPlayer>,
  teamId: number,
  teams: TeamNames
): (LootRow & { from: string | null })[] {
  const earlierIds = new Set(pairs.filter((p) => p.player_id === playerId).map((p) => p.earlier_player_id));
  const seen = new Set<number>();
  const out: (LootRow & { from: string | null })[] = [];
  for (const row of own) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ ...row, from: null });
  }
  for (const row of earlierLoot) {
    if (row.player_id === null || !earlierIds.has(row.player_id) || seen.has(row.id)) continue;
    const player = players.get(row.player_id);
    if (!player) continue;
    seen.add(row.id);
    out.push({ ...row, from: receivedOn(player, teamId, teams) });
  }
  return out;
}

// Earlier character id to the roster row it counts for, for the roster's
// whole-team numbers.
export function earlierOwners(pairs: EarlierPair[]): Map<number, number> {
  return new Map(pairs.map((p) => [p.earlier_player_id, p.player_id]));
}
