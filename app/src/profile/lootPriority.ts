// The profile's loot priority list (#868 part 2): the raider's BiS picks for
// the season, where they stand on each item's Heroic and Mythic list, and
// whether they already have the item. Same rules as the current site's BiS
// List (renderProfile(), bisMergeWishlistPrefs()), recorded in
// tests/behavior/profile.js. Only BiS picks are listed (#1032, #1033).

import type { SeasonWindow } from './profile';

export type WishlistRow = {
  item_id: number;
  status: string;
  slot: string | null;
  season: string | null;
  // A copy of a ring or trinket BiS the current site saves in the other slot.
  synced_bis?: boolean;
};
export type CatalogItem = {
  id: number;
  name: string;
  slot: string;
  wcl_zone_id: number | null;
  is_placeholder: boolean;
  // What the wishlist editor filters on (wishlist.ts).
  armor_type?: string | null;
  // jsonb: a list of STRENGTH, AGILITY and INTELLECT.
  main_stats?: unknown;
  weapon_subtype?: string | null;
};
export type ZoneRow = { wcl_zone_id: number | null; season: string | null };
export type RankRow = { item_id: number; track: string; rank: number; player_id: number };
export type TierTokenRow = { token_item_id: number; resolved: { name: string } | null };
export type ReceivedLoot = { track: string | null; awarded_at: string; items: { name: string } | null };
export type SelfReceivedRow = {
  track: string | null;
  source: string | null;
  slot: string | null;
  items: { name: string } | null;
};

export type Track = 'Heroic' | 'Mythic';
export type Standing = { track: Track; rank: number; of: number };
export type Received = { track: 'Mythic' | 'Heroic' | 'Normal' | null; detail: string };

export type PriorityRow = {
  key: string;
  itemId: number;
  // The slot it is picked for: the catalog's for a raid item, the wishlist
  // row's for a crafted or M+ pick.
  slot: string;
  item: string;
  // The catalog's own name, which a report sends: a tier token's, not the
  // piece it shows as.
  itemName: string;
  placeholder: boolean;
  ranks: Standing[];
  received: Received | null;
};

// Gear-panel order of the wishlist's sixteen slots.
export const WISHLIST_SLOTS = [
  'Head',
  'Neck',
  'Shoulder',
  'Back',
  'Chest',
  'Wrist',
  'Hands',
  'Waist',
  'Legs',
  'Feet',
  'Finger 1',
  'Finger 2',
  'Trinket 1',
  'Trinket 2',
  'Weapon',
  'Off Hand'
];

// A catalog slot's place in that order: a ring or trinket sorts as its first
// slot, any weapon type as Weapon.
const CATALOG_TO_WISHLIST_SLOT: Record<string, string> = {
  Finger: 'Finger 1',
  Trinket: 'Trinket 1',
  'One-Hand': 'Weapon',
  'Two-Hand': 'Weapon',
  Ranged: 'Weapon',
  'Held In Off-hand': 'Off Hand'
};

// One ring or trinket picked for both of its slots is one physical item.
// Weapons are not: a dual-wielder can want two copies.
const PAIRED_SLOTS = new Set(['Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2']);

const TRACK_ORDER: Record<string, number> = { Mythic: 3, Heroic: 2, Normal: 1 };
const trackName = (track: string | null) =>
  track === 'Myth' ? 'Mythic' : track === 'Hero' ? 'Heroic' : track === 'Champion' ? 'Normal' : null;

const AWARD_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'short',
  day: 'numeric',
  year: 'numeric'
});

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// Whether a pick belongs to the season: a raid item by the raid it drops in
// (raid_zones.season holds the code, #933), a crafted or M+ pick by the season
// name stamped on the wishlist row. With no raids set up for the season yet,
// every raid item counts.
function inSeason(pick: WishlistRow, item: CatalogItem, season: SeasonWindow, zones: ZoneRow[]): boolean {
  if (item.is_placeholder) return !pick.season || pick.season === season.name;
  if (item.wcl_zone_id == null) return true;
  const seasonZones = zones.filter((z) => z.season === season.code).map((z) => z.wcl_zone_id);
  return seasonZones.length === 0 || seasonZones.includes(item.wcl_zone_id);
}

export function lootPriority(input: {
  playerId: number;
  wishlist: WishlistRow[];
  catalog: CatalogItem[];
  zones: ZoneRow[];
  season: SeasonWindow;
  ranks: RankRow[];
  tierTokens: TierTokenRow[];
  loot: ReceivedLoot[];
  selfReceived: SelfReceivedRow[];
}): PriorityRow[] {
  const byId = new Map(input.catalog.map((i) => [i.id, i]));
  const seen = new Set<number>();
  const rows: { row: PriorityRow; order: number }[] = [];

  for (const pick of input.wishlist) {
    if (pick.status !== 'bis') continue;
    const item = byId.get(pick.item_id);
    if (!item || !inSeason(pick, item, input.season, input.zones)) continue;
    if (!item.is_placeholder && pick.slot && PAIRED_SLOTS.has(pick.slot)) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
    }
    const slot = item.is_placeholder ? (pick.slot ?? '') : item.slot;
    const orderSlot = item.is_placeholder ? slot : (CATALOG_TO_WISHLIST_SLOT[item.slot] ?? item.slot);
    const order = WISHLIST_SLOTS.indexOf(orderSlot);
    rows.push({
      order: order === -1 ? WISHLIST_SLOTS.length : order,
      row: {
        key: `${item.id}-${item.is_placeholder ? slot : ''}`,
        itemId: item.id,
        slot,
        item: input.tierTokens.find((t) => t.token_item_id === item.id)?.resolved?.name ?? item.name,
        itemName: item.name,
        placeholder: item.is_placeholder,
        // Crafted and M+ picks are not council loot and are never ranked.
        ranks: item.is_placeholder ? [] : standings(item.id, input.playerId, input.ranks),
        received: received(item, slot, input.loot, input.selfReceived)
      }
    });
  }
  return rows.sort((a, b) => a.order - b.order).map((r) => r.row);
}

function standings(itemId: number, playerId: number, ranks: RankRow[]): Standing[] {
  const out: Standing[] = [];
  for (const [code, track] of [
    ['Hero', 'Heroic'],
    ['Myth', 'Mythic']
  ] as const) {
    const list = ranks.filter((r) => r.item_id === itemId && r.track === code).sort((a, b) => a.rank - b.rank);
    const at = list.findIndex((r) => r.player_id === playerId);
    if (at !== -1) out.push({ track, rank: at + 1, of: list.length });
  }
  return out;
}

// The best copy the raider has: from the loot import (any season) or a
// receipt they reported themselves, whichever is the higher track.
function received(item: CatalogItem, slot: string, loot: ReceivedLoot[], self: SelfReceivedRow[]): Received | null {
  const name = norm(item.name);
  const awards = loot
    .filter((l) => l.items && norm(l.items.name) === name)
    .map((l) => ({ track: trackName(l.track), at: l.awarded_at }));
  const bestAward = awards.reduce<(typeof awards)[number] | null>(
    (best, a) => (best === null || (TRACK_ORDER[a.track ?? ''] ?? 0) > (TRACK_ORDER[best.track ?? ''] ?? 0) ? a : best),
    null
  );

  // A receipt is for the row's slot: the catalog's for a raid item, the picked
  // slot for a crafted or M+ pick. One saved without a slot still counts when
  // it is the only receipt for the item, as on the current site
  // (selfReceivedEntryForRow()).
  const matches = self.filter((s) => s.items && norm(s.items.name) === name);
  const receipt =
    matches.find((m) => m.slot && m.slot === slot) ??
    (!slot ? matches.find((m) => !m.slot) : matches.length === 1 && !matches[0]!.slot ? matches[0] : undefined);

  const awardRank = bestAward ? (TRACK_ORDER[bestAward.track ?? ''] ?? 0) : -1;
  const receiptTrack = receipt ? trackName(receipt.track) : null;
  const receiptRank = receipt ? (TRACK_ORDER[receiptTrack ?? ''] ?? 0) : -1;

  if (bestAward && awardRank >= receiptRank) {
    return { track: bestAward.track as Received['track'], detail: AWARD_DATE.format(new Date(bestAward.at)) };
  }
  if (receipt) return { track: receiptTrack as Received['track'], detail: receipt.source ?? 'Self-reported' };
  return null;
}
