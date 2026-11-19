// The boss lineup on a raid night (#1216). Each boss has a usual group
// (boss_groups), every raid night starts as a copy of those groups
// (raid_night_bosses and raid_night_lineups, filled by the database a week
// ahead), and officers change a night for that night only or save the change
// to the group. Kat chose this on 2026-09-18 from Rex's review of the first
// draft, which stored only who sat out; the grid is board E of the boss lineup
// mockups.

import { LINEUP_BUFFS, brings, type Buff } from '../roster/buffs';
import { ROLE_LABELS, ROLE_ORDER, type PlayerRow, type Role } from '../roster/roster';
import { displayName, rosterOf, statusFor, type Answer, type NightRow, type RaidNight } from './calendar';

// Rows as read

export type SeasonRow = { code: string; display_name: string; starts_at: string | null; ends_at: string | null };
export type EncounterRow = {
  id: number;
  name: string;
  sort_index: number;
  // A per-boss cap override (#1244), e.g. a flex fight like Nymrissa
  // Wavecaller or Kith'ix that allows more than the raid's own cap. Null for
  // every other boss, which falls back to the raid's cap.
  cap: number | null;
  // Warcraft Logs' id for the fight, which names its boss art (#1681).
  wcl_encounter_id: number;
  zone: { id: number; name: string; season: string; is_mini_raid: boolean; sort_index: number };
};
export type NightBossRow = {
  raid_date: string;
  encounter_id: number;
  position: number;
  skipped: boolean;
  confirmed_at: string | null;
};
// One raider in one boss's group, or in one boss's lineup for the night.
export type PlaceRow = {
  encounter_id: number;
  player_id: number;
  // Which character and spec they play on the boss (#1580): null is their
  // roster character in its usual spec. `character` is the alt's row, read
  // with the lineup; null when the reader can't see it.
  character_id?: number | null;
  class_spec_id?: number | null;
  character?: PickedCharacter | null;
};

export type PickedCharacter = { id: number; name: string; class_name: string | null; spec_name: string | null };

// Who is in, boss by boss.
export type Places = ReadonlyMap<number, ReadonlySet<number>>;

export function placesOf(rows: PlaceRow[]): Map<number, Set<number>> {
  const places = new Map<number, Set<number>>();
  for (const r of rows) {
    if (!places.has(r.encounter_id)) places.set(r.encounter_id, new Set());
    places.get(r.encounter_id)!.add(r.player_id);
  }
  return places;
}

const EMPTY: ReadonlySet<number> = new Set();
export const placesFor = (places: Places, encounterId: number) => places.get(encounterId) ?? EMPTY;

export const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

// Picks (#1580): for each boss, the raiders playing another character or
// spec there. A raider with no entry plays their roster character in its
// usual spec, so a team that never picks sees no change.
export type Pick = { characterId: number | null; classSpecId: number | null };
export type BossPicks = ReadonlyMap<number, Pick>;
export type Picks = ReadonlyMap<number, BossPicks>;
// A pick as the save functions take and the tables hold it.
export type PickRow = { player_id: number; character_id: number | null; class_spec_id: number | null };

export function picksOf(rows: PlaceRow[]): Map<number, Map<number, Pick>> {
  const picks = new Map<number, Map<number, Pick>>();
  for (const r of rows) {
    if (r.character_id == null && r.class_spec_id == null) continue;
    if (!picks.has(r.encounter_id)) picks.set(r.encounter_id, new Map());
    picks
      .get(r.encounter_id)!
      .set(r.player_id, { characterId: r.character_id ?? null, classSpecId: r.class_spec_id ?? null });
  }
  return picks;
}

const NO_PICKS: BossPicks = new Map();
export const picksFor = (picks: Picks, encounterId: number) => picks.get(encounterId) ?? NO_PICKS;

export const samePick = (a: Pick | undefined, b: Pick | undefined) =>
  (a?.characterId ?? null) === (b?.characterId ?? null) && (a?.classSpecId ?? null) === (b?.classSpecId ?? null);

// Two bosses' picks, counting only raiders in `inn`: a pick left on someone
// sitting out means nothing and is never saved.
export function samePicks(a: BossPicks, b: BossPicks, inn: ReadonlySet<number>): boolean {
  return [...inn].every((id) => samePick(a.get(id), b.get(id)));
}

// What a save sends: the picks of raiders still in, in player order.
export const pickRows = (picks: BossPicks, inn: ReadonlySet<number>): PickRow[] =>
  [...picks]
    .filter(([id, p]) => inn.has(id) && (p.characterId !== null || p.classSpecId !== null))
    .sort(([a], [b]) => a - b)
    .map(([id, p]) => ({ player_id: id, character_id: p.characterId, class_spec_id: p.classSpecId }));

export type PickEdits = ReadonlyMap<number, BossPicks>;

export function currentPicks(saved: Picks, edits: PickEdits): Map<number, BossPicks> {
  const out = new Map<number, BossPicks>(saved);
  for (const [id, picks] of edits) out.set(id, picks);
  return out;
}

// One raider's pick on one boss; null goes back to their roster character in
// its usual spec. A boss whose picks match what is saved drops its edit.
export function setPick(
  saved: Picks,
  edits: PickEdits,
  encounterId: number,
  playerId: number,
  pick: Pick | null
): Map<number, BossPicks> {
  const next = new Map(edits);
  const picks = new Map(edits.get(encounterId) ?? picksFor(saved, encounterId));
  if (!pick || (pick.characterId === null && pick.classSpecId === null)) picks.delete(playerId);
  else picks.set(playerId, pick);
  const was = picksFor(saved, encounterId);
  const same = picks.size === was.size && [...picks].every(([id, p]) => samePick(p, was.get(id)));
  if (same) next.delete(encounterId);
  else next.set(encounterId, picks);
  return next;
}

// What a raider plays on a boss, from their pick: the class and spec (for
// the cell's color and icon, the role counts and the buffs), the alt's name,
// and whether it differs from their roster character in its usual spec.
export type ClassSpecRow = { id: number; class: string; spec: string; role: string | null };
export type PlayLookup = {
  specs: ReadonlyMap<number, ClassSpecRow>;
  characters: ReadonlyMap<number, PickedCharacter>;
};
export const NO_LOOKUP: PlayLookup = { specs: new Map(), characters: new Map() };
export type Play = { class: string; spec: string; role: Role; character: string | null; swapped: boolean };

const roleOf = (look: PlayLookup, cls: string, spec: string): Role | null => {
  for (const cs of look.specs.values()) {
    if (cs.class === cls && cs.spec === spec && cs.role) return cs.role as Role;
  }
  return null;
};

export function playOf(player: PlayerRow, pick: Pick | undefined, look: PlayLookup): Play {
  const main = player.classes_specs;
  const mainPlay: Play = {
    class: main?.class ?? '',
    spec: main?.spec ?? '',
    role: (main?.role ?? 'Ranged') as Role,
    character: null,
    swapped: false
  };
  if (!pick || (pick.characterId === null && pick.classSpecId === null)) return mainPlay;
  const alt = pick.characterId !== null ? look.characters.get(pick.characterId) : undefined;
  const picked = pick.classSpecId !== null ? look.specs.get(pick.classSpecId) : undefined;
  const cls = picked?.class ?? alt?.class_name ?? mainPlay.class;
  const spec = picked?.spec ?? (pick.characterId !== null ? alt?.spec_name : null) ?? mainPlay.spec;
  return {
    class: cls,
    spec,
    role: (picked?.role as Role | null) ?? roleOf(look, cls, spec) ?? mainPlay.role,
    character: pick.characterId !== null ? (alt?.name ?? 'an alt') : null,
    swapped: true
  };
}

// "on Kattotem as Restoration Shaman" or "as Destruction": a pick in words.
export const playWords = (play: Play) =>
  play.character ? `on ${play.character} as ${play.spec} ${play.class}` : `as ${play.spec}`;

// Mythic allows 20 raiders per boss; a lair or mini raid allows 25 (Kat).
export const MYTHIC_CAP = 20;
export const MINI_RAID_CAP = 25;

// A boss's name short enough for a grid column: "Nek'zali the Soulcoiler" is
// "Nek'zali" and "The Lost Explorers" is "Lost Explorers". Only a one-word
// name before " the " or a comma is cut, so "Vexie and the Geargrinders" and
// "Assault of the Zaqali" stay whole. The full name stays on the column for
// screen readers.
export function shortBossName(name: string): string {
  const trimmed = name.trim().replace(/^the\s+/i, '');
  const cut = /^([^\s,]+)(?:,|\s+the\s+)/i.exec(trimmed);
  return cut ? cut[1]! : trimmed;
}

// The season a night falls in, by its dates, as the code raid_zones.season
// holds (#933).
export function seasonOn(seasons: SeasonRow[], date: string): string | null {
  return (
    seasons.find((s) => s.starts_at !== null && s.starts_at <= date && (s.ends_at === null || date <= s.ends_at))
      ?.code ?? null
  );
}

export type LineupBoss = {
  id: number;
  name: string;
  short: string;
  skipped: boolean;
  confirmed: boolean;
  cap: number;
  // The raid's own cap: below `cap` a flex boss can take more but isn't short.
  base: number;
  art: string;
};

// A boss's picture, linked from Warcraft Logs by its fight id (Kat,
// 2026-11-18: link to their copy, the way item icons link to Wowhead's, so a
// new season's bosses need nothing from us).
export const bossArt = (wclEncounterId: number) =>
  `https://assets.rpglogs.com/img/warcraft/bosses/${wclEncounterId}-icon.jpg`;
export type LineupRaid = { zoneId: number; name: string; cap: number; bosses: LineupBoss[] };

// "20 per boss", or "20-25 per boss" when a flex fight inside the raid (a
// Nymrissa Wavecaller, a Kith'ix) allows more than the rest (#1244).
export function capLabel(bosses: LineupBoss[]): string {
  const caps = [...new Set(bosses.map((b) => b.cap))].sort((a, b) => a - b);
  return caps.length === 1 ? `${caps[0]} per boss` : `${caps[0]}-${caps.at(-1)} per boss`;
}

const byZone = (a: EncounterRow, b: EncounterRow) =>
  a.zone.sort_index - b.zone.sort_index || a.zone.id - b.zone.id || a.sort_index - b.sort_index || a.id - b.id;

// A night's pull order (#1679): its bosses' ids, first pull first.
export const nightOrder = (bosses: NightBossRow[]): number[] =>
  [...bosses].sort((a, b) => a.position - b.position || a.encounter_id - b.encounter_id).map((b) => b.encounter_id);

// The night's bosses with an officer's unsaved order, when there is one.
export const withOrder = (bosses: NightBossRow[], order: number[] | null): NightBossRow[] =>
  order ? bosses.map((b) => ({ ...b, position: order.indexOf(b.encounter_id) + 1 })) : bosses;

// One boss dropped on another (Kat's #1680 board D): after it when moving
// later, before it when moving earlier.
export function moveBoss(order: number[], id: number, onto: number): number[] {
  const from = order.indexOf(id);
  const to = order.indexOf(onto);
  if (from < 0 || to < 0 || from === to) return order;
  const rest = order.filter((x) => x !== id);
  const at = rest.indexOf(onto) + (to > from ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export const sameOrder = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// The save bar's lines for a new order: each boss whose pull number in its
// raid changed, "Sentinels to pull 2".
export function orderChanges(before: LineupRaid[], after: LineupRaid[]): string[] {
  const pullOf = (raids: LineupRaid[]) => new Map(raids.flatMap((r) => r.bosses.map((b, i) => [b.id, i + 1] as const)));
  const was = pullOf(before);
  return after.flatMap((r) =>
    r.bosses.flatMap((b, i) => (was.get(b.id) !== i + 1 ? [`${b.short} to pull ${i + 1}`] : []))
  );
}

// The night's bosses as raids, in pull order. With no plan for the night yet,
// `fresh` lists every boss of the night's season instead, for the very first
// night a team plans before any group exists.
export function lineupRaids(
  encounters: EncounterRow[],
  nightBosses: NightBossRow[],
  opts: { fresh: boolean; season: string | null }
): LineupRaid[] {
  const byId = new Map(encounters.map((e) => [e.id, e]));
  const listed: { e: EncounterRow; boss: NightBossRow | null }[] = opts.fresh
    ? encounters
        .filter((e) => e.zone.season === opts.season)
        .sort(byZone)
        .map((e) => ({ e, boss: null }))
    : [...nightBosses]
        .sort((a, b) => a.position - b.position)
        .flatMap((b) => (byId.has(b.encounter_id) ? [{ e: byId.get(b.encounter_id)!, boss: b }] : []));

  const raids: LineupRaid[] = [];
  for (const { e, boss } of listed) {
    let raid = raids.find((r) => r.zoneId === e.zone.id);
    if (!raid) {
      raid = {
        zoneId: e.zone.id,
        name: e.zone.name,
        cap: e.zone.is_mini_raid ? MINI_RAID_CAP : MYTHIC_CAP,
        bosses: []
      };
      raids.push(raid);
    }
    raid.bosses.push({
      id: e.id,
      name: e.name,
      short: shortBossName(e.name),
      skipped: boss?.skipped ?? false,
      confirmed: !!boss?.confirmed_at,
      cap: e.cap ?? raid.cap,
      base: raid.cap,
      art: bossArt(e.wcl_encounter_id)
    });
  }
  return raids;
}

// Edits: the officer's unsaved lineup for each boss they touched. A boss with
// no edit shows what is saved, so a refetch after someone else's save lands
// on every boss this officer has not touched.
export type Edits = ReadonlyMap<number, ReadonlySet<number>>;

export function current(saved: Places, edits: Edits): Map<number, ReadonlySet<number>> {
  const out = new Map<number, ReadonlySet<number>>(saved);
  for (const [id, set] of edits) out.set(id, set);
  return out;
}

export function toggle(
  saved: Places,
  edits: Edits,
  encounterId: number,
  playerId: number
): Map<number, ReadonlySet<number>> {
  const next = new Map(edits);
  const set = new Set(edits.get(encounterId) ?? placesFor(saved, encounterId));
  if (set.has(playerId)) set.delete(playerId);
  else set.add(playerId);
  if (sameSet(set, placesFor(saved, encounterId))) next.delete(encounterId);
  else next.set(encounterId, set);
  return next;
}

// A bench raider in, or out, for every boss still on the night.
export function wholeNight(
  saved: Places,
  edits: Edits,
  bosses: LineupBoss[],
  playerId: number,
  putIn: boolean
): Map<number, ReadonlySet<number>> {
  const next = new Map(edits);
  for (const boss of bosses.filter((b) => !b.skipped)) {
    const set = new Set(edits.get(boss.id) ?? placesFor(saved, boss.id));
    if (putIn) set.add(playerId);
    else set.delete(playerId);
    if (sameSet(set, placesFor(saved, boss.id))) next.delete(boss.id);
    else next.set(boss.id, set);
  }
  return next;
}

// Every boss the officer changed, and how many cells.
export function changes(saved: Places, edits: Edits): { bosses: number[]; cells: number } {
  let cells = 0;
  const bosses: number[] = [];
  for (const [id, set] of edits) {
    const was = placesFor(saved, id);
    const diff = [...set].filter((x) => !was.has(x)).length + [...was].filter((x) => !set.has(x)).length;
    if (diff) {
      bosses.push(id);
      cells += diff;
    }
  }
  return { bosses, cells };
}

// Every "first boss night" edit: everyone on the roster in except the bench,
// for each boss listed.
export function everyoneIn(players: PlayerRow[], bosses: LineupBoss[]): Map<number, ReadonlySet<number>> {
  const ids = new Set(
    rosterOf(players)
      .filter((p) => !p.is_bench)
      .map((p) => p.id)
  );
  return new Map(bosses.map((b) => [b.id, ids]));
}

// `room`: a flex boss at or past the raid's own cap with space left (#1681),
// which is not a problem to fix.
export type CapStatus = { text: string; tone: 'good' | 'warn' | 'bad' | 'room' };

export function capStatus(count: number, cap: number, base = cap): CapStatus {
  if (count === cap) return { text: 'Full', tone: 'good' };
  if (count > cap) return { text: `${count - cap} over`, tone: 'bad' };
  if (count >= base) return { text: `room for ${cap - count} more`, tone: 'room' };
  const open = base - count;
  return { text: `${open} open spot${open === 1 ? '' : 's'}`, tone: 'warn' };
}

// A Mythic boss wants two tanks and four healers by default (the A2 mockup's
// check); a team can say otherwise (#1244, team_lineup_settings).
// A boss can want its own numbers (#1682, team_boss_role_targets): a null
// tanks or healers uses the team's, a null melee or ranged means no target.
export type BossTargets = { tanks: number | null; healers: number | null; melee: number | null; ranged: number | null };
export type RoleTargets = { tanks: number; healers: number; bosses?: ReadonlyMap<number, BossTargets> };
export const DEFAULT_ROLE_TARGETS: RoleTargets = { tanks: 2, healers: 4 };
export const NO_BOSS_TARGETS: BossTargets = { tanks: null, healers: null, melee: null, ranged: null };

// What a boss wants of each role; null (or 0) is not counted.
export type Wants = Record<Role, number | null>;
export function wantsOf(targets: RoleTargets, bossId: number): Wants {
  const own = targets.bosses?.get(bossId) ?? NO_BOSS_TARGETS;
  return {
    Tank: own.tanks ?? targets.tanks,
    Heal: own.healers ?? targets.healers,
    Melee: own.melee,
    Ranged: own.ranged
  };
}

const ROLE_WORDS: Record<Role, [string, string]> = {
  Tank: ['tank', 'tanks'],
  Heal: ['healer', 'healers'],
  Melee: ['melee', 'melee'],
  Ranged: ['ranged', 'ranged']
};
const count = (n: number, role: Role) => `${n} ${ROLE_WORDS[role][n === 1 ? 0 : 1]}`;

// "Wants 3 tanks, 6 ranged": only what the boss sets for itself, unlike the
// team's targets; '' when it has nothing of its own.
export function wantsText(targets: RoleTargets, bossId: number): string {
  const team = wantsOf({ tanks: targets.tanks, healers: targets.healers }, bossId);
  const mine = wantsOf(targets, bossId);
  const parts = ROLE_ORDER.filter((r) => mine[r] !== team[r]).map((r) => count(mine[r]!, r));
  return parts.length ? `Wants ${parts.join(', ')}` : '';
}

export type LineupCell = {
  boss: LineupBoss;
  in: boolean;
  // Changed for tonight only: the boss's usual group has it the other way.
  differs: boolean;
  // In, but they said they are not coming.
  conflict: boolean;
  // What they play on this boss (#1580), and on it in the usual group.
  play: Play;
  usuallyIn: boolean;
  usualPlay: Play;
};

export type LineupRow = {
  row: NightRow;
  // A word beside the name: their answer (Absent, Late...), else Bench or Trial.
  tag: string | null;
  tagTone: 'out' | 'plain';
  cells: LineupCell[];
  count: number;
};

export type BossTotal = {
  boss: LineupBoss;
  count: number;
  status: CapStatus;
  tanks: number;
  healers: number;
  damage: number;
  roles: Record<Role, number>;
  // What the boss wants of each role (#1682).
  wants: Wants;
  // Buffs nobody in brings.
  missing: string[];
  // The one warning under the boss's count: the cap first, then buffs.
  warn: string;
  // Everything that needs a look on the boss.
  problems: string[];
  // The same, with missing buffs as a count ("3 buffs missing"), for the
  // one-line Needs a look on a night's lineup (#1681).
  brief: string[];
};

export type BuffCell = { boss: LineupBoss; providers: string[] };

export type LineupView = {
  groups: { role: Role; label: string; rows: LineupRow[] }[];
  // Bosses on the plan tonight (not skipped).
  live: LineupBoss[];
  totals: BossTotal[];
  buffs: { buff: Buff; cells: BuffCell[] }[];
  // Bench raiders out on every boss, for "Needs a look".
  benchOut: string[];
  // In on a boss tonight, but said they are not coming.
  notComing: string[];
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A raider as the grids list them.
type Raider = { player: PlayerRow; name: string; role: Role };

const providersOf = (buff: Buff, inn: Raider[]) =>
  inn
    .filter((r) => brings(buff, r.player.classes_specs?.class ?? '', r.player.classes_specs?.spec ?? ''))
    .map((r) => r.name);

// "1 tank, wants 2": a role short of, or over, the boss's target. A target
// of 0 or none means that role isn't counted.
const roleCheck = (n: number, target: number | null, role: Role) =>
  !target || n === target ? [] : [`${n === 0 ? `no ${ROLE_WORDS[role][1]}` : count(n, role)}, wants ${target}`];

// One boss's count, role mix, missing buffs and warnings, for whoever is in.
function totalOf(boss: LineupBoss, inn: Raider[], targets: RoleTargets): BossTotal {
  const wants = wantsOf(targets, boss.id);
  const n = (role: Role) => inn.filter((r) => r.role === role).length;
  const roles = { Tank: n('Tank'), Heal: n('Heal'), Melee: n('Melee'), Ranged: n('Ranged') };
  const status = capStatus(inn.length, boss.cap, boss.base);
  const fine = status.tone === 'good' || status.tone === 'room';
  const missing = LINEUP_BUFFS.filter((b) => !providersOf(b, inn).length).map((b) => b.name);
  const checks = [
    ...(fine ? [] : [status.text]),
    ...ROLE_ORDER.flatMap((role) => roleCheck(roles[role], wants[role], role))
  ];
  return {
    boss,
    count: inn.length,
    status,
    tanks: roles.Tank,
    healers: roles.Heal,
    damage: roles.Melee + roles.Ranged,
    roles,
    wants,
    missing,
    warn: !fine ? status.text : missing.length ? plural(missing.length, 'buff') : '',
    problems: [...checks, ...(missing.length ? [`no ${missing.join(', no ')}`] : [])],
    brief: [...checks, ...(missing.length ? [`${plural(missing.length, 'buff')} missing`] : [])]
  };
}

// The grid for one raid: everyone on the roster by role, with a cell per boss.
// A raider who said they are not coming stays in the grid, so a planned-in
// raider who then answered Absent shows as a conflict rather than vanishing.
export function lineupView(
  players: PlayerRow[],
  night: RaidNight,
  answers: Answer[],
  raid: LineupRaid,
  places: Places,
  groups: Places,
  targets: RoleTargets = DEFAULT_ROLE_TARGETS,
  picks: Picks = new Map(),
  look: PlayLookup = NO_LOOKUP,
  usualPicks: Picks = new Map()
): LineupView {
  const byPlayer = new Map(answers.filter((a) => a.raid_date === night.date).map((a) => [a.player_id, a]));
  const rows: NightRow[] = rosterOf(players)
    .map((player) => {
      const answer = byPlayer.get(player.id);
      return {
        player,
        name: displayName(player),
        character: player.name_realm.split('-')[0]!.trim(),
        role: player.classes_specs!.role as Role,
        status: statusFor(player, night, answer),
        note: answer?.note?.trim() ?? '',
        updatedAt: answer?.updated_at ?? null
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const live = raid.bosses.filter((b) => !b.skipped);
  const isIn = (boss: LineupBoss, id: number) => placesFor(places, boss.id).has(id);
  const saidOut = (r: NightRow) => r.status.answered && r.status.kind === 'out';

  const playFor = (boss: LineupBoss, player: PlayerRow) =>
    playOf(player, picksFor(picks, boss.id).get(player.id), look);

  const rowOf = (r: NightRow): LineupRow => {
    const cells = raid.bosses.map((boss) => {
      const inn = !boss.skipped && isIn(boss, r.player.id);
      const usuallyIn = placesFor(groups, boss.id).has(r.player.id);
      const pick = picksFor(picks, boss.id).get(r.player.id);
      const usualPick = picksFor(usualPicks, boss.id).get(r.player.id);
      return {
        boss,
        in: inn,
        // Tonight only: in or out the other way from the usual group, or in
        // on another character or spec than the group has them on.
        differs: !boss.skipped && (inn !== usuallyIn || (inn && usuallyIn && !samePick(pick, usualPick))),
        conflict: inn && saidOut(r),
        play: inn ? playFor(boss, r.player) : playOf(r.player, undefined, look),
        usuallyIn,
        usualPlay: playOf(r.player, usualPick, look)
      };
    });
    const tag = r.status.answered ? r.status.label : r.player.is_bench ? 'Bench' : r.player.is_trial ? 'Trial' : null;
    return {
      row: r,
      tag,
      tagTone: saidOut(r) ? 'out' : 'plain',
      cells,
      count: cells.filter((c) => c.in).length
    };
  };

  // Whoever is in, as what they play on the boss: the role counts and buffs
  // follow a pick (Kat, #1680).
  const inFor = (boss: LineupBoss): Raider[] =>
    rows
      .filter((r) => isIn(boss, r.player.id))
      .map((r) => {
        const play = playFor(boss, r.player);
        return {
          name: r.name,
          role: play.role,
          player: { ...r.player, classes_specs: { class: play.class, spec: play.spec, role: play.role } }
        };
      });

  return {
    groups: ROLE_ORDER.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      rows: rows.filter((r) => r.role === role).map(rowOf)
    })).filter((g) => g.rows.length),
    live,
    totals: live.map((boss) => totalOf(boss, inFor(boss), targets)),
    buffs: LINEUP_BUFFS.map((buff) => ({
      buff,
      cells: live.map((boss) => ({ boss, providers: providersOf(buff, inFor(boss)) }))
    })),
    benchOut: rows.filter((r) => r.player.is_bench && live.every((b) => !isIn(b, r.player.id))).map((r) => r.name),
    notComing: rows.filter((r) => saidOut(r) && live.some((b) => isIn(b, r.player.id))).map((r) => r.name)
  };
}

// The save bar's lines for picks (#1680): "Katorrí on Kattotem as
// Restoration Shaman for Ula'tek", "Katorrí as Destruction for Sszorak", or
// "Katorrí back to Demonology for Sszorak".
export function pickChanges(
  saved: Picks,
  now: Picks,
  places: Places,
  bosses: LineupBoss[],
  players: PlayerRow[],
  look: PlayLookup
): string[] {
  const out: { name: string; text: string }[] = [];
  for (const boss of bosses.filter((b) => !b.skipped)) {
    for (const player of players) {
      if (!placesFor(places, boss.id).has(player.id)) continue;
      const was = picksFor(saved, boss.id).get(player.id);
      const is = picksFor(now, boss.id).get(player.id);
      if (samePick(was, is)) continue;
      const play = playOf(player, is, look);
      const name = displayName(player);
      out.push({
        name,
        text: play.swapped
          ? `${name} ${playWords(play)} for ${boss.short}`
          : `${name} back to ${play.spec} for ${boss.short}`
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.text);
}

// What the save bar lists (#1681): "Ironjaw out on Twin Fangs", or "Ironjaw
// out all night" when a raider changed on more than one boss and is now out
// (or in) on every boss of the raid still on the night. On a night with two
// raids, `all` names the raid instead ("for all of Tidebound Grotto").
export function changeList(
  saved: Places,
  edits: Edits,
  bosses: LineupBoss[],
  nameOf: (id: number) => string,
  all = 'all night'
): string[] {
  const live = bosses.filter((b) => !b.skipped);
  const now = current(saved, edits);
  const byPlayer = new Map<number, LineupBoss[]>();
  for (const boss of live) {
    const was = placesFor(saved, boss.id);
    const is = placesFor(now, boss.id);
    for (const id of new Set([...was, ...is])) {
      if (was.has(id) === is.has(id)) continue;
      byPlayer.set(id, [...(byPlayer.get(id) ?? []), boss]);
    }
  }
  return [...byPlayer]
    .map(([id, changed]) => ({ id, name: nameOf(id), changed }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(({ id, name, changed }) => {
      const inOn = (b: LineupBoss) => placesFor(now, b.id).has(id);
      if (changed.length > 1 && live.every((b) => !inOn(b))) return [`${name} out ${all}`];
      if (changed.length > 1 && live.every(inOn)) return [`${name} in ${all}`];
      return changed.map((b) => `${name} ${inOn(b) ? 'in' : 'out'} on ${b.short}`);
    });
}

// The message a refused save gives when someone else saved first.
export const isStaleSave = (message: string) => /Someone else changed/i.test(message);

// Only raiders still on the roster: a group or a night can still hold someone
// archived since (a main swap, someone leaving), and the database refuses a
// save that names them.
export function onRoster(places: Places, players: PlayerRow[]): Map<number, ReadonlySet<number>> {
  const ids = new Set(rosterOf(players).map((p) => p.id));
  return new Map([...places].map(([boss, set]) => [boss, new Set([...set].filter((id) => ids.has(id)))]));
}

// The Boss groups page (#1216, board I of the mockups): the usual group for
// each boss of one raid, with the same checks as a night's lineup.

export type GroupCell = { boss: LineupBoss; in: boolean; changed: boolean };

export type GroupRow = {
  raider: Raider;
  tag: string | null;
  tagTone: 'warn' | 'plain';
  cells: GroupCell[];
  count: number;
};

// A raider who left the roster but is still in some of this raid's groups.
export type Leaver = { name: string; bosses: number };

export type GroupsView = {
  groups: { role: Role; label: string; rows: GroupRow[] }[];
  totals: BossTotal[];
  // Raiders off the bench who are in none of this raid's groups.
  unplaced: string[];
  bench: string[];
  leavers: Leaver[];
};

export type LeaverRow = PlaceRow & { player: { name_realm: string; nickname: string | null } | null };

export function groupsView(
  players: PlayerRow[],
  raid: LineupRaid,
  places: Places,
  saved: Places,
  savedRows: LeaverRow[],
  targets: RoleTargets = DEFAULT_ROLE_TARGETS
): GroupsView {
  const roster = rosterOf(players);
  const rows: Raider[] = roster
    .map((player) => ({ player, name: displayName(player), role: player.classes_specs!.role as Role }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const isIn = (boss: LineupBoss, id: number) => placesFor(places, boss.id).has(id);

  const rowOf = (r: Raider): GroupRow => {
    const cells = raid.bosses.map((boss) => {
      const inn = isIn(boss, r.player.id);
      return { boss, in: inn, changed: inn !== placesFor(saved, boss.id).has(r.player.id) };
    });
    const count = cells.filter((c) => c.in).length;
    const unplaced = count === 0 && !r.player.is_bench;
    const tag = r.player.is_bench ? 'Bench' : unplaced ? 'In no group' : r.player.is_trial ? 'Trial' : null;
    return { raider: r, tag, tagTone: unplaced ? 'warn' : 'plain', cells, count };
  };

  const rosterIds = new Set(roster.map((p) => p.id));
  const bossIds = new Set(raid.bosses.map((b) => b.id));
  const leavers = new Map<number, Leaver>();
  for (const row of savedRows) {
    if (rosterIds.has(row.player_id) || !bossIds.has(row.encounter_id)) continue;
    const name = row.player ? displayName(row.player) : 'A raider';
    const leaver = leavers.get(row.player_id) ?? { name, bosses: 0 };
    leaver.bosses += 1;
    leavers.set(row.player_id, leaver);
  }

  const grouped = ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABELS[role],
    rows: rows.filter((r) => r.role === role).map(rowOf)
  })).filter((g) => g.rows.length);
  const all = grouped.flatMap((g) => g.rows);

  return {
    groups: grouped,
    totals: raid.bosses.map((boss) =>
      totalOf(
        boss,
        rows.filter((r) => isIn(boss, r.player.id)),
        targets
      )
    ),
    unplaced: all.filter((r) => r.tagTone === 'warn').map((r) => r.raider.name),
    bench: all.filter((r) => r.raider.player.is_bench).map((r) => r.raider.name),
    leavers: [...leavers.values()].sort((a, b) => a.name.localeCompare(b.name))
  };
}

// What saving the groups changes on coming nights already filled. A group save
// rewrites a boss on every coming night unless an officer saved that boss for
// the night or skipped it there (set_boss_group()).
export type ComingBossRow = { raid_date: string; encounter_id: number; skipped: boolean; confirmed_at: string | null };
export type ComingNight = { date: string; text: string };

// "Ana", "Ana and Bo", "Ana, Bo and Cy".
export const joinNames = (names: string[]) =>
  names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export function comingNights(rows: ComingBossRow[], bosses: LineupBoss[], changed: number[]): ComingNight[] {
  const byId = new Map(bosses.map((b) => [b.id, b]));
  const dates = [...new Set(rows.filter((r) => byId.has(r.encounter_id)).map((r) => r.raid_date))].sort();
  return dates.map((date) => {
    const night = rows.filter((r) => r.raid_date === date && byId.has(r.encounter_id));
    const short = (list: ComingBossRow[]) => list.map((r) => byId.get(r.encounter_id)!.short);
    const savedThere = night.filter((r) => r.confirmed_at && !r.skipped);
    const skipped = night.filter((r) => r.skipped);
    if (!changed.length) {
      const parts = [
        ...(savedThere.length ? [`${joinNames(short(savedThere))} saved for that night`] : []),
        ...(skipped.length ? [`${joinNames(short(skipped))} skipped`] : [])
      ];
      return {
        date,
        text: parts.length
          ? `${parts.join('; ')}. The rest follows the groups.`
          : 'Filled from the groups; nobody has changed it yet.'
      };
    }
    const touched = night.filter((r) => changed.includes(r.encounter_id));
    const follows = touched.filter((r) => !r.confirmed_at && !r.skipped);
    const keeps = touched.filter((r) => r.confirmed_at && !r.skipped);
    const skips = touched.filter((r) => r.skipped);
    const parts = [
      ...(follows.length ? [`Will follow for ${joinNames(short(follows))}.`] : []),
      ...(keeps.length
        ? [`${joinNames(short(keeps))} ${keeps.length === 1 ? 'stays' : 'stay'} as saved for that night.`]
        : []),
      ...(skips.length ? [`${joinNames(short(skips))} ${skips.length === 1 ? 'is' : 'are'} skipped that night.`] : [])
    ];
    return { date, text: parts.length ? parts.join(' ') : 'Your changes don’t reach this night.' };
  });
}

// A raider's own bosses for a night (#1216, boards C and D): what the "Your
// bosses tonight" card says. Kat, 2026-09-18: sitting out a boss is not
// missing the night, a night filled from the groups but not saved by an
// officer still shows (marked not final), and raiders see only their own.
export type YourBossTile = { n: number; name: string; in: boolean; play: string | null };
export type YourBosses = {
  tiles: YourBossTile[];
  summary: string;
  // Null once an officer has saved every boss on the night.
  notFinal: string | null;
};

export function yourBosses(
  raids: LineupRaid[],
  places: Places,
  me: PlayerRow,
  picks: Picks = new Map(),
  look: PlayLookup = NO_LOOKUP
): YourBosses | null {
  const live = raids.flatMap((r) => r.bosses).filter((b) => !b.skipped);
  if (!live.length) return null;
  // What to bring where it isn't their main in its usual spec (#1580):
  // "Your Restoration Shaman (Kattotem)" or "Destruction".
  const tiles = live.map((b, i) => {
    const inn = placesFor(places, b.id).has(me.id);
    const play = inn ? playOf(me, picksFor(picks, b.id).get(me.id), look) : null;
    return {
      n: i + 1,
      name: b.name,
      in: inn,
      play: play?.swapped ? (play.character ? `Your ${play.spec} ${play.class} (${play.character})` : play.spec) : null
    };
  });
  const count = tiles.filter((t) => t.in).length;
  const out = live.filter((b) => !placesFor(places, b.id).has(me.id)).map((b) => b.short);
  const summary =
    count === live.length
      ? live.length === 1
        ? 'In for tonight’s boss.'
        : `In for all ${live.length} bosses.`
      : count === 0
        ? me.is_bench
          ? 'You’re on the bench, so you’re out for every boss unless your officers put you in.'
          : 'You sit out every boss tonight.'
        : `In for ${count} of ${live.length} bosses. You sit out ${joinNames(out)}.`;
  const unsaved = live.filter((b) => !b.confirmed);
  const done = live.filter((b) => b.confirmed);
  // Whichever list is shorter is the one named.
  const notFinal = !unsaved.length
    ? null
    : !done.length
      ? 'From the usual groups; your officers haven’t finalized it yet.'
      : unsaved.length <= done.length
        ? `${joinNames(unsaved.map((b) => b.short))} ${unsaved.length === 1 ? 'is' : 'are'} from the usual groups and not final yet.`
        : `${joinNames(done.map((b) => b.short))} ${done.length === 1 ? 'is' : 'are'} final; the rest are from the usual groups and not final yet.`;
  return { tiles, summary, notFinal };
}
