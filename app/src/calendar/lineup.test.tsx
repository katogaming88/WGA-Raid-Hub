import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type FakeHandlers, type Read } from '../test/fakeSupabase';
import type { PlayerRow, Role } from '../roster/roster';
import type { Answer, RaidNight } from './calendar';
import {
  inRaiderOrder,
  moveBoss,
  wantsText,
  nightOrder,
  withOrder,
  capLabel,
  capStatus,
  changeList,
  pickChanges,
  pickRows,
  picksOf,
  playWords,
  setPick,
  changes,
  comingNights,
  current,
  everyoneIn,
  lineupRaids,
  lineupView,
  groupsView,
  onRoster,
  placesOf,
  seasonOn,
  shortBossName,
  toggle,
  wholeNight,
  yourBosses,
  DEFAULT_ROLE_TARGETS,
  type ComingBossRow,
  type EncounterRow,
  type LeaverRow,
  type NightBossRow,
  type PlaceRow
} from './lineup';

// The boss lineup on a raid night (#1216): the grid's rules, and the officer
// tab on the night page.

const player = (id: number, name: string, cls: string, role: string, flags: Partial<PlayerRow> = {}): PlayerRow => ({
  id,
  name_realm: `${name}-Illidan`,
  nickname: null,
  is_trial: false,
  is_bench: false,
  tier_pieces_equipped: null,
  classes_specs: { class: cls, spec: 'Spec', role },
  ...flags
});

const NIGHT: RaidNight = {
  date: '2026-05-14',
  start: '21:00:00',
  durationMinutes: 180,
  optional: false,
  extra: false,
  note: ''
};

const ABYSS = { id: 10, name: 'The Venomous Abyss', season: 'S1', is_mini_raid: false, sort_index: 0 };
const GROTTO = { id: 11, name: 'Tidebound Grotto', season: 'S1', is_mini_raid: true, sort_index: 1 };
const OLD = { id: 9, name: 'Old Raid', season: 'S0', is_mini_raid: false, sort_index: 0 };

const ENCOUNTERS: EncounterRow[] = [
  { id: 101, name: "Nek'zali the Soulcoiler", sort_index: 1, zone: ABYSS, cap: null, wcl_encounter_id: 3101 },
  { id: 102, name: 'Sszorak', sort_index: 2, zone: ABYSS, cap: null, wcl_encounter_id: 3102 },
  { id: 103, name: 'Nymrissa Wavecaller', sort_index: 1, zone: GROTTO, cap: null, wcl_encounter_id: 3103 },
  { id: 90, name: 'Old Boss', sort_index: 1, zone: OLD, cap: null, wcl_encounter_id: 3090 }
];

// A flex boss inside a Mythic raid: 25 allowed against the raid's own 20
// (#1244, Nymrissa Wavecaller and Kith'ix on production).
const FLEX_ENCOUNTERS: EncounterRow[] = [
  ...ENCOUNTERS,
  { id: 104, name: "Kith'ix", sort_index: 3, zone: ABYSS, cap: 25, wcl_encounter_id: 3104 }
];

const SEASONS = [
  { code: 'S0', display_name: 'Season Zero', starts_at: '2026-01-01', ends_at: '2026-03-31' },
  { code: 'S1', display_name: 'Season One', starts_at: '2026-04-01', ends_at: null }
];

const nightBoss = (encounter_id: number, position: number, extra: Partial<NightBossRow> = {}): NightBossRow => ({
  raid_date: NIGHT.date,
  encounter_id,
  position,
  skipped: false,
  confirmed_at: null,
  ...extra
});

const ROSTER = [
  player(1, 'Ana', 'Warrior', 'Tank'),
  player(2, 'Bo', 'Priest', 'Heal', { team_member_id: 12 }),
  player(3, 'Cy', 'Mage', 'Ranged', { is_trial: true }),
  player(4, 'Di', 'Rogue', 'Melee'),
  player(5, 'Ed', 'Druid', 'Ranged', { is_bench: true })
];

// The spec list (#1580): Bo is a Priest ("Spec", a healer) who can play
// Shadow, and has a Restoration Shaman alt, Bosham.
const SPECS = [
  { id: 1, class: 'Priest', spec: 'Spec', role: 'Heal' },
  { id: 2, class: 'Priest', spec: 'Shadow', role: 'Ranged' },
  { id: 3, class: 'Shaman', spec: 'Restoration', role: 'Heal' },
  { id: 4, class: 'Shaman', spec: 'Elemental', role: 'Ranged' }
];
const BOSHAM = { id: 501, name: 'Bosham', class_name: 'Shaman', spec_name: 'Restoration' };
const LOOK = {
  specs: new Map(SPECS.map((cs) => [cs.id, cs])),
  characters: new Map([[BOSHAM.id, BOSHAM]])
};

const answer = (player_id: number, status: string): Answer => ({
  player_id,
  raid_date: NIGHT.date,
  status,
  updated_at: '2026-05-14T12:00:00Z'
});

const places = (rows: [number, number[]][]): PlaceRow[] =>
  rows.flatMap(([encounter_id, ids]) => ids.map((player_id) => ({ encounter_id, player_id })));

describe('the lineup rules', () => {
  it('shortens boss names for a grid column, and only a one-word name', () => {
    expect(shortBossName("Nek'zali the Soulcoiler")).toBe("Nek'zali");
    expect(shortBossName('The Lost Explorers')).toBe('Lost Explorers');
    expect(shortBossName('Vashnik, the Malignant')).toBe('Vashnik');
    expect(shortBossName('Sszorak')).toBe('Sszorak');
    expect(shortBossName('Vexie and the Geargrinders')).toBe('Vexie and the Geargrinders');
    expect(shortBossName('Assault of the Zaqali')).toBe('Assault of the Zaqali');
  });

  it('finds the season a night falls in', () => {
    expect(seasonOn(SEASONS, '2026-02-01')).toBe('S0');
    expect(seasonOn(SEASONS, NIGHT.date)).toBe('S1');
    expect(seasonOn(SEASONS, '2025-12-31')).toBeNull();
  });

  it('lists the night’s bosses as raids in pull order, 25 a boss for a mini raid and 20 otherwise', () => {
    const bosses = [nightBoss(103, 3), nightBoss(102, 2, { confirmed_at: '2026-05-13T00:00:00Z' }), nightBoss(101, 1)];
    expect(lineupRaids(ENCOUNTERS, bosses, { fresh: false, season: 'S1' })).toEqual([
      {
        zoneId: 10,
        name: 'The Venomous Abyss',
        cap: 20,
        bosses: [
          {
            id: 101,
            name: "Nek'zali the Soulcoiler",
            short: "Nek'zali",
            skipped: false,
            confirmed: false,
            cap: 20,
            base: 20,
            art: 'https://assets.rpglogs.com/img/warcraft/bosses/3101-icon.jpg'
          },
          {
            id: 102,
            name: 'Sszorak',
            short: 'Sszorak',
            skipped: false,
            confirmed: true,
            cap: 20,
            base: 20,
            art: 'https://assets.rpglogs.com/img/warcraft/bosses/3102-icon.jpg'
          }
        ]
      },
      {
        zoneId: 11,
        name: 'Tidebound Grotto',
        cap: 25,
        bosses: [
          {
            id: 103,
            name: 'Nymrissa Wavecaller',
            short: 'Nymrissa Wavecaller',
            skipped: false,
            confirmed: false,
            cap: 25,
            base: 25,
            art: 'https://assets.rpglogs.com/img/warcraft/bosses/3103-icon.jpg'
          }
        ]
      }
    ]);
    // Nothing planned yet: nothing, unless starting the very first night.
    expect(lineupRaids(ENCOUNTERS, [], { fresh: false, season: 'S1' })).toEqual([]);
    const fresh = lineupRaids(ENCOUNTERS, [], { fresh: true, season: 'S1' });
    expect(fresh.flatMap((r) => r.bosses.map((b) => b.id))).toEqual([101, 102, 103]);
  });

  it('gives a boss its own cap when one is set, over the raid’s (#1244, a flex boss)', () => {
    const raids = lineupRaids(FLEX_ENCOUNTERS, [], { fresh: true, season: 'S1' });
    const abyss = raids.find((r) => r.zoneId === 10)!;
    expect(abyss.cap).toBe(20);
    expect(abyss.bosses.map((b) => [b.short, b.cap])).toEqual([
      ["Nek'zali", 20],
      ['Sszorak', 20],
      ["Kith'ix", 25]
    ]);
    expect(capLabel(abyss.bosses)).toBe('20-25 per boss');
    const grotto = raids.find((r) => r.zoneId === 11)!;
    expect(capLabel(grotto.bosses)).toBe('25 per boss');
  });

  it('keeps edits only where they differ from what is saved', () => {
    const saved = placesOf(places([[101, [1, 2]]]));
    let edits = toggle(saved, new Map(), 101, 2);
    expect([...current(saved, edits).get(101)!]).toEqual([1]);
    expect(changes(saved, edits)).toEqual({ bosses: [101], cells: 1 });
    // Clicking back leaves no edit behind.
    edits = toggle(saved, edits, 101, 2);
    expect(edits.size).toBe(0);
    expect(changes(saved, edits)).toEqual({ bosses: [], cells: 0 });
  });

  it('puts a bench raider in, or out, for every boss still on the night', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2, { skipped: true })], {
      fresh: false,
      season: 'S1'
    })[0]!;
    const edits = wholeNight(new Map(), new Map(), raid.bosses, 5, true);
    expect([...edits.keys()]).toEqual([101]);
    expect(wholeNight(new Map(), edits, raid.bosses, 5, false).size).toBe(0);
  });

  it('starts the very first night with everyone in but the bench', () => {
    const raid = lineupRaids(ENCOUNTERS, [], { fresh: true, season: 'S1' })[0]!;
    const edits = everyoneIn(ROSTER, raid.bosses);
    expect([...edits.get(101)!].sort()).toEqual([1, 2, 3, 4]);
  });

  it('says how full a boss is', () => {
    expect(capStatus(20, 20)).toEqual({ text: 'Full', tone: 'good' });
    expect(capStatus(19, 20)).toEqual({ text: '1 open spot', tone: 'warn' });
    expect(capStatus(15, 20)).toEqual({ text: '5 open spots', tone: 'warn' });
    expect(capStatus(22, 20)).toEqual({ text: '2 over', tone: 'bad' });
    // A flex boss (#1681): past the raid's own 20 it has room, not a problem;
    // under 20 it is short of the raid's cap, not its own.
    expect(capStatus(22, 25, 20)).toEqual({ text: 'room for 3 more', tone: 'room' });
    expect(capStatus(20, 25, 20)).toEqual({ text: 'room for 5 more', tone: 'room' });
    expect(capStatus(18, 25, 20)).toEqual({ text: '2 open spots', tone: 'warn' });
  });

  it('lists everyone on the roster, marks changes from the group and raiders in who said they’re out', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2)], {
      fresh: false,
      season: 'S1'
    })[0]!;
    const tonight = placesOf(
      places([
        [101, [1, 2, 3, 4]],
        [102, [2, 3]]
      ])
    );
    const usual = placesOf(
      places([
        [101, [1, 2, 3]],
        [102, [1, 2, 3]]
      ])
    );
    // Bo is late; Di answered Absent after being planned in; Ed is on the bench.
    const view = lineupView(ROSTER, NIGHT, [answer(2, 'Late'), answer(4, 'Absent')], raid, tonight, usual);

    expect(view.groups.map((g) => [g.label, g.rows.map((r) => [r.row.name, r.tag, r.count])])).toEqual([
      ['Tanks', [['Ana', null, 1]]],
      ['Healers', [['Bo', 'Late', 2]]],
      ['Melee', [['Di', 'Absent', 1]]],
      [
        'Ranged',
        [
          ['Cy', 'Trial', 2],
          ['Ed', 'Bench', 0]
        ]
      ]
    ]);
    const ana = view.groups[0]!.rows[0]!;
    // Ana is usually in on Sszorak, out tonight.
    expect(ana.cells.map((c) => [c.in, c.differs])).toEqual([
      [true, false],
      [false, true]
    ]);
    const di = view.groups[2]!.rows[0]!;
    expect(di.tagTone).toBe('out');
    expect(di.cells.map((c) => [c.in, c.conflict, c.differs])).toEqual([
      [true, true, true],
      [false, false, false]
    ]);
    expect(view.benchOut).toEqual(['Ed']);
    // Di is named once in Needs a look, not on every boss.
    expect(view.notComing).toEqual(['Di']);

    const [nekzali, sszorak] = view.totals;
    expect([nekzali!.count, nekzali!.tanks, nekzali!.healers, nekzali!.damage]).toEqual([4, 1, 1, 2]);
    // Each group's heading row counts its role, boss by boss.
    expect(nekzali!.roles).toEqual({ Tank: 1, Heal: 1, Melee: 1, Ranged: 1 });
    expect(nekzali!.problems).toEqual([
      '16 open spots',
      '1 tank, wants 2',
      '1 healer, wants 4',
      expect.stringMatching(/^no Mark of the Wild, /)
    ]);
    expect(sszorak!.problems.slice(0, 2)).toEqual(['18 open spots', 'no tanks, wants 2']);
    // The night's one-line Needs a look counts the buffs instead of naming them.
    expect(nekzali!.brief).toEqual([...nekzali!.problems.slice(0, 3), expect.stringMatching(/^\d+ buffs missing$/)]);
    const battleShout = view.buffs.find((r) => r.buff.name === 'Battle Shout')!;
    expect(battleShout.cells.map((c) => c.providers)).toEqual([['Ana'], []]);
  });

  it('checks a boss against the team’s own role targets, not the default (#1244)', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1)], { fresh: false, season: 'S1' })[0]!;
    // One tank (Ana), one healer (Bo): short of the default's 2 tanks / 4
    // healers, but enough for a team that wants only one of each.
    const tonight = placesOf(places([[101, [1, 2, 3, 4]]]));
    const asDefault = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight);
    expect(asDefault.totals[0]!.problems).toEqual(expect.arrayContaining(['1 tank, wants 2', '1 healer, wants 4']));
    const wantsLess = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, { tanks: 1, healers: 1 });
    expect(wantsLess.totals[0]!.problems).toEqual(['16 open spots', expect.stringMatching(/^no /)]);
    // Explicit DEFAULT_ROLE_TARGETS matches the no-argument call.
    expect(lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, DEFAULT_ROLE_TARGETS)).toEqual(asDefault);
  });

  it('reports tanks by count against the target, not a fixed "needs a second tank" (Rex’s review of #1256)', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1)], { fresh: false, season: 'S1' })[0]!;
    // Two tanks in (Ana and a second), short of a team that wants three.
    const secondTank = player(6, 'Az', 'Paladin', 'Tank');
    const tonight = placesOf(places([[101, [1, 6]]]));
    const wantsThree = lineupView([...ROSTER, secondTank], NIGHT, [], raid, tonight, tonight, {
      tanks: 3,
      healers: 0
    });
    expect(wantsThree.totals[0]!.problems).toContain('2 tanks, wants 3');
    // Over the target is a problem too (#1681).
    const wantsOne = lineupView([...ROSTER, secondTank], NIGHT, [], raid, tonight, tonight, {
      tanks: 1,
      healers: 0
    });
    expect(wantsOne.totals[0]!.problems).toContain('2 tanks, wants 1');

    // A team that wants no tanks at all is never told it has none.
    const noTanksWanted = lineupView(ROSTER, NIGHT, [], raid, placesOf(places([[101, [2]]])), tonight, {
      tanks: 0,
      healers: 0
    });
    expect(noTanksWanted.totals[0]!.problems.some((p) => p.includes('tank'))).toBe(false);
  });

  it('checks a boss against its own targets, and the team’s where it has none (#1682)', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2)], { fresh: false, season: 'S1' })[0]!;
    // Ana tanks, Bo heals, Cy is ranged, Di is melee, on both bosses.
    const tonight = placesOf(
      places([
        [101, [1, 2, 3, 4]],
        [102, [1, 2, 3, 4]]
      ])
    );
    const targets = {
      tanks: 1,
      healers: 1,
      bosses: new Map([[101, { tanks: 3, healers: null, melee: 2, ranged: null }]])
    };
    const view = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, targets);
    const [own, team] = view.totals;
    expect(own!.wants).toEqual({ Tank: 3, Heal: 1, Melee: 2, Ranged: null });
    expect(own!.problems).toEqual(expect.arrayContaining(['1 tank, wants 3', '1 melee, wants at least 2']));
    expect(own!.problems.some((p) => /healer|ranged/.test(p))).toBe(false);
    // The other boss has nothing of its own: the team's 1 and 1, no melee count.
    expect(team!.wants).toEqual({ Tank: 1, Heal: 1, Melee: null, Ranged: null });
    expect(team!.problems.some((p) => /tank|healer|melee|ranged/.test(p))).toBe(false);
    // Over a boss's own target is flagged too: one ranged, wanted none.
    const over = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, {
      ...targets,
      bosses: new Map([[101, { tanks: null, healers: 2, melee: null, ranged: null }]])
    });
    expect(over.totals[0]!.problems).toContain('1 healer, wants 2');
    // Melee and ranged are a minimum: more than wanted is fine (Kat).
    const plenty = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, {
      ...targets,
      bosses: new Map([[101, { tanks: null, healers: null, melee: null, ranged: 1 }]])
    });
    expect(plenty.totals[0]!.wants.Ranged).toBe(1);
    expect(plenty.totals[0]!.problems.some((p) => p.includes('ranged'))).toBe(false);
    const short = lineupView(ROSTER, NIGHT, [], raid, tonight, tonight, {
      ...targets,
      bosses: new Map([[101, { tanks: null, healers: null, melee: null, ranged: 3 }]])
    });
    expect(short.totals[0]!.problems).toContain('1 ranged, wants at least 3');
    expect(wantsText(targets, 101)).toBe('Wants 3 tanks, 2 melee');
    expect(wantsText(targets, 102)).toBe('');
  });

  it('leaves a skipped boss out of the counts and checks', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2, { skipped: true })], {
      fresh: false,
      season: 'S1'
    })[0]!;
    const view = lineupView(ROSTER, NIGHT, [], raid, placesOf(places([[101, [1]]])), new Map());
    expect(view.live.map((b) => b.id)).toEqual([101]);
    expect(view.totals.map((t) => t.boss.id)).toEqual([101]);
    expect(view.groups[0]!.rows[0]!.cells.map((c) => [c.in, c.differs])).toEqual([
      [true, true],
      [false, false]
    ]);
  });

  it('warns about buffs only once a boss is full', () => {
    const full = {
      zoneId: 1,
      name: 'R',
      cap: 2,
      bosses: [{ id: 1, name: 'B', short: 'B', skipped: false, confirmed: false, cap: 2, base: 2, art: '' }]
    };
    const two = [player(1, 'Ana', 'Warrior', 'Tank'), player(2, 'Bo', 'Warrior', 'Tank')];
    const total = lineupView(two, NIGHT, [], full, placesOf(places([[1, [1, 2]]])), new Map()).totals[0]!;
    expect(total.warn).toBe('12 buffs');
    expect(total.problems).toEqual(['no healers, wants 4', expect.stringMatching(/^no Mark of the Wild/)]);
  });

  it('counts a flex boss with room past the raid’s cap as fine (#1681)', () => {
    const flex = lineupRaids(FLEX_ENCOUNTERS, [nightBoss(104, 1)], { fresh: false, season: 'S1' })[0]!;
    const kithix = flex.bosses[0]!;
    expect([kithix.cap, kithix.base]).toEqual([25, 20]);
    expect(kithix.art).toBe('https://assets.rpglogs.com/img/warcraft/bosses/3104-icon.jpg');
    const many = Array.from({ length: 22 }, (_, i) =>
      player(100 + i, `R${i}`, 'Priest', i < 2 ? 'Tank' : i < 6 ? 'Heal' : 'Ranged')
    );
    const all = placesOf(places([[104, many.map((p) => p.id)]]));
    const total = lineupView(many, NIGHT, [], flex, all, all).totals[0]!;
    expect(total.status.tone).toBe('room');
    expect(total.problems.some((p) => /open|over/.test(p))).toBe(false);
  });

  it('counts a raider as what they play on a boss, and names it (#1580)', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2)], { fresh: false, season: 'S1' })[0]!;
    const all = placesOf(
      places([
        [101, [1, 2]],
        [102, [1, 2]]
      ])
    );
    // Bo plays Shadow on Nek'zali and their Shaman alt on Sszorak.
    const picks = picksOf([
      { encounter_id: 101, player_id: 2, character_id: null, class_spec_id: 2 },
      { encounter_id: 102, player_id: 2, character_id: BOSHAM.id, class_spec_id: null }
    ]);
    const view = lineupView(ROSTER, NIGHT, [], raid, all, all, DEFAULT_ROLE_TARGETS, picks, LOOK);
    const [nekzali, sszorak] = view.totals;
    expect(nekzali!.roles).toEqual({ Tank: 1, Heal: 0, Melee: 0, Ranged: 1 });
    expect(sszorak!.roles).toEqual({ Tank: 1, Heal: 1, Melee: 0, Ranged: 0 });
    const bo = view.groups.find((g) => g.role === 'Heal')!.rows[0]!;
    expect(bo.cells.map((c) => playWords(c.play))).toEqual(['as Shadow', 'on Bosham as Restoration Shaman']);
    // Played differently from the usual group (no picks there): tonight only.
    expect(bo.cells.map((c) => c.differs)).toEqual([true, true]);

    expect(pickChanges(new Map(), picks, all, raid.bosses, ROSTER, LOOK)).toEqual([
      'Bo as Shadow for Nek’zali'.replace('’', "'"),
      'Bo on Bosham as Restoration Shaman for Sszorak'
    ]);
    expect(pickChanges(picks, new Map(), all, raid.bosses, ROSTER, LOOK)).toEqual([
      "Bo back to Spec for Nek'zali",
      'Bo back to Spec for Sszorak'
    ]);
  });

  it('moves a boss after the one it lands on going later, before it going earlier (#1679)', () => {
    expect(moveBoss([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
    expect(moveBoss([1, 2, 3, 4], 4, 2)).toEqual([1, 4, 2, 3]);
    expect(moveBoss([1, 2, 3], 2, 2)).toEqual([1, 2, 3]);
    const bosses = [nightBoss(102, 2), nightBoss(101, 1)];
    expect(nightOrder(bosses)).toEqual([101, 102]);
    expect(nightOrder(withOrder(bosses, [102, 101]))).toEqual([102, 101]);
  });

  it('saves only the picks of raiders still in', () => {
    const one = new Map([
      [2, { characterId: null, classSpecId: 2 }],
      [3, { characterId: BOSHAM.id, classSpecId: null }]
    ]);
    expect(pickRows(one, new Set([2]))).toEqual([{ player_id: 2, character_id: null, class_spec_id: 2 }]);
    const edits = setPick(new Map(), new Map(), 101, 2, { characterId: null, classSpecId: 2 });
    expect(setPick(new Map(), edits, 101, 2, null).size).toBe(0);
  });

  it('lists what changed for the save bar, by raider', () => {
    const raid = lineupRaids(ENCOUNTERS, [nightBoss(101, 1), nightBoss(102, 2)], { fresh: false, season: 'S1' })[0]!;
    const saved = placesOf(
      places([
        [101, [1, 2, 3]],
        [102, [1, 2, 3]]
      ])
    );
    const names = new Map(ROSTER.map((p) => [p.id, p.name_realm.split('-')[0]!]));
    const nameOf = (id: number) => names.get(id)!;
    // Bo out on Sszorak only; Cy out on both, so out all night; Ed in on both.
    let edits = toggle(saved, new Map(), 102, 2);
    edits = wholeNight(saved, edits, raid.bosses, 3, false);
    edits = wholeNight(saved, edits, raid.bosses, 5, true);
    expect(changeList(saved, edits, raid.bosses, nameOf)).toEqual([
      'Bo out on Sszorak',
      'Cy out all night',
      'Ed in all night'
    ]);
    expect(changeList(saved, new Map(), raid.bosses, nameOf)).toEqual([]);
  });
});

// The page

const who = (role: string) => ({
  site_admin: false,
  guild_officer: false,
  boe_manager: false,
  teams: [
    {
      team_id: 1,
      team_member_id: 1,
      role,
      characters: [{ player_id: 1, name_realm: 'Ana-Illidan', url_code: null, archived_at: null }]
    }
  ]
});

type Setup = {
  bosses?: NightBossRow[];
  tonight?: PlaceRow[];
  groups?: PlaceRow[];
  answers?: Answer[];
  targets?: { tanks_wanted: number; healers_wanted: number };
  bossTargets?: {
    encounter_id: number;
    tanks: number | null;
    healers: number | null;
    melee: number | null;
    ranged: number | null;
  }[];
  raiderOrder?: { player_id: number; role: string; position: number }[];
  // The weekly nights' difficulty (#1688); none reads as Mythic.
  difficulty?: string;
  rpc?: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: { message: string } } | undefined;
};

const PLANNED: Setup = {
  bosses: [nightBoss(101, 1), nightBoss(102, 2), nightBoss(103, 3)],
  tonight: places([
    [101, [1, 2, 3]],
    [102, [1, 2]],
    [103, [1, 2, 3, 4]]
  ]),
  groups: places([
    [101, [1, 2, 3]],
    [102, [1, 2, 3]],
    [103, [1, 2, 3, 4]]
  ])
};

// Rows on the Heroic plan (#1688); rows without a plan are Mythic.
const heroic = <T,>(rows: T[]): T[] => rows.map((r) => ({ ...r, plan: 'heroic' }));
const byPlan = <T,>(rows: T[], read: Read): T[] => {
  const want = read.filters.find(([op, column]) => op === 'eq' && column === 'plan')?.[2];
  return want ? rows.filter((r) => ((r as { plan?: string }).plan ?? 'mythic') === want) : rows;
};

function handlers(person: ReturnType<typeof who>, setup: Setup = PLANNED): FakeHandlers {
  const base = seededHandlers();
  const tables: Record<string, (read: Read) => unknown> = {
    raid_schedule: () =>
      [2, 4].map((weekday) => ({
        weekday,
        start_time: '21:00:00',
        duration_minutes: 180,
        is_optional: false,
        difficulty: setup.difficulty ?? null
      })),
    raid_schedule_exceptions: () => [],
    players: () => ROSTER,
    raid_rsvps: () => setup.answers ?? [],
    seasons: () => SEASONS,
    raid_encounters: () => ENCOUNTERS,
    raid_night_bosses: (read) => byPlan(setup.bosses ?? [], read),
    raid_night_lineups: (read) => byPlan(setup.tonight ?? [], read),
    boss_groups: (read) => byPlan(setup.groups ?? [], read),
    team_lineup_settings: (read) => (read.single ? (setup.targets ?? null) : setup.targets ? [setup.targets] : []),
    team_boss_role_targets: () => setup.bossTargets ?? [],
    team_raider_order: () => setup.raiderOrder ?? [],
    classes_specs: () => SPECS,
    team_members: () => [{ id: 12, person_id: 7 }],
    characters: () => [{ ...BOSHAM, person_id: 7, realm: 'Illidan', item_level: null }]
  };
  return seededHandlers({
    session: fakeSession({ battlenet: 'A#1', discord: { id: 'd', name: 'Ana' } }),
    rpc(name, args) {
      const custom = setup.rpc?.(name, args);
      if (custom) return custom;
      if (name === 'current_discord_id') return { data: 'discord-ana' };
      if (name === 'resolve_person') return { data: person };
      if (name === 'team_rsvp_answers') return { data: [] };
      if (name === 'set_raid_night_lineup' || name === 'set_boss_group') return { data: 1 };
      if (name === 'plan_raid_night') return { data: 3 };
      if (
        name === 'set_raid_night_boss_skipped' ||
        name === 'set_raid_night_boss_order' ||
        name === 'set_lineup_raider_order' ||
        name === 'set_boss_role_targets'
      )
        return { data: null };
      return base.rpc!(name, args);
    },
    from(read) {
      if (read.table in tables) return { data: tables[read.table]!(read) };
      return base.from!(read);
    }
  });
}

const LINEUP = '/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup';
const grid = async () =>
  within(await screen.findByRole('table', { name: /The Venomous Abyss lineup for Thu, May 14/ }));
const rpcs = (client: { rpcs: [string, unknown][] }, name: string) =>
  client.rpcs.filter(([n]) => n === name).map(([, args]) => args);

// One Save button that asks how far the change reaches (#1681).
async function save(
  user: ReturnType<typeof userEvent.setup>,
  reach: 'Just Thursday' | 'Thursday and every night after'
) {
  await user.click(screen.getByRole('button', { name: 'Save…' }));
  const dialog = within(await screen.findByRole('dialog', { name: 'Save the boss lineup' }));
  await user.click(dialog.getByRole('radio', { name: new RegExp(`^${reach}`) }));
  await user.click(dialog.getByRole('button', { name: 'Save' }));
}

describe('the boss lineup tab', () => {
  it('shows a raider the same grid, read-only (#1681)', async () => {
    renderApp(LINEUP, handlers(who('raider')));
    const g = await grid();
    expect(screen.getByRole('link', { name: 'Boss lineup' })).toHaveAttribute('aria-current', 'page');
    expect(g.getByText("Ana, Nek'zali the Soulcoiler: in")).toBeInTheDocument();
    expect(g.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save…' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Needs a look' })).not.toBeInTheDocument();
  });

  it('lets each viewer pick Names or Solid bars, saved to their own account (#1681)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    expect(screen.getByRole('radio', { name: 'Names' })).toBeChecked();
    expect(g.getAllByText('Ana').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('radio', { name: 'Solid bars' }));
    expect(screen.getByRole('radio', { name: 'Solid bars' })).toBeChecked();
    expect(screen.getByRole('table', { name: /lineup for/ })).toHaveAttribute('data-style', 'bars');
    expect(client.writes.filter((w) => w.table === 'account_preferences')).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({ key: 'lineup_cell_style', value: 'bars', team_id: null })
      })
    ]);
  });

  it('opens from the night page for an officer, and stepping nights keeps it open', async () => {
    renderApp('/g/wga/t/phoenix/calendar?date=2026-05-14', handlers(who('officer')));
    const tab = await screen.findByRole('link', { name: 'Boss lineup' });
    expect(tab).toHaveAttribute('href', '/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup');
    expect(screen.getByRole('link', { name: 'Who’s coming' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^Next raid night/ })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/calendar?date=2026-05-19'
    );
  });

  it('keeps the boss lineup open when stepping to the next night', async () => {
    renderApp(LINEUP, handlers(who('officer')));
    await grid();
    expect(screen.getByRole('link', { name: /^Next raid night/ })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/calendar?date=2026-05-19&view=lineup'
    );
  });

  it('goes back to the saved cell style, and says so, when the pick doesn’t save', async () => {
    const user = userEvent.setup();
    renderApp(LINEUP, {
      ...handlers(who('officer')),
      write: (w) => (w.table === 'account_preferences' ? { error: { message: 'Network down' } } : { data: null })
    });
    await grid();
    await user.click(screen.getByRole('radio', { name: 'Solid bars' }));
    expect(await screen.findByText('Your cell style didn’t save: Network down')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Names' })).toBeChecked();
  });

  it('shows everyone on the roster, with the bench out and changes from the group marked', async () => {
    renderApp(LINEUP, handlers(who('officer'), { ...PLANNED, answers: [answer(3, 'Absent')] }));
    const g = await grid();
    expect(g.getByRole('button', { name: "Ed, Nek'zali the Soulcoiler: out" })).toBeInTheDocument();
    expect(
      g.getByRole('button', { name: 'Cy, Sszorak: out, changed for tonight only, usually in' })
    ).toBeInTheDocument();
    expect(
      g.getByRole('button', { name: "Cy, Nek'zali the Soulcoiler: in, but said they’re not coming" })
    ).toBeInTheDocument();
    // The count against the cap is read out, not only shown.
    expect(
      g.getByRole('columnheader', { name: /^Sszorak, pull 2\s*2\/20, 18 open spots, 1 tank, 1 healer, 0 damage/ })
    ).toBeInTheDocument();
    // Each role's heading row counts it on every boss, against the target.
    const tanks = g.getByRole('rowheader', { name: 'Tanks · 1' }).closest('tr')!;
    expect([...tanks.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1/2', '1/2']);
    const look = within(screen.getByRole('region', { name: 'Needs a look' }));
    expect(look.getByText('Ed is out on every boss unless you put them in.')).toBeInTheDocument();
    expect(look.getByText('is in, but said they’re not coming')).toBeInTheDocument();
    expect(look.getByText('2. Sszorak')).toBeInTheDocument();
    // Needs a look counts missing buffs; hovering the boss names them.
    expect(
      look.getByText(/^18 open spots · 1 tank, wants 2 · 1 healer, wants 4 · \d+ buffs missing$/)
    ).toBeInTheDocument();
    // A screen reader hears the buffs by name in Needs a look itself.
    expect(
      look.getByText(/^18 open spots; 1 tank, wants 2; 1 healer, wants 4; no Mark of the Wild/)
    ).toBeInTheDocument();
  });

  it('lets an officer set what a boss needs, saved at once, never as an unsaved change (#1682)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    const saveWas = (screen.getByRole('button', { name: 'Save…' }) as HTMLButtonElement).disabled;
    await user.click(g.getByRole('button', { name: 'What Sszorak needs' }));
    const panel = within(await screen.findByRole('dialog', { name: 'What Sszorak needs' }));
    expect(panel.getByText(/^Team targets: 2 tanks, 4 healers\./)).toBeInTheDocument();
    expect(panel.getByText('up to 20')).toBeInTheDocument();
    // Nothing of its own yet: nothing to reset.
    expect(panel.getByRole('button', { name: 'Use team targets' })).toBeDisabled();

    await user.click(panel.getByRole('button', { name: 'One more: tanks' }));
    await waitFor(() =>
      expect(rpcs(client, 'set_boss_role_targets')).toEqual([{ p_team_id: 1, p_encounter_id: 102, p_tanks: 3 }])
    );
    // Melee starts at Any; + sets a minimum of 1.
    await user.click(panel.getByRole('button', { name: 'One more: melee' }));
    await waitFor(() => expect(rpcs(client, 'set_boss_role_targets')).toHaveLength(2));
    expect(rpcs(client, 'set_boss_role_targets')[1]).toEqual({ p_team_id: 1, p_encounter_id: 102, p_melee: 1 });
    // A standing setting: the lineup's Save has nothing to save.
    expect((screen.getByRole('button', { name: 'Save…' }) as HTMLButtonElement).disabled).toBe(saveWas);
  });

  it('checks a boss with its own targets against them, and shows what it wants (#1682)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      LINEUP,
      handlers(who('officer'), {
        ...PLANNED,
        bossTargets: [{ encounter_id: 101, tanks: 3, healers: null, melee: 2, ranged: null }]
      })
    );
    const g = await grid();
    const tanks = g.getByRole('rowheader', { name: 'Tanks · 1' }).closest('tr')!;
    const cells = [...tanks.querySelectorAll('td')];
    expect(cells.map((td) => td.textContent)).toEqual(['1/3', '1/2']);
    expect(cells[0]).toHaveAttribute('data-tone', 'warn');
    const melee = g.getByRole('rowheader', { name: 'Melee · 1' }).closest('tr')!;
    expect([...melee.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['0/2', '0']);

    // The blue line reopens the panel, which can put the boss back.
    await user.click(g.getByRole('button', { name: 'Wants 3 tanks, 2 melee' }));
    const panel = within(await screen.findByRole('dialog', { name: "What Nek'zali needs" }));
    await user.click(panel.getByRole('button', { name: 'Use team targets' }));
    await waitFor(() => expect(rpcs(client, 'set_boss_role_targets')).toEqual([{ p_team_id: 1, p_encounter_id: 101 }]));
  });

  it('shows a raider what a boss wants, with nothing to change it (#1682)', async () => {
    renderApp(
      LINEUP,
      handlers(who('raider'), {
        ...PLANNED,
        bossTargets: [{ encounter_id: 101, tanks: 3, healers: null, melee: null, ranged: null }]
      })
    );
    const g = await grid();
    expect(g.getByText('Wants 3 tanks')).toBeInTheDocument();
    expect(g.queryByRole('button', { name: /needs$/ })).not.toBeInTheDocument();
  });

  it('names a boss’s missing buffs in the site’s own tip, at once, on hover (#1681)', async () => {
    const user = userEvent.setup();
    renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    const heading = g.getByRole('columnheader', { name: /^Sszorak, pull 2/ });
    expect(heading).not.toHaveAttribute('title');
    await user.hover(heading);
    const tip = within(screen.getByRole('tooltip'));
    expect(tip.getByText('2. Sszorak')).toBeInTheDocument();
    // The boss's numbers, anything short of its target in amber.
    const row = (label: string) => tip.getByRole('rowheader', { name: label }).nextElementSibling!;
    expect(row('Raiders')).toHaveTextContent('2/20');
    expect(row('Raiders')).toHaveClass('blg-tip-warn');
    expect(row('Tanks')).toHaveTextContent('1/2');
    expect(row('Healers')).toHaveTextContent('1/4');
    expect(row('Melee')).toHaveTextContent('0');
    expect(row('Melee')).not.toHaveClass('blg-tip-warn');
    expect(row('Ranged')).toHaveTextContent('0');
    // The missing buffs by name.
    expect(tip.getByText(/^Missing buffs \(\d+\)$/)).toBeInTheDocument();
    expect(tip.getByText('Mark of the Wild')).toBeInTheDocument();
    await user.unhover(heading);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const look = within(screen.getByRole('region', { name: 'Needs a look' }));
    await user.hover(look.getByText('2. Sszorak').closest('li')!);
    expect(within(screen.getByRole('tooltip')).getByText('2. Sszorak')).toBeInTheDocument();
  });

  it('saves a change for tonight only', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    const saveButton = screen.getByRole('button', { name: 'Save…' });
    expect(screen.getByText('No unsaved changes.')).toBeInTheDocument();
    // Nothing changed yet, but Sszorak differs from its group: Save can still
    // make tonight the usual group, and only that.
    await user.click(saveButton);
    const ask = within(await screen.findByRole('dialog', { name: 'Save the boss lineup' }));
    expect(ask.getByRole('radio', { name: /^Just Thursday/ })).toBeDisabled();
    expect(ask.getByRole('radio', { name: /^Thursday and every night after/ })).toBeChecked();
    await user.click(ask.getByRole('button', { name: 'Cancel' }));

    await user.click(g.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: in" }));
    expect(screen.getByText('1 unsaved change:')).toBeInTheDocument();
    expect(screen.getByText("Bo out on Nek'zali")).toBeInTheDocument();
    await user.click(saveButton);
    // Just this night is the default.
    const dialog = within(await screen.findByRole('dialog', { name: 'Save the boss lineup' }));
    expect(dialog.getByRole('radio', { name: /^Just Thursday/ })).toBeChecked();
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(rpcs(client, 'set_raid_night_lineup')).toEqual([
      {
        p_team_id: 1,
        p_raid_date: '2026-05-14',
        p_encounter_id: 101,
        p_player_ids: [1, 3],
        p_expected_player_ids: [1, 2, 3],
        p_picks: [],
        p_expected_picks: [],
        p_plan: 'mythic'
      }
    ]);
    expect(rpcs(client, 'set_boss_group')).toEqual([]);
    expect((await screen.findAllByText('Saved the lineup for Thu, May 14.')).length).toBeGreaterThan(0);
    // The editor stays put, so keyboard focus is not thrown to the top.
    expect(saveButton).toBeInTheDocument();
  });

  it('saves to the group: tonight first, then the usual group', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: in' }));
    await save(user, 'Thursday and every night after');

    const order = client.rpcs.map(([n]) => n).filter((n) => n.startsWith('set_'));
    expect(order).toEqual(['set_raid_night_lineup', 'set_boss_group']);
    // Sszorak's group had Cy too; what is on screen becomes the group.
    expect(rpcs(client, 'set_boss_group')).toEqual([
      {
        p_team_id: 1,
        p_encounter_id: 102,
        p_player_ids: [2],
        p_expected_player_ids: [1, 2, 3],
        p_picks: [],
        p_expected_picks: [],
        p_plan: 'mythic'
      }
    ]);
  });

  it('says which boss was held back when someone else saved it first', async () => {
    const user = userEvent.setup();
    renderApp(
      LINEUP,
      handlers(who('officer'), {
        ...PLANNED,
        rpc: (name) =>
          name === 'set_raid_night_lineup'
            ? {
                error: {
                  message: 'Someone else changed this boss’s lineup since you opened it. Reload to see their change.'
                }
              }
            : undefined
      })
    );
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: in' }));
    await save(user, 'Just Thursday');
    expect(await screen.findByText('Sszorak wasn’t saved.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show their version' }));
    expect(g.getByRole('button', { name: 'Ana, Sszorak: in' })).toBeInTheDocument();
    expect(screen.getByText('No unsaved changes.')).toBeInTheDocument();
  });

  it('lets an officer pick another spec or an alt for a raider on a boss (#1580)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    await user.click(g.getByRole('button', { name: "Change what Bo plays on Nek'zali the Soulcoiler" }));
    let dialog = within(await screen.findByRole('dialog', { name: "What Bo plays on Nek'zali" }));
    // Their roster character, then the alt, every spec of each class.
    expect(dialog.getByRole('button', { name: 'Spec healer · usual' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(dialog.getByRole('button', { name: 'Shadow ranged' }));
    expect(
      g.getByRole('button', {
        name: "Bo, Nek'zali the Soulcoiler: in, as Shadow, changed for tonight only, usually as Spec"
      })
    ).toBeInTheDocument();
    expect(screen.getByText("Bo as Shadow for Nek'zali")).toBeInTheDocument();

    await user.click(g.getByRole('button', { name: 'Change what Bo plays on Sszorak' }));
    dialog = within(await screen.findByRole('dialog', { name: 'What Bo plays on Sszorak' }));
    await user.click(
      within(dialog.getByRole('region', { name: 'Bosham' })).getByRole('button', { name: 'Restoration healer · usual' })
    );
    // The alt's name is on the cell.
    expect(g.getByRole('button', { name: /^Bo, Sszorak: in, on Bosham as Restoration Shaman/ })).toHaveTextContent(
      'Bosham'
    );

    await save(user, 'Just Thursday');
    expect(rpcs(client, 'set_raid_night_lineup')).toEqual([
      expect.objectContaining({
        p_encounter_id: 101,
        p_picks: [{ player_id: 2, character_id: null, class_spec_id: 2 }],
        p_expected_picks: [],
        p_plan: 'mythic'
      }),
      expect.objectContaining({
        p_encounter_id: 102,
        p_picks: [{ player_id: 2, character_id: BOSHAM.id, class_spec_id: 3 }],
        p_expected_picks: [],
        p_plan: 'mythic'
      })
    ]);
  });

  it('shows a saved pick on the grid and counts its role (#1580)', async () => {
    renderApp(
      LINEUP,
      handlers(who('officer'), {
        ...PLANNED,
        tonight: [
          ...PLANNED.tonight!.filter((r) => !(r.encounter_id === 101 && r.player_id === 2)),
          { encounter_id: 101, player_id: 2, character_id: BOSHAM.id, class_spec_id: 4, character: BOSHAM }
        ]
      })
    );
    const g = await grid();
    expect(
      g.getByRole('button', { name: /^Bo, Nek'zali the Soulcoiler: in, on Bosham as Elemental Shaman/ })
    ).toBeInTheDocument();
    const healers = g.getByRole('rowheader', { name: 'Healers · 1' }).closest('tr')!;
    expect([...healers.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['0/4', '1/4']);
  });

  it('puts a raider in, or sits them out, on every boss from their name', async () => {
    const user = userEvent.setup();
    renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Put Ed back in on every boss' }));
    expect(
      g.getByRole('button', { name: 'Ed, Sszorak: in, changed for tonight only, usually out' })
    ).toBeInTheDocument();
    expect(screen.getByText('1 unsaved change:')).toBeInTheDocument();
    expect(screen.getByText('Ed in for all of The Venomous Abyss')).toBeInTheDocument();
    await user.click(g.getByRole('button', { name: 'Sit Ana out on every boss' }));
    expect(
      g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: out, changed for tonight only, usually in" })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ana out for all of The Venomous Abyss · Ed in for all of The Venomous Abyss')
    ).toBeInTheDocument();
  });

  it('moves a boss by its arrows and saves the order for tonight only (#1679)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    expect(g.getByRole('button', { name: "Move Nek'zali the Soulcoiler earlier" })).toBeDisabled();
    await user.click(g.getByRole('button', { name: 'Move Sszorak earlier' }));
    expect(g.getByRole('columnheader', { name: /^Sszorak, pull 1/ })).toBeInTheDocument();
    expect(screen.getByText('2 unsaved changes:')).toBeInTheDocument();
    expect(screen.getByText("Sszorak to pull 1 · Nek'zali to pull 2")).toBeInTheDocument();
    await save(user, 'Just Thursday');
    expect(rpcs(client, 'set_raid_night_boss_order')).toEqual([
      {
        p_team_id: 1,
        p_raid_date: '2026-05-14',
        p_encounter_ids: [102, 101, 103],
        p_expected_ids: [101, 102, 103],
        p_every_night: false,
        p_plan: 'mythic'
      }
    ]);
    expect(rpcs(client, 'set_raid_night_lineup')).toEqual([]);
    expect((await screen.findAllByText('Saved the pull order for Thu, May 14.')).length).toBeGreaterThan(0);
  });

  it('lists a section A-Z, then in the team order with new raiders last (#1683)', () => {
    const ids = (order: [number, number][], role: Role = 'Ranged') =>
      inRaiderOrder(
        [3, 5, 7],
        (x) => x,
        new Map(order.map(([id, position]) => [id, { role: 'Ranged' as Role, position }])),
        role
      );
    expect(ids([])).toEqual([3, 5, 7]);
    expect(
      ids([
        [5, 1],
        [3, 2]
      ])
    ).toEqual([5, 3, 7]);
    expect(ids([[7, 1]])).toEqual([7, 3, 5]);
    // A place saved in another role is ignored.
    expect(ids([[7, 1]], 'Melee')).toEqual([3, 5, 7]);
  });

  it('moves a raider by the arrows within their section, saving at once for the team (#1683)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    expect(g.getByRole('button', { name: 'Move Cy up' })).toBeDisabled();
    expect(g.getByRole('button', { name: 'Move Ed down' })).toBeDisabled();
    expect(g.queryByRole('button', { name: /^Sort Ranged A to Z/ })).not.toBeInTheDocument();
    await user.click(g.getByRole('button', { name: 'Move Cy down' }));
    await waitFor(() =>
      expect(rpcs(client, 'set_lineup_raider_order')).toEqual([
        { p_team_id: 1, p_role: 'Ranged', p_player_ids: [5, 3] }
      ])
    );
    // Not part of the lineup's Save.
    expect(screen.queryByText(/^[0-9]+ unsaved changes?:/)).not.toBeInTheDocument();
  });

  it('drags a raider onto another in their section only, with a line where they land (#1683)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    const cy = g.getByRole('rowheader', { name: /Cy/ });
    const ed = g.getByRole('rowheader', { name: /Ed/ });
    const ana = g.getByRole('rowheader', { name: /Ana/ });
    const data = { effectAllowed: '', setData: () => undefined };
    fireEvent.dragStart(cy.querySelector('.blg-raider-box')!, { dataTransfer: data });
    fireEvent.dragOver(ana.closest('tr')!, { dataTransfer: data });
    expect(ana.closest('tr')).not.toHaveAttribute('data-drop');
    fireEvent.dragOver(ed.closest('tr')!, { dataTransfer: data });
    expect(ed.closest('tr')).toHaveAttribute('data-drop', 'after');
    fireEvent.drop(ed.closest('tr')!, { dataTransfer: data });
    await waitFor(() =>
      expect(rpcs(client, 'set_lineup_raider_order')).toEqual([
        { p_team_id: 1, p_role: 'Ranged', p_player_ids: [5, 3] }
      ])
    );
    expect(user).toBeDefined();
  });

  it('shows a section with its own order, and Sort A-Z puts it back (#1683)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      LINEUP,
      handlers(who('officer'), {
        ...PLANNED,
        raiderOrder: [
          { player_id: 5, role: 'Ranged', position: 1 },
          { player_id: 3, role: 'Ranged', position: 2 }
        ]
      })
    );
    const g = await grid();
    const names = g.getAllByRole('rowheader').map((r) => r.textContent ?? '');
    expect(names.findIndex((n) => n.includes('Ed'))).toBeLessThan(names.findIndex((n) => n.includes('Cy')));
    await user.click(g.getByRole('button', { name: 'Sort Ranged A to Z' }));
    await waitFor(() =>
      expect(rpcs(client, 'set_lineup_raider_order')).toEqual([{ p_team_id: 1, p_role: 'Ranged', p_player_ids: [] }])
    );
  });

  it('shows the order to a raider, who cannot change it (#1683)', async () => {
    renderApp(
      LINEUP,
      handlers(who('raider'), {
        ...PLANNED,
        raiderOrder: [
          { player_id: 5, role: 'Ranged', position: 1 },
          { player_id: 3, role: 'Ranged', position: 2 }
        ]
      })
    );
    const g = await grid();
    const names = g.getAllByRole('rowheader').map((r) => r.textContent ?? '');
    expect(names.findIndex((n) => n.includes('Ed'))).toBeLessThan(names.findIndex((n) => n.includes('Cy')));
    expect(g.queryByRole('button', { name: /^Move Cy/ })).not.toBeInTheDocument();
    expect(g.queryByRole('button', { name: /Sort Ranged/ })).not.toBeInTheDocument();
  });

  it('drops an order someone else beat, and says so (#1679)', async () => {
    const user = userEvent.setup();
    renderApp(
      LINEUP,
      handlers(who('officer'), {
        ...PLANNED,
        rpc: (name) =>
          name === 'set_raid_night_boss_order'
            ? { error: { message: 'Someone else changed this night’s pull order since you opened it.' } }
            : undefined
      })
    );
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Move Sszorak earlier' }));
    await save(user, 'Just Thursday');
    expect(
      (await screen.findAllByText('Someone else changed the pull order while you were editing. Theirs is showing now.'))
        .length
    ).toBeGreaterThan(0);
    expect(g.getByRole('columnheader', { name: /^Sszorak, pull 2/ })).toBeInTheDocument();
    expect(screen.queryByText('That did not save.')).not.toBeInTheDocument();
  });

  it('drags a boss onto another, and saves the order for every night after first (#1679)', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    const first = g.getByRole('columnheader', { name: /^Nek'zali the Soulcoiler, pull 1/ });
    const second = g.getByRole('columnheader', { name: /^Sszorak, pull 2/ });
    const data = { effectAllowed: '', setData: () => undefined };
    fireEvent.dragStart(first, { dataTransfer: data });
    fireEvent.dragOver(second, { dataTransfer: data });
    // Moving later: the line marks the far side of the boss it lands on.
    expect(second).toHaveAttribute('data-drop', 'after');
    fireEvent.drop(second, { dataTransfer: data });
    expect(g.getByRole('columnheader', { name: /^Sszorak, pull 1/ })).toBeInTheDocument();

    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: in' }));
    await user.click(screen.getByRole('button', { name: 'Save…' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Save the boss lineup' }));
    expect(dialog.getByText(/The pull order goes on every coming night/)).toBeInTheDocument();
    await user.click(dialog.getByRole('radio', { name: /^Thursday and every night after/ }));
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    await screen.findAllByText(/Saved to the usual groups/);
    const order = client.rpcs.map(([n]) => n).filter((n) => n.startsWith('set_'));
    expect(order).toEqual(['set_raid_night_boss_order', 'set_raid_night_lineup', 'set_boss_group']);
    expect(rpcs(client, 'set_raid_night_boss_order')[0]).toMatchObject({
      p_encounter_ids: [102, 101, 103],
      p_every_night: true,
      p_plan: 'mythic'
    });
  });

  it('skips a boss for the night', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer')));
    await grid();
    await user.click(screen.getByRole('button', { name: 'Skip Sszorak tonight' }));
    expect(rpcs(client, 'set_raid_night_boss_skipped')).toEqual([
      { p_team_id: 1, p_raid_date: '2026-05-14', p_encounter_id: 102, p_skipped: true, p_plan: 'mythic' }
    ]);
  });

  it('keeps unsaved changes while switching raids, and asks before leaving the night', async () => {
    const user = userEvent.setup();
    renderApp(LINEUP, handlers(who('officer')));
    const g = await grid();
    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: in' }));

    await user.click(screen.getByRole('button', { name: /Tidebound Grotto/ }));
    expect(screen.getByRole('button', { name: 'Ana, Nymrissa Wavecaller: in' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /The Venomous Abyss/ }));
    expect(
      screen.getByRole('button', { name: 'Ana, Sszorak: out, changed for tonight only, usually in' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Who’s coming' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Leave without saving?' }));
    expect(dialog.getByText(/You have 1 unsaved change to this night’s boss lineup/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('1 unsaved change:')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Who’s coming' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave and discard' }));
    expect(await screen.findByRole('region', { name: 'Heads up' })).toBeInTheDocument();
  });

  it('fills a night that is not planned yet from the groups', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer'), { groups: PLANNED.groups! }));
    expect(await screen.findByRole('heading', { name: 'This night isn’t planned yet.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Fill from the groups' }));
    expect(rpcs(client, 'plan_raid_night')).toEqual([{ p_team_id: 1, p_raid_date: '2026-05-14' }]);
  });

  it('starts the very first night with everyone in but the bench', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(LINEUP, handlers(who('officer'), {}));
    expect(await screen.findByRole('heading', { name: 'No boss has a usual Mythic group yet.' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start with everyone in' }));
    const g = await grid();
    expect(
      g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: in, changed for tonight only, usually out" })
    ).toBeInTheDocument();
    expect(g.getByRole('button', { name: "Ed, Nek'zali the Soulcoiler: out" })).toBeInTheDocument();

    await save(user, 'Thursday and every night after');
    expect(rpcs(client, 'set_raid_night_lineup')).toHaveLength(3);
    expect(rpcs(client, 'set_boss_group')).toHaveLength(3);
    expect(rpcs(client, 'set_boss_group')[0]).toEqual({
      p_team_id: 1,
      p_encounter_id: 101,
      p_player_ids: [1, 2, 3, 4],
      p_expected_player_ids: [],
      p_picks: [],
      p_expected_picks: [],
      p_plan: 'mythic'
    });
  });
});

// The Boss groups page (#1216, board I)

const abyss = () => lineupRaids(ENCOUNTERS, [], { fresh: true, season: 'S1' })[0]!;

describe('the boss groups rules', () => {
  it('keeps only raiders still on the roster', () => {
    const kept = onRoster(placesOf(places([[101, [1, 2, 99]]])), ROSTER);
    expect([...kept.get(101)!]).toEqual([1, 2]);
  });

  it('marks unsaved cells, the bench, and raiders in no group of the raid', () => {
    const saved = placesOf(
      places([
        [101, [1, 2, 3]],
        [102, [1, 2]]
      ])
    );
    const view = groupsView(ROSTER, abyss(), current(saved, toggle(saved, new Map(), 102, 3)), saved, []);
    const row = (name: string) => view.groups.flatMap((g) => g.rows).find((r) => r.raider.name === name)!;
    expect(row('Cy').cells.map((c) => [c.in, c.changed])).toEqual([
      [true, false],
      [true, true]
    ]);
    expect(row('Di').tag).toBe('In no group');
    expect(row('Ed').tag).toBe('Bench');
    expect(view.unplaced).toEqual(['Di']);
    expect(view.bench).toEqual(['Ed']);
    expect(view.totals.map((t) => t.count)).toEqual([3, 3]);
  });

  it('names someone who left the roster but is still in a group', () => {
    const flame = { name_realm: 'Flame-Illidan', nickname: null };
    const rows: LeaverRow[] = [
      { encounter_id: 101, player_id: 99, player: flame },
      { encounter_id: 102, player_id: 99, player: flame },
      { encounter_id: 103, player_id: 99, player: flame },
      { encounter_id: 101, player_id: 1, player: { name_realm: 'Ana-Illidan', nickname: null } }
    ];
    const view = groupsView(ROSTER, abyss(), new Map(), new Map(), rows);
    // Only this raid's groups count: 103 is in the Grotto.
    expect(view.leavers).toEqual([{ name: 'Flame', bosses: 2 }]);
  });

  it('says what a save changes on coming nights already filled', () => {
    const bosses = abyss().bosses;
    const coming: ComingBossRow[] = [
      { raid_date: '2026-05-19', encounter_id: 101, skipped: false, confirmed_at: null },
      { raid_date: '2026-05-19', encounter_id: 102, skipped: false, confirmed_at: null },
      { raid_date: '2026-05-21', encounter_id: 101, skipped: false, confirmed_at: '2026-05-18T10:00:00Z' },
      { raid_date: '2026-05-21', encounter_id: 102, skipped: true, confirmed_at: null },
      { raid_date: '2026-05-21', encounter_id: 103, skipped: false, confirmed_at: null }
    ];
    expect(comingNights(coming, bosses, [])).toEqual([
      { date: '2026-05-19', text: 'Filled from the groups; nobody has changed it yet.' },
      { date: '2026-05-21', text: "Nek'zali saved for that night; Sszorak skipped. The rest follows the groups." }
    ]);
    expect(comingNights(coming, bosses, [101, 102])).toEqual([
      { date: '2026-05-19', text: "Will follow for Nek'zali and Sszorak." },
      { date: '2026-05-21', text: "Nek'zali stays as saved for that night. Sszorak is skipped that night." }
    ]);
  });
});

const GROUPS = '/g/wga/t/phoenix/officer/groups';
const groupsGrid = async () =>
  within(await screen.findByRole('table', { name: /The Venomous Abyss boss groups, up to 20 per boss/ }));

const GROUPED: Setup = {
  bosses: [nightBoss(101, 1), nightBoss(102, 2, { confirmed_at: '2026-05-13T10:00:00Z' })],
  groups: [
    ...places([
      [101, [1, 2, 3]],
      [102, [1, 2]]
    ]),
    { encounter_id: 101, player_id: 99 }
  ]
};

const STALE_GROUP = 'Someone else changed this group since you opened it. Reload to see their change.';

describe('the boss groups page', () => {
  it('is in the Officer menu, and only for officers', async () => {
    renderApp(GROUPS, handlers(who('raider'), GROUPED));
    expect(await screen.findByText('This page is for officers of Phoenix.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Boss groups' })).not.toBeInTheDocument();
  });

  it('shows a guild Admin on another team the groups with no way to change them (#1703)', async () => {
    const readOnly: Setup = {
      ...GROUPED,
      rpc: (name) => (name === 'my_permissions' ? { data: { team: [], guild: ['view_every_team'] } } : undefined)
    };
    renderApp(GROUPS, handlers(who('raider'), readOnly));
    const g = await groupsGrid();
    expect(g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: in the group" })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save groups' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows the usual groups with the checks and what saving changes', async () => {
    renderApp(GROUPS, handlers(who('officer'), GROUPED));
    const g = await groupsGrid();
    expect(screen.getByRole('link', { name: 'Boss groups' })).toHaveAttribute('aria-current', 'page');
    expect(g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: in the group" })).toBeInTheDocument();
    expect(g.getByRole('button', { name: 'Cy, Sszorak: not in the group' })).toBeInTheDocument();
    expect(g.getByText('In no group')).toBeInTheDocument();
    const look = within(screen.getByRole('region', { name: 'Needs a look' }));
    expect(look.getByText('Di is in no group yet.')).toBeInTheDocument();
    expect(look.getByText(/Ed is on the bench/)).toBeInTheDocument();
    const nights = within(screen.getByRole('region', { name: 'Coming nights' }));
    expect(nights.getByText('Sszorak saved for that night. The rest follows the groups.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Thursday’s lineup ›' })).toHaveAttribute(
      'href',
      '/g/wga/t/phoenix/calendar?date=2026-05-14&view=lineup'
    );
  });

  it('saves the changed groups, leaving out anyone who left the roster', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers(who('officer'), GROUPED));
    const g = await groupsGrid();
    const save = screen.getByRole('button', { name: 'Save groups' });
    expect(save).toBeDisabled();
    await user.click(g.getByRole('button', { name: 'Di, Sszorak: not in the group' }));
    expect(g.getByRole('button', { name: 'Di, Sszorak: in the group, not saved yet' })).toBeInTheDocument();
    expect(screen.getByText('1 unsaved change.')).toBeInTheDocument();
    const nights = within(screen.getByRole('region', { name: 'Coming nights' }));
    expect(nights.getByText('Sszorak stays as saved for that night.')).toBeInTheDocument();
    await user.click(g.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: in the group" }));
    await user.click(save);

    expect(rpcs(client, 'set_boss_group')).toEqual([
      {
        p_team_id: 1,
        p_encounter_id: 102,
        p_player_ids: [1, 2, 4],
        p_expected_player_ids: [1, 2],
        p_picks: [],
        p_expected_picks: [],
        p_plan: 'mythic'
      },
      {
        p_team_id: 1,
        p_encounter_id: 101,
        p_player_ids: [1, 3],
        p_expected_player_ids: [1, 2, 3, 99],
        p_picks: [],
        p_expected_picks: [],
        p_plan: 'mythic'
      }
    ]);
    expect((await screen.findAllByText(/^Saved the boss groups\./)).length).toBeGreaterThan(0);
  });

  it('says which group was held back when someone else saved it first', async () => {
    const user = userEvent.setup();
    renderApp(
      GROUPS,
      handlers(who('officer'), {
        ...GROUPED,
        rpc: (name) => (name === 'set_boss_group' ? { error: { message: STALE_GROUP } } : undefined)
      })
    );
    const g = await groupsGrid();
    await user.click(g.getByRole('button', { name: 'Di, Sszorak: not in the group' }));
    await user.click(screen.getByRole('button', { name: 'Save groups' }));
    expect(await screen.findByText('Sszorak wasn’t saved.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show their version' }));
    expect(g.getByRole('button', { name: 'Di, Sszorak: not in the group' })).toBeInTheDocument();
  });

  it('asks before leaving with unsaved changes', async () => {
    const user = userEvent.setup();
    renderApp(GROUPS, handlers(who('officer'), GROUPED));
    const g = await groupsGrid();
    await user.click(g.getByRole('button', { name: 'Di, Sszorak: not in the group' }));
    await user.click(screen.getByRole('link', { name: 'Roster' }));
    expect(await screen.findByRole('dialog', { name: 'Leave without saving?' })).toHaveTextContent(
      'You have 1 unsaved change to the boss groups.'
    );
  });

  it('shows the team’s own role targets, defaulting to 2 tanks and 4 healers, and lets an officer change them', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers(who('officer'), GROUPED));
    await groupsGrid();
    expect(screen.getByText('Role targets: 2 tanks · 4 healers')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Role targets' }));
    await user.clear(dialog.getByLabelText('Tanks wanted'));
    await user.type(dialog.getByLabelText('Tanks wanted'), '3');
    await user.clear(dialog.getByLabelText('Healers wanted'));
    await user.type(dialog.getByLabelText('Healers wanted'), '5');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(rpcs(client, 'set_lineup_role_targets')).toEqual([{ p_team_id: 1, p_tanks: 3, p_healers: 5 }]);
    expect(await screen.findByText('Role targets saved: 3 tanks and 5 healers.')).toBeInTheDocument();
  });

  it('reads a team’s own saved role targets', async () => {
    renderApp(GROUPS, handlers(who('officer'), { ...GROUPED, targets: { tanks_wanted: 3, healers_wanted: 6 } }));
    await groupsGrid();
    expect(await screen.findByText('Role targets: 3 tanks · 6 healers')).toBeInTheDocument();
  });

  it.each([
    ['a team officer', who('officer')],
    ['a guild officer', { ...who('officer'), guild_officer: true }]
  ])('offers no cap edit to %s, only to a site admin', async (_, person) => {
    renderApp(GROUPS, handlers(person, GROUPED));
    await groupsGrid();
    expect(screen.queryByRole('button', { name: 'Edit cap' })).not.toBeInTheDocument();
  });

  it('lets a site admin set a boss’s cap, for every team', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers({ ...who('officer'), site_admin: true }, GROUPED));
    const g = await groupsGrid();
    await user.click(
      within(g.getByRole('columnheader', { name: /Sszorak/ })).getByRole('button', { name: 'Edit cap' })
    );
    const dialog = within(await screen.findByRole('dialog', { name: 'Sszorak’s cap' }));
    expect(dialog.getByLabelText('Cap for this boss')).toHaveValue(null);
    await user.type(dialog.getByLabelText('Cap for this boss'), '25');
    await user.click(dialog.getByRole('button', { name: 'Save' }));
    expect(rpcs(client, 'set_encounter_cap')).toEqual([{ p_encounter_id: 102, p_cap: 25 }]);
    expect(await screen.findByText('Sszorak’s cap is set to 25, for every team.')).toBeInTheDocument();
  });
});

describe('the boss lineup, after someone leaves the roster', () => {
  it('leaves them out of a night’s save', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(
      LINEUP,
      handlers(who('officer'), { ...PLANNED, tonight: [...PLANNED.tonight!, { encounter_id: 101, player_id: 99 }] })
    );
    const g = await grid();
    await user.click(g.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: in" }));
    await save(user, 'Just Thursday');
    expect(rpcs(client, 'set_raid_night_lineup')).toEqual([
      {
        p_team_id: 1,
        p_raid_date: '2026-05-14',
        p_encounter_id: 101,
        p_player_ids: [1, 3],
        p_expected_player_ids: [1, 2, 3, 99],
        p_picks: [],
        p_expected_picks: [],
        p_plan: 'mythic'
      }
    ]);
  });
});

describe('the boss groups page, before any group is set', () => {
  it('starts with everyone in but the bench, and saves every boss', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers(who('officer'), {}));
    expect(
      await screen.findByRole('heading', { name: 'No boss in The Venomous Abyss has a usual Mythic group yet.' })
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start with everyone in' }));
    const g = await groupsGrid();
    expect(g.getByRole('button', { name: 'Di, Sszorak: in the group, not saved yet' })).toBeInTheDocument();
    expect(g.getByRole('button', { name: 'Ed, Sszorak: not in the group' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save groups' }));
    expect(rpcs(client, 'set_boss_group')).toEqual([
      {
        p_team_id: 1,
        p_encounter_id: 101,
        p_player_ids: [1, 2, 3, 4],
        p_expected_player_ids: [],
        p_picks: [],
        p_expected_picks: [],
        p_plan: 'mythic'
      },
      {
        p_team_id: 1,
        p_encounter_id: 102,
        p_player_ids: [1, 2, 3, 4],
        p_expected_player_ids: [],
        p_picks: [],
        p_expected_picks: [],
        p_plan: 'mythic'
      }
    ]);
  });
});

// A raider's own bosses (#1216, boards C and D)

describe('your bosses tonight', () => {
  const raids = (bosses: NightBossRow[]) => lineupRaids(ENCOUNTERS, bosses, { fresh: false, season: null });
  const saved = { confirmed_at: '2026-05-13T10:00:00Z' };

  it('says which bosses a raider sits out', () => {
    const card = yourBosses(
      raids([nightBoss(101, 1, saved), nightBoss(102, 2, saved), nightBoss(103, 3, saved)]),
      placesOf(
        places([
          [101, [1, 2]],
          [102, [2]],
          [103, [1, 2]]
        ])
      ),
      ROSTER[0]!
    )!;
    expect(card.summary).toBe('In for 2 of 3 bosses. You sit out Sszorak.');
    expect(card.tiles.map((t) => [t.n, t.in])).toEqual([
      [1, true],
      [2, false],
      [3, true]
    ]);
    expect(card.notFinal).toBeNull();
  });

  it('says what to bring where it is not their main in its usual spec (#1580)', () => {
    const bo = ROSTER[1]!;
    const card = yourBosses(
      raids([nightBoss(101, 1, saved), nightBoss(102, 2, saved), nightBoss(103, 3, saved)]),
      placesOf(
        places([
          [101, [2]],
          [102, [2]],
          [103, [2]]
        ])
      ),
      bo,
      picksOf([
        { encounter_id: 102, player_id: 2, character_id: null, class_spec_id: 2 },
        { encounter_id: 103, player_id: 2, character_id: BOSHAM.id, class_spec_id: null }
      ]),
      LOOK
    )!;
    expect(card.tiles.map((t) => t.play)).toEqual([null, 'Shadow', 'Your Restoration Shaman (Bosham)']);
  });

  it('marks a night filled from the groups as not final, boss by boss', () => {
    const all = places([
      [101, [1]],
      [102, [1]]
    ]);
    expect(yourBosses(raids([nightBoss(101, 1), nightBoss(102, 2)]), placesOf(all), ROSTER[0]!)!.notFinal).toBe(
      'From the usual groups; your officers haven’t finalized it yet.'
    );
    const card = yourBosses(raids([nightBoss(101, 1, saved), nightBoss(102, 2)]), placesOf(all), ROSTER[0]!)!;
    expect(card.summary).toBe('In for all 2 bosses.');
    expect(card.notFinal).toBe('Sszorak is from the usual groups and not final yet.');
    const mostlyUnsaved = yourBosses(
      raids([nightBoss(101, 1, saved), nightBoss(102, 2), nightBoss(103, 3)]),
      placesOf(all),
      ROSTER[0]!
    )!;
    expect(mostlyUnsaved.notFinal).toBe("Nek'zali is final; the rest are from the usual groups and not final yet.");
  });

  it('leaves skipped bosses off, tells the bench, and shows nothing on a night with no lineup', () => {
    const bench = ROSTER[4]!;
    const card = yourBosses(raids([nightBoss(101, 1, saved), nightBoss(102, 2, { skipped: true })]), new Map(), bench)!;
    expect(card.tiles.map((t) => t.name)).toEqual(["Nek'zali the Soulcoiler"]);
    expect(card.summary).toBe('You’re on the bench, so you’re out for every boss unless your officers put you in.');
    expect(yourBosses(raids([]), new Map(), bench)).toBeNull();
  });
});

describe('the night page for a raider', () => {
  const NIGHT_PAGE = '/g/wga/t/phoenix/calendar?date=2026-05-14';

  it('shows their bosses, and a sit-out is not in Heads up', async () => {
    renderApp(
      NIGHT_PAGE,
      handlers(who('raider'), {
        ...PLANNED,
        tonight: places([
          [101, [1, 2, 3]],
          [102, [2]],
          [103, [1, 2, 3, 4]]
        ])
      })
    );
    const cards = await screen.findAllByRole('region', { name: 'Your bosses tonight' });
    const card = within(cards[0]!);
    expect(card.getByText('In for 2 of 3 bosses. You sit out Sszorak.')).toBeInTheDocument();
    expect(card.getByText('Not final yet')).toBeInTheDocument();
    expect(card.getByText('From the usual groups; your officers haven’t finalized it yet.')).toBeInTheDocument();
    const headsUp = within(screen.getByRole('region', { name: 'Heads up' }));
    expect(headsUp.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('shows no card on a night with no boss lineup', async () => {
    renderApp(NIGHT_PAGE, handlers(who('raider'), {}));
    expect(await screen.findByRole('region', { name: 'Heads up' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Your bosses tonight' })).not.toBeInTheDocument();
  });
});

describe('a Heroic plan and a Mythic plan (#1688)', () => {
  const TWO_PLANS: Setup = {
    ...GROUPED,
    groups: [...(GROUPED.groups ?? []), ...heroic(places([[101, [1, 4]]]))]
  };

  it('switches Boss groups to the Heroic plan, 10 to 30 a boss, and saves it there', async () => {
    const user = userEvent.setup();
    const { client } = renderApp(GROUPS, handlers(who('officer'), TWO_PLANS));
    await groupsGrid();
    expect(screen.getByRole('radio', { name: 'Mythic (team default)' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Heroic (Normal too)' }));
    const g = within(
      await screen.findByRole('table', { name: /The Venomous Abyss boss groups, up to 10-30 per boss/ })
    );
    expect(g.getByRole('button', { name: "Di, Nek'zali the Soulcoiler: in the group" })).toBeInTheDocument();
    expect(g.getByRole('button', { name: "Bo, Nek'zali the Soulcoiler: not in the group" })).toBeInTheDocument();
    await user.click(g.getByRole('button', { name: 'Ana, Sszorak: not in the group' }));
    // Switching now would drop the change.
    expect(screen.getByRole('radio', { name: 'Mythic (team default)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Save groups' }));
    expect(rpcs(client, 'set_boss_group')).toEqual([
      expect.objectContaining({ p_encounter_id: 102, p_player_ids: [1], p_plan: 'heroic' })
    ]);
  });

  it('shows a Heroic into Mythic night one half at a time, Heroic first, and saves each to its own half', async () => {
    const user = userEvent.setup();
    const setup: Setup = {
      ...PLANNED,
      difficulty: 'heroic_into_mythic',
      bosses: [...(PLANNED.bosses ?? []), ...heroic([nightBoss(101, 1)])],
      tonight: [...(PLANNED.tonight ?? []), ...heroic(places([[101, [4]]]))]
    };
    const { client } = renderApp(LINEUP, handlers(who('officer'), setup));
    let g = await grid();
    expect(screen.getByRole('radio', { name: 'Heroic' })).toBeChecked();
    expect(g.getByRole('button', { name: /^Di, Nek'zali the Soulcoiler: in/ })).toBeInTheDocument();
    expect(g.queryByText('Sszorak')).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Mythic' }));
    g = await grid();
    expect(g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: in" })).toBeInTheDocument();
    await user.click(g.getByRole('button', { name: "Ana, Nek'zali the Soulcoiler: in" }));
    expect(screen.getByRole('radio', { name: 'Heroic' })).toBeDisabled();
    await save(user, 'Just Thursday');
    expect(rpcs(client, 'set_raid_night_lineup')).toEqual([
      expect.objectContaining({ p_encounter_id: 101, p_player_ids: [2, 3], p_plan: 'mythic' })
    ]);
  });

  it('shows no switch on a night with one difficulty', async () => {
    renderApp(LINEUP, handlers(who('officer')));
    await grid();
    expect(screen.queryByRole('group', { name: 'Lineup' })).not.toBeInTheDocument();
  });

  it('counts Heroic from 10 to 30 on every boss, a boss of its own cap or not', () => {
    const raids = lineupRaids(FLEX_ENCOUNTERS, [], { fresh: true, season: 'S1', plan: 'heroic' });
    expect(raids.map((r) => capLabel(r.bosses))).toEqual(['10-30 per boss', '10-30 per boss']);
    const mythic = lineupRaids(FLEX_ENCOUNTERS, [], { fresh: true, season: 'S1' });
    expect(mythic.map((r) => capLabel(r.bosses))).toEqual(['20-25 per boss', '25 per boss']);
    expect(capStatus(8, 30, 10)).toEqual({ text: '2 open spots', tone: 'warn' });
    expect(capStatus(26, 30, 10).tone).toBe('room');
    expect(capStatus(31, 30, 10)).toEqual({ text: '1 over', tone: 'bad' });
  });
});
