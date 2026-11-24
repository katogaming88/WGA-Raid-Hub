import { describe, expect, it } from 'vitest';
import raidbots from './fixtures/raidbots-droptimizer.json';
import qeLive from './fixtures/qe-live-upgrade-report.json';
import {
  asStaleDays,
  gainsByItem,
  sortGain,
  trackGains,
  bestPerItem,
  isCharacter,
  isStale,
  parseQeLive,
  parseRaidbots,
  parseSimLink,
  type ParsedReport,
  type SavedResult
} from './sims';

// The fixtures are trimmed from real reports (2026-11-24): a Raidbots
// Mythic droptimizer and a QE Live Normal upgrade report.

const ok = (r: ParsedReport | { error: string }) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

describe('parseSimLink', () => {
  it('reads Raidbots and QE Live report links', () => {
    expect(parseSimLink(' https://www.raidbots.com/simbot/report/4fa37C7DkwEgoJQTLTFS9L ')).toEqual({
      source: 'raidbots',
      reportId: '4fa37C7DkwEgoJQTLTFS9L',
      dataUrl: 'https://www.raidbots.com/reports/4fa37C7DkwEgoJQTLTFS9L/data.json'
    });
    expect(parseSimLink('https://questionablyepic.com/live/upgradereport/ecdqdqpmpfzx')).toEqual({
      source: 'qe_live',
      reportId: 'ecdqdqpmpfzx',
      dataUrl: 'https://questionablyepic.com/api/getUpgradeReport.php?reportID=ecdqdqpmpfzx'
    });
  });

  it('turns away anything else, saying why', () => {
    expect(parseSimLink('')).toHaveProperty('error');
    expect(parseSimLink('not a link')).toMatchObject({ error: expect.stringMatching(/isn’t a link/) });
    expect(parseSimLink('https://www.raidbots.com/simbot/droptimizer')).toMatchObject({
      error: expect.stringMatching(/isn’t a report/)
    });
    expect(parseSimLink('https://www.wowhead.com/item=1')).toMatchObject({ error: expect.stringMatching(/Only/) });
  });
});

describe('parseRaidbots', () => {
  it('keeps every item and slot, its gain against the character, and the catalyst source', () => {
    const report = ok(parseRaidbots(raidbots, 'abc'));
    expect(report).toMatchObject({
      source: 'raidbots',
      character: { name: 'Katorrí', realm: 'stormrage' },
      fightStyle: 'Patchwerk',
      targetCount: 1
    });
    expect(report.sims.map((s) => s.difficulty)).toEqual(['mythic']);
    const results = report.sims[0]!.results;
    // The trinket simmed with and without swapping on-use is kept once.
    expect(results).toHaveLength(6);
    const rings = results.filter((r) => r.wow_item_id === 268252).map((r) => r.slot);
    expect(rings.sort()).toEqual(['finger1', 'finger2']);
    const tier = results.find((r) => r.wow_item_id === 271545)!;
    expect(tier).toMatchObject({ slot: 'legs', item_level: 334, catalyst_from: 268236, encounter_id: 2888 });
    const ring = results.find((r) => r.slot === 'finger1')!;
    expect(ring.pct_gain).toBeCloseTo(1.979, 2);
    expect(ring.dps_gain).toBe(4335);
    expect(ring.item_name).toBeTruthy();
  });

  it('turns away a report that isn’t a droptimizer', () => {
    const quick = {
      ...raidbots,
      simbot: { ...raidbots.simbot, simType: 'quick', meta: { ...raidbots.simbot.meta, type: 'quick' } }
    };
    expect(parseRaidbots(quick, 'abc')).toMatchObject({ error: expect.stringMatching(/isn’t a droptimizer/) });
  });
});

describe('parseQeLive', () => {
  it('keeps raid results as dropped and fully upgraded, with the percent gain', () => {
    const report = ok(parseQeLive(qeLive, 'ecdqdqpmpfzx'));
    expect(report).toMatchObject({ source: 'qe_live', character: { name: 'Katorria', realm: 'Stormrage' } });
    expect(report.sims.map((s) => s.difficulty)).toEqual(['normal']);
    const results = report.sims[0]!.results;
    // Two items, each as dropped and fully upgraded; dungeon and bonus rows left out.
    expect(results).toHaveLength(4);
    expect(results.find((r) => r.wow_item_id === 268203 && r.item_level === 334)).toMatchObject({
      pct_gain: 7.65,
      dps_gain: null,
      slot: null
    });
  });

  it('says when QE Live has no such report', () => {
    expect(parseQeLive({ status: 'Report not found' }, 'x')).toMatchObject({
      error: expect.stringMatching(/no report/)
    });
  });
});

describe('isCharacter', () => {
  it('matches name and realm ignoring case, accents kept, and realm spelling', () => {
    expect(isCharacter('Katorrí-Stormrage', { name: 'Katorrí', realm: 'stormrage' })).toBe(true);
    expect(isCharacter('Somebody-Wyrmrest Accord', { name: 'somebody', realm: 'wyrmrest_accord' })).toBe(true);
    expect(isCharacter('Katorrí-Stormrage', { name: 'Katorria', realm: 'Stormrage' })).toBe(false);
    expect(isCharacter('Katorrí-Illidan', { name: 'Katorrí', realm: 'stormrage' })).toBe(false);
  });
});

describe('bestPerItem', () => {
  const row = (o: Partial<SavedResult>): SavedResult => ({
    id: 1,
    wow_item_id: 1,
    item_name: null,
    slot: null,
    item_level: 334,
    pct_gain: 1,
    dps_gain: null,
    encounter_id: null,
    catalyst_from: null,
    ...o
  });
  it('shows each item at its highest item level and best slot, biggest gain first', () => {
    const best = bestPerItem([
      row({ wow_item_id: 1, item_level: 321, pct_gain: 3 }),
      row({ wow_item_id: 1, item_level: 334, pct_gain: 2 }),
      row({ wow_item_id: 2, slot: 'finger1', pct_gain: 4 }),
      row({ wow_item_id: 2, slot: 'finger2', pct_gain: 5 })
    ]);
    expect(best.map((r) => [r.wow_item_id, r.item_level, r.slot])).toEqual([
      [2, 334, 'finger2'],
      [1, 334, null]
    ]);
  });
});

describe('out of date', () => {
  it('uses the team’s days, 14 until set', () => {
    expect(asStaleDays(undefined)).toBe(14);
    expect(asStaleDays('5')).toBe(5);
    expect(asStaleDays(0)).toBe(14);
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(isStale('2026-11-19T12:00:00Z', 5, now)).toBe(false);
    expect(isStale('2026-11-19T11:00:00Z', 5, now)).toBe(true);
  });
});

describe('gainsByItem', () => {
  const result = (o: Partial<SavedResult>): SavedResult => ({
    id: 1,
    wow_item_id: 1,
    item_name: null,
    slot: null,
    item_level: 334,
    pct_gain: 1,
    dps_gain: null,
    encounter_id: null,
    catalyst_from: null,
    ...o
  });
  it('lists each item’s gain per sim, Mythic first, marking an old sim', () => {
    const now = Date.parse('2026-11-24T12:00:00Z');
    const gains = gainsByItem(
      [
        { difficulty: 'heroic', simmed_at: '2026-11-01T00:00:00Z', character_sim_results: [result({ pct_gain: 1.2 })] },
        {
          difficulty: 'mythic',
          simmed_at: '2026-11-23T00:00:00Z',
          character_sim_results: [
            result({ pct_gain: 1.5, item_level: 321 }),
            result({ pct_gain: 1.98 }),
            result({ wow_item_id: 2, pct_gain: -1 })
          ]
        }
      ],
      14,
      now
    );
    expect(gains.get(1)).toEqual([
      { difficulty: 'mythic', pct: 1.98, stale: false },
      { difficulty: 'heroic', pct: 1.2, stale: true }
    ]);
    expect(gains.get(2)).toEqual([{ difficulty: 'mythic', pct: -1, stale: false }]);
  });
});

describe('trackGains', () => {
  const r = (wow: number, pct: number): SavedResult => ({
    id: wow,
    wow_item_id: wow,
    item_name: null,
    slot: null,
    item_level: 334,
    pct_gain: pct,
    dps_gain: null,
    encounter_id: null,
    catalyst_from: null
  });
  const now = Date.parse('2026-11-24T12:00:00Z');
  const gainOf = trackGains(
    [
      {
        player_id: 1,
        difficulty: 'mythic',
        simmed_at: '2026-11-23T00:00:00Z',
        character_sim_results: [r(500, 2.5), r(900, 1.1)]
      },
      { player_id: 2, difficulty: 'heroic', simmed_at: '2026-10-01T00:00:00Z', character_sim_results: [r(500, 3)] }
    ],
    14,
    // Item 10 is a tier token: it becomes piece 900 for player 1.
    (playerId, itemId) => (itemId === 10 ? (playerId === 1 ? 900 : null) : 500),
    now
  );
  it('gives the gain at the track’s difficulty, a token as its piece, and says when there is no sim', () => {
    expect(gainOf(1, 5, 'Myth')).toEqual({ sim: true, pct: 2.5, stale: false, simmedAt: '2026-11-23T00:00:00Z' });
    expect(gainOf(1, 10, 'Myth')).toMatchObject({ pct: 1.1 });
    expect(gainOf(1, 5, 'Hero')).toEqual({ sim: false });
    expect(gainOf(2, 5, 'Hero')).toMatchObject({ pct: 3, stale: true });
    expect(gainOf(2, 10, 'Hero')).toMatchObject({ sim: true, pct: null });
  });
  it('sorts an out-of-date or missing gain below every real one', () => {
    expect(sortGain(gainOf(1, 5, 'Myth'))).toBe(2.5);
    expect(sortGain(gainOf(2, 5, 'Hero'))).toBe(-Infinity);
    expect(sortGain(gainOf(1, 5, 'Hero'))).toBe(-Infinity);
  });
});
