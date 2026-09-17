// The boss lineup on a raid night (#1216): officers pick, boss by boss, which
// raiders sit out. Chosen by Kat and Phoenix's officers on 2026-09-17 (the
// grid, board A of the boss lineup mockups). Only the sit-outs are stored
// (boss_lineup_sitouts), so everyone coming that night is in until an officer
// takes them out.

import type { SettingsRaid } from '../home/progression';
import { ROLE_LABELS, ROLE_ORDER, type PlayerRow, type Role } from '../roster/roster';
import { isoDate } from './nights';
import { displayName, nightView, type Answer, type NightRow, type RaidNight } from './calendar';

export type SitoutRow = { raid_date: string; raid_name: string; boss_name: string; player_id: number };

export type LineupBoss = { name: string; short: string };
export type LineupRaid = { name: string; cap: number; bosses: LineupBoss[] };

// Mythic allows 20 raiders per boss; a lair or mini raid allows 25 (Kat).
export const MYTHIC_CAP = 20;
export const MINI_RAID_CAP = 25;

// A boss's name short enough for a grid column: "Nek'zali the Soulcoiler" is
// "Nek'zali", "The Lost Explorers" is "Lost Explorers". The full name stays on
// the column for screen readers and on hover.
export function shortBossName(name: string): string {
  const trimmed = name.trim().replace(/^the\s+/i, '');
  const cut = trimmed.split(/,|\s+the\s+/i)[0]!.trim();
  return cut || name.trim();
}

// The season's raids as Season Settings lists them, in kill order, leaving
// out a raid with no bosses listed.
export function lineupRaids(raids: SettingsRaid[]): LineupRaid[] {
  return raids
    .map((raid) => ({
      name: (raid.name ?? '').trim(),
      cap: raid.isMiniRaid ? MINI_RAID_CAP : MYTHIC_CAP,
      bosses: (raid.bosses ?? [])
        .map((b) => (b.name ?? '').trim())
        .filter(Boolean)
        .map((name) => ({ name, short: shortBossName(name) }))
    }))
    .filter((raid) => raid.name && raid.bosses.length);
}

// One raid's sit-outs as a set of "boss|player" keys.
export type Sitouts = ReadonlySet<string>;
export const sitoutKey = (boss: string, playerId: number) => `${boss}|${playerId}`;

export function sitoutsFor(rows: SitoutRow[], date: string, raid: string): Set<string> {
  return new Set(
    rows.filter((r) => r.raid_date === date && r.raid_name === raid).map((r) => sitoutKey(r.boss_name, r.player_id))
  );
}

export function toggleSitout(sitouts: Sitouts, boss: string, playerId: number): Set<string> {
  const next = new Set(sitouts);
  const key = sitoutKey(boss, playerId);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export const sameSitouts = (a: Sitouts, b: Sitouts) => a.size === b.size && [...a].every((k) => b.has(k));

// What a save sends: the sit-outs of raiders in the grid, for bosses in the
// raid. A raider who has since said they are out, or a boss renamed in Season
// Settings, drops out of the saved lineup.
export function sitoutsToSave(sitouts: Sitouts, raid: LineupRaid, playerIds: number[]) {
  const ids = new Set(playerIds);
  return raid.bosses.flatMap((boss) =>
    [...ids].filter((id) => sitouts.has(sitoutKey(boss.name, id))).map((id) => ({ boss: boss.name, player_id: id }))
  );
}

export type CapStatus = { text: string; tone: 'good' | 'warn' | 'bad' };

export function capStatus(count: number, cap: number): CapStatus {
  if (count === cap) return { text: 'Full', tone: 'good' };
  if (count > cap) return { text: `${count - cap} over`, tone: 'bad' };
  const open = cap - count;
  return { text: `${open} open spot${open === 1 ? '' : 's'}`, tone: 'warn' };
}

// Raid buffs, boss debuffs and the two must-haves, as the current site lists
// them (js/common.js RAID_BUFFS, BOSS_DEBUFFS and RAID_UTILITY).
export type Buff = { name: string; kind: BuffKind; classes: string[] };
export type BuffKind = 'Raid buffs' | 'Boss debuffs' | 'Must-haves';
export const BUFF_KINDS: BuffKind[] = ['Raid buffs', 'Boss debuffs', 'Must-haves'];

export const BUFFS: Buff[] = [
  { name: 'Mark of the Wild', kind: 'Raid buffs', classes: ['Druid'] },
  { name: 'Arcane Intellect', kind: 'Raid buffs', classes: ['Mage'] },
  { name: 'Battle Shout', kind: 'Raid buffs', classes: ['Warrior'] },
  { name: 'Power Word: Fortitude', kind: 'Raid buffs', classes: ['Priest'] },
  { name: 'Blessing of the Bronze', kind: 'Raid buffs', classes: ['Evoker'] },
  { name: 'Skyfury', kind: 'Raid buffs', classes: ['Shaman'] },
  { name: 'Devotion Aura', kind: 'Raid buffs', classes: ['Paladin'] },
  { name: "Hunter's Mark", kind: 'Boss debuffs', classes: ['Hunter'] },
  { name: 'Mystic Touch', kind: 'Boss debuffs', classes: ['Monk'] },
  { name: 'Chaos Brand', kind: 'Boss debuffs', classes: ['Demon Hunter'] },
  { name: 'Atrophic Poison', kind: 'Boss debuffs', classes: ['Rogue'] },
  { name: 'Heroism / Bloodlust', kind: 'Must-haves', classes: ['Shaman', 'Mage', 'Hunter', 'Evoker'] },
  { name: 'Combat Res', kind: 'Must-haves', classes: ['Druid', 'Warlock', 'Paladin', 'Death Knight'] }
];

export type LineupRow = {
  row: NightRow;
  // A word beside the name when the raider is not simply Present: Trial, Late.
  tag: string | null;
  cells: { boss: LineupBoss; in: boolean }[];
  count: number;
};

export type BossTotal = {
  boss: LineupBoss;
  count: number;
  status: CapStatus;
  tanks: number;
  healers: number;
  dps: number;
  missingBuffs: number;
};

export type BuffCell = { boss: LineupBoss; providers: string[] };

export type LineupView = {
  groups: { role: Role; label: string; rows: LineupRow[] }[];
  totals: BossTotal[];
  buffs: { kind: BuffKind; rows: { buff: Buff; cells: BuffCell[] }[] }[];
  // Raiders not coming tonight, who are left out of the grid.
  notComing: NightRow[];
};

// The grid for one raid: every raider coming tonight (the night page's own
// rule), by role, with a cell per boss.
export function lineupView(
  players: PlayerRow[],
  night: RaidNight,
  answers: Answer[],
  raid: LineupRaid,
  sitouts: Sitouts
): LineupView {
  const view = nightView(players, night, answers);
  const everyone = view.groups.flatMap((g) => [...g.rows, ...g.apart]);
  const headsUp = [...view.headsUp.out, ...view.headsUp.flagged];
  const all = [...everyone, ...headsUp];
  const coming = (r: NightRow) => r.status.kind === 'in' || (r.status.kind === 'flag' && r.status.answered);
  const inGrid = all.filter(coming).sort((a, b) => a.name.localeCompare(b.name));
  const isIn = (boss: LineupBoss, r: NightRow) => !sitouts.has(sitoutKey(boss.name, r.player.id));

  const rowOf = (r: NightRow): LineupRow => {
    const cells = raid.bosses.map((boss) => ({ boss, in: isIn(boss, r) }));
    const tag = r.status.answered ? r.status.label : r.player.is_trial ? 'Trial' : null;
    return { row: r, tag, cells, count: cells.filter((c) => c.in).length };
  };

  const bossIn = (boss: LineupBoss) => inGrid.filter((r) => isIn(boss, r));
  const providers = (buff: Buff, boss: LineupBoss) =>
    bossIn(boss)
      .filter((r) => buff.classes.includes(r.player.classes_specs?.class ?? ''))
      .map((r) => displayName(r.player));

  return {
    groups: ROLE_ORDER.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      rows: inGrid.filter((r) => r.role === role).map(rowOf)
    })).filter((g) => g.rows.length),
    totals: raid.bosses.map((boss) => {
      const inn = bossIn(boss);
      const n = (role: Role) => inn.filter((r) => r.role === role).length;
      return {
        boss,
        count: inn.length,
        status: capStatus(inn.length, raid.cap),
        tanks: n('Tank'),
        healers: n('Heal'),
        dps: n('Melee') + n('Ranged'),
        missingBuffs: BUFFS.filter((b) => !providers(b, boss).length).length
      };
    }),
    buffs: BUFF_KINDS.map((kind) => ({
      kind,
      rows: BUFFS.filter((b) => b.kind === kind).map((buff) => ({
        buff,
        cells: raid.bosses.map((boss) => ({ boss, providers: providers(buff, boss) }))
      }))
    })),
    notComing: all.filter((r) => !coming(r)).sort((a, b) => a.name.localeCompare(b.name))
  };
}

// The night a week earlier on the same weekday, if the team raided then.
export function lastWeeksNight(nights: Pick<RaidNight, 'date'>[], date: string): string | null {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 7);
  const earlier = isoDate(d);
  return nights.some((n) => n.date === earlier) ? earlier : null;
}
