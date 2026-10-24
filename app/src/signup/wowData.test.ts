import { describe, expect, it } from 'vitest';
import { CLASS_SPECS, specRole } from './wowData';

describe('specRole', () => {
  it('is fixed for a pure ranged/melee class', () => {
    expect(specRole('Mage', 'Frost')).toBe('Ranged');
    expect(specRole('Rogue', 'Subtlety')).toBe('Melee');
  });

  it("is the spec's role for everyone else", () => {
    expect(specRole('Druid', 'Balance')).toBe('Ranged');
    expect(specRole('Druid', 'Feral')).toBe('Melee');
    expect(specRole('Druid', 'Restoration')).toBe('Heal');
    expect(specRole('Warrior', 'Protection')).toBe('Tank');
    expect(specRole('Death Knight', 'Frost')).toBe('Melee');
    expect(specRole('Hunter', 'Survival')).toBe('Melee');
    expect(specRole('Hunter', 'Beast Mastery')).toBe('Ranged');
  });

  it('is null with no spec picked yet, or a class it does not know', () => {
    expect(specRole('Priest', '')).toBeNull();
    expect(specRole('Tinker', 'Frost')).toBeNull();
  });
});

describe('CLASS_SPECS', () => {
  it('has every class the roster shows', () => {
    expect(Object.keys(CLASS_SPECS)).toHaveLength(13);
  });
});
