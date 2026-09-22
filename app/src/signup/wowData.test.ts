import { describe, expect, it } from 'vitest';
import { CLASS_SPECS, resolveRole } from './wowData';

describe('resolveRole', () => {
  it('is fixed for a pure ranged/melee class', () => {
    expect(resolveRole('Mage', 'Fire', null)).toBe('Ranged');
    expect(resolveRole('Rogue', 'Subtlety', null)).toBe('Melee');
  });

  it('resolves a hybrid’s DPS/Healer choice through the spec', () => {
    expect(resolveRole('Druid', 'Balance', 'DPS')).toBe('Ranged');
    expect(resolveRole('Druid', 'Feral', 'DPS')).toBe('Melee');
    expect(resolveRole('Druid', 'Restoration', 'Healer')).toBe('Heal');
  });

  it('keeps Tank as Tank', () => {
    expect(resolveRole('Warrior', 'Protection', 'Tank')).toBe('Tank');
  });

  it('passes Hunter’s own Melee/Ranged choice through unchanged', () => {
    expect(resolveRole('Hunter', 'Survival', 'Melee')).toBe('Melee');
    expect(resolveRole('Hunter', 'Beast Mastery', 'Ranged')).toBe('Ranged');
  });

  it('is null with no role chosen yet on a hybrid', () => {
    expect(resolveRole('Priest', 'Shadow', null)).toBeNull();
  });
});

describe('CLASS_SPECS', () => {
  it('has every class the roster shows, and Hunter offers a role choice', () => {
    expect(Object.keys(CLASS_SPECS)).toHaveLength(13);
    expect(CLASS_SPECS['Hunter']!.roles).toEqual(['Melee', 'Ranged']);
    expect(CLASS_SPECS['Hunter']!.role).toBeUndefined();
  });
});
