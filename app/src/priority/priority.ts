// The Loot priority page (#1362 part 1): each item's saved priority order for
// one track, the RCLootCouncil export, and the two gear reads. The rules are
// the current site's (js/tabs/tab-priority.js), recorded per function.

import { isOffSpec } from '../home/home';
import type { CatalogItem, ZoneRow } from '../profile/lootPriority';
import { inSeasonZone } from '../profile/wishlist';
import { timeAgoLabel } from '../profile/profile';
import { firstName, type PlayerRow } from '../roster/roster';
import type { Raid } from '../settings/settings';

export type Track = 'Hero' | 'Myth';
export const TRACK_LABEL: Record<Track, string> = { Hero: 'Heroic', Myth: 'Mythic' };

export type OrderRow = {
  item_id: number;
  track: string;
  rank: number;
  player_id: number;
  players: { name_realm: string } | null;
};
// An item/track saved with nobody on it on purpose (save_priority_order()).
export type EmptyRow = { item_id: number; track: string };
export type PrefRow = { player_id: number; item_id: number; status: string };
export type TeamLootRow = {
  player_id: number | null;
  item_id: number | null;
  track: string | null;
  response: string | null;
};
export type BossRow = { item_id: number; boss: string };
export type TierPieceRow = {
  class: string;
  resolved_item_id: number;
  resolved: { wow_item_id: number | null; slot: string } | null;
};

export type PriorityData = {
  order: OrderRow[];
  empty: EmptyRow[];
  prefs: PrefRow[];
  loot: TeamLootRow[];
  bosses: BossRow[];
  tierPieces: TierPieceRow[];
};

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

// The current site's slot groups (getItemGroup()), in its order.
const ARMOR_SLOTS = ['Head', 'Shoulder', 'Chest', 'Hands', 'Legs', 'Back', 'Wrist', 'Waist', 'Feet'];
const WEAPON_SLOTS = new Set(['One-Hand', 'Two-Hand', 'Ranged', 'Off Hand', 'Held In Off-hand']);
const JEWELRY_SLOTS = new Set(['Neck', 'Finger']);
const SECTION_ORDER = ['Trinkets', ...ARMOR_SLOTS, 'Weapons', 'Jewelry', 'Other'];

function sectionOf(slot: string): string {
  if (slot === 'Trinket') return 'Trinkets';
  if (ARMOR_SLOTS.includes(slot)) return slot;
  if (WEAPON_SLOTS.has(slot)) return 'Weapons';
  if (JEWELRY_SLOTS.has(slot)) return 'Jewelry';
  return 'Other';
}

export type PriorityItem = {
  itemId: number;
  name: string;
  slot: string;
  boss: string | null;
  // Player ids, rank 1 first. Empty for an item saved with nobody on it.
  ranked: number[];
};
export type Section = { label: string; items: PriorityItem[] };

// Every item with a saved order on the track this season. Tier pieces are
// left out: priority is kept on the token, which is what drops (#650). An
// item saved with nobody on it is listed, as "Nobody ranked".
export function priorityItems(
  data: PriorityData,
  track: Track,
  catalog: CatalogItem[],
  zones: ZoneRow[],
  season: string
): PriorityItem[] {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const tierPieces = new Set(data.tierPieces.map((t) => t.resolved_item_id));
  const bossOf = new Map(data.bosses.map((b) => [b.item_id, b.boss]));
  const ranked = new Map<number, OrderRow[]>();
  for (const row of data.order) {
    if (row.track !== track) continue;
    ranked.set(row.item_id, [...(ranked.get(row.item_id) ?? []), row]);
  }
  const ids = new Set([...ranked.keys(), ...data.empty.filter((e) => e.track === track).map((e) => e.item_id)]);
  const items: PriorityItem[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item || item.is_placeholder || tierPieces.has(id) || !inSeasonZone(item, season, zones)) continue;
    items.push({
      itemId: id,
      name: item.name,
      slot: item.slot,
      boss: bossOf.get(id) ?? null,
      ranked: (ranked.get(id) ?? []).sort((a, b) => a.rank - b.rank).map((r) => r.player_id)
    });
  }
  return items;
}

export type Filters = { search: string; boss: string; hideEmpty: boolean };

export function sections(items: PriorityItem[], filters: Filters): Section[] {
  const search = norm(filters.search);
  const shown = items.filter(
    (i) =>
      (!search || norm(i.name).includes(search)) &&
      (!filters.boss || i.boss === filters.boss) &&
      (!filters.hideEmpty || i.ranked.length > 0)
  );
  return SECTION_ORDER.map((label) => ({
    label,
    items: shown.filter((i) => sectionOf(i.slot) === label).sort((a, b) => a.name.localeCompare(b.name))
  })).filter((s) => s.items.length > 0);
}

// The bosses the items drop from, in kill order (the Raid progression
// setting), then any it does not list alphabetically.
export function bossOptions(items: PriorityItem[], raids: Raid[]): string[] {
  const killOrder = new Map<string, number>();
  for (const raid of raids) {
    for (const boss of raid.bosses ?? []) {
      if (boss.name && !killOrder.has(boss.name)) killOrder.set(boss.name, killOrder.size);
    }
  }
  const bosses = [...new Set(items.map((i) => i.boss).filter((b): b is string => !!b))];
  return bosses.sort((a, b) => {
    const ra = killOrder.get(a);
    const rb = killOrder.get(b);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return a.localeCompare(b);
  });
}

// Wishlist marks, strongest first: generate_priority_order()'s own order.
const MARK_ORDER = ['bis', 'good', 'catalyst', 'ok', 'pass'];
export const MARK_LABEL: Record<string, string> = {
  bis: 'BiS',
  good: '2nd Choice',
  catalyst: 'Catalyst',
  ok: 'Sidegrade',
  pass: 'Pass'
};

export type RankedRow = {
  rank: number;
  playerId: number;
  name: string;
  className: string | null;
  role: string | null;
  // Not on the active roster any more.
  left: boolean;
  mark: string | null;
  // Already won this item on this track this season.
  received: boolean;
  // Other items for the same slot won this season. A ring or trinket only
  // counts once both are filled.
  sameSlot: string[];
};

const DUAL_SLOTS = new Set(['Trinket', 'Finger']);

// One item's ranked raiders, each with the flags the current site's list
// shows (buildPriorityTab()): the raider's best wishlist mark for the item,
// and what they have already won. Only main-spec wins this season count.
export function rankedRows(
  item: PriorityItem,
  track: Track,
  data: PriorityData,
  players: PlayerRow[],
  catalog: CatalogItem[]
): RankedRow[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const slotOf = new Map(catalog.map((i) => [i.id, { slot: i.slot, name: i.name }]));
  const names = new Map(data.order.map((r) => [r.player_id, r.players?.name_realm ?? '']));
  const wins = data.loot.filter((l) => !isOffSpec(l.response));
  return item.ranked.map((playerId, i) => {
    const player = byId.get(playerId);
    const marks = data.prefs.filter((p) => p.player_id === playerId && p.item_id === item.itemId).map((p) => p.status);
    const mark = MARK_ORDER.find((m) => marks.includes(m)) ?? null;
    const own = wins.filter((l) => l.player_id === playerId);
    const sameSlot = [
      ...new Set(
        own
          .map((l) => (l.item_id === item.itemId ? undefined : slotOf.get(l.item_id ?? 0)))
          .filter((other) => other?.slot === item.slot)
          .map((other) => other!.name)
      )
    ];
    const nameRealm = player?.name_realm ?? names.get(playerId) ?? '';
    return {
      rank: i + 1,
      playerId,
      name: player?.nickname?.trim() || firstName(nameRealm) || `Player ${playerId}`,
      className: player?.classes_specs?.class ?? null,
      role: player?.classes_specs?.role ?? null,
      left: !player,
      mark,
      received: own.some((l) => l.item_id === item.itemId && l.track === track),
      sameSlot: DUAL_SLOTS.has(item.slot) && sameSlot.length < 2 ? [] : sameSlot
    };
  });
}

// The export string: the build_rclc_export() payload as JSON, UTF-8, base64,
// byte for byte what the current site's _utf8ToBase64() makes, so the addon
// reads it the same.
export function exportString(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// The gear read's status line (#1174), from the two runs blizzard-gear-sync
// records on site_settings: the morning read, and the last one by hand.
export type GearRun = {
  finished_at: string;
  synced?: number | null;
  skipped?: number | null;
  players?: number | null;
  error?: string | null;
};

export function gearReadCounts(updated: number | null | undefined, unread?: number | null): string {
  const n = updated ?? 0;
  return `${n} ${n === 1 ? 'raider' : 'raiders'} updated${unread ? `, ${unread} could not be read` : ''}`;
}

const GEAR_STALE_MS = 36 * 60 * 60 * 1000;

export function gearStatus(cron: GearRun | null, byHand: GearRun | null, now = Date.now()) {
  if (!cron) return { text: 'No morning read recorded yet.', warn: true };
  let text = `Last morning read: ${timeAgoLabel(cron.finished_at) || 'unknown age'}, ${gearReadCounts(cron.synced, cron.skipped)}.`;
  let warn = false;
  if (cron.error) {
    text += ` Error: ${cron.error}`;
    warn = true;
  } else if (!cron.synced && (cron.players ?? 0) > 0) {
    text += ' Nothing was updated.';
    warn = true;
  }
  const finished = Date.parse(cron.finished_at);
  if (isNaN(finished) || now - finished > GEAR_STALE_MS) {
    text += ' The morning read has not run in 36 hours.';
    warn = true;
  }
  if (byHand) {
    text += ` Last refresh by hand: ${timeAgoLabel(byHand.finished_at) || 'unknown age'}, ${gearReadCounts(byHand.synced)}.`;
  }
  return { text, warn };
}

// Tier pieces equipped (#651), counted from Raider.IO's equipped gear: how
// many of the class's five pieces this season the raider wears. Raider.IO
// names slots in lower case and gives the equipped piece's own item id, the
// one the catalog keeps as wow_item_id.
const TIER_SLOTS = new Set(['Head', 'Shoulder', 'Chest', 'Hands', 'Legs']);

export function tierPiecesEquipped(
  className: string,
  pieces: TierPieceRow[],
  gear: Record<string, { item_id?: number } | undefined>
): number {
  let count = 0;
  for (const piece of pieces) {
    const resolved = piece.resolved;
    if (piece.class !== className || !resolved || resolved.wow_item_id == null || !TIER_SLOTS.has(resolved.slot)) {
      continue;
    }
    if (gear[resolved.slot.toLowerCase()]?.item_id === resolved.wow_item_id) count++;
  }
  return count;
}

// "Katorrí-Area 52" -> name "Katorrí", realm "Area 52" (a realm can carry a
// hyphen of its own, as Azjol-Nerub does).
export function splitNameRealm(nameRealm: string): { name: string; realm: string } {
  const at = nameRealm.indexOf('-');
  return at === -1 ? { name: nameRealm, realm: '' } : { name: nameRealm.slice(0, at), realm: nameRealm.slice(at + 1) };
}
