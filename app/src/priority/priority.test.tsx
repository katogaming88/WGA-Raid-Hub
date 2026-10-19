import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from '../test/renderApp';
import { fakeSession, seededHandlers, type Read } from '../test/fakeSupabase';
import type { CatalogItem } from '../profile/lootPriority';
import type { PlayerRow } from '../roster/roster';
import {
  applySuggestion,
  blocked,
  bossOptions,
  committedScores,
  contestedItems,
  exportString,
  flaggedItemIds,
  firstCounts,
  itemFor,
  outOf100,
  owned,
  parseOutOf100,
  pending,
  poolFor,
  unmanagedItems,
  wasRank,
  gearStatus,
  priorityItems,
  rankedRows,
  sections,
  showOutOf100,
  sidegradeNames,
  sortScores,
  splitNameRealm,
  wishlistNotes,
  tierPiecesEquipped,
  type PriorityData
} from './priority';

// Loot priority (#1362 part 1), from a fixture season: two Back pieces, a
// neck, a ring saved with nobody on it, and a tier piece and an older raid's
// item that must stay off the list.

const item = (id: number, name: string, slot: string, zone = 100, extra: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  name,
  slot,
  wcl_zone_id: zone,
  is_placeholder: false,
  source: 'raid',
  seasons: [],
  ...extra
});

const CATALOG = [
  item(1, 'Silken Voodoo Drape', 'Back'),
  item(2, 'Drape of the Dreadful Rite', 'Back'),
  item(3, 'Amulet of the Twin Fangs', 'Neck'),
  item(4, "Vile Alchemist's Band", 'Finger'),
  item(6, 'Voidwoven Mantle', 'Shoulder'),
  item(7, 'Old Raid Cloak', 'Back', 200),
  item(8, 'M+', 'Placeholder', 100, { is_placeholder: true })
];
const ZONES = [
  { wcl_zone_id: 100, season: 'MID2' },
  { wcl_zone_id: 200, season: 'MID1' }
];

const player = (
  id: number,
  nameRealm: string,
  klass: string,
  spec: string,
  role: string,
  nickname: string | null = null
) =>
  ({
    id,
    name_realm: nameRealm,
    nickname,
    is_trial: false,
    is_bench: false,
    is_rotator: false,
    tier_pieces_equipped: null,
    classes_specs: { class: klass, spec, role }
  }) satisfies PlayerRow;

const PLAYERS = [
  player(10, 'Katorrí-Stormrage', 'Warlock', 'Demonology', 'Ranged'),
  player(11, 'Bbldrizzy-Nazjatar', 'Druid', 'Restoration', 'Heal'),
  player(12, 'Angryamazon-Wyrmrest Accord', 'Hunter', 'Marksmanship', 'Ranged', 'Amazon')
];

const order = (item_id: number, track: string, rank: number, player_id: number, name_realm: string) => ({
  item_id,
  track,
  rank,
  player_id,
  players: { name_realm }
});

const DATA: PriorityData = {
  order: [
    // Stored out of rank order on purpose.
    order(1, 'Hero', 2, 11, 'Bbldrizzy-Nazjatar'),
    order(1, 'Hero', 1, 10, 'Katorrí-Stormrage'),
    order(1, 'Hero', 3, 99, 'Gone-Stormrage'),
    order(1, 'Myth', 1, 11, 'Bbldrizzy-Nazjatar'),
    order(3, 'Hero', 1, 12, 'Angryamazon-Wyrmrest Accord'),
    order(6, 'Hero', 1, 10, 'Katorrí-Stormrage'),
    order(7, 'Hero', 1, 10, 'Katorrí-Stormrage')
  ],
  empty: [{ item_id: 4, track: 'Hero' }],
  prefs: [
    { player_id: 10, item_id: 1, status: 'bis' },
    { player_id: 11, item_id: 1, status: 'pass' },
    { player_id: 11, item_id: 1, status: 'ok' },
    { player_id: 10, item_id: 3, status: 'bis' },
    { player_id: 12, item_id: 3, status: 'ok' }
  ],
  loot: [
    // Katorrí already won the drape on Heroic; Bbldrizzy won the other Back.
    { player_id: 10, item_id: 1, track: 'Hero', response: 'BiS' },
    { player_id: 11, item_id: 2, track: 'Hero', response: 'Upgrade' },
    // An off-spec roll is not an award for the main spec.
    { player_id: 12, item_id: 2, track: 'Hero', response: 'OS' }
  ],
  bosses: [
    { item_id: 1, boss: 'The Coiled Altar' },
    { item_id: 3, boss: 'The Twin Fangs' },
    { item_id: 4, boss: 'Vashnik the Malignant' }
  ],
  tierPieces: [{ class: 'Warlock', resolved_item_id: 6, resolved: { wow_item_id: 5006, slot: 'Shoulder' } }],
  // An officer approved Amazon's report of a Mythic amulet.
  received: [{ player_id: 12, self_item_id: 3, track: 'Myth' }]
};

describe('conflict flags and contested items', () => {
  it('flags a #1 who is also #1 on another item from the same boss', () => {
    const data = {
      ...DATA,
      bosses: [...DATA.bosses, { item_id: 2, boss: 'The Coiled Altar' }],
      order: [
        ...DATA.order,
        order(2, 'Hero', 1, 10, 'Katorrí-Stormrage'),
        order(2, 'Hero', 2, 11, 'Bbldrizzy-Nazjatar')
      ]
    };
    const items = priorityItems(data, 'Hero', CATALOG, ZONES, 'MID2');
    const drape = items.find((i) => i.itemId === 1)!;
    const rows = rankedRows(drape, 'Hero', data, PLAYERS, CATALOG);
    expect(rows[0]!.sameBoss).toEqual(['Drape of the Dreadful Rite']);
    // Only the #1 carries it.
    expect(rows[1]!.sameBoss).toEqual([]);
    expect([...flaggedItemIds(items, 'Hero', data, PLAYERS, CATALOG)].sort()).toEqual([1, 2]);
    // Nothing flagged without the shared boss.
    expect(
      flaggedItemIds(priorityItems(DATA, 'Hero', CATALOG, ZONES, 'MID2'), 'Hero', DATA, PLAYERS, CATALOG).size
    ).toBe(0);
  });

  it('flags a Mythic #1 who already has the Heroic copy, and only on Mythic', () => {
    const data = { ...DATA, loot: [{ player_id: 11, item_id: 1, track: 'Hero', response: 'BiS' }] };
    const myth = priorityItems(data, 'Myth', CATALOG, ZONES, 'MID2')[0]!;
    expect(rankedRows(myth, 'Myth', data, PLAYERS, CATALOG)[0]!.heroicCopy).toBe(true);
    expect([...flaggedItemIds([myth], 'Myth', data, PLAYERS, CATALOG)]).toEqual([1]);
    const hero = priorityItems(data, 'Hero', CATALOG, ZONES, 'MID2').find((i) => i.itemId === 1)!;
    expect(rankedRows(hero, 'Hero', data, PLAYERS, CATALOG).some((r) => r.heroicCopy)).toBe(false);
  });

  it('lists items six or more raiders marked BiS, most wanted first, with ranks and what they have', () => {
    const many = [10, 11, 12, 13, 14, 15].map((id) => ({ player_id: id, item_id: 1, status: 'bis' }));
    const roster = [
      ...PLAYERS,
      ...[13, 14, 15].map((id) => player(id, `Raider${id}-Stormrage`, 'Mage', 'Fire', 'Ranged'))
    ];
    const data = { ...DATA, prefs: many };
    const [top, ...rest] = contestedItems(data, CATALOG, ZONES, 'MID2', roster);
    expect(rest).toEqual([]);
    expect(top!.item.name).toBe('Silken Voodoo Drape');
    expect(top!.wanters).toHaveLength(6);
    const kat = top!.wanters.find((w) => w.playerId === 10)!;
    expect([kat.heroic, kat.mythic, kat.has]).toEqual([1, null, 'Heroic']);
    expect(top!.wanters.find((w) => w.playerId === 11)!.mythic).toBe(1);
    // Best priority number first, unranked last.
    expect(top!.wanters.map((w) => w.playerId).slice(0, 3)).toEqual([11, 10, 12]);
    // A raider who left the roster is not counted; five is not enough.
    expect(contestedItems(data, CATALOG, ZONES, 'MID2', roster.slice(0, 5))).toEqual([]);
  });
});

describe('Sidegrade and notes', () => {
  it('names the raiders who marked an item Sidegrade and are not ranked on it', () => {
    const data = {
      ...DATA,
      prefs: [...DATA.prefs, { player_id: 12, item_id: 1, status: 'ok' }, { player_id: 99, item_id: 1, status: 'ok' }]
    };
    const drape = priorityItems(data, 'Hero', CATALOG, ZONES, 'MID2').find((i) => i.itemId === 1)!;
    // Bbldrizzy is ranked, and player 99 left the roster.
    expect(sidegradeNames(drape, data, PLAYERS)).toEqual(['Amazon']);
  });

  it('groups notes by item, once per raider and text, leaving out stand-ins and raiders who left', () => {
    const data = {
      ...DATA,
      prefs: [
        { id: 1, player_id: 10, item_id: 4, status: 'ok', note: 'BiS for Destro' },
        { id: 2, player_id: 10, item_id: 4, status: 'ok', note: ' BiS for Destro ' },
        { id: 3, player_id: 11, item_id: 1, status: 'bis', note: 'Need it for the haste' },
        { id: 4, player_id: 11, item_id: 3, status: 'pass', note: '   ' },
        { id: 5, player_id: 99, item_id: 1, status: 'bis', note: 'Gone' },
        { id: 6, player_id: 10, item_id: 8, status: 'bis', note: 'M+ pick' }
      ]
    };
    const notes = wishlistNotes(data, CATALOG, PLAYERS);
    expect(notes.map((n) => n.name)).toEqual(['Silken Voodoo Drape', "Vile Alchemist's Band"]);
    expect(notes[1]!.notes).toEqual([
      {
        ids: [1, 2],
        playerId: 10,
        name: 'Katorrí',
        className: 'Warlock',
        spec: 'Demonology',
        mark: 'ok',
        note: 'BiS for Destro'
      }
    ]);
  });
});

describe('scoring', () => {
  const saved = [
    { player_id: 10, recent_score: 8.2, trend_score: 7.9, best_score: 9.1, performance_score: 8.41 },
    { player_id: 12, recent_score: null, trend_score: null, best_score: null, performance_score: null }
  ];

  it("reads each raider's saved score, Recent being the one Suggest order uses", () => {
    expect(committedScores(PLAYERS, saved)).toEqual([
      { playerId: 10, role: 'dps', recent: 8.41, trend: 7.9, best: 9.1, noData: false, usedTrend: false },
      { playerId: 11, role: 'healer', recent: null, trend: null, best: null, noData: true, usedTrend: false },
      { playerId: 12, role: 'dps', recent: null, trend: null, best: null, noData: true, usedTrend: false }
    ]);
  });

  it('sorts scored raiders best first, then no data, then healers and tanks', () => {
    const scores = committedScores(PLAYERS, saved);
    expect(sortScores(scores).map((s) => s.playerId)).toEqual([10, 12, 11]);
  });

  it('marks a score as not committed only when it differs from the saved one', () => {
    const map = new Map([
      [10, 8.41],
      [12, null]
    ]);
    const dps = {
      playerId: 10,
      role: 'dps' as const,
      recent: 8.41,
      trend: null,
      best: null,
      noData: false,
      usedTrend: false
    };
    expect(pending(dps, map)).toBe(false);
    expect(pending({ ...dps, recent: 8.5 }, map)).toBe(true);
    expect(pending({ ...dps, playerId: 12, recent: 6 }, map)).toBe(true);
    expect(pending({ ...dps, role: 'healer', recent: 6 }, map)).toBe(false);
  });

  it('reads and shows scores out of 100, stored out of 10', () => {
    expect(parseOutOf100('84.1')).toBe(8.41);
    expect(parseOutOf100('100')).toBe(10);
    expect(parseOutOf100('101')).toBeNull();
    expect(parseOutOf100('')).toBeNull();
    expect(parseOutOf100('abc')).toBeNull();
    expect(showOutOf100(8.41)).toBe('84.1');
    expect(showOutOf100(null)).toBe('--');
  });
});

describe('priority list', () => {
  const items = priorityItems(DATA, 'Hero', CATALOG, ZONES, 'MID2');

  it("lists the season's items on the track, ranked first to last, and leaves out tier pieces and other raids", () => {
    expect(items.map((i) => i.name).sort()).toEqual([
      'Amulet of the Twin Fangs',
      'Silken Voodoo Drape',
      "Vile Alchemist's Band"
    ]);
    expect(items.find((i) => i.itemId === 1)!.ranked).toEqual([10, 11, 99]);
    expect(items.find((i) => i.itemId === 4)!.ranked).toEqual([]);
    expect(priorityItems(DATA, 'Myth', CATALOG, ZONES, 'MID2').map((i) => i.itemId)).toEqual([1]);
  });

  it('groups by slot in the current order and filters by name, boss and empty', () => {
    const all = { search: '', boss: '', hideEmpty: false };
    expect(sections(items, all).map((s) => s.label)).toEqual(['Back', 'Jewelry']);
    expect(sections(items, { ...all, search: 'AMULET' })[0]!.items.map((i) => i.itemId)).toEqual([3]);
    expect(sections(items, { ...all, boss: 'The Coiled Altar' }).flatMap((s) => s.items.map((i) => i.itemId))).toEqual([
      1
    ]);
    expect(sections(items, { ...all, hideEmpty: true }).flatMap((s) => s.items.map((i) => i.itemId))).toEqual([1, 3]);
  });

  it('orders the bosses by kill order, then any the setting does not list', () => {
    const raids = [{ name: 'Raid', bosses: [{ name: 'The Twin Fangs' }, { name: 'The Coiled Altar' }] }];
    expect(bossOptions(items, raids)).toEqual(['The Twin Fangs', 'The Coiled Altar', 'Vashnik the Malignant']);
  });

  it("flags each raider's mark, a win of this item, and a raider who left", () => {
    const rows = rankedRows(
      items.find((i) => i.itemId === 1)!,
      'Hero',
      DATA,
      PLAYERS,
      CATALOG
    );
    // Bbldrizzy's other Back is not flagged: only rings, trinkets and weapons are.
    expect(rows.map((r) => [r.rank, r.name, r.mark, r.received, r.otherBis, r.left])).toEqual([
      [1, 'Katorrí', 'bis', true, [], false],
      [2, 'Bbldrizzy', 'ok', false, [], false],
      [3, 'Gone', null, false, [], true]
    ]);
    // On Mythic, a Heroic win is not this track's.
    const myth = priorityItems(DATA, 'Myth', CATALOG, ZONES, 'MID2')[0]!;
    expect(
      rankedRows(myth, 'Myth', { ...DATA, loot: [{ ...DATA.loot[0]!, player_id: 11 }] }, PLAYERS, CATALOG)[0]!.received
    ).toBe(false);
  });

  it("flags a ring, trinket or weapon only with the raider's other BiS one they already won", () => {
    const ring = { itemId: 4, name: "Vile Alchemist's Band", slot: 'Finger', boss: null, ranked: [10] };
    const ringCatalog = [...CATALOG, item(20, 'Band A', 'Finger'), item(21, 'Band B', 'Finger')];
    // Katorri won both bands; only Band A is one she marked BiS.
    const data = {
      ...DATA,
      prefs: [...DATA.prefs, { player_id: 10, item_id: 20, status: 'bis' }],
      loot: [
        { player_id: 10, item_id: 20, track: 'Hero', response: null },
        { player_id: 10, item_id: 21, track: 'Myth', response: null }
      ]
    };
    expect(rankedRows(ring, 'Hero', data, PLAYERS, ringCatalog)[0]!.otherBis).toEqual(['Band A']);
    // Won with an off-spec roll, it does not count.
    const offSpec = { ...data, loot: [{ ...data.loot[0]!, response: 'OS' }] };
    expect(rankedRows(ring, 'Hero', offSpec, PLAYERS, ringCatalog)[0]!.otherBis).toEqual([]);
  });
});

describe('export string', () => {
  it("is the payload's UTF-8 JSON in base64, as the current site makes it", () => {
    const payload = {
      players: { 'Katorrí-Stormrage': { class: 'WARLOCK' } },
      priority: { '12345': { H: ['Katorrí-Stormrage'] } }
    };
    expect(exportString(payload)).toBe(Buffer.from(JSON.stringify(payload), 'utf8').toString('base64'));
  });
});

describe('gear reads', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  // timeAgoLabel reads the clock itself.
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'], now }));
  afterEach(() => vi.useRealTimers());
  it('says when the daily read last ran, and says plainly when it failed, is stuck or missed raiders', () => {
    expect(gearStatus(null, null, now)).toEqual({ text: 'No gear read recorded yet.', warn: true });
    const cron = { finished_at: '2026-10-18T06:00:00Z', synced: 76, skipped: 0, players: 76 };
    expect(gearStatus(cron, null, now)).toEqual({ text: 'Gear read 6h ago.', warn: false });
    expect(gearStatus({ ...cron, skipped: 1 }, null, now)).toEqual({
      text: 'Gear read 6h ago. 1 raider could not be read.',
      warn: false
    });
    expect(gearStatus({ ...cron, finished_at: '2026-10-16T06:00:00Z' }, null, now)).toMatchObject({
      warn: true,
      text: expect.stringContaining('has not run in 36 hours')
    });
    expect(gearStatus({ ...cron, error: 'Blizzard is down' }, null, now).text).toContain(
      'failed: Blizzard is down. Use Refresh equipped gear.'
    );
    expect(gearStatus({ ...cron, synced: 0 }, null, now)).toMatchObject({ warn: true });
    expect(gearStatus(cron, { finished_at: '2026-10-18T10:00:00Z' }, now).text).toBe(
      'Gear read 6h ago. Refreshed by hand 2h ago.'
    );
  });

  it("counts the class's tier pieces the raider has on, by Raider.IO's slot names", () => {
    const pieces = [
      ...DATA.tierPieces,
      { class: 'Warlock', resolved_item_id: 30, resolved: { wow_item_id: 5030, slot: 'Head' } },
      { class: 'Druid', resolved_item_id: 31, resolved: { wow_item_id: 5031, slot: 'Head' } }
    ];
    expect(tierPiecesEquipped('Warlock', pieces, { shoulder: { item_id: 5006 }, head: { item_id: 5030 } })).toBe(2);
    expect(tierPiecesEquipped('Warlock', pieces, { head: { item_id: 5031 } })).toBe(0);
    expect(splitNameRealm('Zug-Azjol-Nerub')).toEqual({ name: 'Zug', realm: 'Azjol-Nerub' });
  });
});

describe('editing an order', () => {
  it('lists the items with no order on a track, and opens one that has none', () => {
    const list = unmanagedItems(DATA, CATALOG, ZONES, 'MID2');
    expect(list.map((u) => [u.item.itemId, u.missing])).toEqual([
      [2, ['Hero', 'Myth']],
      [3, ['Myth']],
      [4, ['Myth']]
    ]);
    expect(itemFor(2, DATA, 'Hero', CATALOG, ZONES, 'MID2')).toMatchObject({
      name: 'Drape of the Dreadful Rite',
      ranked: []
    });
    // A tier piece, an older raid's item and a stand-in never open.
    expect([6, 7, 8].map((id) => itemFor(id, DATA, 'Hero', CATALOG, ZONES, 'MID2'))).toEqual([null, null, null]);
  });

  it('blocks a Mythic copy from both tracks and a Heroic one from Heroic, from wins and approved receipts', () => {
    expect(owned(12, 3, DATA)).toEqual({ normal: false, heroic: false, mythic: true });
    expect(blocked(owned(12, 3, DATA), 'Hero')).toBe(true);
    expect(owned(10, 1, DATA)).toMatchObject({ heroic: true });
    expect([blocked(owned(10, 1, DATA), 'Hero'), blocked(owned(10, 1, DATA), 'Myth')]).toEqual([true, false]);
    // An off-spec roll is not a copy.
    expect(owned(12, 2, DATA).heroic).toBe(false);
  });

  it('offers who marked the item and is not ranked, or the whole roster', () => {
    expect(poolFor(3, [12], DATA, PLAYERS, false).map((p) => p.id)).toEqual([10]);
    expect(poolFor(3, [12], DATA, PLAYERS, true).map((p) => p.id)).toEqual([11, 10]);
  });

  it('keeps locked raiders in their spot and, pressed again, spreads the #1s', () => {
    const counts = new Map([
      [10, 2],
      [11, 1]
    ]);
    expect(applySuggestion([12, 10, 11], new Set([12]), [10, 11, 12], counts, false)).toEqual({
      order: [12, 10, 11],
      promoted: null,
      keptLocked: 1
    });
    // Katorri holds two #1s elsewhere, Bbldrizzy one, Amazon none.
    expect(applySuggestion([], new Set(), [10, 11, 12], counts, true).order).toEqual([12, 10, 11]);
    expect(applySuggestion([], new Set(), [10, 11], counts, true)).toMatchObject({
      order: [11, 10],
      promoted: { id: 11, count: 1 }
    });
    // A locked #1 stays, #1s or not.
    expect(applySuggestion([10], new Set([10]), [10, 11], counts, true).order).toEqual([10, 11]);
    expect(firstCounts(DATA, 'Hero', 1)).toEqual(
      new Map([
        [12, 1],
        [10, 2]
      ])
    );
  });

  it('says where a moved raider was in the saved order, and shows scores out of 100', () => {
    expect(wasRank([10, 11, 12], 11, 0)).toEqual({ kind: 'up', rank: 2 });
    expect(wasRank([10, 11, 12], 10, 1)).toEqual({ kind: 'down', rank: 1 });
    expect(wasRank([10, 11], 12, 2)).toEqual({ kind: 'new' });
    expect(wasRank([10, 11], 11, 1)).toBeNull();
    expect([outOf100(8.4), outOf100(null)]).toEqual([84, null]);
  });
});

// The page, for an officer (or a guild officer, who only views).
function handlers(tables: Record<string, unknown>, role = 'officer', extra: Parameters<typeof seededHandlers>[0] = {}) {
  const base = seededHandlers();
  return seededHandlers({
    session: fakeSession({ battlenet: 'X#1', discord: { id: 'd', name: 'X' } }),
    rpc(name, args) {
      if (name === 'current_discord_id') return { data: 'discord-x' };
      if (name === 'resolve_person')
        return {
          data: {
            site_admin: false,
            guild_officer: role === 'guild',
            boe_manager: false,
            teams: role === 'guild' ? [] : [{ team_id: 1, team_member_id: 1, role, characters: [] }]
          }
        };
      if (name === 'team_season_start') return { data: null };
      if (name === 'build_rclc_export') return { data: PAYLOAD };
      if (name === 'generate_priority_order') return { data: SUGGESTED };
      if (name === 'save_priority_order') return { data: 3 };
      return base.rpc!(name, args);
    },
    from(read: Read) {
      if (read.table in tables) return { data: tables[read.table] };
      return base.from!(read);
    },
    ...extra
  });
}

const SUGGESTED = [
  {
    player_id: 12,
    name_realm: 'Angryamazon-Wyrmrest Accord',
    role: 'Ranged',
    weighted_total: 8.4,
    status_label: 'Has Champion',
    wishlist_status: 'bis'
  },
  {
    player_id: 10,
    name_realm: 'Katorrí-Stormrage',
    role: 'Ranged',
    weighted_total: 7.9,
    status_label: '',
    wishlist_status: 'bis'
  }
];

const PAYLOAD = { players: { 'Katorrí-Stormrage': { class: 'WARLOCK' } }, priority: {} };

const TABLES = {
  seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-07-18', ends_at: null }],
  team_settings: {
    view: null,
    raidProgression: [{ name: 'Raid', bosses: [{ name: 'The Twin Fangs' }, { name: 'The Coiled Altar' }] }]
  },
  team_seasons: [],
  items: CATALOG.map(({ seasons, ...i }) => ({ ...i, item_seasons: (seasons ?? []).map((season) => ({ season })) })),
  raid_zones: ZONES,
  players: PLAYERS,
  priority_order: DATA.order,
  priority_order_confirmed_empty: DATA.empty,
  item_preferences: DATA.prefs,
  rclc_loot: DATA.loot,
  item_bosses: DATA.bosses,
  tier_token_map: DATA.tierPieces,
  self_received_requests: DATA.received,
  site_settings: {
    gear_sync_last_cron_run: { finished_at: new Date().toISOString(), synced: 76, skipped: 0, players: 76 }
  }
};

const PAGE = '/g/wga/t/phoenix/officer/priority';

afterEach(() => vi.unstubAllGlobals());

describe('Loot priority page', () => {
  it('lists the items and opens one to show its order and flags', async () => {
    const { router } = renderApp(PAGE, handlers(TABLES));
    expect(await screen.findByRole('heading', { name: 'Pick an item to see its priority order' })).toBeInTheDocument();
    expect(
      screen.getByText(/Heroic track\. 3 items, 2 with someone ranked, 1 with nobody ranked\./)
    ).toBeInTheDocument();
    expect(screen.getByText('Midnight Season 2')).toBeInTheDocument();

    const list = screen.getByRole('navigation', { name: 'Items' });
    expect(within(list).getByRole('button', { name: "Vile Alchemist's Band, Nobody ranked" })).toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: 'Silken Voodoo Drape, #1 Katorrí · 3' }));

    const ranks = screen.getByRole('list', { name: 'Silken Voodoo Drape, Heroic order' });
    const rows = within(ranks).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Katorrí');
    expect(rows[0]).toHaveTextContent('BiS');
    expect(rows[0]).toHaveTextContent('Received Heroic');
    expect(rows[1]).toHaveTextContent('Sidegrade');
    expect(rows[1]).not.toHaveTextContent('Has BiS');
    expect(rows[2]).toHaveTextContent('Left the roster');
    expect(router.state.location.search).toBe('?item=1');
  });

  it('makes the string for the track on screen, and drops it when the track changes', async () => {
    const { client } = renderApp(`${PAGE}?item=1`, handlers(TABLES));
    await userEvent.click(await screen.findByRole('button', { name: 'Generate Heroic string' }));
    expect(await screen.findByLabelText('RCLootCouncil string, Heroic')).toHaveValue(exportString(PAYLOAD));
    expect(client.rpcs).toContainEqual(['build_rclc_export', { p_team_id: 1, p_season: 'MID2', p_track: 'Hero' }]);

    await userEvent.click(screen.getByRole('button', { name: 'Mythic' }));
    expect(screen.queryByLabelText(/RCLootCouncil string/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate Mythic string' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Silken Voodoo Drape, Mythic order' })).toHaveTextContent('Bbldrizzy');
  });

  it('refreshes equipped gear for the team and says how it went', async () => {
    const invoke = vi.fn(() => ({ data: { success: true, synced: 24, skipped: 1 } }));
    const { client } = renderApp(PAGE, handlers(TABLES, 'officer', { invoke }));
    expect(await screen.findByText(/Gear read just now\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh equipped gear' }));
    expect(await screen.findByText('24 raiders updated, 1 could not be read.')).toBeInTheDocument();
    expect(client.authCalls).toContainEqual(['invoke', ['blizzard-gear-sync', { body: { teamId: 1 } }]]);
  });

  it("syncs tier counts from Raider.IO, and refuses when the season's tier tokens are missing", async () => {
    const fetch = vi.fn((url: string) =>
      Promise.resolve({
        ok: !url.includes('Bbldrizzy'),
        json: () => Promise.resolve({ gear: { items: { shoulder: { item_id: 5006 } } } })
      })
    );
    vi.stubGlobal('fetch', fetch);
    const { client } = renderApp(PAGE, handlers(TABLES));
    await userEvent.click(await screen.findByRole('button', { name: 'Sync tier counts' }));
    expect(
      await screen.findByText('2 synced, 1 skipped (no Raider.IO data).', {}, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(fetch.mock.calls.map((c) => c[0]).find((u) => u.includes('raider.io'))).toContain(
      'realm=stormrage&name=Katorr%C3%AD'
    );
    const writes = client.writes.filter((w) => w.table === 'players');
    expect(writes[0]).toMatchObject({
      method: 'update',
      values: { tier_pieces_equipped: 1 },
      filters: [['eq', 'id', 10]]
    });
    expect(writes[1]).toMatchObject({ values: { tier_pieces_equipped: 0 }, filters: [['eq', 'id', 12]] });
  });

  it('refuses a tier sync with no tier tokens set up', async () => {
    renderApp(PAGE, handlers({ ...TABLES, tier_token_map: [] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sync tier counts' }));
    expect(
      await screen.findByText('Not synced: no tier tokens are set up for Midnight Season 2 yet.')
    ).toBeInTheDocument();
  });

  it('shows a guild officer the lists and the export, not the gear buttons or the editor', async () => {
    renderApp(`${PAGE}?item=1`, handlers(TABLES, 'guild'));
    expect(await screen.findByRole('button', { name: 'Generate Heroic string' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh equipped gear' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Silken Voodoo Drape, Heroic order' })).toHaveTextContent('Katorrí');
    expect(screen.queryByRole('button', { name: 'Suggest order' })).not.toBeInTheDocument();
  });

  it('moves a raider by keyboard, keeps the change while looking at another item, and saves it', async () => {
    const { client } = renderApp(`${PAGE}?item=1`, handlers(TABLES));
    const order = () => screen.getByRole('list', { name: 'Silken Voodoo Drape, Heroic order' });
    await userEvent.click(await screen.findByRole('button', { name: 'Move Bbldrizzy up' }));
    expect(screen.getByText('Moved Bbldrizzy to position 1 of 3.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Bbldrizzy down' })).toHaveFocus();
    let rows = within(order()).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Bbldrizzy');
    expect(rows[0]).toHaveTextContent('was #2');
    expect(rows[1]).toHaveTextContent('was #1');

    const list = screen.getByRole('navigation', { name: 'Items' });
    await userEvent.click(within(list).getByRole('button', { name: /Amulet of the Twin Fangs/ }));
    expect(within(list).getByRole('button', { name: /Silken Voodoo Drape/ })).toHaveTextContent('Not saved');
    await userEvent.click(within(list).getByRole('button', { name: /Silken Voodoo Drape/ }));
    rows = within(order()).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Bbldrizzy');

    await userEvent.click(screen.getByRole('button', { name: 'Save priority' }));
    expect(await screen.findByText('Saved the Heroic order for Silken Voodoo Drape.')).toBeInTheDocument();
    expect(client.rpcs).toContainEqual([
      'save_priority_order',
      { p_team_id: 1, p_season: 'MID2', p_item_id: 1, p_track: 'Hero', p_player_ids: [11, 10, 99] }
    ]);
  });

  it('suggests an order around a locked raider, with scores out of 100 and where each was', async () => {
    renderApp(`${PAGE}?item=1`, handlers(TABLES));
    const order = () => screen.getByRole('list', { name: 'Silken Voodoo Drape, Heroic order' });
    await userEvent.click(await screen.findByRole('button', { name: 'Lock Katorrí at #1' }));
    expect(screen.getByRole('button', { name: 'Lock Katorrí at #1' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest order' }));
    expect(
      await screen.findByText('Suggested order loaded: 1 added, 2 removed, 1 locked spot kept. Not saved yet.', {
        selector: '.priority-editor-note'
      })
    ).toBeInTheDocument();
    const rows = within(order()).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Katorrí'),
      expect.stringMatching(/Amazon.*new.*Has Champion.*Score 84/)
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
    expect(within(order()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('lists the items with a flagged #1 when nothing is picked, and marks them in the list', async () => {
    const tables = {
      ...TABLES,
      item_bosses: [...DATA.bosses, { item_id: 2, boss: 'The Coiled Altar' }],
      priority_order: [...DATA.order, order(2, 'Hero', 1, 10, 'Katorrí-Stormrage')]
    };
    renderApp(PAGE, handlers(tables));
    expect(await screen.findByRole('heading', { name: 'Needs a look (2)' })).toBeInTheDocument();
    const list = screen.getByRole('navigation', { name: 'Items' });
    expect(within(list).getByRole('button', { name: /Silken Voodoo Drape.*Needs a look/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Drape of the Dreadful Rite' }));
    expect(screen.getByRole('list', { name: 'Drape of the Dreadful Rite, Heroic order' })).toHaveTextContent(
      'Also #1 on Silken Voodoo Drape, same boss'
    );
  });

  it('lists notes on the Notes tab, and an officer clears one after confirming', async () => {
    const tables = {
      ...TABLES,
      item_preferences: [...DATA.prefs, { id: 7, player_id: 11, item_id: 1, status: 'ok', note: 'BiS for Balance' }]
    };
    const { client } = renderApp(`${PAGE}?tab=notes`, handlers(tables));
    expect(await screen.findByRole('link', { name: 'Notes, 1' })).toBeInTheDocument();
    expect(screen.getByText('BiS for Balance')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "Clear Bbldrizzy's note on Silken Voodoo Drape" }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear this note?' });
    expect(dialog).toHaveTextContent('Their Sidegrade mark stays.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear note' }));
    expect(await screen.findByText("Cleared Bbldrizzy's note on Silken Voodoo Drape.")).toBeInTheDocument();
    expect(client.writes).toContainEqual({
      table: 'item_preferences',
      method: 'update',
      values: { note: null },
      filters: [['in', 'id', [7]]]
    });
    expect(client.rpcs).toContainEqual([
      'write_audit_log',
      {
        p_team_id: 1,
        p_action: 'Wishlist Note Cleared',
        p_target_type: 'players',
        p_target_id: 11,
        p_detail: 'Bbldrizzy -- Silken Voodoo Drape'
      }
    ]);
  });

  it('shows a guild officer the notes without Clear', async () => {
    const tables = {
      ...TABLES,
      item_preferences: [...DATA.prefs, { id: 7, player_id: 11, item_id: 1, status: 'ok', note: 'BiS for Balance' }]
    };
    renderApp(`${PAGE}?tab=notes`, handlers(tables, 'guild'));
    expect(await screen.findByText('BiS for Balance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
  });

  it('names Sidegrade raiders who are not ranked under the order', async () => {
    const tables = { ...TABLES, item_preferences: [...DATA.prefs, { player_id: 12, item_id: 1, status: 'ok' }] };
    renderApp(`${PAGE}?item=1`, handlers(tables, 'guild'));
    expect(await screen.findByText('Sidegrade, not ranked: Amazon')).toBeInTheDocument();
  });

  it('shows the saved scores, fetches new ones, takes an edit, and commits them', async () => {
    const invoke = vi.fn(() => ({
      data: {
        success: true,
        updated: 1,
        recentReports: 2,
        trendReports: 8,
        scores: [
          {
            playerId: 10,
            name: 'Katorrí',
            role: 'dps',
            recent: 9,
            trend: 8,
            best: 9.5,
            noData: false,
            usedTrend: false
          },
          {
            playerId: 11,
            name: 'Bbldrizzy',
            role: 'healer',
            recent: null,
            trend: null,
            best: null,
            noData: false,
            usedTrend: false,
            manual: true
          },
          {
            playerId: 12,
            name: 'Angryamazon',
            role: 'dps',
            recent: 6,
            trend: 6,
            best: 7,
            noData: false,
            usedTrend: true
          }
        ]
      }
    }));
    const tables = {
      ...TABLES,
      scoring: [{ player_id: 10, recent_score: 8.2, trend_score: 7.9, best_score: 9.1, performance_score: 8.41 }]
    };
    const user = userEvent.setup();
    const { client } = renderApp(`${PAGE}?tab=scoring`, handlers(tables, 'officer', { invoke }));
    const table = await screen.findByRole('table', { name: 'Performance scores, out of 100' });
    expect(within(table).getByRole('row', { name: /Katorrí/ })).toHaveTextContent('84.1');
    expect(within(table).getByRole('row', { name: /Bbldrizzy/ })).toHaveTextContent('Left out (healer)');
    expect(screen.getByRole('button', { name: 'Commit scores' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Fetch from Warcraft Logs' }));
    expect(
      await screen.findByText(
        '1 raider updated (2 recent / 8 trend reports, Item level bracket %). Not committed yet.',
        {
          selector: '.priority-scoring-note'
        }
      )
    ).toBeInTheDocument();
    expect(client.authCalls).toContainEqual([
      'invoke',
      ['wcl-sync', { body: { action: 'refreshPerformance', teamId: 1, scoringMetric: 'bracket' } }]
    ]);
    expect(within(table).getByRole('row', { name: /Amazon/ })).toHaveTextContent('(trend fallback)');

    // Amazon's score typed by hand, out of 100.
    await user.click(screen.getByRole('button', { name: "Edit Amazon's Recent score" }));
    const box = screen.getByRole('spinbutton', { name: "Amazon's Recent score, out of 100" });
    await user.clear(box);
    await user.type(box, '72.5{Enter}');
    expect(within(table).getByRole('row', { name: /Amazon/ })).toHaveTextContent('72.5');
    expect(screen.getByRole('button', { name: "Edit Amazon's Recent score" })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Commit 2 scores' }));
    const dialog = await screen.findByRole('dialog', { name: 'Commit performance scores?' });
    await user.click(within(dialog).getByRole('button', { name: 'Commit' }));
    expect(await screen.findByText("Committed 2 raiders' scores. Suggest order uses them now.")).toBeInTheDocument();
    expect(client.writes).toContainEqual({
      table: 'scoring',
      method: 'upsert',
      values: [
        {
          team_id: 1,
          player_id: 10,
          season: 'MID2',
          recent_score: 9,
          trend_score: 8,
          best_score: 9.5,
          performance_score: 9
        },
        {
          team_id: 1,
          player_id: 12,
          season: 'MID2',
          recent_score: 7.25,
          trend_score: 6,
          best_score: 7,
          performance_score: 7.25
        }
      ],
      filters: []
    });
    expect(client.rpcs).toContainEqual([
      'write_audit_log',
      { p_team_id: 1, p_action: 'Performance Scores Committed', p_detail: '2 players' }
    ]);
  });

  it('shows a guild officer the saved scores with nothing to change', async () => {
    const tables = {
      ...TABLES,
      scoring: [{ player_id: 10, recent_score: 8.2, trend_score: 7.9, best_score: 9.1, performance_score: 8.41 }]
    };
    renderApp(`${PAGE}?tab=scoring`, handlers(tables, 'guild'));
    expect(await screen.findByRole('table', { name: 'Performance scores, out of 100' })).toHaveTextContent('84.1');
    expect(screen.queryByRole('button', { name: /Fetch|Commit|Edit|Use/ })).not.toBeInTheDocument();
  });

  it('shows the Contested tab, empty until six raiders mark an item BiS', async () => {
    renderApp(`${PAGE}?tab=contested`, handlers(TABLES));
    expect(
      await screen.findByText(/No contested items: nothing is marked BiS by 6 or more raiders/)
    ).toBeInTheDocument();
  });

  it('lists Unmanaged items, and Set Mythic opens one with a suggestion', async () => {
    const { client, router } = renderApp(PAGE, handlers(TABLES));
    await userEvent.click(await screen.findByRole('link', { name: 'Unmanaged, 3' }));
    expect(screen.getByText('3 items have no order saved on one track or both.')).toBeInTheDocument();
    expect(screen.getByText('No order on either track')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set Mythic for Amulet of the Twin Fangs' }));
    expect(await screen.findByRole('heading', { name: 'Amulet of the Twin Fangs' })).toBeInTheDocument();
    expect(client.rpcs).toContainEqual([
      'generate_priority_order',
      { p_team_id: 1, p_season: 'MID2', p_item_id: 3, p_track: 'Myth' }
    ]);
    expect(router.state.location.search).toBe('?item=3&track=mythic');
  });

  it("adds a raider who marked the item, and won't add one who has it", async () => {
    renderApp(`${PAGE}?item=3&track=mythic`, handlers(TABLES));
    expect(await screen.findByText(/No Mythic order saved yet/)).toBeInTheDocument();
    expect(screen.getByText('Has Mythic, can’t be added')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Katorrí' }));
    expect(screen.getByText('Added Katorrí at position 1.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Amulet of the Twin Fangs, Mythic order' })).toHaveTextContent('Katorrí');
  });
});
