import { describe, expect, it } from 'vitest';
import { rosterRows, rosterStatus, seasonHistory, seasonRecap, type SeasonHistoryEntry } from './history';

const roster = [
  {
    nameRealm: 'Zed-Illidan',
    role: 'Melee',
    isTrial: false,
    isBench: false,
    joinDate: '2026-01-01',
    attendance: '90%'
  },
  { nameRealm: 'Aur-Illidan', role: 'Tank', isTrial: true, isBench: false, joinDate: '2026-02-01', attendance: '' },
  { nameRealm: 'Kes-Illidan', role: 'Melee', isTrial: false, isBench: true, joinDate: '2026-03-01', attendance: '75%' }
];

const SEASON: SeasonHistoryEntry = {
  name: 'Season One',
  raids: [
    {
      bosses: [
        { name: 'Warden', mythicDate: '2026-08-01', mythicPulls: 5, mythicBestPct: null },
        { name: 'Herald', mythicDate: null, mythicPulls: 12, mythicBestPct: 4.2 },
        { name: 'Untouched', mythicDate: null, mythicPulls: 0, mythicBestPct: null }
      ]
    }
  ],
  roster
};

describe('seasonRecap', () => {
  it('counts kills, the latest date, and the boss still being worked on', () => {
    const recap = seasonRecap(SEASON);
    expect(recap).toMatchObject({
      name: 'Season One',
      killed: 1,
      total: 3,
      lastKillDate: '2026-08-01',
      currentBoss: { name: 'Herald', pulls: 12, bestPct: 4.2 }
    });
  });

  it('names an unnamed season, and needs no current boss for one with no pulls logged', () => {
    const recap = seasonRecap({ name: '', raids: [{ bosses: [{ name: 'Untouched', mythicPulls: 0 }] }] });
    expect(recap.name).toBe('Unnamed Season');
    expect(recap.currentBoss).toBeNull();
  });
});

describe('seasonHistory', () => {
  it('lists newest first', () => {
    const entries: SeasonHistoryEntry[] = [{ name: 'Older' }, { name: 'Newer' }];
    expect(seasonHistory(entries).map((s) => s.name)).toEqual(['Newer', 'Older']);
  });

  it('is empty for no history', () => {
    expect(seasonHistory(null)).toEqual([]);
    expect(seasonHistory(undefined)).toEqual([]);
  });
});

describe('rosterRows', () => {
  it('orders by role group, then name', () => {
    expect(rosterRows(roster).map((r) => r.nameRealm)).toEqual(['Aur-Illidan', 'Kes-Illidan', 'Zed-Illidan']);
  });
});

describe('rosterStatus', () => {
  it('is Bench, Trial, or Roster', () => {
    expect(rosterStatus(roster[1]!)).toBe('Trial');
    expect(rosterStatus(roster[2]!)).toBe('Bench');
    expect(rosterStatus(roster[0]!)).toBe('Roster');
  });
});
