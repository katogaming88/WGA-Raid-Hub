import { describe, expect, it } from 'vitest';
import raidbots from './fixtures/raidbots-droptimizer.json';
import qeLive from './fixtures/qe-live-upgrade-report.json';
import {
  asStaleDays,
  gainsByItem,
  setupGains,
  sortGain,
  trackGains,
  bestPerItem,
  isCharacter,
  isRosterSim,
  isStale,
  matchSpec,
  simOrder,
  parseQeLive,
  parseRaidbots,
  parseSimLink,
  type ParsedReport,
  type SavedResult
} from './sims';

import { asSimSettings, DEFAULT_SIM_SETTINGS, simProblems, type SimSettings } from './simSettings';

// The team's defaults: one setup, 14 days.
const SETTINGS = DEFAULT_SIM_SETTINGS;

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
      spec: 'affliction warlock',
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
    expect(report).toMatchObject({
      source: 'qe_live',
      character: { name: 'Katorria', realm: 'Stormrage' },
      spec: 'Restoration Shaman'
    });
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
    // No realm in the report: turned away (Kat, 2026-11-25).
    expect(isCharacter('Katorrí-Stormrage', { name: 'Katorrí', realm: '' })).toBe(false);
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
        {
          difficulty: 'heroic',
          spec: 'Demonology',
          className: 'Warlock',
          simmed_at: '2026-11-01T00:00:00Z',
          character_sim_results: [result({ pct_gain: 1.2 })]
        },
        {
          difficulty: 'mythic',
          spec: 'Demonology',
          className: 'Warlock',
          simmed_at: '2026-11-23T00:00:00Z',
          character_sim_results: [
            result({ pct_gain: 1.5, item_level: 321 }),
            result({ pct_gain: 1.98 }),
            result({ wow_item_id: 2, pct_gain: -1 })
          ]
        },
        {
          difficulty: 'mythic',
          spec: 'Affliction',
          className: 'Warlock',
          simmed_at: '2026-11-23T00:00:00Z',
          character_sim_results: [result({ pct_gain: 4.1 })]
        }
      ],
      { className: 'Warlock', spec: 'Demonology' },
      SETTINGS,
      now
    );
    // The roster spec's first, then another spec's, named (#1916).
    expect(gains.get(1)).toMatchObject([
      { difficulty: 'mythic', spec: 'Demonology', className: 'Warlock', roster: true, pct: 1.98, stale: false },
      { difficulty: 'heroic', spec: 'Demonology', className: 'Warlock', roster: true, pct: 1.2, stale: true },
      { difficulty: 'mythic', spec: 'Affliction', className: 'Warlock', roster: false, pct: 4.1, stale: false }
    ]);
    expect(gains.get(2)).toMatchObject([
      { difficulty: 'mythic', spec: 'Demonology', className: 'Warlock', roster: true, pct: -1, stale: false }
    ]);
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
        spec: 'Demonology',
        className: 'Warlock',
        simmed_at: '2026-11-23T00:00:00Z',
        character_sim_results: [r(500, 2.5), r(900, 1.1)]
      },
      // Player 1's off spec: a bigger gain, shown but never sorted by (#1916).
      {
        player_id: 1,
        difficulty: 'mythic',
        spec: 'Affliction',
        className: 'Warlock',
        simmed_at: '2026-11-23T00:00:00Z',
        character_sim_results: [r(500, 4.1)]
      },
      {
        player_id: 2,
        difficulty: 'heroic',
        spec: 'Fire',
        className: 'Mage',
        simmed_at: '2026-10-01T00:00:00Z',
        character_sim_results: [r(500, 3)]
      },
      // Player 3 has only an off-spec sim: it doesn't count as theirs.
      {
        player_id: 3,
        difficulty: 'mythic',
        spec: 'Frost',
        className: 'Mage',
        simmed_at: '2026-11-23T00:00:00Z',
        character_sim_results: [r(500, 9)]
      }
    ],
    SETTINGS,
    (playerId) =>
      ({
        1: { className: 'Warlock', spec: 'Demonology' },
        2: { className: 'Mage', spec: 'Fire' },
        3: { className: 'Mage', spec: 'Arcane' }
      })[playerId] ?? null,
    // Item 10 is a tier token: it becomes piece 900 for player 1.
    (playerId: number, itemId: number) => (itemId === 10 ? (playerId === 1 ? 900 : null) : 500),
    now
  );
  it('gives the gain at the track’s difficulty, a token as its piece, and says when there is no sim', () => {
    expect(gainOf(1, 5, 'Myth')).toMatchObject({
      sim: true,
      pct: 2.5,
      stale: false,
      simmedAt: '2026-11-23T00:00:00Z',
      roster: { className: 'Warlock', spec: 'Demonology' },
      others: [{ spec: 'Affliction', className: 'Warlock', pct: 4.1, stale: false }]
    });
    expect(gainOf(1, 10, 'Myth')).toMatchObject({ pct: 1.1 });
    expect(gainOf(1, 5, 'Hero')).toMatchObject({
      sim: false,
      roster: { className: 'Warlock', spec: 'Demonology' },
      others: []
    });
    // The off spec's sim didn't include the token's piece: nothing to show.
    expect(gainOf(1, 10, 'Myth').others).toEqual([]);
    expect(gainOf(3, 5, 'Myth')).toMatchObject({
      sim: false,
      roster: { className: 'Mage', spec: 'Arcane' },
      others: [{ spec: 'Frost', className: 'Mage', pct: 9, stale: false }]
    });
    expect(gainOf(2, 5, 'Hero')).toMatchObject({ pct: 3, stale: true });
    expect(gainOf(2, 10, 'Hero')).toMatchObject({ sim: true, pct: null });
  });
  it('sorts an out-of-date or missing gain below every real one', () => {
    expect(sortGain(gainOf(1, 5, 'Myth'))).toBe(2.5);
    expect(sortGain(gainOf(2, 5, 'Hero'))).toBe(-Infinity);
    expect(sortGain(gainOf(1, 5, 'Hero'))).toBe(-Infinity);
    expect(sortGain(gainOf(3, 5, 'Myth'))).toBe(-Infinity);
  });
});

describe('matchSpec', () => {
  const specs = [
    { id: 1, class: 'Warlock', spec: 'Affliction' },
    { id: 2, class: 'Hunter', spec: 'Beast Mastery' },
    { id: 3, class: 'Shaman', spec: 'Restoration' },
    { id: 4, class: 'Death Knight', spec: 'Frost' },
    { id: 5, class: 'Mage', spec: 'Frost' }
  ];
  it('reads a Raidbots profile’s spec and class, and QE Live’s name', () => {
    expect(matchSpec('affliction warlock', specs)?.id).toBe(1);
    expect(matchSpec('beast_mastery hunter', specs)?.id).toBe(2);
    expect(matchSpec('Restoration Shaman', specs)?.id).toBe(3);
    expect(matchSpec('frost deathknight', specs)?.id).toBe(4);
    expect(matchSpec('frost mage', specs)?.id).toBe(5);
    expect(matchSpec('frost', specs)).toBeNull();
  });
});

describe('a report with no spec', () => {
  it('is turned away, saying why', () => {
    const text = raidbots.simbot.meta.rawFormData.text.replace(/\nspec=.*/, '');
    const noSpec = {
      ...raidbots,
      simbot: { ...raidbots.simbot, meta: { ...raidbots.simbot.meta, rawFormData: { text } } }
    };
    expect(parseRaidbots(noSpec, 'abc')).toMatchObject({ error: expect.stringMatching(/which spec/) });
    const qe = { ...JSON.parse(qeLive as unknown as string), spec: '' };
    expect(parseQeLive(qe, 'x')).toMatchObject({ error: expect.stringMatching(/which spec/) });
  });
});

describe('simOrder', () => {
  it('puts the roster spec first, highest difficulty first, then the others by name', () => {
    const sims = [
      { difficulty: 'heroic' as const, spec: 'Destruction', className: 'Warlock' },
      { difficulty: 'heroic' as const, spec: 'Demonology', className: 'Warlock' },
      { difficulty: 'mythic' as const, spec: 'Affliction', className: 'Warlock' },
      { difficulty: 'mythic' as const, spec: 'Demonology', className: 'Warlock' }
    ];
    expect(
      simOrder(sims, { className: 'Warlock', spec: 'Demonology' }).map((s) => `${s.difficulty} ${s.spec}`)
    ).toEqual(['mythic Demonology', 'heroic Demonology', 'mythic Affliction', 'heroic Destruction']);
  });
});

describe('the roster spec is matched on class and spec', () => {
  it('doesn’t take another class’s same-named spec as the roster one', () => {
    const r: SavedResult = {
      id: 1,
      wow_item_id: 500,
      item_name: null,
      slot: null,
      item_level: 334,
      pct_gain: 2,
      dps_gain: null,
      encounter_id: null,
      catalyst_from: null
    };
    const gainOf = trackGains(
      [
        {
          player_id: 1,
          difficulty: 'mythic',
          spec: 'Frost',
          className: 'Mage',
          simmed_at: new Date().toISOString(),
          character_sim_results: [r]
        }
      ],
      SETTINGS,
      () => ({ className: 'Death Knight', spec: 'Frost' }),
      () => 500
    );
    expect(gainOf(1, 5, 'Myth')).toMatchObject({ sim: false, others: [{ spec: 'Frost', className: 'Mage', pct: 2 }] });
    expect(isRosterSim({ spec: 'Frost', className: 'Mage' }, { className: 'Death Knight', spec: 'Frost' })).toBe(false);
  });
});

// #1888: the team's setups, weighted (Kat's example on the issue).
describe('setupGains', () => {
  const r = (pct: number, dps: number | null = null): SavedResult => ({
    id: 1,
    wow_item_id: 500,
    item_name: null,
    slot: null,
    item_level: 334,
    pct_gain: pct,
    dps_gain: dps,
    encounter_id: null,
    catalyst_from: null
  });
  const now = Date.parse('2026-11-25T12:00:00Z');
  const fresh = '2026-11-24T00:00:00Z';
  const old = '2026-10-01T00:00:00Z';
  const SETUPS: SimSettings = {
    ...DEFAULT_SIM_SETTINGS,
    setups: [
      { id: 'st', name: 'Single target', fightStyle: 'Patchwerk', targets: 1, minutes: 5, weight: 70 },
      { id: 'aoe', name: 'Several targets', fightStyle: 'Patchwerk', targets: 3, minutes: 5, weight: 30 }
    ]
  };
  const sim = (targets: number, pct: number, simmedAt = fresh, dps: number | null = null) => ({
    fight_style: 'Patchwerk',
    target_count: targets,
    fight_length: 300,
    simmed_at: simmedAt,
    character_sim_results: [r(pct, dps)]
  });

  it('averages by weight: +1.0% and +2.0% at 70/30 is +1.3%, and +0.7% with one missing', () => {
    expect(setupGains([sim(1, 1), sim(3, 2)], SETUPS, 'mythic', now).gainOf(500)).toMatchObject({ pct: 1.3 });
    const one = setupGains([sim(1, 1)], SETUPS, 'mythic', now);
    expect(one.gainOf(500)).toMatchObject({ pct: 0.7, stale: false });
    expect(one.missing.map((s) => s.name)).toEqual(['Several targets']);
  });

  it('counts an out-of-date setup as no gain, and shows the old ones greyed when nothing is current', () => {
    expect(setupGains([sim(1, 1), sim(3, 2, old)], SETUPS, 'mythic', now).gainOf(500)).toMatchObject({
      pct: 0.7,
      stale: false
    });
    expect(setupGains([sim(1, 1, old), sim(3, 2, old)], SETUPS, 'mythic', now).gainOf(500)).toMatchObject({
      pct: 1.3,
      stale: true
    });
  });

  it('lets a QE Live sim stand in for every setup, unweighted (Kat, 2026-11-25)', () => {
    const qe = {
      fight_style: null,
      target_count: null,
      fight_length: null,
      simmed_at: fresh,
      character_sim_results: [r(4)]
    };
    const read = setupGains([qe], SETUPS, 'mythic', now);
    expect(read.gainOf(500)).toMatchObject({ pct: 4, dps: null });
    expect(read.missing).toEqual([]);
  });

  it('ignores a sim that matches none of the setups, and averages DPS where every sim has it', () => {
    const read = setupGains([sim(1, 1, fresh, 1000), sim(3, 2, fresh, 2000), sim(8, 9)], SETUPS, 'mythic', now);
    expect(read.gainOf(500)).toMatchObject({ pct: 1.3, dps: 1300 });
    expect(setupGains([sim(8, 9)], SETUPS, 'mythic', now).has).toBe(false);
  });

  it('shows the team’s level: fully upgraded is the highest item level, as it drops the lowest', () => {
    const both = {
      ...sim(1, 0),
      fight_style: null,
      character_sim_results: [
        { ...r(1), item_level: 321 },
        { ...r(3), id: 2, item_level: 334 }
      ]
    };
    expect(setupGains([both], SETUPS, 'mythic', now).gainOf(500)).toMatchObject({ pct: 3 });
    const drop = { ...SETUPS, upgrade: { ...SETUPS.upgrade, mythic: 'drop' as const } };
    expect(setupGains([both], drop, 'mythic', now).gainOf(500)).toMatchObject({ pct: 1 });
  });
});

// #1888: the team's checks, on the real Raidbots report (all defaults pass).
describe('simProblems', () => {
  const report = ok(parseRaidbots(raidbots, 'abc'));
  it('reads the report’s settings', () => {
    expect(report).toMatchObject({ fightStyle: 'Patchwerk', targetCount: 1, fightLength: 300 });
    expect(report.raidbots).toEqual({
      missingBuffs: [],
      powerInfusion: false,
      customRotation: false,
      sockets: false,
      latestSimc: true,
      highPrecision: true,
      upgradedEquipped: false,
      upgrade: { step: 6, of: 6 }
    });
  });

  it('passes the defaults, and names every rule a report breaks', () => {
    expect(simProblems(report, DEFAULT_SIM_SETTINGS)).toEqual([]);
    const strict: SimSettings = {
      ...DEFAULT_SIM_SETTINGS,
      equipped: 'upgraded',
      upgrade: { ...DEFAULT_SIM_SETTINGS.upgrade, mythic: 'drop' },
      checks: { ...DEFAULT_SIM_SETTINGS.checks, sockets: true },
      setups: [{ ...DEFAULT_SIM_SETTINGS.setups[0]!, targets: 3, name: 'Several targets' }]
    };
    expect(simProblems(report, strict)).toEqual([
      'It was run as Patchwerk, 1 target, 5 min, which isn’t one of the team’s setups: Several targets (Patchwerk, 3 targets, 5 min).',
      'Mythic items must be simmed as they drop (1/6); this one is at 6/6.',
      'Equipped gear must be simmed fully upgraded.',
      'Items must be simmed with sockets added.'
    ]);
  });

  it('turns away raid buffs off, Power Infusion on and a custom rotation', () => {
    const meta = { ...raidbots.simbot.meta, bloodlust: false, powerInfusion: true, customApl: true };
    const broken = ok(parseRaidbots({ ...raidbots, simbot: { ...raidbots.simbot, meta } }, 'abc'));
    expect(simProblems(broken, DEFAULT_SIM_SETTINGS)).toEqual([
      'Raid buffs must be on: Bloodlust is off.',
      'Power Infusion must be off.',
      'It must use the default rotation, with no custom rotation or expert settings.'
    ]);
  });

  it('never turns away a QE Live report', () => {
    const qe = ok(parseQeLive(qeLive, 'x'));
    expect(
      simProblems(qe, { ...DEFAULT_SIM_SETTINGS, checks: { ...DEFAULT_SIM_SETTINGS.checks, sockets: true } })
    ).toEqual([]);
  });
});

describe('asSimSettings', () => {
  it('takes defaults for anything unset or unreadable', () => {
    expect(asSimSettings(undefined)).toEqual(DEFAULT_SIM_SETTINGS);
    const s = asSimSettings({
      simGainMode: 'raw',
      simDifficulties: ['mythic', 'nonsense'],
      simUpgrade: { mythic: 'drop', heroic: 'weird' },
      simSetups: [{ name: 'Bad', fightStyle: 'Patchwerk', targets: 0, minutes: 5, weight: 1 }],
      simChecks: { sockets: true, buffs: 'yes' },
      simStaleDays: 0
    });
    expect(s.gainMode).toBe('raw');
    expect(s.difficulties).toEqual(['mythic']);
    expect(s.upgrade).toMatchObject({ mythic: 'drop', heroic: 'max' });
    expect(s.setups).toEqual(DEFAULT_SIM_SETTINGS.setups);
    expect(s.checks).toMatchObject({ sockets: true, buffs: true });
    expect(s.staleDays).toBe(14);
  });
});
