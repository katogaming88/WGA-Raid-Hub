import { describe, expect, it } from 'vitest';
import {
  auditRaider,
  bestKills,
  crestProgress,
  killCounts,
  seasonBestKeys,
  enchantCell,
  enchantColumns,
  gemChips,
  gemColumns,
  lowGemCount,
  upgradeFigures,
  belowVaultRule,
  gearCheck,
  groupRaiders,
  needsAttention,
  vaultFilled,
  vaultView,
  weekBefore,
  weekOf,
  type AuditRaider,
  type GearItem,
  type SeasonRefs,
  type Vault,
  type VaultSlot,
  type WeekRow
} from './audit';

const REFS: SeasonRefs = {
  slots: [
    { slot: 'HEAD', counts_from: null },
    { slot: 'FINGER_1', counts_from: null },
    { slot: 'OFF_HAND', counts_from: null },
    { slot: 'FEET', counts_from: '2026-12-01' }
  ],
  enchants: new Map([
    [7959, { name: 'Hex of Leeching', top_rank: true, tertiary: true }], // head, Leech, top rank
    [7958, { name: 'Hex of Leeching', top_rank: false, tertiary: true }], // head, Leech, lower rank
    [7964, { name: 'Amani Mastery', top_rank: false, tertiary: false }], // ring, lower rank
    [7965, { name: 'Amani Mastery', top_rank: true, tertiary: false }]
  ]),
  gems: new Map([
    [1, { name: 'Eversong Diamond', top_rank: true, epic: true }],
    [2, { name: 'Flawless Garnet', top_rank: false, epic: false }]
  ])
};

const piece = (slot: string, over: Partial<GearItem> = {}): GearItem => ({
  player_id: 1,
  equipment_slot: slot,
  item_level: 720,
  wow_item_id: 1000 + slot.length,
  track: 'Hero',
  enchantment_id: null,
  gem_wow_item_ids: [],
  embellished: false,
  crafted: false,
  upgrade_rank: 4,
  upgrade_max: 6,
  synced_at: '2026-11-15T10:00:00Z',
  ...over
});

const check = (gear: GearItem[], rule: 'strict' | 'lenient' | 'casual' = 'lenient', weaponOffHand = false) =>
  gearCheck(gear, REFS, rule, '2026-11-15', weaponOffHand);

describe('gearCheck: enchants', () => {
  it('flags a slot with no enchant and counts what is enchanted', () => {
    const c = check([piece('HEAD'), piece('FINGER_1', { enchantment_id: 7965 })]);
    expect(c.enchantable).toBe(2);
    expect(c.enchanted).toBe(1);
    expect(c.problems).toMatchObject([{ slot: 'HEAD', kind: 'enchant', problem: 'No enchant', issue: true }]);
  });

  it('treats an enchant not on the season list as old', () => {
    const c = check([piece('HEAD', { enchantment_id: 9999 })]);
    expect(c.enchanted).toBe(0);
    expect(c.problems[0]?.problem).toBe('Enchant from an old expansion');
  });

  it('Lenient takes a tertiary enchant at any rank; Strict and Lenient want top rank elsewhere', () => {
    const lowLeech = [piece('HEAD', { enchantment_id: 7958 })];
    expect(check(lowLeech, 'lenient').enchanted).toBe(1);
    expect(check(lowLeech, 'strict').enchanted).toBe(0);
    const lowRing = [piece('FINGER_1', { enchantment_id: 7964 })];
    expect(check(lowRing, 'lenient').enchanted).toBe(0);
    expect(check(lowRing, 'casual').enchanted).toBe(1);
  });

  it('skips a slot that does not count yet, and an off hand that is not a weapon', () => {
    const gear = [piece('FEET'), piece('OFF_HAND')];
    expect(check(gear).enchantable).toBe(0);
    expect(check(gear, 'lenient', true).enchantable).toBe(1);
  });

  it('ignores an empty slot (no item to enchant)', () => {
    expect(check([piece('HEAD', { wow_item_id: null })]).enchantable).toBe(0);
  });
});

describe('gearCheck: gear not read yet', () => {
  it('flags nothing for rows from before the gear sync saved slot details', () => {
    const bare = [
      piece('HEAD', { upgrade_rank: null, upgrade_max: null }),
      piece('FINGER_1', { upgrade_rank: null, upgrade_max: null })
    ];
    const c = check(bare);
    expect(c.read).toBe(false);
    expect([c.enchantable, c.sockets, c.noEpicGem, c.problems]).toEqual([0, 0, null, []]);
  });
});

describe('gearCheck: gems and information', () => {
  it('flags empty sockets and the missing epic gem', () => {
    const c = check([piece('HEAD', { enchantment_id: 7959, gem_wow_item_ids: [2, null] })]);
    expect(c.sockets).toBe(2);
    expect(c.filledSockets).toBe(1);
    expect(c.noEpicGem).toBe(true);
    expect(c.problems.filter((p) => p.kind === 'socket')).toHaveLength(1);
  });

  it('an epic gem anywhere clears the flag; no sockets at all is not applicable', () => {
    expect(check([piece('HEAD', { gem_wow_item_ids: [1] })]).noEpicGem).toBe(false);
    expect(check([piece('HEAD')]).noEpicGem).toBeNull();
  });

  it('a low-quality or old gem is listed but never an issue', () => {
    const c = check([piece('HEAD', { enchantment_id: 7959, gem_wow_item_ids: [2, 77] })], 'strict');
    expect(c.problems.map((p) => [p.problem, p.issue])).toEqual([
      ['Gem is not the highest rank', false],
      ['Gem from an old expansion', false]
    ]);
  });

  it('embellishments and sparks are counted, never issues', () => {
    const c = check([piece('HEAD', { embellished: true, crafted: true, enchantment_id: 7959 })]);
    expect([c.embellishments, c.sparks]).toEqual([1, 1]);
    expect(c.problems).toEqual([]);
  });
});

describe('weeks', () => {
  it('a week starts at the Tuesday 15:00 UTC reset', () => {
    expect(weekOf(new Date('2026-11-10T14:59:00Z'))).toBe('2026-11-03');
    expect(weekOf(new Date('2026-11-10T15:00:00Z'))).toBe('2026-11-10');
    expect(weekOf(new Date('2026-11-15T12:00:00Z'))).toBe('2026-11-10');
    expect(weekBefore('2026-11-10')).toBe('2026-11-03');
  });
});

const slot = (needs: number, done: number, level?: number, track = 'Hero'): VaultSlot =>
  level ? { needs, done, track, rank: 1, item_level: level } : { needs, done, left: needs - done };

describe('the Great Vault', () => {
  const vault: Vault = {
    raid: [slot(2, 8, 730, 'Myth'), slot(4, 8, 723), slot(6, 8, 723)],
    dungeon: [slot(1, 1, 727, 'Myth'), slot(4, 1), slot(8, 1)],
    world: null
  };
  it('counts filled slots and the best level per row; a null row is unknown', () => {
    expect(vaultView(vault, 'raid')).toMatchObject({ filled: 3, best: 730 });
    expect(vaultView(vault, 'dungeon')).toMatchObject({ filled: 1, best: 727 });
    expect(vaultView(vault, 'world')).toEqual({ slots: null, filled: 0, best: null });
    expect(vaultFilled(vault)).toBe(4);
  });

  it('the team rule fails only rows that were read and fell short', () => {
    expect(belowVaultRule(vault, { raid: 3, dungeon: 2, world: 3 })).toEqual(['dungeon']);
    expect(belowVaultRule(vault, null)).toEqual([]);
    expect(belowVaultRule(vault, { raid: 0, dungeon: 0, world: 0 })).toEqual([]);
  });
});

const week = (over: Partial<WeekRow> = {}): WeekRow => ({
  name_realm_key: 'katorri-stormrage',
  week_of: '2026-11-10',
  raid_kills: [],
  raids_at: null,
  mplus_runs: [],
  mplus_rating: 2865,
  mplus_at: '2026-11-15T10:00:00Z',
  crests: {},
  crests_at: null,
  vault: {},
  vault_at: null,
  item_level: 688,
  best_item_level: 721,
  gear_at: null,
  ...over
});

const raiderOf = (
  over: { gear?: GearItem[]; weeks?: WeekRow[]; now?: Date; role?: string; cls?: string; name?: string } = {}
) =>
  auditRaider({
    player: {
      id: 1,
      name_realm: `${over.name ?? 'Katorri'}-Stormrage`,
      name_realm_key: 'katorri-stormrage',
      url_code: 'kator01',
      classes_specs: { class: over.cls ?? 'Warlock', spec: 'Demonology', role: over.role ?? 'Ranged' }
    },
    gear: over.gear ?? [piece('HEAD', { enchantment_id: 7959 })],
    weeks: over.weeks ?? [week()],
    refs: REFS,
    rule: 'lenient',
    vaultRule: null,
    tierItems: new Set([1004]),
    weaponIds: new Set(),
    which: 'this',
    thisWeek: '2026-11-10',
    now: over.now ?? new Date('2026-11-15T12:00:00Z')
  });

describe('auditRaider', () => {
  it('shows the highest item level ever, with the worn one apart', () => {
    const r = raiderOf();
    expect(r.highestIlvl).toBe(721);
    expect(r.rating).toBe(2865);
  });

  it('marks tier pieces by the track they are on', () => {
    const r = raiderOf({ gear: [piece('HEAD', { enchantment_id: 7959, wow_item_id: 1004, track: 'Myth' })] });
    expect(r.tier.find((t) => t.slot === 'HEAD')?.letter).toBe('M');
    expect(r.tier.find((t) => t.slot === 'CHEST')?.letter).toBe('');
  });

  it('issues add enchants, sockets, the epic gem and the vault rule; not embellishments', () => {
    const r = raiderOf({
      gear: [piece('HEAD', { embellished: true, gem_wow_item_ids: [2, null] })]
    });
    // no enchant (1) + empty socket (1) + no epic gem (1)
    expect(r.issues).toBe(3);
  });

  it('is stale when nothing was written for a day', () => {
    expect(raiderOf().stale).toBe(false);
    expect(raiderOf({ now: new Date('2026-11-17T12:00:00Z') }).stale).toBe(true);
    expect(raiderOf({ gear: [], weeks: [] }).stale).toBe(true);
  });
});

describe('groups and Needs attention', () => {
  const raiders: AuditRaider[] = [
    raiderOf({ name: 'Aur', role: 'Tank', cls: 'Warrior', gear: [piece('HEAD', { enchantment_id: 7959 })] }),
    raiderOf({ name: 'Bel', role: 'Heal', cls: 'Priest', gear: [piece('HEAD')] }),
    raiderOf({
      name: 'Cor',
      role: 'Heal',
      cls: 'Priest',
      gear: [piece('HEAD', { enchantment_id: 7959, gem_wow_item_ids: [null, 1] })]
    })
  ];

  it('groups by role in role order with each group average and how many need a look', () => {
    const groups = groupRaiders(raiders, 'role', 'highest');
    expect(groups.map((g) => [g.label, g.raiders.length, g.avg, g.needLook])).toEqual([
      ['Tanks', 1, 721, 0],
      ['Healers', 2, 721, 2]
    ]);
  });

  it('groups by armor, class or not at all', () => {
    expect(groupRaiders(raiders, 'armor', 'highest').map((g) => g.label)).toEqual(['Cloth', 'Plate']);
    expect(groupRaiders(raiders, 'class', 'highest').map((g) => g.label)).toEqual(['Priest', 'Warrior']);
    expect(groupRaiders(raiders, 'none', 'highest')).toHaveLength(1);
  });

  it('lists each problem with who, and the vault line only when the team has a rule', () => {
    const items = needsAttention(raiders, false);
    expect(items.map((a) => a.id)).toEqual(['enchants', 'sockets']);
    expect(items[0]).toMatchObject({ count: 1, who: ['Bel'] });
    expect(items[1]).toMatchObject({ count: 1, who: ['Cor'] });
    expect(needsAttention(raiders, true).some((a) => a.id === 'vault')).toBe(false);
  });
});

describe('the Gear, Upgrades and Enchants & gems tabs', () => {
  it('counts items per track and the steps left, ignoring crafted pieces', () => {
    const r = raiderOf({
      gear: [
        piece('HEAD', { track: 'Myth', upgrade_rank: 4, upgrade_max: 6 }),
        piece('NECK', { track: 'Hero', upgrade_rank: 6, upgrade_max: 6 }),
        piece('BACK', { track: 'Hero', upgrade_rank: 1, upgrade_max: 6 }),
        piece('WRIST', { track: null, upgrade_rank: null, upgrade_max: null, crafted: true })
      ]
    });
    expect(upgradeFigures(r)).toEqual({ myth: 1, hero: 2, champion: 0, stepsLeft: 7 });
  });

  it('a Myth 9 of 6 piece has no steps left, never a negative', () => {
    const r = raiderOf({ gear: [piece('HEAD', { track: 'Myth', upgrade_rank: 9, upgrade_max: 6 })] });
    expect(upgradeFigures(r).stepsLeft).toBe(0);
  });

  it('enchant columns come from the season settings, in slot order, less any not counting yet', () => {
    expect(enchantColumns(REFS, '2026-11-15')).toEqual(['OFF_HAND', 'HEAD', 'FINGER_1']);
    expect(enchantColumns(REFS, '2026-12-01')).toEqual(['OFF_HAND', 'HEAD', 'FEET', 'FINGER_1']);
  });

  it('gem columns: neck and rings always, other slots only when someone has a socket there', () => {
    const none = [raiderOf({ gear: [piece('HEAD')] })];
    expect(gemColumns(none)).toEqual(['NECK', 'FINGER_1', 'FINGER_2']);
    const wrist = [raiderOf({ gear: [piece('WRIST', { gem_wow_item_ids: [1] })] })];
    expect(gemColumns(wrist)).toEqual(['NECK', 'WRIST', 'FINGER_1', 'FINGER_2']);
  });

  it('one chip per socket: top, low, old or empty', () => {
    const chips = gemChips(piece('NECK', { gem_wow_item_ids: [1, 2, 77, null] }), REFS);
    expect(chips.map((c) => c.kind)).toEqual(['top', 'low', 'old', 'empty']);
    expect(gemChips(null, REFS)).toEqual([]);
  });

  it('an enchant cell names the enchant and its rank, None, or an old one; nothing for an empty slot', () => {
    expect(enchantCell(piece('HEAD', { enchantment_id: 7959 }), REFS)).toEqual({
      name: 'Hex of Leeching',
      rank: 'Highest rank',
      kind: 'ok'
    });
    expect(enchantCell(piece('HEAD', { enchantment_id: 7958 }), REFS)?.rank).toBe('Lower rank');
    expect(enchantCell(piece('HEAD'), REFS)?.kind).toBe('none');
    expect(enchantCell(piece('HEAD', { enchantment_id: 9999 }), REFS)?.kind).toBe('old');
    expect(enchantCell(piece('HEAD', { wow_item_id: null }), REFS)).toBeNull();
    expect(enchantCell(null, REFS)).toBeNull();
  });

  it('low quality counts lower-rank and old gems, never empty sockets', () => {
    const r = raiderOf({
      gear: [piece('NECK', { gem_wow_item_ids: [1, 2, null] }), piece('FINGER_1', { gem_wow_item_ids: [77] })]
    });
    expect(lowGemCount(r, REFS)).toBe(2);
  });
});

describe('the Raids, Dungeons and Crests tabs', () => {
  const kill = (encounter_id: number, difficulty: string) => ({ encounter_id, difficulty });

  it('keeps the highest of Normal, Heroic and Mythic per boss across weeks, and leaves Raid Finder out', () => {
    const best = bestKills([
      { raid_kills: [kill(1, 'heroic'), kill(2, 'lfr'), kill(3, 'normal')] },
      { raid_kills: [kill(1, 'mythic'), kill(3, 'heroic')] }
    ]);
    expect([...best.entries()]).toEqual([
      [1, 'mythic'],
      [3, 'heroic']
    ]);
  });

  it('counts bosses killed on each difficulty, a Mythic kill never counting as a Heroic one', () => {
    const weeks = [
      { raid_kills: [kill(1, 'mythic'), kill(2, 'heroic'), kill(3, 'normal'), kill(9, 'heroic')] },
      { raid_kills: [kill(2, 'heroic'), kill(1, 'heroic')] }
    ];
    // Boss 9 is not one of the season's bosses; boss 2's second Heroic kill counts once.
    expect(killCounts(weeks, [1, 2, 3, 4])).toEqual({ normal: 1, heroic: 2, mythic: 1 });
  });

  it('the best key in each dungeon across the season, preferring one in time at the same level', () => {
    const run = (dungeon_id: number, level: number, timed: boolean) => ({ dungeon_id, level, timed });
    const week = (runs: ReturnType<typeof run>[]) => ({
      name_realm_key: 'k',
      week_of: '2026-11-03',
      raid_kills: [],
      mplus_runs: runs
    });
    const best = seasonBestKeys([
      week([run(1, 12, false), run(2, 9, true)]),
      week([run(1, 12, true), run(1, 11, true)])
    ]);
    expect(best.get(1)).toEqual({ level: 12, timed: true });
    expect(best.get(2)).toEqual({ level: 9, timed: true });
    expect(best.get(3)).toBeUndefined();
  });

  it('crest progress: a count against the cap, Capped when full, the total when uncapped', () => {
    expect(crestProgress(640, 800)).toEqual({ kind: 'open', earned: 640, pct: 80 });
    expect(crestProgress(800, 800).kind).toBe('capped');
    expect(crestProgress(900, 800).kind).toBe('capped');
    expect(crestProgress(564, null)).toEqual({ kind: 'uncapped', earned: 564, pct: 0 });
  });
});
