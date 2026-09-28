import { describe, expect, it } from 'vitest';
import type { FullAttendanceRow } from '../attendance/attendance';
import type { PlayerRow } from '../roster/roster';
import {
  addBoss,
  addRaid,
  clampInt,
  closableSeasonCodes,
  closeSeasonTarget,
  defaultZoneIndex,
  newestHistoryIndex,
  normalizeRaids,
  perfZoneGroups,
  reorderBoss,
  removeBoss,
  removeRaid,
  rosterSnapshot,
  seasonPerfFetchedText,
  toggleMiniRaid,
  updateBoss,
  updateRaid,
  type Raid,
  type SeasonRow
} from './settings';

describe('clampInt', () => {
  it('clamps into range and rounds', () => {
    expect(clampInt(4.6, 1, 52)).toBe(5);
    expect(clampInt(0, 1, 52)).toBe(1);
    expect(clampInt(100, 0, 20)).toBe(20);
  });
});

describe('normalizeRaids', () => {
  it('fills in missing fields but keeps unknown ones', () => {
    const raw = [{ wclZoneId: 46, bosses: [{ wclEncounterId: 12 }] }];
    const raids = normalizeRaids(raw);
    expect(raids).toEqual([
      {
        wclZoneId: 46,
        name: '',
        isMiniRaid: false,
        aotcDate: '',
        bosses: [{ wclEncounterId: 12, name: '', mythicDate: '' }]
      }
    ]);
  });

  it('is empty for anything that is not an array', () => {
    expect(normalizeRaids(null)).toEqual([]);
    expect(normalizeRaids(undefined)).toEqual([]);
    expect(normalizeRaids({})).toEqual([]);
  });
});

describe('raid progression editing', () => {
  it('adds and removes a raid', () => {
    const withRaid = addRaid([]);
    expect(withRaid).toEqual([{ name: '', isMiniRaid: false, aotcDate: '', bosses: [] }]);
    expect(removeRaid(withRaid, 0)).toEqual([]);
  });

  it('adds and removes a boss, keeping other raids untouched', () => {
    const raids = normalizeRaids([
      { name: 'A', bosses: [] },
      { name: 'B', bosses: [] }
    ]);
    const withBoss = addBoss(raids, 0);
    expect(withBoss[0]!.bosses).toEqual([{ name: '', mythicDate: '' }]);
    expect(withBoss[1]).toEqual(raids[1]);
    expect(removeBoss(withBoss, 0, 0)[0]!.bosses).toEqual([]);
  });

  it('updates a raid field and a boss field independently', () => {
    const raids = normalizeRaids([{ name: 'A', bosses: [{ name: 'Boss 1', mythicDate: '' }] }]);
    const named = updateRaid(raids, 0, { name: 'Renamed' });
    expect(named[0]!.name).toBe('Renamed');
    const dated = updateBoss(raids, 0, 0, { mythicDate: '2026-05-01' });
    expect(dated[0]!.bosses![0]).toEqual({ name: 'Boss 1', mythicDate: '2026-05-01' });
  });

  it('clears the AOTC date when a raid becomes a mini-raid', () => {
    const raids = normalizeRaids([{ name: 'A', aotcDate: '2026-06-01', bosses: [] }]);
    const mini = toggleMiniRaid(raids, 0, true);
    expect(mini[0]).toMatchObject({ isMiniRaid: true, aotcDate: '' });
  });

  it('reorders a boss within its own raid', () => {
    const raids = normalizeRaids([{ name: 'A', bosses: [{ name: 'One' }, { name: 'Two' }, { name: 'Three' }] }]);
    const reordered = reorderBoss(raids, 0, 0, 2);
    expect(reordered[0]!.bosses!.map((b) => b.name)).toEqual(['Two', 'Three', 'One']);
    // A no-op move (same index) changes nothing.
    expect(reorderBoss(raids, 0, 1, 1)).toBe(raids);
  });
});

describe('newestHistoryIndex', () => {
  it('is the entry that started last, whatever order they were closed in', () => {
    expect(newestHistoryIndex([{ start: '2026-01-01' }, { start: '2026-06-01' }, { start: '2026-03-01' }])).toBe(1);
  });

  it('is -1 for no history', () => {
    expect(newestHistoryIndex([])).toBe(-1);
  });
});

describe('perfZoneGroups / defaultZoneIndex', () => {
  const raids = normalizeRaids([
    { name: 'Mini Release', wclZoneId: 10, isMiniRaid: true, bosses: [{ name: 'A' }] },
    { name: 'Main Raid', wclZoneId: 46, isMiniRaid: false, bosses: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] },
    { name: 'Main Raid Wing 2', wclZoneId: 46, isMiniRaid: false, bosses: [{ name: 'D' }] }
  ]) as Raid[];

  it('dedupes by zone, labeling with the raid that has the most bosses', () => {
    const groups = perfZoneGroups(raids);
    expect(groups).toEqual([
      { zoneId: 10, label: 'Mini Release', bossCount: 1, allMini: true },
      { zoneId: 46, label: 'Main Raid', bossCount: 4, allMini: false }
    ]);
  });

  it('defaults to the non-mini zone with the most bosses', () => {
    expect(defaultZoneIndex(perfZoneGroups(raids))).toBe(1);
  });

  it('defaults to the last zone when every zone is a mini-raid', () => {
    const allMini = normalizeRaids([
      { name: 'A', wclZoneId: 1, isMiniRaid: true, bosses: [{ name: 'x' }] },
      { name: 'B', wclZoneId: 2, isMiniRaid: true, bosses: [{ name: 'x' }] }
    ]) as Raid[];
    expect(defaultZoneIndex(perfZoneGroups(allMini))).toBe(1);
  });

  it('skips a raid with no WCL zone', () => {
    const noZone = normalizeRaids([{ name: 'A', bosses: [] }]) as Raid[];
    expect(perfZoneGroups(noZone)).toEqual([]);
  });
});

describe('seasonPerfFetchedText', () => {
  it('says how many players are already fetched', () => {
    expect(seasonPerfFetchedText(3)).toBe('Already fetched (3 players).');
    expect(seasonPerfFetchedText(1)).toBe('Already fetched (1 player).');
  });

  it('nudges toward fetching when nothing is there yet', () => {
    expect(seasonPerfFetchedText(0)).toBe('Not fetched yet -- do this before generating Heroic priority.');
  });
});

const SEASONS: SeasonRow[] = [
  { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-01-01', ends_at: '2026-03-31' },
  { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-04-01', ends_at: '2026-07-31' },
  { code: 'MID3', display_name: 'Midnight Season 3', starts_at: '2026-08-01', ends_at: null }
];

describe('closableSeasonCodes', () => {
  it('lists tiers before the current one that are not already closed, oldest first', () => {
    expect(closableSeasonCodes(SEASONS[2]!, SEASONS, [])).toEqual(['MID1', 'MID2']);
    expect(closableSeasonCodes(SEASONS[2]!, SEASONS, ['MID1'])).toEqual(['MID2']);
  });

  it('is empty with no current tier', () => {
    expect(closableSeasonCodes(null, SEASONS, [])).toEqual([]);
  });
});

describe('closeSeasonTarget', () => {
  it('keeps the picked code when it is still closable', () => {
    expect(closeSeasonTarget(['MID1', 'MID2'], 'MID1')).toBe('MID1');
  });

  it('falls back to the most recently started closable tier', () => {
    expect(closeSeasonTarget(['MID1', 'MID2'], 'gone')).toBe('MID2');
    expect(closeSeasonTarget([], 'anything')).toBe('');
  });
});

describe('rosterSnapshot', () => {
  const players: PlayerRow[] = [
    {
      id: 1,
      name_realm: 'Aur-Illidan',
      nickname: null,
      is_trial: false,
      is_bench: false,
      is_rotator: false,
      tier_pieces_equipped: null,
      join_date: '2025-12-01',
      classes_specs: { class: 'Warrior', spec: 'Protection', role: 'Tank' }
    },
    {
      id: 2,
      name_realm: 'New-Illidan',
      nickname: null,
      is_trial: true,
      is_bench: false,
      is_rotator: false,
      tier_pieces_equipped: null,
      join_date: '2026-05-01',
      classes_specs: { class: 'Mage', spec: 'Frost', role: 'Ranged' }
    }
  ];

  const rows: FullAttendanceRow[] = [
    {
      id: 1,
      player_id: 1,
      raid_date: '2026-01-05',
      status: 'Present',
      report_excluded: false,
      report_title: null,
      source: null
    },
    {
      id: 2,
      player_id: 1,
      raid_date: '2026-01-12',
      status: 'No Show',
      report_excluded: false,
      report_title: null,
      source: null
    },
    {
      id: 3,
      player_id: 1,
      raid_date: '2025-11-01',
      status: 'Present',
      report_excluded: false,
      report_title: null,
      source: null
    },
    {
      id: 4,
      player_id: 1,
      raid_date: '2026-01-19',
      status: 'Present',
      report_excluded: true,
      report_title: null,
      source: null
    }
  ];

  it('averages weighted attendance over the window, ignoring nights before the tier or a join date, and excluded reports', () => {
    const snapshot = rosterSnapshot(players, rows, { start: '2026-01-01', end: '2026-03-31' });
    expect(snapshot[0]).toEqual({
      playerId: 1,
      nameRealm: 'Aur-Illidan',
      role: 'Tank',
      isTrial: false,
      isBench: false,
      joinDate: '2025-12-01',
      attendance: '50.0%'
    });
  });

  it('is blank, not 100%, for a player with no eligible night yet', () => {
    const snapshot = rosterSnapshot(players, rows, { start: '2026-01-01', end: '2026-03-31' });
    expect(snapshot[1]).toMatchObject({ playerId: 2, attendance: '' });
  });
});
