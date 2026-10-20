// The Loot priority page (#1362 part 1): each item's saved priority order for
// one track, the RCLootCouncil export, and the two gear reads. The rules are
// the current site's (js/tabs/tab-priority.js), recorded per function.

import type { CountedLoot } from '../settings/lootResponses';
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
export type PrefRow = { id?: number; player_id: number; item_id: number; status: string; note?: string | null };
export type TeamLootRow = {
  player_id: number | null;
  item_id: number | null;
  team_id: number | null;
  track: string | null;
  response: string | null;
};
export type BossRow = { item_id: number; boss: string };
// A receipt an officer approved (Mark Received): it counts as having the item.
export type ReceivedRow = { player_id: number | null; self_item_id: number | null; track: string | null };
export type TierPieceRow = {
  class: string;
  resolved_item_id: number;
  resolved: { wow_item_id: number | null; slot: string } | null;
};

export type PriorityData = {
  order: OrderRow[];
  empty: EmptyRow[];
  prefs: PrefRow[];
  // Marked by countedLoot(): Off spec awards are not wins.
  loot: (TeamLootRow & CountedLoot)[];
  bosses: BossRow[];
  tierPieces: TierPieceRow[];
  received: ReceivedRow[];
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
  // For a ring, trinket or weapon: another item for that slot the raider
  // marked BiS and has already won this season (Kat, 2026-10-18). Any other
  // win for the slot is not shown; it was noise.
  otherBis: string[];
  // Only on the #1 row (Part 3). On a Mythic order: the raider already has
  // the Heroic copy of this item.
  heroicCopy: boolean;
  // Only on the #1 row: other items from the same boss this raider is also #1
  // on, on this track, in the saved orders.
  sameBoss: string[];
};

// Slots a raider fills twice (or main hand and off hand), so having one BiS
// already says how much the next one matters.
const PAIRED_GROUP: Record<string, string> = {
  Trinket: 'trinket',
  Finger: 'ring',
  'One-Hand': 'weapon',
  'Two-Hand': 'weapon',
  Ranged: 'weapon',
  'Off Hand': 'weapon',
  'Held In Off-hand': 'weapon'
};
export const pairedNoun = (slot: string) => PAIRED_GROUP[slot] ?? null;

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
  const wins = data.loot.filter((l) => !l.offSpec);
  return item.ranked.map((playerId, i) => {
    const player = byId.get(playerId);
    const marks = data.prefs.filter((p) => p.player_id === playerId && p.item_id === item.itemId).map((p) => p.status);
    const mark = MARK_ORDER.find((m) => marks.includes(m)) ?? null;
    const own = wins.filter((l) => l.player_id === playerId);
    const group = PAIRED_GROUP[item.slot];
    const bis = new Set(data.prefs.filter((p) => p.player_id === playerId && p.status === 'bis').map((p) => p.item_id));
    const otherBis = group
      ? [
          ...new Set(
            own
              .filter((l) => l.item_id !== null && l.item_id !== item.itemId && bis.has(l.item_id))
              .map((l) => slotOf.get(l.item_id!))
              .filter((other) => !!other && PAIRED_GROUP[other.slot] === group)
              .map((other) => other!.name)
          )
        ]
      : [];
    const nameRealm = player?.name_realm ?? names.get(playerId) ?? '';
    const first = i === 0;
    const sameBoss =
      first && item.boss
        ? [
            ...new Set(
              data.bosses
                .filter((b) => b.boss === item.boss && b.item_id !== item.itemId)
                .filter((b) =>
                  data.order.some(
                    (r) => r.item_id === b.item_id && r.track === track && r.rank === 1 && r.player_id === playerId
                  )
                )
                .map((b) => slotOf.get(b.item_id)?.name)
                .filter((n): n is string => !!n)
            )
          ]
        : [];
    return {
      rank: i + 1,
      playerId,
      name: player?.nickname?.trim() || firstName(nameRealm) || `Player ${playerId}`,
      className: player?.classes_specs?.class ?? null,
      role: player?.classes_specs?.role ?? null,
      left: !player,
      mark,
      received: own.some((l) => l.item_id === item.itemId && l.track === track),
      otherBis,
      heroicCopy: first && track === 'Myth' && owned(playerId, item.itemId, data).heroic,
      sameBoss
    };
  });
}

// Items whose #1 carries a flag: the ones "Needs a look" lists, and the dot in
// the item list (Part 3).
export function flaggedItemIds(
  items: PriorityItem[],
  track: Track,
  data: PriorityData,
  players: PlayerRow[],
  catalog: CatalogItem[]
): Set<number> {
  const out = new Set<number>();
  for (const item of items) {
    const top = rankedRows({ ...item, ranked: item.ranked.slice(0, 1) }, track, data, players, catalog)[0];
    if (top && (top.heroicCopy || top.sameBoss.length > 0)) out.add(item.itemId);
  }
  return out;
}

// -- Part 3: Contested items --------------------------------------------

// The current site's bar (CONTESTED_ITEMS_MIN_PLAYERS): below it, wanting the
// same item is too common to say anything.
export const CONTESTED_MIN = 6;

export type Wanter = {
  playerId: number;
  name: string;
  className: string | null;
  heroic: number | null;
  mythic: number | null;
  // The best copy they already have.
  has: 'Mythic' | 'Heroic' | 'Normal' | null;
};
// A raider's best (lowest) spot on either track; unranked sort last.
const best = (w: Wanter) => Math.min(w.heroic ?? Infinity, w.mythic ?? Infinity);

export type Contested = { item: PriorityItem; wanters: Wanter[] };

// Items CONTESTED_MIN or more raiders on the roster marked BiS, most wanted
// first, each with who wants it and where they rank on both tracks.
export function contestedItems(
  data: PriorityData,
  catalog: CatalogItem[],
  zones: ZoneRow[],
  season: string,
  players: PlayerRow[]
): Contested[] {
  const roster = new Map(players.map((p) => [p.id, p]));
  const wanted = new Map<number, number[]>();
  for (const p of data.prefs) {
    if (p.status !== 'bis' || !roster.has(p.player_id)) continue;
    const who = wanted.get(p.item_id) ?? [];
    if (!who.includes(p.player_id)) wanted.set(p.item_id, [...who, p.player_id]);
  }
  const out: Contested[] = [];
  for (const item of catalog) {
    const who = wanted.get(item.id);
    if (!who || who.length < CONTESTED_MIN || !rankable(item, data, zones, season)) continue;
    const rank = (playerId: number, track: Track) =>
      data.order.find((r) => r.item_id === item.id && r.track === track && r.player_id === playerId)?.rank ?? null;
    out.push({
      item: {
        itemId: item.id,
        name: item.name,
        slot: item.slot,
        boss: data.bosses.find((b) => b.item_id === item.id)?.boss ?? null,
        ranked: []
      },
      wanters: who
        .map((id) => {
          const p = roster.get(id)!;
          const o = owned(id, item.id, data);
          return {
            playerId: id,
            name: p.nickname?.trim() || firstName(p.name_realm),
            className: p.classes_specs?.class ?? null,
            heroic: rank(id, 'Hero'),
            mythic: rank(id, 'Myth'),
            has: o.mythic ? ('Mythic' as const) : o.heroic ? ('Heroic' as const) : o.normal ? ('Normal' as const) : null
          };
        })
        .sort((a, b) => best(a) - best(b) || a.name.localeCompare(b.name))
    });
  }
  return out.sort((a, b) => b.wanters.length - a.wanters.length || a.item.name.localeCompare(b.item.name));
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
  if (!cron) return { text: 'No gear read recorded yet.', warn: true };
  const ago = timeAgoLabel(cron.finished_at) || 'at an unknown time';
  const finished = Date.parse(cron.finished_at);
  let text: string;
  let warn = true;
  if (cron.error) {
    text = `The daily gear read failed: ${cron.error}. Use Refresh equipped gear.`;
  } else if (isNaN(finished) || now - finished > GEAR_STALE_MS) {
    text = `The daily gear read has not run in 36 hours (last ${ago}). Use Refresh equipped gear.`;
  } else if (!cron.synced && (cron.players ?? 0) > 0) {
    text = `The daily gear read ran ${ago} but updated nobody. Use Refresh equipped gear.`;
  } else {
    warn = false;
    const unread = cron.skipped ?? 0;
    text = `Gear read ${ago}.${unread ? ` ${unread} ${unread === 1 ? 'raider' : 'raiders'} could not be read.` : ''}`;
  }
  if (byHand) text += ` Refreshed by hand ${timeAgoLabel(byHand.finished_at) || 'at an unknown time'}.`;
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

// -- Part 2: editing an order -------------------------------------------

// Every in-season raid item, as a list entry, whether or not it has an order
// on the track yet: Unmanaged items open here before they have one.
export function itemFor(
  itemId: number,
  data: PriorityData,
  track: Track,
  catalog: CatalogItem[],
  zones: ZoneRow[],
  season: string
): PriorityItem | null {
  const listed = priorityItems(data, track, catalog, zones, season).find((i) => i.itemId === itemId);
  if (listed) return listed;
  const item = catalog.find((i) => i.id === itemId);
  if (!item || !rankable(item, data, zones, season)) return null;
  return {
    itemId,
    name: item.name,
    slot: item.slot,
    boss: data.bosses.find((b) => b.item_id === itemId)?.boss ?? null,
    ranked: []
  };
}

// A raid item of the season that gets a priority order: not a stand-in, not a
// dungeon or crafted piece (never ranked, #1166), not a tier piece (the token
// is ranked, #650).
function rankable(item: CatalogItem, data: PriorityData, zones: ZoneRow[], season: string): boolean {
  if (item.is_placeholder || offRaidSource(item)) return false;
  if (data.tierPieces.some((t) => t.resolved_item_id === item.id)) return false;
  return inSeasonZone(item, season, zones);
}

const offRaidSource = (item: CatalogItem) => !!item.source && item.source !== 'raid';

export type Unmanaged = { item: PriorityItem; missing: Track[] };

// Items with no order saved on one track or both (the current site's
// Unmanaged Items). An order saved with nobody on it counts as managed.
export function unmanagedItems(
  data: PriorityData,
  catalog: CatalogItem[],
  zones: ZoneRow[],
  season: string
): Unmanaged[] {
  const has = new Set([...data.order, ...data.empty].map((r) => `${r.item_id}|${r.track}`));
  const out: Unmanaged[] = [];
  for (const item of catalog) {
    if (!rankable(item, data, zones, season)) continue;
    const missing = (['Hero', 'Myth'] as const).filter((t) => !has.has(`${item.id}|${t}`));
    if (missing.length === 0) continue;
    out.push({
      item: {
        itemId: item.id,
        name: item.name,
        slot: item.slot,
        boss: data.bosses.find((b) => b.item_id === item.id)?.boss ?? null,
        ranked: []
      },
      missing
    });
  }
  return out;
}

// What a raider already has of one item, as generate_priority_order()'s
// exclusion reads it: a main-spec win this season, or a receipt an officer
// approved. Champion (Normal) only informs; it never blocks.
export type Owned = { normal: boolean; heroic: boolean; mythic: boolean };

export function owned(playerId: number, itemId: number, data: PriorityData): Owned {
  const tracks = [
    ...data.loot.filter((l) => l.player_id === playerId && l.item_id === itemId && !l.offSpec),
    ...data.received.filter((r) => r.player_id === playerId && r.self_item_id === itemId)
  ].map((r) => r.track);
  return { normal: tracks.includes('Champion'), heroic: tracks.includes('Hero'), mythic: tracks.includes('Myth') };
}

// A Mythic copy takes a raider off both lists; a Heroic copy only off Heroic.
export const blocked = (o: Owned, track: Track) => o.mythic || (track === 'Hero' && o.heroic);

// Raiders who marked the item BiS, 2nd Choice or Sidegrade and are not ranked
// yet, or with `wholeRoster` everyone on the roster. Alphabetical.
const POOL_MARKS = new Set(['bis', 'good', 'ok']);

export function poolFor(
  itemId: number,
  ranked: number[],
  data: PriorityData,
  players: PlayerRow[],
  wholeRoster: boolean
): PlayerRow[] {
  const marked = new Set(
    data.prefs.filter((p) => p.item_id === itemId && POOL_MARKS.has(p.status)).map((p) => p.player_id)
  );
  return players
    .filter((p) => !ranked.includes(p.id) && (wholeRoster || marked.has(p.id)))
    .sort((a, b) => a.name_realm.localeCompare(b.name_realm));
}

export type Suggested = { player_id: number; weighted_total: number | null; status_label: string | null };

export type Suggestion = { order: number[]; promoted: { id: number; count: number } | null; keptLocked: number };

// Suggest order's result, the current site's way (prioEditGenerate()):
// - pressed again, a #1 who already holds a #1 on another item on this track
//   gives way to the first raider holding fewer, unless they are locked;
// - a locked raider keeps the spot they had, and everyone else flows round.
export function applySuggestion(
  previous: number[],
  locked: ReadonlySet<number>,
  suggested: number[],
  firstCounts: ReadonlyMap<number, number>,
  again: boolean
): Suggestion {
  let order = [...suggested];
  let promoted: Suggestion['promoted'] = null;
  if (again && order.length > 1 && !locked.has(order[0]!)) {
    const top = firstCounts.get(order[0]!) ?? 0;
    if (top > 0) {
      let at = -1;
      let fewest = top;
      for (let i = 1; i < order.length; i++) {
        const c = firstCounts.get(order[i]!) ?? 0;
        if (c < fewest) {
          at = i;
          fewest = c;
          if (c === 0) break;
        }
      }
      if (at !== -1) {
        const [id] = order.splice(at, 1);
        order.unshift(id!);
        promoted = { id: id!, count: fewest };
      }
    }
  }
  const keep = previous.map((id, idx) => ({ id, idx })).filter((p) => locked.has(p.id));
  order = order.filter((id) => !locked.has(id));
  for (const { id, idx } of keep) order.splice(Math.min(idx, order.length), 0, id);
  return { order, promoted, keptLocked: keep.length };
}

// How many #1 spots each raider holds on other items on this track.
export function firstCounts(data: PriorityData, track: Track, exceptItemId: number): Map<number, number> {
  const counts = new Map<number, number>();
  for (const r of data.order) {
    if (r.track !== track || r.rank !== 1 || r.item_id === exceptItemId) continue;
    counts.set(r.player_id, (counts.get(r.player_id) ?? 0) + 1);
  }
  return counts;
}

// Where a raider sat in the saved order, when it is not where they are now
// (Kat, 2026-10-18): "new" for someone who was not on it.
export type Was = { kind: 'up' | 'down'; rank: number } | { kind: 'new' } | null;

export function wasRank(saved: number[], playerId: number, index: number): Was {
  const at = saved.indexOf(playerId);
  if (at === -1) return { kind: 'new' };
  if (at === index) return null;
  return { kind: at > index ? 'up' : 'down', rank: at + 1 };
}

export const move = (order: number[], from: number, to: number): number[] => {
  const next = [...order];
  const [id] = next.splice(from, 1);
  next.splice(to, 0, id!);
  return next;
};

// Scores read out of 100 (Kat, 2026-10-18); they are stored out of 10 until
// cutover (#1554).
export const outOf100 = (score: number | null | undefined) => (score == null ? null : Math.round(score * 10));

// -- Part 4: Sidegrade and notes ------------------------------------------

// Raiders who marked the item Sidegrade and are not ranked on it: officers see
// them, but only BiS gets a priority number (Kat, 2026-10-18).
export function sidegradeNames(item: PriorityItem, data: PriorityData, players: PlayerRow[]): string[] {
  const ids = new Set(
    data.prefs
      .filter((p) => p.item_id === item.itemId && p.status === 'ok' && !item.ranked.includes(p.player_id))
      .map((p) => p.player_id)
  );
  return players
    .filter((p) => ids.has(p.id))
    .map((p) => p.nickname?.trim() || firstName(p.name_realm))
    .sort((a, b) => a.localeCompare(b));
}

export type WishlistNote = {
  // Every saved row with this text: a ring or trinket marked in both slots is
  // two rows with one note, and Clear clears both.
  ids: number[];
  playerId: number;
  name: string;
  className: string | null;
  spec: string | null;
  mark: string;
  note: string;
};
export type NotesForItem = { itemId: number; name: string; slot: string; notes: WishlistNote[] };

// Raiders' notes on the items they marked (the current site's Notes tab), by
// item A to Z. Raiders who left the roster and M+ or crafted stand-ins are
// left out; the same raider's same text on one item shows once.
export function wishlistNotes(data: PriorityData, catalog: CatalogItem[], players: PlayerRow[]): NotesForItem[] {
  const roster = new Map(players.map((p) => [p.id, p]));
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const byItem = new Map<number, NotesForItem>();
  for (const pref of data.prefs) {
    const text = pref.note?.trim();
    const player = roster.get(pref.player_id);
    const item = byId.get(pref.item_id);
    if (!text || pref.id === undefined || !player || !item || item.is_placeholder) continue;
    const entry = byItem.get(item.id) ?? { itemId: item.id, name: item.name, slot: item.slot, notes: [] };
    byItem.set(item.id, entry);
    const same = entry.notes.find((n) => n.playerId === player.id && n.note === text);
    if (same) {
      same.ids.push(pref.id);
      continue;
    }
    entry.notes.push({
      ids: [pref.id],
      playerId: player.id,
      name: player.nickname?.trim() || firstName(player.name_realm),
      className: player.classes_specs?.class ?? null,
      spec: player.classes_specs?.spec ?? null,
      mark: pref.status,
      note: text
    });
  }
  return [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// -- Part 5: Scoring --------------------------------------------------------

// Warcraft Logs performance per raider (the current site's Scoring tab).
// Stored out of 10 until cutover (#1554), shown out of 100.
export type PerfRole = 'dps' | 'healer' | 'tank';
export type PerfScore = {
  playerId: number;
  role: PerfRole;
  recent: number | null;
  trend: number | null;
  best: number | null;
  // No parse in the last 8 reports.
  noData: boolean;
  // No parse in the last 2, so Recent is the Trend score.
  usedTrend: boolean;
};
export type ScoringRow = {
  player_id: number;
  recent_score: number | null;
  trend_score: number | null;
  best_score: number | null;
  performance_score: number | null;
};

// The roster role, as wcl-sync's classRoleToScoringRole() reads it.
export const perfRole = (role: string | null | undefined): PerfRole =>
  role === 'Tank' ? 'tank' : role === 'Heal' ? 'healer' : 'dps';

// What is saved, one row per raider on the roster. Recent is the score
// Suggest order uses (performance_score).
export function committedScores(players: PlayerRow[], rows: ScoringRow[]): PerfScore[] {
  const byPlayer = new Map(rows.map((r) => [r.player_id, r]));
  return players.map((p) => {
    const row = byPlayer.get(p.id);
    const recent = row ? (row.performance_score ?? row.recent_score) : null;
    return {
      playerId: p.id,
      role: perfRole(p.classes_specs?.role),
      recent,
      trend: row?.trend_score ?? null,
      best: row?.best_score ?? null,
      noData: recent === null,
      usedTrend: false
    };
  });
}

// Healers and tanks are left out of performance (2026-09-15): attendance only.
export const scored = (s: PerfScore) => s.role === 'dps';

// The current site's order: raiders with a score, best first, then no data,
// then healers and tanks.
export function sortScores(scores: PerfScore[]): PerfScore[] {
  const rank = (s: PerfScore) => (!scored(s) ? 2 : s.recent === null ? 1 : 0);
  return [...scores].sort((a, b) => rank(a) - rank(b) || (b.recent ?? 0) - (a.recent ?? 0));
}

// Whether a raider's Recent differs from what is saved, so Commit would
// change it.
export function pending(score: PerfScore, saved: ReadonlyMap<number, number | null>): boolean {
  if (!scored(score) || score.recent === null) return false;
  const was = saved.get(score.playerId);
  return was == null || Math.round(was * 100) !== Math.round(score.recent * 100);
}

// A score typed out of 100, stored out of 10 to two places; null when it is
// not a number from 0 to 100.
export function parseOutOf100(text: string): number | null {
  const n = Number(text.trim());
  if (!text.trim() || !Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 10) / 100;
}

// Out of 100, one decimal, so nothing stored is hidden.
export const showOutOf100 = (score: number | null) => (score === null ? '--' : (score * 10).toFixed(1));
