// Officer Loot: Reviews (#1363), ported from js/tabs/tab-requests.js: the
// items raiders report they got outside the team's raids, waiting for an
// officer before they count.

import { easternDate } from '../lib/dates';
import { currentSeason, type SeasonRow } from '../profile/profile';

export type ReviewRow = {
  id: number;
  status: string;
  track: string | null;
  source: string | null;
  note: string | null;
  officer_notes: string | null;
  slot: string | null;
  submitted_at: string;
  player_id: number | null;
  players: { name_realm: string; classes_specs: { class: string } | null } | null;
  items: {
    name: string;
    slot: string | null;
    wow_item_id: number | null;
    is_ptr: boolean | null;
    icon: string | null;
  } | null;
};

const TRACKS: Record<string, string> = { Myth: 'Mythic', Hero: 'Heroic' };

// "Heroic: Great Vault", as the raider picked it.
export function sourceLabel(row: Pick<ReviewRow, 'track' | 'source'>): string {
  const track = row.track ? (TRACKS[row.track] ?? row.track) : '';
  return [track, row.source ?? ''].filter(Boolean).join(': ');
}

export const raiderName = (row: ReviewRow) => row.players?.name_realm.split('-')[0] || 'No longer on the roster';

export const itemName = (row: ReviewRow) => row.items?.name ?? 'Unknown item';

// The decided list's search: raider, item, source, slot and the raider's note.
export function searchReviews(rows: ReviewRow[], search: string): ReviewRow[] {
  const q = search.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) =>
    [r.players?.name_realm, r.items?.name, sourceLabel(r), r.note, r.slot ?? r.items?.slot]
      .join(' ')
      .toLowerCase()
      .includes(q)
  );
}

export type RaiderGroup = {
  key: string;
  name: string;
  className: string;
  rows: ReviewRow[];
  approved: number;
  rejected: number;
};

// The decided list, one group per raider (Kat, 2026-10-22), by name, each
// raider's items newest first as they come in.
export function groupByRaider(rows: ReviewRow[]): RaiderGroup[] {
  const groups = new Map<string, RaiderGroup>();
  for (const row of rows) {
    const key = String(row.player_id ?? 'gone');
    const group = groups.get(key) ?? {
      key,
      name: raiderName(row),
      className: row.players?.classes_specs?.class ?? '',
      rows: [],
      approved: 0,
      rejected: 0
    };
    group.rows.push(row);
    if (row.status === 'approved') group.approved++;
    else group.rejected++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function groupCounts(g: Pick<RaiderGroup, 'approved' | 'rejected'>): string {
  return [g.approved && `${g.approved} approved`, g.rejected && `${g.rejected} rejected`].filter(Boolean).join(', ');
}

// The season a request was sent in (Kat, 2026-10-22): nothing stores one, so
// it is the season current on the Eastern date it was sent, by the same rule
// as current_season().
export const seasonOf = (row: ReviewRow, seasons: SeasonRow[]): string | null =>
  currentSeason(seasons, easternDate(row.submitted_at))?.code ?? null;
