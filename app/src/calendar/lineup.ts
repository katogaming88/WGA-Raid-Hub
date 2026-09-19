// The boss lineup on a raid night (#1216). Each boss has a usual group
// (boss_groups), every raid night starts as a copy of those groups
// (raid_night_bosses and raid_night_lineups, filled by the database a week
// ahead), and officers change a night for that night only or save the change
// to the group. Kat chose this on 2026-09-18 from Rex's review of the first
// draft, which stored only who sat out; the grid is board E of the boss lineup
// mockups.

import { ROLE_LABELS, ROLE_ORDER, type PlayerRow, type Role } from '../roster/roster';
import { displayName, rosterOf, statusFor, type Answer, type NightRow, type RaidNight } from './calendar';

// Rows as read

export type SeasonRow = { display_name: string; starts_at: string; ends_at: string | null };
export type EncounterRow = {
  id: number;
  name: string;
  sort_index: number;
  // A per-boss cap override (#1244), e.g. a flex fight like Nymrissa
  // Wavecaller or Kith'ix that allows more than the raid's own cap. Null for
  // every other boss, which falls back to the raid's cap.
  cap: number | null;
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
export type PlaceRow = { encounter_id: number; player_id: number };

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

// The season a night falls in, by its dates.
export function seasonOn(seasons: SeasonRow[], date: string): string | null {
  return seasons.find((s) => s.starts_at <= date && (s.ends_at === null || date <= s.ends_at))?.display_name ?? null;
}

export type LineupBoss = { id: number; name: string; short: string; skipped: boolean; confirmed: boolean; cap: number };
export type LineupRaid = { zoneId: number; name: string; cap: number; bosses: LineupBoss[] };

// "20 per boss", or "20-25 per boss" when a flex fight inside the raid (a
// Nymrissa Wavecaller, a Kith'ix) allows more than the rest (#1244).
export function capLabel(bosses: LineupBoss[]): string {
  const caps = [...new Set(bosses.map((b) => b.cap))].sort((a, b) => a - b);
  return caps.length === 1 ? `${caps[0]} per boss` : `${caps[0]}-${caps.at(-1)} per boss`;
}

const byZone = (a: EncounterRow, b: EncounterRow) =>
  a.zone.sort_index - b.zone.sort_index || a.zone.id - b.zone.id || a.sort_index - b.sort_index || a.id - b.id;

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
      cap: e.cap ?? raid.cap
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

export type CapStatus = { text: string; tone: 'good' | 'warn' | 'bad' };

export function capStatus(count: number, cap: number): CapStatus {
  if (count === cap) return { text: 'Full', tone: 'good' };
  if (count > cap) return { text: `${count - cap} over`, tone: 'bad' };
  const open = cap - count;
  return { text: `${open} open spot${open === 1 ? '' : 's'}`, tone: 'warn' };
}

// Raid buffs, boss debuffs and the two must-haves, as the current site lists
// them (js/common.js RAID_BUFFS, BOSS_DEBUFFS and RAID_UTILITY; #1244 is
// about keeping one list).
export type Buff = { name: string; classes: string[] };

export const BUFFS: Buff[] = [
  { name: 'Mark of the Wild', classes: ['Druid'] },
  { name: 'Arcane Intellect', classes: ['Mage'] },
  { name: 'Battle Shout', classes: ['Warrior'] },
  { name: 'Power Word: Fortitude', classes: ['Priest'] },
  { name: 'Blessing of the Bronze', classes: ['Evoker'] },
  { name: 'Skyfury', classes: ['Shaman'] },
  { name: 'Devotion Aura', classes: ['Paladin'] },
  { name: "Hunter's Mark", classes: ['Hunter'] },
  { name: 'Mystic Touch', classes: ['Monk'] },
  { name: 'Chaos Brand', classes: ['Demon Hunter'] },
  { name: 'Atrophic Poison', classes: ['Rogue'] },
  { name: 'Heroism / Bloodlust', classes: ['Shaman', 'Mage', 'Hunter', 'Evoker'] },
  { name: 'Combat Res', classes: ['Druid', 'Warlock', 'Paladin', 'Death Knight'] }
];

// A Mythic boss wants two tanks and four healers by default (the A2 mockup's
// check); a team can say otherwise (#1244, team_lineup_settings).
export type RoleTargets = { tanks: number; healers: number };
export const DEFAULT_ROLE_TARGETS: RoleTargets = { tanks: 2, healers: 4 };

export type LineupCell = {
  boss: LineupBoss;
  in: boolean;
  // Changed for tonight only: the boss's usual group has it the other way.
  differs: boolean;
  // In, but they said they are not coming.
  conflict: boolean;
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
  // Buffs nobody in brings.
  missing: string[];
  // The one warning under the boss's count: the cap first, then buffs.
  warn: string;
  // Everything "Needs a look" lists for the boss.
  problems: string[];
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
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

// A raider as the grids list them.
type Raider = { player: PlayerRow; name: string; role: Role };

const providersOf = (buff: Buff, inn: Raider[]) =>
  inn.filter((r) => buff.classes.includes(r.player.classes_specs?.class ?? '')).map((r) => r.name);

// One boss's count, role mix, missing buffs and warnings, for whoever is in.
// `out` names raiders in who said they are not coming (a night only).
function totalOf(boss: LineupBoss, inn: Raider[], targets: RoleTargets, out: string[] = []): BossTotal {
  const n = (role: Role) => inn.filter((r) => r.role === role).length;
  const tanks = n('Tank');
  const healers = n('Heal');
  const status = capStatus(inn.length, boss.cap);
  const full = inn.length === boss.cap;
  const missing = BUFFS.filter((b) => !providersOf(b, inn).length).map((b) => b.name);
  const problems = [
    ...(full ? [] : [status.text]),
    ...(targets.tanks === 0 ? [] : tanks === 0 ? ['no tanks'] : tanks < targets.tanks ? [plural(tanks, 'tank')] : []),
    ...(healers < targets.healers ? [plural(healers, 'healer')] : []),
    ...(missing.length ? [`no ${missing.join(', no ')}`] : []),
    ...(out.length ? [`${out.join(', ')} said they’re not coming`] : [])
  ];
  return {
    boss,
    count: inn.length,
    status,
    tanks,
    healers,
    damage: n('Melee') + n('Ranged'),
    missing,
    warn: !full ? status.text : missing.length ? plural(missing.length, 'buff') : '',
    problems
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
  targets: RoleTargets = DEFAULT_ROLE_TARGETS
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

  const rowOf = (r: NightRow): LineupRow => {
    const cells = raid.bosses.map((boss) => {
      const inn = !boss.skipped && isIn(boss, r.player.id);
      return {
        boss,
        in: inn,
        differs: !boss.skipped && inn !== placesFor(groups, boss.id).has(r.player.id),
        conflict: inn && saidOut(r)
      };
    });
    const tag = r.status.answered
      ? r.status.label
      : r.player.is_bench
        ? 'Bench'
        : r.player.is_rotator
          ? 'Rotator'
          : r.player.is_trial
            ? 'Trial'
            : null;
    return {
      row: r,
      tag,
      tagTone: saidOut(r) ? 'out' : 'plain',
      cells,
      count: cells.filter((c) => c.in).length
    };
  };

  const inFor = (boss: LineupBoss) => rows.filter((r) => isIn(boss, r.player.id));

  return {
    groups: ROLE_ORDER.map((role) => ({
      role,
      label: ROLE_LABELS[role],
      rows: rows.filter((r) => r.role === role).map(rowOf)
    })).filter((g) => g.rows.length),
    live,
    totals: live.map((boss) => {
      const inn = inFor(boss);
      return totalOf(
        boss,
        inn,
        targets,
        inn.filter(saidOut).map((r) => r.name)
      );
    }),
    buffs: BUFFS.map((buff) => ({
      buff,
      cells: live.map((boss) => ({ boss, providers: providersOf(buff, inFor(boss)) }))
    })),
    benchOut: rows.filter((r) => r.player.is_bench && live.every((b) => !isIn(b, r.player.id))).map((r) => r.name)
  };
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
    const tag = r.player.is_bench
      ? 'Bench'
      : unplaced
        ? 'In no group'
        : r.player.is_rotator
          ? 'Rotator'
          : r.player.is_trial
            ? 'Trial'
            : null;
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
export type YourBossTile = { n: number; name: string; in: boolean };
export type YourBosses = {
  tiles: YourBossTile[];
  summary: string;
  // Null once an officer has saved every boss on the night.
  notFinal: string | null;
};

export function yourBosses(raids: LineupRaid[], places: Places, me: PlayerRow): YourBosses | null {
  const live = raids.flatMap((r) => r.bosses).filter((b) => !b.skipped);
  if (!live.length) return null;
  const tiles = live.map((b, i) => ({ n: i + 1, name: b.name, in: placesFor(places, b.id).has(me.id) }));
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
