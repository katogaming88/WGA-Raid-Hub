// The wishlist editor (#868 part 3): which raid items a raider is offered for
// each slot, how their marks read, and the writes a new mark takes. Same rules
// as the current site's My Wishlist (js/wishlist.js), recorded in
// tests/behavior/wishlist.js, with two changes Kat made on 2026-09-14: a slot
// is marked BiS or Pass only (#1032), and a BiS pick that is replaced is
// unmarked rather than kept as 2nd Choice. Notes are gone, and M+ or crafted
// picks are shown but not added here until real items exist (#1166).

import type { CatalogItem, WishlistRow, ZoneRow } from './lootPriority';
import type { SeasonWindow } from './profile';
import { WISHLIST_SLOTS } from './lootPriority';

export type Mark = 'bis' | 'pass';
export type Pick = WishlistRow & { id: number; synced_bis: boolean };
export type TokenRow = { token_item_id: number; resolved_item_id: number; class: string };
export type Wearer = { className: string | null; spec: string | null; role: string | null };

export type EditorRow = { itemId: number; name: string; mark: Mark | null; takenBy: string | null };
export type EditorSlot = { slot: string; items: EditorRow[]; notFromRaid: string | null };

// Which class can use what, as on the current site (js/common.js). Kat
// confirmed each list there.
const ARMOR_TYPE: Record<string, string> = {
  'Death Knight': 'Plate',
  'Demon Hunter': 'Leather',
  Druid: 'Leather',
  Evoker: 'Mail',
  Hunter: 'Mail',
  Mage: 'Cloth',
  Monk: 'Leather',
  Paladin: 'Plate',
  Priest: 'Cloth',
  Rogue: 'Leather',
  Shaman: 'Mail',
  Warlock: 'Cloth',
  Warrior: 'Plate'
};

const CLASS_MAIN_STAT: Record<string, string> = {
  'Death Knight': 'STRENGTH',
  'Demon Hunter': 'AGILITY',
  Evoker: 'INTELLECT',
  Hunter: 'AGILITY',
  Mage: 'INTELLECT',
  Priest: 'INTELLECT',
  Rogue: 'AGILITY',
  Warlock: 'INTELLECT',
  Warrior: 'STRENGTH'
};

// Classes whose main stat depends on the spec. No spec name here means
// something different for another class; Frost does, so it is not here.
const SPEC_MAIN_STAT: Record<string, string> = {
  Balance: 'INTELLECT',
  Feral: 'AGILITY',
  Guardian: 'AGILITY',
  Restoration: 'INTELLECT',
  Brewmaster: 'AGILITY',
  Mistweaver: 'INTELLECT',
  Windwalker: 'AGILITY',
  Holy: 'INTELLECT',
  Protection: 'STRENGTH',
  Retribution: 'STRENGTH',
  Elemental: 'INTELLECT',
  Enhancement: 'AGILITY',
  Devourer: 'INTELLECT'
};

// Weapon types by handedness, since a class can have one of a type and not
// the other (#609).
const WEAPON_TYPES: Record<string, Record<string, string[]>> = {
  'Death Knight': { 'One-Hand': ['Axe', 'Mace', 'Sword'], 'Two-Hand': ['Axe', 'Mace', 'Sword', 'Polearm'] },
  'Demon Hunter': { 'One-Hand': ['Axe', 'Sword', 'Dagger', 'Fist Weapon', 'Warglaive'] },
  Druid: { 'One-Hand': ['Mace', 'Dagger', 'Fist Weapon'], 'Two-Hand': ['Mace', 'Staff', 'Polearm'] },
  Evoker: {
    'One-Hand': ['Axe', 'Mace', 'Sword', 'Dagger', 'Fist Weapon'],
    'Two-Hand': ['Axe', 'Mace', 'Sword', 'Staff']
  },
  Hunter: {
    'One-Hand': ['Axe', 'Sword', 'Fist Weapon'],
    'Two-Hand': ['Axe', 'Sword', 'Polearm'],
    Ranged: ['Bow', 'Gun', 'Crossbow']
  },
  Mage: { 'One-Hand': ['Sword', 'Dagger', 'Wand'], 'Two-Hand': ['Staff'] },
  Monk: { 'One-Hand': ['Axe', 'Mace', 'Sword', 'Fist Weapon'], 'Two-Hand': ['Staff', 'Polearm'] },
  Paladin: { 'One-Hand': ['Axe', 'Mace', 'Sword'], 'Two-Hand': ['Axe', 'Mace', 'Sword', 'Polearm'] },
  Priest: { 'One-Hand': ['Mace', 'Dagger', 'Wand'], 'Two-Hand': ['Staff'] },
  Rogue: { 'One-Hand': ['Axe', 'Sword', 'Dagger', 'Fist Weapon'] },
  Shaman: { 'One-Hand': ['Axe', 'Mace', 'Dagger', 'Fist Weapon'], 'Two-Hand': ['Staff'] },
  Warlock: { 'One-Hand': ['Sword', 'Dagger', 'Wand'], 'Two-Hand': ['Staff'] },
  Warrior: {
    'One-Hand': ['Axe', 'Mace', 'Sword', 'Dagger', 'Fist Weapon'],
    'Two-Hand': ['Axe', 'Mace', 'Sword', 'Polearm', 'Staff']
  }
};

const SHIELD_USERS = new Set(['Warrior', 'Paladin', 'Shaman']);
const DUAL_WIELDERS = new Set(['Death Knight', 'Demon Hunter', 'Monk', 'Rogue', 'Shaman', 'Warrior']);

// Trinkets whose whole effect helps allies, or only protects the wearer (#636).
const HEALER_ONLY_TRINKETS = new Set([
  'Light of the Cosmic Crescendo',
  'Volatile Void Suffuser',
  'Soulcoiler Ritual Vessel',
  'Preternatural Antivenom'
]);
const TANK_ONLY_TRINKETS = new Set(["First Mate's Shellward", 'Idol of the Howling Nexus']);

const CATALOG_ROWS: Record<string, string[]> = {
  Head: ['Head'],
  Neck: ['Neck'],
  Shoulder: ['Shoulder'],
  Back: ['Back'],
  Chest: ['Chest'],
  Wrist: ['Wrist'],
  Hands: ['Hands'],
  Waist: ['Waist'],
  Legs: ['Legs'],
  Feet: ['Feet'],
  Finger: ['Finger 1', 'Finger 2'],
  Trinket: ['Trinket 1', 'Trinket 2'],
  'One-Hand': ['Weapon'],
  'Two-Hand': ['Weapon'],
  Ranged: ['Weapon'],
  'Off Hand': ['Off Hand'],
  'Held In Off-hand': ['Off Hand']
};

// Slots whose saved rows name the slot, because an item there fits more than
// one. The other slots save no slot, as the current site does, so both sites
// keep reading the same rows until cutover.
const NAMED_SLOTS = new Set(['Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2', 'Weapon', 'Off Hand']);

// One ring or trinket is the same item in either of its slots, so it is BiS in
// one of them and a Pass covers both. Weapons are not paired: a dual wielder
// can want the same one-hander twice.
const PAIR: Record<string, string> = {
  'Finger 1': 'Finger 2',
  'Finger 2': 'Finger 1',
  'Trinket 1': 'Trinket 2',
  'Trinket 2': 'Trinket 1'
};

const ARMOR_TYPES = new Set(['Plate', 'Mail', 'Leather', 'Cloth']);
// Slots with no armor type to match: jewelry, cloaks and weapons.
const ANY_ARMOR_SLOTS = new Set([
  'Neck',
  'Back',
  'Finger 1',
  'Finger 2',
  'Trinket 1',
  'Trinket 2',
  'Weapon',
  'Off Hand'
]);
// Slots whose items carry a main stat.
const MAIN_STAT_SLOTS = new Set(['Trinket 1', 'Trinket 2', 'Weapon', 'Off Hand']);

export const mainStatFor = (className: string | null, spec: string | null) =>
  (spec && SPEC_MAIN_STAT[spec]) || (className && CLASS_MAIN_STAT[className]) || null;

// Whether a raid item drops in the season, by its raid: raid_zones.season
// holds the season code (#933). With no raids set up for the season yet,
// every raid item counts.
export function inSeasonZone(item: CatalogItem, seasonCode: string | null, zones: ZoneRow[]): boolean {
  if (item.wcl_zone_id == null) return true;
  const seasonZones = zones.filter((z) => z.season === seasonCode).map((z) => z.wcl_zone_id);
  return seasonZones.length === 0 || seasonZones.includes(item.wcl_zone_id);
}

// The season the editor plans for: the Season View an officer pinned (a code
// since #933) or the team's own. It scopes the raid items by zone and stamps
// the row, which since #936 is the same value for both.
export function editorSeason(view: string | null, season: SeasonWindow): string | null {
  return view || season.code;
}

// Only the picks filed under the tier being planned. The wishlist key carries
// the season since #936, so a raider holds a separate pick for the same item
// in each tier, and the write gate refuses a row filed under any other. A pick
// from a tier the editor is not planning is not its to read, replace or clear.
//
// No season at all is the editor not knowing which tier it plans, rather than
// a tier of its own: no tier has started and no officer has pinned one. It
// narrows nothing there and the editor is read-only, because hiding every
// pick would show a raider an empty wishlist instead of an unavailable one.
export function picksInSeason(picks: Pick[], seasonCode: string | null): Pick[] {
  if (seasonCode === null) return picks;
  return picks.filter((p) => (p.season ?? null) === seasonCode);
}

// Whether the wearer can use `item` in `row`. Anything the catalog does not
// know (no armor type, no main stat, no weapon type) is offered.
function usable(item: CatalogItem, row: string, wearer: Wearer): boolean {
  const { className, role } = wearer;
  const armor = className ? ARMOR_TYPE[className] : undefined;
  if (armor && item.armor_type && ARMOR_TYPES.has(item.armor_type) && !ANY_ARMOR_SLOTS.has(row)) {
    if (item.armor_type !== armor) return false;
  }
  const stat = mainStatFor(className, wearer.spec);
  const stats = Array.isArray(item.main_stats) ? (item.main_stats as string[]) : [];
  if (stat && MAIN_STAT_SLOTS.has(row) && stats.length && !stats.includes(stat)) return false;
  if (role && (row === 'Trinket 1' || row === 'Trinket 2')) {
    if (HEALER_ONLY_TRINKETS.has(item.name) && role !== 'Heal') return false;
    if (TANK_ONLY_TRINKETS.has(item.name) && role !== 'Tank') return false;
  }
  const subtype = item.weapon_subtype;
  if (className && subtype && (row === 'Weapon' || (row === 'Off Hand' && item.slot === 'One-Hand'))) {
    if (!(WEAPON_TYPES[className]?.[item.slot] ?? []).includes(subtype)) return false;
  }
  if (className && row === 'Off Hand' && subtype === 'Shield' && !SHIELD_USERS.has(className)) return false;
  return true;
}

// The slots an item can fill for this wearer.
function rowsFor(item: CatalogItem, className: string | null): string[] {
  const rows = CATALOG_ROWS[item.slot] ?? [];
  return item.slot === 'One-Hand' && className && DUAL_WIELDERS.has(className) ? [...rows, 'Off Hand'] : rows;
}

// The saved rows that mark `itemId` for `row`: the ones naming the slot, and
// ones saved without a slot whose item fits it.
function picksFor(picks: Pick[], byId: Map<number, CatalogItem>, row: string, itemId: number): Pick[] {
  return picks.filter((p) => {
    if (p.item_id !== itemId) return false;
    if (p.slot) return p.slot === row;
    const item = byId.get(itemId);
    return !!item && (CATALOG_ROWS[item.slot] ?? []).includes(row);
  });
}

type Context = {
  picks: Pick[];
  byId: Map<number, CatalogItem>;
  seasonCode: string | null;
  zones: ZoneRow[];
};

// The items holding BiS in each slot of a ring or trinket pair, by item id.
// A copy the current site saves into the other slot (synced_bis) is not a pick
// of its own. On the current site a raider could save both BiS trinkets under
// Trinket 1 (six Phoenix raiders did); when one slot holds two and the other
// none, the later pick reads as the other slot's.
function pairHolders(ctx: Context, row: string): Record<string, number[]> {
  const pair = PAIR[row]!;
  const [a, b] = row < pair ? [row, pair] : [pair, row];
  const bisRows = (slot: string) =>
    ctx.picks
      .filter((p) => {
        const item = ctx.byId.get(p.item_id);
        return (
          p.status === 'bis' &&
          !!item &&
          !item.is_placeholder &&
          inSeasonZone(item, ctx.seasonCode, ctx.zones) &&
          picksFor(ctx.picks, ctx.byId, slot, p.item_id).includes(p)
        );
      })
      .sort((x, y) => x.id - y.id);
  const ids = (rows: Pick[]) => [...new Set(rows.map((p) => p.item_id))];
  const heldA = ids(bisRows(a).filter((p) => !p.synced_bis));
  let heldB = ids(bisRows(b).filter((p) => !p.synced_bis));
  // A copy whose pick is gone still counts for its own slot.
  for (const id of ids(bisRows(a))) if (!heldA.includes(id) && !heldB.includes(id)) heldA.push(id);
  for (const id of ids(bisRows(b))) if (!heldA.includes(id) && !heldB.includes(id)) heldB.push(id);
  // The same item held in both slots is the first slot's.
  heldB = heldB.filter((id) => !heldA.includes(id));
  if (heldA.length > 1 && heldB.length === 0) heldB = [heldA.pop()!];
  else if (heldB.length > 1 && heldA.length === 0) heldA.push(heldB.pop()!);
  return { [a]: heldA, [b]: heldB };
}

// How `itemId` reads in `row`.
function markFor(ctx: Context, row: string, itemId: number): { mark: Mark | null; takenBy: string | null } {
  const own = picksFor(ctx.picks, ctx.byId, row, itemId);
  const pair = PAIR[row];
  const other = pair ? picksFor(ctx.picks, ctx.byId, pair, itemId) : [];
  if (pair) {
    const held = pairHolders(ctx, row);
    if (held[row]!.includes(itemId)) return { mark: 'bis', takenBy: null };
    if (held[pair]!.includes(itemId)) return { mark: null, takenBy: pair };
  } else if (own.some((p) => p.status === 'bis')) {
    return { mark: 'bis', takenBy: null };
  }
  if ([...own, ...other].some((p) => p.status === 'pass')) return { mark: 'pass', takenBy: null };
  return { mark: null, takenBy: null };
}

export type EditorInput = {
  picks: Pick[];
  catalog: CatalogItem[];
  zones: ZoneRow[];
  // The season being planned (editorSeason()): Season View when an officer set
  // one, else the team's season, as on the current site. It scopes the zones
  // and stamps the row.
  seasonCode: string | null;
  tokens: TokenRow[];
  wearer: Wearer;
};

export function editorSlots(input: EditorInput): EditorSlot[] {
  const { catalog, zones, seasonCode, tokens, wearer } = input;
  const picks = picksInSeason(input.picks, seasonCode);
  const byId = new Map(catalog.map((i) => [i.id, i]));
  // A tier piece is offered as its token, named for the wearer's class, since
  // the token is what drops and what priority is kept for.
  const resolvedIds = new Set(tokens.map((t) => t.resolved_item_id));
  const tokenName = new Map(
    tokens.filter((t) => t.class === wearer.className).map((t) => [t.token_item_id, byId.get(t.resolved_item_id)?.name])
  );

  const offered = new Map<string, { itemId: number; name: string }[]>(WISHLIST_SLOTS.map((s) => [s, []]));
  for (const item of catalog) {
    if (item.is_placeholder || resolvedIds.has(item.id) || !inSeasonZone(item, seasonCode, zones)) continue;
    for (const row of rowsFor(item, wearer.className)) {
      if (!usable(item, row, wearer)) continue;
      offered.get(row)?.push({ itemId: item.id, name: tokenName.get(item.id) ?? item.name });
    }
  }

  return WISHLIST_SLOTS.flatMap((slot) => {
    const items = offered.get(slot)!.sort((a, b) => a.name.localeCompare(b.name));
    if (!items.length) return [];
    const notFromRaid = picks.find((p) => {
      const item = byId.get(p.item_id);
      return item?.is_placeholder && p.slot === slot && p.status === 'bis';
    });
    return [
      {
        slot,
        items: items.map((i) => ({
          ...i,
          ...markFor({ picks, byId, seasonCode, zones }, slot, i.itemId)
        })),
        notFromRaid: notFromRaid ? (byId.get(notFromRaid.item_id)?.name ?? null) : null
      }
    ];
  });
}

export type NewPick = {
  team_id: number;
  player_id: number;
  item_id: number;
  slot: string | null;
  status: Mark;
  note: null;
  // Null when no tier resolves at all, which is what a row with no season
  // looks like. The column is nullable and the empty string is not a seasons
  // row, so it would fail the foreign key (#936).
  season: string | null;
  synced_bis: false;
};

export type WritePlan = {
  deletes: number[];
  update: { id: number; status: Mark; slot: string | null } | null;
  insert: NewPick | null;
};

// The writes that set `itemId` in `row` to `next` (null clears it). Rows are
// deleted first, so a kept row can take the slot a deleted one had.
export function planMark(
  input: EditorInput & { teamId: number; playerId: number },
  row: string,
  itemId: number,
  next: Mark | null
): WritePlan {
  const { catalog, zones, seasonCode } = input;
  const picks = picksInSeason(input.picks, seasonCode);
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const ctx = { picks, byId, seasonCode, zones };
  const pair = PAIR[row];
  const own = picksFor(picks, byId, row, itemId);
  const other = pair ? picksFor(picks, byId, pair, itemId) : [];
  const slot = NAMED_SLOTS.has(row) ? row : null;
  const kept = next === null ? null : (own.find((p) => p.slot === slot) ?? own[0] ?? null);
  const deletes = new Set<number>();
  const drop = (p: Pick) => {
    if (p !== kept) deletes.add(p.id);
  };

  // Every other row marking the item here, and for a ring or trinket, its BiS
  // and Pass rows in the other slot, which this mark replaces.
  for (const p of own) drop(p);
  if (pair) for (const p of other) if (p.status === 'bis' || p.status === 'pass') drop(p);

  if (next === 'bis') {
    // One BiS pick per slot: the raid item holding it this season, and an M+
    // or crafted pick for it, are unmarked.
    if (pair) {
      for (const id of pairHolders(ctx, row)[row]!) {
        if (id === itemId) continue;
        for (const p of [...picksFor(picks, byId, row, id), ...picksFor(picks, byId, pair, id)]) {
          if (p.status === 'bis') drop(p);
        }
      }
    } else {
      for (const p of picks) {
        const item = byId.get(p.item_id);
        if (!item || item.is_placeholder || p.item_id === itemId || p.status !== 'bis') continue;
        if (inSeasonZone(item, seasonCode, zones) && picksFor(picks, byId, row, p.item_id).includes(p)) drop(p);
      }
    }
    for (const p of picks) {
      const item = byId.get(p.item_id);
      if (item?.is_placeholder && p.status === 'bis' && p.slot === row) drop(p);
    }
  }

  const deleted = [...deletes].sort((x, y) => x - y);
  if (next === null) return { deletes: deleted, update: null, insert: null };

  return {
    deletes: deleted,
    update: kept ? { id: kept.id, status: next, slot } : null,
    insert: kept
      ? null
      : {
          team_id: input.teamId,
          player_id: input.playerId,
          item_id: itemId,
          slot,
          status: next,
          note: null,
          season: seasonCode,
          synced_bis: false
        }
  };
}

// How many of the sixteen slots have a BiS pick this season, and how many the
// raider passed on, read the way the editor reads them.
export function wishlistSummary(
  rows: WishlistRow[],
  catalog: CatalogItem[],
  zones: ZoneRow[],
  season: SeasonWindow
): { bis: number; pass: number; total: number } {
  const byId = new Map(catalog.map((i) => [i.id, i]));
  const picks = picksInSeason(
    rows.map((r, i) => ({ ...r, id: (r as Partial<Pick>).id ?? i, synced_bis: r.synced_bis ?? false })),
    season.code
  );
  const ctx = { picks, byId, seasonCode: season.code, zones };
  const raid = picks.filter((p) => {
    const item = byId.get(p.item_id);
    return !!item && !item.is_placeholder && inSeasonZone(item, season.code, zones);
  });
  const marks = (slot: string, status: string) =>
    raid.some((p) => p.status === status && picksFor(picks, byId, slot, p.item_id).includes(p));
  const notFromRaid = (slot: string, status: string) =>
    picks.some((p) => byId.get(p.item_id)?.is_placeholder && p.slot === slot && p.status === status);

  let bis = 0;
  let pass = 0;
  for (const slot of WISHLIST_SLOTS) {
    const pair = PAIR[slot];
    const held = pair ? pairHolders(ctx, slot)[slot]!.length > 0 : marks(slot, 'bis');
    if (held || notFromRaid(slot, 'bis')) bis++;
    else if (marks(slot, 'pass') || (pair && marks(pair, 'pass')) || notFromRaid(slot, 'pass')) pass++;
  }
  return { bis, pass, total: WISHLIST_SLOTS.length };
}
