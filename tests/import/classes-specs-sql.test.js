import { describe, it, expect } from 'vitest';
import { classesSpecsRows } from '../../scripts/classes-specs-sql.js';

// #1012: this generator built its three values with no escaping at all. Nothing
// reaches it from outside (the two tables are mirrored from js/common.js), so
// it was never a defect, but it is one of the places the repo built SQL by hand
// and CONTRIBUTING states that none do.

describe('classesSpecsRows', () => {
  it('emits one row per spec, class first', () => {
    const rows = classesSpecsRows({ Mage: { specs: ['Arcane', 'Fire'], roles: null, role: 'Ranged' } }, {});
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("('Mage', 'Arcane', 'Ranged')");
  });

  it('takes the class-level role ahead of the per-spec one, which collides on Frost', () => {
    const rows = classesSpecsRows({ Mage: { specs: ['Frost'], roles: null, role: 'Ranged' } }, { Frost: 'Melee' });
    expect(rows[0]).toContain("'Ranged'");
  });

  it('falls back to the per-spec role where the class has no fixed one', () => {
    const rows = classesSpecsRows({ Druid: { specs: ['Guardian'], roles: ['Tank'] } }, { Guardian: 'Tank' });
    expect(rows[0]).toContain("('Druid', 'Guardian', 'Tank')");
  });

  it('doubles an apostrophe in any of the three values', () => {
    const rows = classesSpecsRows({ "Kael'thas": { specs: ["Sun'well"], roles: null, role: "Ran'ged" } }, {});
    expect(rows[0]).toContain("'Kael''thas'");
    expect(rows[0]).toContain("'Sun''well'");
    expect(rows[0]).toContain("'Ran''ged'");
  });

  it('throws when a spec resolves to no role, so a new spec cannot land unlabelled', () => {
    expect(() => classesSpecsRows({ Druid: { specs: ['Balance'], roles: ['Tank'] } }, {})).toThrow(/SPEC_ROLE/);
  });
});
