import { describe, expect, it } from 'vitest';
import { BUFFS, LINEUP_BUFFS, brings } from './buffs';

// The one list of raid buffs, boss debuffs and raid utility (#1244). Its
// match against the current site's copy in js/common.js is checked by
// tests/frontend/buff-list-drift.test.js, which runs when either file changes.

const buff = (name: string) => BUFFS.find((b) => b.name === name)!;

describe('the buff list', () => {
  it('names each buff once, with the classes that bring it and its Wowhead spell', () => {
    expect(BUFFS).toHaveLength(21);
    expect(new Set(BUFFS.map((b) => b.name)).size).toBe(BUFFS.length);
    for (const b of BUFFS) {
      expect(b.classes.length).toBeGreaterThan(0);
      expect(b.spellId).toBeGreaterThan(0);
    }
  });

  it('gives the boss lineup the raid buffs, the boss debuffs, lust and a battle res', () => {
    expect(LINEUP_BUFFS.map((b) => b.name)).toEqual([
      'Mark of the Wild',
      'Arcane Intellect',
      'Battle Shout',
      'Power Word: Fortitude',
      'Blessing of the Bronze',
      'Skyfury',
      'Devotion Aura',
      "Hunter's Mark",
      'Mystic Touch',
      'Chaos Brand',
      'Atrophic Poison',
      'Heroism / Bloodlust',
      'Combat Res'
    ]);
  });

  it('counts a buff only one spec brings for that spec alone', () => {
    expect(brings(buff('Mass Grip'), 'Death Knight', 'Blood')).toBe(true);
    expect(brings(buff('Mass Grip'), 'Death Knight', 'Frost')).toBe(false);
    expect(brings(buff('Death Grip'), 'Death Knight', 'Frost')).toBe(true);
    expect(brings(buff('Death Grip'), 'Warrior', 'Arms')).toBe(false);
  });
});
