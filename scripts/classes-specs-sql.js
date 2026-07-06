'use strict';

// Generates classes_specs INSERT SQL.
//
// Unlike the other importers in issue #320, classes_specs has no source Sheet
// tab -- it's fixed WoW reference data. The source of truth is CLASS_SPECS and
// SPEC_ROLE in js/common.js (used today to drive the signup form's dropdowns).
// The two objects below are mirrored from there -- keep them in sync if a spec
// is ever added, renamed, or reworked by a WoW expansion/patch.
//
// --- How to run ---
//   node scripts/classes-specs-sql.js
//
// --- Output ---
// Ready-to-paste INSERT SQL is printed for the Supabase SQL Editor.

// Mirrored from js/common.js CLASS_SPECS.
// `role` (singular) is a fixed role for every spec in the class. `roles`
// (plural, or null) means the class's role varies by spec -- resolved per
// spec via SPEC_ROLE below.
const CLASS_SPECS = {
  'Death Knight': { specs: ['Blood', 'Frost', 'Unholy'], roles: ['Tank', 'DPS'] },
  'Demon Hunter': { specs: ['Havoc', 'Vengeance', 'Devourer'], roles: ['Tank', 'DPS'] },
  Druid: { specs: ['Balance', 'Feral', 'Guardian', 'Restoration'], roles: ['Tank', 'Healer', 'DPS'] },
  Evoker: { specs: ['Augmentation', 'Devastation', 'Preservation'], roles: ['Healer', 'DPS'] },
  Hunter: { specs: ['Beast Mastery', 'Marksmanship', 'Survival'], roles: ['Melee', 'Ranged'] },
  Mage: { specs: ['Arcane', 'Fire', 'Frost'], roles: null, role: 'Ranged' },
  Monk: { specs: ['Brewmaster', 'Mistweaver', 'Windwalker'], roles: ['Tank', 'Healer', 'DPS'] },
  Paladin: { specs: ['Holy', 'Protection', 'Retribution'], roles: ['Tank', 'Healer', 'DPS'] },
  Priest: { specs: ['Discipline', 'Holy', 'Shadow'], roles: ['Healer', 'DPS'] },
  Rogue: { specs: ['Assassination', 'Outlaw', 'Subtlety'], roles: null, role: 'Melee' },
  Shaman: { specs: ['Elemental', 'Enhancement', 'Restoration'], roles: ['Healer', 'DPS'] },
  Warlock: { specs: ['Affliction', 'Demonology', 'Destruction'], roles: null, role: 'Ranged' },
  Warrior: { specs: ['Arms', 'Fury', 'Protection'], roles: ['Tank', 'DPS'] }
};

// Mirrored from js/common.js SPEC_ROLE.
// Keyed by spec name alone, so it is NOT safe to use directly for classes
// that have a fixed class-level `role` above (Mage/Rogue/Warlock) -- e.g.
// Frost collides between Death Knight (Melee) and Mage (Ranged). Resolution
// below always checks CLASS_SPECS[class].role first.
const SPEC_ROLE = {
  Arcane: 'Ranged',
  Fire: 'Ranged',
  Affliction: 'Ranged',
  Demonology: 'Ranged',
  Destruction: 'Ranged',
  'Beast Mastery': 'Ranged',
  Marksmanship: 'Ranged',
  Survival: 'Melee',
  Balance: 'Ranged',
  Shadow: 'Ranged',
  Elemental: 'Ranged',
  Augmentation: 'Ranged',
  Devastation: 'Ranged',
  Devourer: 'Ranged',
  Assassination: 'Melee',
  Outlaw: 'Melee',
  Subtlety: 'Melee',
  Feral: 'Melee',
  Windwalker: 'Melee',
  Retribution: 'Melee',
  Enhancement: 'Melee',
  Havoc: 'Melee',
  Arms: 'Melee',
  Fury: 'Melee',
  Frost: 'Melee',
  Unholy: 'Melee',
  Blood: 'Tank',
  Guardian: 'Tank',
  Brewmaster: 'Tank',
  Protection: 'Tank',
  Vengeance: 'Tank',
  Restoration: 'Heal',
  Mistweaver: 'Heal',
  Holy: 'Heal',
  Discipline: 'Heal',
  Preservation: 'Heal'
};

const rows = [];

for (const [className, data] of Object.entries(CLASS_SPECS)) {
  for (const spec of data.specs) {
    const role = data.role || SPEC_ROLE[spec];
    if (!role) {
      throw new Error(`No role resolved for ${className} / ${spec} -- add it to SPEC_ROLE.`);
    }
    rows.push(`  ('${className}', '${spec}', '${role}')`);
  }
}

console.log('-- Paste into Supabase SQL Editor (or apply with psql -f):');
console.log('insert into classes_specs (class, spec, role)');
console.log('values');
console.log(rows.join(',\n'));
console.log('on conflict (class, spec) do nothing;');
