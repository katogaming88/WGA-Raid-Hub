// The Boss lineups report (#1247): a season of each night's plan
// (raid_night_bosses, raid_night_lineups) read against who the logs say was
// actually in each fight (raid_night_participation, #1242) and the team's
// kills (team_raid_kills). Kept apart from the page so every number is tested
// from fixture rows.
//
// A boss on a night is a "slot". A skipped boss is not one. Once a night's log
// is in (it has any participation row), a boss nobody was recorded for was not
// pulled, so it is not a slot either. A night with no log yet counts from its
// plan alone: who was in is who was planned, and nobody missed anything.

import type { RoleGroup } from '../roster/roster';

export type NightBossRow = { raid_date: string; encounter_id: number; position: number; skipped: boolean };
export type SeatRow = { raid_date: string; encounter_id: number; player_id: number };
export type KillRow = { raid_date: string; encounter_id: number };
export type BossInfo = { id: number; name: string; short: string };

export type LineupData = {
  nightBosses: NightBossRow[];
  planned: SeatRow[];
  played: SeatRow[];
  kills: KillRow[];
};

type Slot = {
  date: string;
  bossId: number;
  position: number;
  planned: ReadonlySet<number>;
  // Null on a night whose log is not in yet.
  played: ReadonlySet<number> | null;
  killed: boolean;
};

const seatKey = (date: string, bossId: number) => `${date}|${bossId}`;

function seatsBy(rows: SeatRow[]): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const r of rows) {
    const k = seatKey(r.raid_date, r.encounter_id);
    if (!map.has(k)) map.set(k, new Set());
    map.get(k)!.add(r.player_id);
  }
  return map;
}

const NONE: ReadonlySet<number> = new Set();

// Every boss on every night up to today, in pull order, with what was planned
// and played. `slots` drops the skipped and the not-pulled.
function nightsOf(data: LineupData, today: string) {
  const planned = seatsBy(data.planned);
  const played = seatsBy(data.played);
  const logged = new Set(data.played.map((r) => r.raid_date));
  const kills = new Set(data.kills.map((k) => seatKey(k.raid_date, k.encounter_id)));
  const rows = data.nightBosses
    .filter((b) => b.raid_date <= today)
    .sort((a, b) => (a.raid_date < b.raid_date ? -1 : a.raid_date > b.raid_date ? 1 : a.position - b.position));
  return rows.map((b) => {
    const k = seatKey(b.raid_date, b.encounter_id);
    const slot: Slot = {
      date: b.raid_date,
      bossId: b.encounter_id,
      position: b.position,
      planned: planned.get(k) ?? NONE,
      played: logged.has(b.raid_date) ? (played.get(k) ?? NONE) : null,
      killed: kills.has(k)
    };
    const pulled = !b.skipped && (slot.played === null || slot.played.size > 0);
    return { slot, skipped: b.skipped, pulled };
  });
}

export function slotsOf(data: LineupData, today: string): Slot[] {
  return nightsOf(data, today)
    .filter((n) => n.pulled)
    .map((n) => n.slot);
}

// Who was in for a slot: the log when it is in, the plan until then.
const inFor = (s: Slot) => s.played ?? s.planned;

// Per raider

export type RaiderLineup = {
  playerId: number;
  name: string;
  className: string;
  role: string;
  // Slots the team had, and how many of them they were planned for.
  slots: number;
  assigned: number;
  satOut: number;
  // The longest run of the team's slots in a row they were planned out of.
  longestSitOut: number;
  // From nights whose log is in.
  played: number;
  missed: number;
  swappedIn: number;
  // Bosses the team pulled this season that they were never in for.
  neverIn: number[];
  // Bosses killed with them in the fight.
  kills: number[];
  // Their bonus roll boss, and how many of its slots they were in for.
  bonusRoll: { bossId: number; inFor: number; slots: number } | null;
};

export function raiderLineups(
  slots: Slot[],
  groups: RoleGroup[],
  bonusRolls: ReadonlyMap<number, number | null> = new Map()
): RaiderLineup[] {
  const bosses = [...new Set(slots.map((s) => s.bossId))];
  return groups.flatMap((g) =>
    g.raiders
      .filter((r) => r.playerId !== null)
      .map((r) => {
        const id = r.playerId!;
        let assigned = 0;
        let played = 0;
        let missed = 0;
        let swappedIn = 0;
        let run = 0;
        let longestSitOut = 0;
        const inBosses = new Set<number>();
        const kills = new Set<number>();
        for (const s of slots) {
          const planned = s.planned.has(id);
          if (planned) {
            assigned++;
            run = 0;
          } else {
            run++;
            longestSitOut = Math.max(longestSitOut, run);
          }
          if (inFor(s).has(id)) inBosses.add(s.bossId);
          if (s.played === null) continue;
          const was = s.played.has(id);
          if (was) played++;
          if (planned && !was) missed++;
          if (!planned && was) swappedIn++;
          if (was && s.killed) kills.add(s.bossId);
        }
        const bonusId = bonusRolls.get(id) ?? null;
        const bonusSlots = bonusId === null ? [] : slots.filter((s) => s.bossId === bonusId);
        return {
          playerId: id,
          name: r.name,
          className: r.className,
          role: g.role,
          slots: slots.length,
          assigned,
          satOut: slots.length - assigned,
          longestSitOut,
          played,
          missed,
          swappedIn,
          neverIn: bosses.filter((b) => !inBosses.has(b)),
          kills: [...kills],
          bonusRoll:
            bonusId === null
              ? null
              : { bossId: bonusId, inFor: bonusSlots.filter((s) => inFor(s).has(id)).length, slots: bonusSlots.length }
        };
      })
  );
}

// The sit-out spread for each role: the fewest, the most and the average.
export type RoleLoad = { role: string; label: string; fewest: number; most: number; average: number };

export function roleLoad(raiders: RaiderLineup[], groups: RoleGroup[]): RoleLoad[] {
  return groups.flatMap((g) => {
    const counts = raiders.filter((r) => r.role === g.role).map((r) => r.satOut);
    if (counts.length === 0) return [];
    return [
      {
        role: g.role,
        label: g.label,
        fewest: Math.min(...counts),
        most: Math.max(...counts),
        average: counts.reduce((a, b) => a + b, 0) / counts.length
      }
    ];
  });
}

// Per boss

export type BossLineup = {
  bossId: number;
  slots: number;
  // Raiders in for every one of its slots, and the rest who took a turn.
  always: number[];
  rotating: number[];
  // How many seats a night went to someone outside `always`, on average.
  rotatingSeats: number;
  // Raiders per role on an average pull.
  roles: Record<string, number>;
  // Times each raider has been in for it.
  seen: ReadonlyMap<number, number>;
  // The first kill this season: its night and who was in.
  firstKill: { date: string; lineup: number[] } | null;
};

export function bossLineups(slots: Slot[], bossOrder: number[], roleOf: ReadonlyMap<number, string>): BossLineup[] {
  const order = [...new Set([...bossOrder, ...slots.map((s) => s.bossId)])];
  return order.flatMap((bossId) => {
    const mine = slots.filter((s) => s.bossId === bossId);
    if (mine.length === 0) return [];
    const seen = new Map<number, number>();
    const roles: Record<string, number> = {};
    let seats = 0;
    for (const s of mine) {
      const ins = inFor(s);
      seats += ins.size;
      for (const id of ins) {
        seen.set(id, (seen.get(id) ?? 0) + 1);
        const role = roleOf.get(id);
        if (role) roles[role] = (roles[role] ?? 0) + 1;
      }
    }
    for (const role of Object.keys(roles)) roles[role] = roles[role]! / mine.length;
    const always = [...seen].filter(([, n]) => n === mine.length).map(([id]) => id);
    const rotating = [...seen].filter(([, n]) => n < mine.length).map(([id]) => id);
    const kill = mine.find((s) => s.killed && s.played !== null);
    return [
      {
        bossId,
        slots: mine.length,
        always,
        rotating,
        rotatingSeats: seats / mine.length - always.length,
        roles,
        seen,
        firstKill: kill ? { date: kill.date, lineup: [...kill.played!] } : null
      }
    ];
  });
}

// Per night

export type BossOnNight = {
  bossId: number;
  state: 'skipped' | 'not pulled' | 'planned' | 'pulled';
  planned: number;
  played: number | null;
  killed: boolean;
  swappedIn: number[];
  missed: number[];
};
// Late: in for a later boss than the first one they were planned for, so the
// bosses before it went without them.
export type LateArrival = { playerId: number; plannedFrom: number; arrivedAt: number };
export type NightLineup = { date: string; logged: boolean; bosses: BossOnNight[]; late: LateArrival[] };

export function nightLineups(data: LineupData, today: string): NightLineup[] {
  const byDate = new Map<string, ReturnType<typeof nightsOf>>();
  for (const n of nightsOf(data, today)) byDate.set(n.slot.date, [...(byDate.get(n.slot.date) ?? []), n]);
  return [...byDate]
    .map(([date, rows]) => {
      const logged = rows.some((r) => r.slot.played !== null);
      const bosses: BossOnNight[] = rows.map(({ slot: s, skipped, pulled }) => {
        const state = skipped ? 'skipped' : !pulled ? 'not pulled' : s.played === null ? 'planned' : 'pulled';
        const played = state === 'pulled' ? s.played! : NONE;
        return {
          bossId: s.bossId,
          state,
          planned: s.planned.size,
          played: state === 'pulled' ? played.size : null,
          killed: s.killed,
          swappedIn: [...played].filter((id) => !s.planned.has(id)),
          missed: state === 'pulled' ? [...s.planned].filter((id) => !played.has(id)) : []
        };
      });
      const late: LateArrival[] = [];
      if (logged) {
        const pulled = rows.filter((r) => r.pulled && !r.skipped);
        const ids = new Set(pulled.flatMap((r) => [...r.slot.planned]));
        for (const id of ids) {
          const from = pulled.find((r) => r.slot.planned.has(id));
          const arrived = pulled.find((r) => r.slot.played!.has(id));
          if (from && arrived && arrived.slot.position > from.slot.position) {
            late.push({ playerId: id, plannedFrom: from.slot.bossId, arrivedAt: arrived.slot.bossId });
          }
        }
      }
      return { date, logged, bosses, late };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}
