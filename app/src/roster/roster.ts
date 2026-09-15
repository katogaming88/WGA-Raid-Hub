// The Roster page's data, turned into what it shows (#870). Kept apart from
// the component so the rules (who is listed, in what order, how item level is
// worked out) are tested without rendering.

import { attendance, seasonLoot, type AttendanceRow, type LootRow, type SeasonWindow } from '../profile/profile';

export type Role = 'Tank' | 'Heal' | 'Melee' | 'Ranged';

export const ROLE_ORDER: Role[] = ['Tank', 'Heal', 'Melee', 'Ranged'];
export const ROLE_LABELS: Record<Role, string> = { Tank: 'Tanks', Heal: 'Healers', Melee: 'Melee', Ranged: 'Ranged' };

export type PlayerRow = {
  id: number;
  name_realm: string;
  url_code?: string | null;
  nickname: string | null;
  is_trial: boolean;
  is_bench: boolean;
  is_rotator: boolean;
  tier_pieces_equipped: number | null;
  join_date?: string | null;
  classes_specs: { class: string; spec: string; role: string | null } | null;
};

export type GearRow = { player_id: number; equipment_slot: string; item_level: number | null };

export type IncomingRow = {
  signup_id: number | null;
  signup_name_realm: string | null;
  class: string | null;
  spec: string | null;
  role: string | null;
};

export type Status = 'Trial' | 'Bench' | 'Rotator';

export type Raider = {
  key: string;
  // The roster character behind a row, and its profile address code. Null for
  // a signup on next season's roster.
  playerId: number | null;
  urlCode: string | null;
  // What the roster calls them: the nickname when there is one.
  name: string;
  // The character's own name, shown beside a nickname.
  character: string | null;
  className: string;
  spec: string;
  role: Role;
  itemLevel: number | null;
  tierPieces: number | null;
  statuses: Status[];
};

export type RoleGroup = { role: Role; label: string; raiders: Raider[] };

const isRole = (role: string | null | undefined): role is Role => ROLE_ORDER.includes(role as Role);

const firstName = (nameRealm: string) => nameRealm.split('-')[0]!.trim();

// Blizzard's equipped item level: the sixteen gear slots averaged, with a
// two-handed weapon counted in both hands when the off hand is empty. The shirt
// and tabard carry no item level that counts.
const GEAR_SLOTS = 16;
const IGNORED_SLOTS = new Set(['SHIRT', 'TABARD']);

export function equippedItemLevel(gear: Pick<GearRow, 'equipment_slot' | 'item_level'>[]): number | null {
  const levels = new Map<string, number>();
  for (const row of gear) {
    if (IGNORED_SLOTS.has(row.equipment_slot) || row.item_level == null) continue;
    levels.set(row.equipment_slot, row.item_level);
  }
  if (levels.size === 0) return null;
  let total = 0;
  for (const level of levels.values()) total += level;
  const mainHand = levels.get('MAIN_HAND');
  if (mainHand !== undefined && !levels.has('OFF_HAND')) total += mainHand;
  return Math.round((total / GEAR_SLOTS) * 10) / 10;
}

function groupByRole(raiders: Raider[]): RoleGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    raiders: raiders.filter((r) => r.role === role).sort((a, b) => a.name.localeCompare(b.name))
  })).filter((group) => group.raiders.length > 0);
}

// A player with no role is not a roster entry yet, the same rule the current
// site's mapSupabaseRoster() applies.
export function toRoster(players: PlayerRow[], gear: GearRow[]): RoleGroup[] {
  const gearByPlayer = new Map<number, GearRow[]>();
  for (const row of gear) {
    const rows = gearByPlayer.get(row.player_id) ?? [];
    rows.push(row);
    gearByPlayer.set(row.player_id, rows);
  }
  const raiders: Raider[] = [];
  for (const p of players) {
    const role = p.classes_specs?.role;
    if (!p.name_realm.trim() || !isRole(role)) continue;
    const character = firstName(p.name_realm);
    const name = p.nickname?.trim() || character;
    const statuses: Status[] = [];
    if (p.is_trial) statuses.push('Trial');
    if (p.is_bench) statuses.push('Bench');
    if (p.is_rotator) statuses.push('Rotator');
    raiders.push({
      key: `player-${p.id}`,
      playerId: p.id,
      urlCode: p.url_code ?? null,
      name,
      character: name === character ? null : character,
      className: p.classes_specs!.class,
      spec: p.classes_specs!.spec,
      role,
      itemLevel: equippedItemLevel(gearByPlayer.get(p.id) ?? []),
      tierPieces: p.tier_pieces_equipped,
      statuses
    });
  }
  return groupByRole(raiders);
}

// Approved signups not yet on the roster: the next season's tentative roster.
export function toIncoming(rows: IncomingRow[]): RoleGroup[] {
  const raiders: Raider[] = [];
  for (const row of rows) {
    const nameRealm = row.signup_name_realm?.trim();
    if (!nameRealm || !isRole(row.role)) continue;
    raiders.push({
      key: `signup-${row.signup_id}`,
      playerId: null,
      urlCode: null,
      name: firstName(nameRealm),
      character: null,
      className: row.class ?? '',
      spec: row.spec ?? '',
      role: row.role,
      itemLevel: null,
      tierPieces: null,
      statuses: []
    });
  }
  return groupByRole(raiders);
}

// Tier sets are one per armor type, so officers plan around this split.
const ARMOR_BY_CLASS: Record<string, 'Cloth' | 'Leather' | 'Mail' | 'Plate'> = {
  Mage: 'Cloth',
  Priest: 'Cloth',
  Warlock: 'Cloth',
  'Demon Hunter': 'Leather',
  Druid: 'Leather',
  Monk: 'Leather',
  Rogue: 'Leather',
  Evoker: 'Mail',
  Hunter: 'Mail',
  Shaman: 'Mail',
  'Death Knight': 'Plate',
  Paladin: 'Plate',
  Warrior: 'Plate'
};

export const ARMOR_ORDER = ['Cloth', 'Leather', 'Mail', 'Plate'] as const;

export type RosterSummary = {
  total: number;
  trial: number;
  bench: number;
  rotator: number;
  roles: { role: Role; label: string; count: number }[];
  averageItemLevel: number | null;
  lowest: { name: string; itemLevel: number } | null;
  withoutGear: number;
  armor: { type: (typeof ARMOR_ORDER)[number]; count: number }[];
};

export function summarize(groups: RoleGroup[]): RosterSummary {
  const raiders = groups.flatMap((g) => g.raiders);
  const geared = raiders.filter((r): r is Raider & { itemLevel: number } => r.itemLevel !== null);
  const lowest = geared.reduce<(typeof geared)[number] | null>(
    (low, r) => (low === null || r.itemLevel < low.itemLevel ? r : low),
    null
  );
  const average = geared.length
    ? Math.round((geared.reduce((sum, r) => sum + r.itemLevel, 0) / geared.length) * 10) / 10
    : null;
  return {
    total: raiders.length,
    trial: raiders.filter((r) => r.statuses.includes('Trial')).length,
    bench: raiders.filter((r) => r.statuses.includes('Bench')).length,
    rotator: raiders.filter((r) => r.statuses.includes('Rotator')).length,
    roles: ROLE_ORDER.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      count: raiders.filter((r) => r.role === role).length
    })),
    averageItemLevel: average,
    lowest: lowest ? { name: lowest.name, itemLevel: lowest.itemLevel } : null,
    withoutGear: raiders.length - geared.length,
    armor: ARMOR_ORDER.map((type) => ({
      type,
      count: raiders.filter((r) => ARMOR_BY_CLASS[r.className] === type).length
    }))
  };
}

export function summaryLine(summary: RosterSummary): string {
  const parts = [`${summary.total} ${summary.total === 1 ? 'raider' : 'raiders'}`];
  if (summary.trial) parts.push(`${summary.trial} on trial`);
  if (summary.bench) parts.push(`${summary.bench} on the bench`);
  if (summary.rotator) parts.push(`${summary.rotator} rotating`);
  return parts.join(', ');
}

export function classColor(className: string): string {
  return `var(--class-${className.toLowerCase().replace(/\s+/g, '-')}, var(--text))`;
}

// Officer-only numbers for each raider (Kat, 2026-09-14): this season's
// attendance and items awarded, worked out the way the profile does so the
// two always agree. Other raiders never see these, to keep loot and
// attendance comparisons out of the public roster.
export type OfficerStats = { attendancePct: number; items: number };

export function officerStats(
  players: Pick<PlayerRow, 'id' | 'join_date'>[],
  attendanceRows: (AttendanceRow & { player_id: number | null })[],
  lootRows: (LootRow & { player_id: number | null })[],
  season: SeasonWindow
): Map<number, OfficerStats> {
  const nights = new Map<number, AttendanceRow[]>();
  for (const row of attendanceRows)
    if (row.player_id !== null) nights.set(row.player_id, [...(nights.get(row.player_id) ?? []), row]);
  const loot = new Map<number, LootRow[]>();
  for (const row of lootRows)
    if (row.player_id !== null) loot.set(row.player_id, [...(loot.get(row.player_id) ?? []), row]);
  return new Map(
    players.map((p) => [
      p.id,
      {
        attendancePct: attendance(nights.get(p.id) ?? [], season, p.join_date ?? null).pct,
        items: seasonLoot(loot.get(p.id) ?? [], season).awards.length
      }
    ])
  );
}
