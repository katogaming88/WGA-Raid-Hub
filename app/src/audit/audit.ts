// The roster audit's rules (#1639, #1261), kept apart from the components so
// what counts as an issue is tested without rendering. Everything here reads
// what the syncs stored: current gear (player_equipped_gear), the weekly row
// (character_weeks) and the season's reference rows (season_enchants and the
// rest); nothing is worked out from a guess.

import { ARMOR_BY_CLASS, ROLE_LABELS, ROLE_ORDER, equippedItemLevel, type Role } from '../roster/roster';
import type { EnchantCheck, VaultRule } from '../settings/settings';

export type GearItem = {
  player_id: number;
  equipment_slot: string;
  item_level: number | null;
  wow_item_id: number | null;
  track: string | null;
  enchantment_id: number | null;
  gem_wow_item_ids: (number | null)[];
  embellished: boolean;
  crafted: boolean;
  upgrade_rank: number | null;
  upgrade_max: number | null;
  synced_at: string;
};

// One slot of the Great Vault, as season_vault() stores it: a filled slot has
// the weakest reward it counts, an empty one says how many runs are left.
export type VaultSlot = {
  needs: number;
  done: number;
  track?: string;
  rank?: number;
  item_level?: number;
  left?: number;
};
export type VaultRowId = 'raid' | 'dungeon' | 'world';
// A row missing from the object, or null in it, is unknown (never read).
export type Vault = Partial<Record<VaultRowId, VaultSlot[] | null>>;

export type WeekRow = {
  name_realm_key: string;
  week_of: string;
  raid_kills: { encounter_id: number; difficulty: string }[];
  raids_at: string | null;
  mplus_runs: { dungeon_id: number; level: number; timed: boolean }[];
  mplus_rating: number | null;
  mplus_at: string | null;
  crests: Record<string, number>;
  crests_at: string | null;
  vault: Vault;
  vault_at: string | null;
  item_level: number | null;
  best_item_level: number | null;
  gear_at: string | null;
};

export type SeasonRefs = {
  // The slots a day expects enchanted, as season_enchant_slots_on() answers.
  slots: { slot: string; counts_from: string | null }[];
  enchants: Map<number, { name: string; top_rank: boolean; tertiary: boolean }>;
  gems: Map<number, { name: string; top_rank: boolean; epic: boolean }>;
};

// -- Weeks -------------------------------------------------------------------

const DAY_MS = 86_400_000;
// The US weekly reset, Tuesday 15:00 UTC, as the sync names weeks (weekOf).
const RESET_HOUR_MS = 15 * 3_600_000;

// The reset Tuesday that starts the week `at` falls in, 'YYYY-MM-DD'.
export function weekOf(at: Date): string {
  const shifted = new Date(at.getTime() - RESET_HOUR_MS);
  const back = (shifted.getUTCDay() - 2 + 7) % 7;
  return new Date(shifted.getTime() - back * DAY_MS).toISOString().slice(0, 10);
}

export function weekBefore(week: string): string {
  return new Date(Date.parse(week + 'T00:00:00Z') - 7 * DAY_MS).toISOString().slice(0, 10);
}

export type WhichWeek = 'this' | 'last';

// -- Gear check ----------------------------------------------------------------

export type GearProblem = {
  kind: 'enchant' | 'socket' | 'gem';
  slot: string;
  item: number | null;
  problem: string;
  issue: boolean;
};

export type GearCheck = {
  // False until the gear sync has saved a raider's slot details (#1634): rows
  // from before it carry empty defaults, which would read as every enchant
  // missing. Nothing is flagged then.
  read: boolean;
  enchantable: number;
  enchanted: number;
  sockets: number;
  filledSockets: number;
  // No gem worn is epic; null when the gear has no sockets at all.
  noEpicGem: boolean | null;
  embellishments: number;
  sparks: number;
  // Everything to fix, in slot order. `issue` is false for what is shown but
  // never counted (a gem below the rule's rank, an old gem).
  problems: GearProblem[];
};

export const SLOT_LABELS: Record<string, string> = {
  HEAD: 'Head',
  NECK: 'Neck',
  SHOULDER: 'Shoulders',
  BACK: 'Back',
  CHEST: 'Chest',
  WRIST: 'Wrists',
  HANDS: 'Hands',
  WAIST: 'Waist',
  LEGS: 'Legs',
  FEET: 'Feet',
  FINGER_1: 'Ring 1',
  FINGER_2: 'Ring 2',
  TRINKET_1: 'Trinket 1',
  TRINKET_2: 'Trinket 2',
  MAIN_HAND: 'Main hand',
  OFF_HAND: 'Off hand'
};
const SLOT_ORDER = Object.keys(SLOT_LABELS);

// An enchant or gem passes a rule when it is the season's and, for Strict, the
// top rank; for Lenient, the top rank unless it only gives a tertiary stat.
function enchantPasses(rule: EnchantCheck, e: { top_rank: boolean; tertiary: boolean }) {
  return rule === 'casual' || e.top_rank || (rule === 'lenient' && e.tertiary);
}

// `weaponOffHand`: whether the item in the off hand is a weapon, the only
// off hand that takes an enchant (a shield or held item does not).
export function gearCheck(
  gear: GearItem[],
  refs: SeasonRefs,
  rule: EnchantCheck,
  today: string,
  weaponOffHand: boolean
): GearCheck {
  // Any detail at all means the sync has read this raider's gear since #1634:
  // a track step comes with every raid, dungeon or crafted piece.
  const read = gear.some(
    (g) =>
      g.upgrade_rank != null ||
      g.enchantment_id != null ||
      (g.gem_wow_item_ids ?? []).length > 0 ||
      g.embellished ||
      g.crafted
  );
  if (!read) {
    return {
      read,
      enchantable: 0,
      enchanted: 0,
      sockets: 0,
      filledSockets: 0,
      noEpicGem: null,
      embellishments: 0,
      sparks: 0,
      problems: []
    };
  }
  const slots = new Set(refs.slots.filter((s) => !s.counts_from || s.counts_from <= today).map((s) => s.slot));
  const problems: GearProblem[] = [];
  let enchantable = 0;
  let enchanted = 0;
  let sockets = 0;
  let filledSockets = 0;
  let epic = false;

  for (const item of gear) {
    const slot = item.equipment_slot;
    if (slots.has(slot) && !(slot === 'OFF_HAND' && !weaponOffHand) && item.wow_item_id != null) {
      enchantable++;
      const e = item.enchantment_id == null ? undefined : refs.enchants.get(item.enchantment_id);
      if (item.enchantment_id == null) {
        problems.push({ kind: 'enchant', slot, item: item.wow_item_id, problem: 'No enchant', issue: true });
      } else if (!e) {
        problems.push({
          kind: 'enchant',
          slot,
          item: item.wow_item_id,
          problem: 'Enchant from an old expansion',
          issue: true
        });
      } else if (!enchantPasses(rule, e)) {
        problems.push({
          kind: 'enchant',
          slot,
          item: item.wow_item_id,
          problem: 'Enchant is not the highest rank',
          issue: true
        });
      } else enchanted++;
    }
    for (const gem of item.gem_wow_item_ids ?? []) {
      sockets++;
      if (gem == null) {
        problems.push({ kind: 'socket', slot, item: item.wow_item_id, problem: 'Empty socket', issue: true });
        continue;
      }
      filledSockets++;
      const g = refs.gems.get(gem);
      if (g?.epic) epic = true;
      // Information only: a low-quality gem is never an issue (#1639).
      if (!g)
        problems.push({
          kind: 'gem',
          slot,
          item: item.wow_item_id,
          problem: 'Gem from an old expansion',
          issue: false
        });
      else if (!enchantPasses(rule, { top_rank: g.top_rank, tertiary: false })) {
        problems.push({
          kind: 'gem',
          slot,
          item: item.wow_item_id,
          problem: 'Gem is not the highest rank',
          issue: false
        });
      }
    }
  }
  problems.sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  return {
    read,
    enchantable,
    enchanted,
    sockets,
    filledSockets,
    noEpicGem: sockets === 0 ? null : !epic,
    // Embellishments are information only, never an issue (#1639).
    embellishments: gear.filter((g) => g.embellished).length,
    sparks: gear.filter((g) => g.crafted).length,
    problems
  };
}

export const countIssues = (c: GearCheck) => c.problems.filter((p) => p.issue).length;

// -- Vault ---------------------------------------------------------------------

export type VaultView = {
  // Per row: its slots, or null when that row was never read.
  slots: VaultSlot[] | null;
  filled: number;
  best: number | null;
};

export const VAULT_ROWS: { id: VaultRowId; name: string; unit: string }[] = [
  { id: 'raid', name: 'Raid', unit: 'boss' },
  { id: 'dungeon', name: 'Dungeons', unit: 'run' },
  { id: 'world', name: 'World', unit: 'delve' }
];

export function vaultView(vault: Vault | undefined, row: VaultRowId): VaultView {
  const slots = vault?.[row] ?? null;
  if (!slots) return { slots: null, filled: 0, best: null };
  const levels = slots.map((s) => s.item_level).filter((l): l is number => l != null);
  return { slots, filled: levels.length, best: levels.length ? Math.max(...levels) : null };
}

export const vaultFilled = (vault: Vault | undefined) =>
  VAULT_ROWS.reduce((n, r) => n + vaultView(vault, r.id).filled, 0);

// Rows below the team's weekly minimum, only for rows that were read: an
// unknown row is not a failed one.
export function belowVaultRule(vault: Vault | undefined, rule: VaultRule | null): VaultRowId[] {
  if (!rule) return [];
  return VAULT_ROWS.filter((r) => {
    const v = vaultView(vault, r.id);
    return v.slots !== null && rule[r.id] > 0 && v.filled < rule[r.id];
  }).map((r) => r.id);
}

// -- One raider ----------------------------------------------------------------

export type AuditPlayer = {
  id: number;
  name_realm: string;
  name_realm_key: string | null;
  url_code?: string | null;
  classes_specs: { class: string; spec: string; role: string | null } | null;
};

export type TierLetters = { slot: string; letter: string }[];

export type AuditRaider = {
  id: number;
  code: string | null;
  // The character's name_realm_key, for reading its other weeks.
  key: string | null;
  name: string;
  realm: string;
  className: string;
  spec: string;
  role: Role | null;
  // Item level: the highest ever (the sync's mark), and what is worn now.
  highestIlvl: number | null;
  wornIlvl: number | null;
  rating: number | null;
  check: GearCheck;
  // The slots' current gear, for the Gear, Upgrades and Enchants & gems tabs.
  gear: GearItem[];
  tier: TierLetters;
  // The chosen week's row, and both weeks' rows for the opened raider.
  week: WeekRow | null;
  thisWeek: WeekRow | null;
  lastWeek: WeekRow | null;
  belowRule: VaultRowId[];
  issues: number;
  // The newest time any part of the raider's data was written.
  updatedAt: string | null;
  stale: boolean;
};

export const TIER_SLOTS = ['HEAD', 'SHOULDER', 'CHEST', 'HANDS', 'LEGS'] as const;
// One letter each in the table heading (Gloves for Hands), the full name for
// screen readers and the tooltip.
export const TIER_SLOT_HEADINGS = [
  { letter: 'H', name: 'Head' },
  { letter: 'S', name: 'Shoulders' },
  { letter: 'C', name: 'Chest' },
  { letter: 'G', name: 'Hands' },
  { letter: 'L', name: 'Legs' }
];
const TRACK_LETTER: Record<string, string> = { Myth: 'M', Hero: 'H', Champion: 'C', Veteran: 'V', Adventurer: 'A' };

export const trackLetter = (track: string | null) => (track ? (TRACK_LETTER[track] ?? '?') : '?');

export type AuditInput = {
  player: AuditPlayer;
  gear: GearItem[];
  // The weekly rows of the character, newest first (at most this and last week).
  weeks: WeekRow[];
  refs: SeasonRefs;
  rule: EnchantCheck;
  vaultRule: VaultRule | null;
  // Wow item ids of this season's tier pieces for the character's class.
  tierItems: Set<number>;
  // Off-hand items that are weapons, by wow item id.
  weaponIds: Set<number>;
  which: WhichWeek;
  thisWeek: string;
  now: Date;
};

const STALE_MS = DAY_MS;

export function auditRaider(i: AuditInput): AuditRaider {
  const { player, gear, refs } = i;
  const today = i.now.toISOString().slice(0, 10);
  const offHand = gear.find((g) => g.equipment_slot === 'OFF_HAND');
  const check = gearCheck(gear, refs, i.rule, today, !!offHand?.wow_item_id && i.weaponIds.has(offHand.wow_item_id));
  const thisWeek = i.weeks.find((w) => w.week_of === i.thisWeek) ?? null;
  const lastWeek = i.weeks.find((w) => w.week_of === weekBefore(i.thisWeek)) ?? null;
  const week = i.which === 'this' ? thisWeek : lastWeek;
  const newest = i.weeks[0] ?? null;
  const worn = equippedItemLevel(gear);
  const best = Math.max(0, ...i.weeks.map((w) => w.best_item_level ?? 0), newest?.item_level ?? 0) || null;
  // The mark is never below what is worn, even before the first weekly read.
  const highest = best === null ? worn : Math.max(best, worn ?? 0);
  const belowRule = belowVaultRule(week?.vault, i.vaultRule);
  const times = [
    ...gear.map((g) => g.synced_at),
    ...i.weeks.flatMap((w) => [w.raids_at, w.mplus_at, w.crests_at, w.vault_at, w.gear_at])
  ].filter((t): t is string => !!t);
  const updatedAt = times.length ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
  const cs = player.classes_specs;
  const role = ROLE_ORDER.includes(cs?.role as Role) ? (cs!.role as Role) : null;
  const [name = player.name_realm, ...realm] = player.name_realm.split('-');
  return {
    id: player.id,
    code: player.url_code ?? null,
    key: player.name_realm_key,
    name,
    realm: realm.join('-'),
    className: cs?.class ?? '',
    spec: cs?.spec ?? '',
    role,
    highestIlvl: highest,
    wornIlvl: worn,
    rating: newest?.mplus_rating ?? null,
    check,
    gear,
    tier: TIER_SLOTS.map((slot) => {
      const piece = gear.find((g) => g.equipment_slot === slot);
      const isTier = !!piece?.wow_item_id && i.tierItems.has(piece.wow_item_id);
      return { slot, letter: isTier ? trackLetter(piece!.track) : '' };
    }),
    week,
    thisWeek,
    lastWeek,
    belowRule,
    issues: countIssues(check) + (check.noEpicGem ? 1 : 0) + belowRule.length,
    updatedAt,
    stale: updatedAt === null || i.now.getTime() - Date.parse(updatedAt) > STALE_MS
  };
}

// -- The page's groups and Needs attention ---------------------------------------

export type GroupBy = 'role' | 'armor' | 'class' | 'none';
export type IlvlMode = 'highest' | 'worn';

export const ilvlOf = (r: AuditRaider, mode: IlvlMode) => (mode === 'highest' ? r.highestIlvl : r.wornIlvl);

export type AuditGroup = { label: string; raiders: AuditRaider[]; avg: number | null; needLook: number };

export function groupRaiders(raiders: AuditRaider[], by: GroupBy, mode: IlvlMode): AuditGroup[] {
  const keyOf = (r: AuditRaider): string => {
    if (by === 'role') return r.role ? ROLE_LABELS[r.role] : 'No role';
    if (by === 'armor') return ARMOR_BY_CLASS[r.className] ?? 'Unknown';
    if (by === 'class') return r.className || 'Unknown';
    return 'Everyone';
  };
  const order = (label: string): number => {
    if (by === 'role') return ROLE_ORDER.map((r) => ROLE_LABELS[r]).indexOf(label);
    if (by === 'armor') return ['Cloth', 'Leather', 'Mail', 'Plate'].indexOf(label);
    return 0;
  };
  const map = new Map<string, AuditRaider[]>();
  for (const r of raiders) map.set(keyOf(r), [...(map.get(keyOf(r)) ?? []), r]);
  return [...map.entries()]
    .map(([label, rs]) => {
      const levels = rs.map((r) => ilvlOf(r, mode)).filter((l): l is number => l != null);
      return {
        label,
        raiders: rs.sort((a, b) => (ilvlOf(b, mode) ?? 0) - (ilvlOf(a, mode) ?? 0) || a.name.localeCompare(b.name)),
        avg: levels.length ? Math.round(levels.reduce((n, l) => n + l, 0) / levels.length) : null,
        needLook: rs.filter((r) => r.issues > 0).length
      };
    })
    .sort(
      (a, b) =>
        (order(a.label) - order(b.label)) * (by === 'class' || by === 'none' ? 0 : 1) || a.label.localeCompare(b.label)
    );
}

export type Attention = { id: string; count: number; label: string; who: string[] };

export function needsAttention(raiders: AuditRaider[], hasVaultRule: boolean): Attention[] {
  const count = (r: AuditRaider, kind: GearProblem['kind']) =>
    r.check.problems.filter((p) => p.issue && p.kind === kind).length;
  const named = (kind: GearProblem['kind']) =>
    raiders
      .map((r) => ({ r, n: count(r, kind) }))
      .filter((x) => x.n > 0)
      .map((x) => ({ count: x.n, who: `${x.r.name}${x.n > 1 ? ` (${x.n})` : ''}` }));
  const total = (rows: { count: number }[]) => rows.reduce((n, x) => n + x.count, 0);
  const enchants = named('enchant');
  const sockets = named('socket');
  const noEpic = raiders.filter((r) => r.check.noEpicGem).map((r) => r.name);
  const below = raiders.filter((r) => r.belowRule.length > 0).map((r) => r.name);
  const stale = raiders.filter((r) => r.stale).map((r) => r.name);
  const out: Attention[] = [
    { id: 'enchants', count: total(enchants), label: 'missing or wrong enchants', who: enchants.map((x) => x.who) },
    { id: 'sockets', count: total(sockets), label: 'empty sockets', who: sockets.map((x) => x.who) },
    { id: 'epic', count: noEpic.length, label: 'without an epic gem', who: noEpic },
    ...(hasVaultRule ? [{ id: 'vault', count: below.length, label: 'below the team vault rule', who: below }] : []),
    { id: 'stale', count: stale.length, label: 'not updated today', who: stale }
  ];
  return out.filter((a) => a.count > 0);
}

// -- Per-week figures the table and the raider's own card share ----------------

export function raidCounts(week: WeekRow | null): { heroic: number; mythic: number } | null {
  if (!week || !week.raids_at) return null;
  const bosses = (difficulty: string) =>
    new Set(week.raid_kills.filter((k) => k.difficulty === difficulty).map((k) => k.encounter_id)).size;
  return { heroic: bosses('heroic'), mythic: bosses('mythic') };
}

export function mplusFigures(week: WeekRow | null): { runs: number; best: number } | null {
  if (!week || !week.mplus_at) return null;
  return { runs: week.mplus_runs.length, best: Math.max(0, ...week.mplus_runs.map((r) => r.level)) };
}

// "2 hours ago", "3 days ago", for the Updated column.
export function ago(at: string | null, now: Date): string {
  if (!at) return 'never';
  const minutes = Math.max(0, Math.round((now.getTime() - Date.parse(at)) / 60_000));
  if (minutes < 60) return minutes < 2 ? 'just now' : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export function crestCap(rows: { track: string; cap: number | null }[], track: string) {
  return rows.find((r) => r.track === track)?.cap ?? null;
}

// -- Everything one page load reads, and the raiders made from it ---------------

export type AuditData = {
  players: AuditPlayer[];
  gear: GearItem[];
  weeks: WeekRow[];
  refs: SeasonRefs;
  rule: EnchantCheck;
  vaultRule: VaultRule | null;
  // This season's tier pieces' wow item ids, by class.
  tierByClass: Map<string, Set<number>>;
  weaponIds: Set<number>;
};

export function buildAudit(data: AuditData, which: WhichWeek, now: Date): AuditRaider[] {
  const thisWeek = weekOf(now);
  return data.players.map((player) =>
    auditRaider({
      player,
      gear: data.gear.filter((g) => g.player_id === player.id),
      weeks: data.weeks
        .filter((w) => w.name_realm_key === player.name_realm_key)
        .sort((a, b) => b.week_of.localeCompare(a.week_of)),
      refs: data.refs,
      rule: data.rule,
      vaultRule: data.vaultRule,
      tierItems: data.tierByClass.get(player.classes_specs?.class ?? '') ?? new Set(),
      weaponIds: data.weaponIds,
      which,
      thisWeek,
      now
    })
  );
}

// -- The Gear, Upgrades and Enchants & gems tabs (#1640) --------------------------

// The sixteen slots in the order the character pane lists them, main hand
// first. (A two-hander leaves the off hand empty.)
export const GEAR_SLOTS = [
  'MAIN_HAND',
  'OFF_HAND',
  'HEAD',
  'NECK',
  'SHOULDER',
  'BACK',
  'CHEST',
  'WRIST',
  'HANDS',
  'WAIST',
  'LEGS',
  'FEET',
  'FINGER_1',
  'FINGER_2',
  'TRINKET_1',
  'TRINKET_2'
];

// Short slot headings for the wide tables; the full name stays on hover.
export const SHORT_SLOT: Record<string, string> = {
  MAIN_HAND: 'Main',
  OFF_HAND: 'Off',
  HEAD: 'Head',
  NECK: 'Neck',
  SHOULDER: 'Shld',
  BACK: 'Back',
  CHEST: 'Chest',
  WRIST: 'Wrist',
  HANDS: 'Hands',
  WAIST: 'Waist',
  LEGS: 'Legs',
  FEET: 'Feet',
  FINGER_1: 'Ring',
  FINGER_2: 'Ring',
  TRINKET_1: 'Trink',
  TRINKET_2: 'Trink'
};

// Everyone in the Summary's order: by role, highest item level first.
export const inTabOrder = (raiders: AuditRaider[]) =>
  groupRaiders(raiders, 'role', 'highest').flatMap((g) => g.raiders);

export const itemIn = (r: AuditRaider, slot: string) => r.gear.find((g) => g.equipment_slot === slot) ?? null;

// Items on each upgrade track, and the steps still to buy across every slot.
// Crafted pieces and anything without a track step have none to buy.
export function upgradeFigures(r: AuditRaider) {
  const onTrack = (track: string) => r.gear.filter((g) => g.track === track).length;
  const stepsLeft = r.gear.reduce(
    (n, g) => (g.upgrade_rank != null && g.upgrade_max != null ? n + Math.max(0, g.upgrade_max - g.upgrade_rank) : n),
    0
  );
  return { myth: onTrack('Myth'), hero: onTrack('Hero'), champion: onTrack('Champion'), stepsLeft };
}

// The slots that take an enchant this season, from the season settings (never
// a fixed list), in the order of GEAR_SLOTS.
export function enchantColumns(refs: SeasonRefs, today: string): string[] {
  const slots = new Set(refs.slots.filter((s) => !s.counts_from || s.counts_from <= today).map((s) => s.slot));
  return GEAR_SLOTS.filter((s) => slots.has(s));
}

// The slots to show a gem column for: always neck and rings, and any other
// slot (head, wrist, waist...) only when someone's item there has a socket.
export function gemColumns(raiders: AuditRaider[]): string[] {
  const has = (slot: string) => raiders.some((r) => (itemIn(r, slot)?.gem_wow_item_ids ?? []).length > 0);
  return GEAR_SLOTS.filter((s) => ['NECK', 'FINGER_1', 'FINGER_2'].includes(s) || has(s));
}

export type GemChip = { label: string; kind: 'top' | 'low' | 'old' | 'empty'; title: string };

// One chip per socket: the gem's quality, or Empty.
export function gemChips(item: GearItem | null, refs: SeasonRefs): GemChip[] {
  return (item?.gem_wow_item_ids ?? []).map((id) => {
    if (id == null) return { label: 'Empty', kind: 'empty', title: 'Empty socket' };
    const g = refs.gems.get(id);
    if (!g) return { label: 'Old', kind: 'old', title: 'Gem from an old expansion' };
    return g.top_rank
      ? { label: 'Top', kind: 'top', title: `${g.name}, highest rank` }
      : { label: 'Low', kind: 'low', title: `${g.name}, lower rank` };
  });
}

export type EnchantCell = { name: string; rank: string; kind: 'ok' | 'none' | 'old' };

// What the Enchants cell shows for a slot: the enchant's name and rank, None,
// or one from an old expansion. Null when the slot has no item (nothing to enchant).
export function enchantCell(item: GearItem | null, refs: SeasonRefs): EnchantCell | null {
  if (!item || item.wow_item_id == null) return null;
  if (item.enchantment_id == null) return { name: 'None', rank: '', kind: 'none' };
  const e = refs.enchants.get(item.enchantment_id);
  if (!e) return { name: 'Old expansion', rank: '', kind: 'old' };
  return { name: e.name, rank: e.top_rank ? 'Highest rank' : 'Lower rank', kind: 'ok' };
}

// Low quality and old gems, counted as the tab's Low quality column does.
export function lowGemCount(r: AuditRaider, refs: SeasonRefs): number {
  return r.gear.reduce((n, g) => n + gemChips(g, refs).filter((c) => c.kind === 'low' || c.kind === 'old').length, 0);
}

// -- The Great Vault, Raids, Dungeons and Crests tabs (#1641) ----------------------

// A week of one character's raid kills and M+ runs, for the tabs that look at
// the whole season.
export type SeasonWeek = {
  name_realm_key: string;
  week_of: string;
  raid_kills: { encounter_id: number; difficulty: string }[];
  mplus_runs: { dungeon_id: number; level: number; timed: boolean }[];
};

export type Difficulty = 'mythic' | 'heroic' | 'normal';
const DIFFICULTY_RANK: Record<string, number> = { lfr: 0, normal: 1, heroic: 2, mythic: 3 };

// The highest of Normal, Heroic and Mythic killed on each boss. Raid Finder
// kills are left out: the tab is about the difficulties a guild raids.
export function bestKills(
  weeks: { raid_kills: { encounter_id: number; difficulty: string }[] }[]
): Map<number, Difficulty> {
  const best = new Map<number, Difficulty>();
  for (const w of weeks) {
    for (const k of w.raid_kills) {
      if ((DIFFICULTY_RANK[k.difficulty] ?? 0) < 1) continue;
      const have = best.get(k.encounter_id);
      if (!have || DIFFICULTY_RANK[k.difficulty]! > DIFFICULTY_RANK[have]!)
        best.set(k.encounter_id, k.difficulty as Difficulty);
    }
  }
  return best;
}

// Bosses killed on each difficulty, however many times and whatever else was
// killed on them: a Mythic kill does not count as a Heroic one.
export function killCounts(weeks: { raid_kills: { encounter_id: number; difficulty: string }[] }[], bossIds: number[]) {
  const on = (difficulty: Difficulty) =>
    new Set(
      weeks
        .flatMap((w) => w.raid_kills)
        .filter((k) => k.difficulty === difficulty && bossIds.includes(k.encounter_id))
        .map((k) => k.encounter_id)
    ).size;
  return { normal: on('normal'), heroic: on('heroic'), mythic: on('mythic') };
}

// The best key in each dungeon across the weeks, preferring one finished in time
// when two reach the same level.
export function seasonBestKeys(weeks: SeasonWeek[]): Map<number, { level: number; timed: boolean }> {
  const best = new Map<number, { level: number; timed: boolean }>();
  for (const w of weeks) {
    for (const r of w.mplus_runs) {
      const have = best.get(r.dungeon_id);
      if (!have || r.level > have.level || (r.level === have.level && r.timed && !have.timed)) {
        best.set(r.dungeon_id, { level: r.level, timed: r.timed });
      }
    }
  }
  return best;
}

// A crest's progress against its cap this week: Capped when full, a count and
// percent against the cap, or just the total when the type has no cap.
export function crestProgress(earned: number, cap: number | null) {
  if (cap === null) return { kind: 'uncapped' as const, earned, pct: 0 };
  if (cap > 0 && earned >= cap) return { kind: 'capped' as const, earned, pct: 100 };
  return { kind: 'open' as const, earned, pct: cap > 0 ? Math.min(100, Math.round((earned / cap) * 100)) : 0 };
}
