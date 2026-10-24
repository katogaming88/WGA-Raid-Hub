// Class, spec and role data for the Sign Up form (#1102), ported from
// js/common.js's CLASS_SPECS/SPEC_ROLE. `role: 'Melee' | 'Ranged'` on a pure
// class fixes its role outright.
export type ClassData = { specs: string[]; role?: 'Melee' | 'Ranged' };

export const CLASS_SPECS: Record<string, ClassData> = {
  'Death Knight': { specs: ['Blood', 'Frost', 'Unholy'] },
  'Demon Hunter': { specs: ['Havoc', 'Vengeance', 'Devourer'] },
  Druid: { specs: ['Balance', 'Feral', 'Guardian', 'Restoration'] },
  Evoker: { specs: ['Augmentation', 'Devastation', 'Preservation'] },
  Hunter: { specs: ['Beast Mastery', 'Marksmanship', 'Survival'] },
  Mage: { specs: ['Arcane', 'Fire', 'Frost'], role: 'Ranged' },
  Monk: { specs: ['Brewmaster', 'Mistweaver', 'Windwalker'] },
  Paladin: { specs: ['Holy', 'Protection', 'Retribution'] },
  Priest: { specs: ['Discipline', 'Holy', 'Shadow'] },
  Rogue: { specs: ['Assassination', 'Outlaw', 'Subtlety'], role: 'Melee' },
  Shaman: { specs: ['Elemental', 'Enhancement', 'Restoration'] },
  Warlock: { specs: ['Affliction', 'Demonology', 'Destruction'], role: 'Ranged' },
  Warrior: { specs: ['Arms', 'Fury', 'Protection'] }
};

// Each spec's raid role. A pure class's fixed `role` wins over it (Mage
// Frost is Ranged; Death Knight Frost is Melee).
export const SPEC_ROLE: Record<string, 'Tank' | 'Heal' | 'Melee' | 'Ranged'> = {
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

// The raid role a class/spec plays (#1466: the spec says it, so there is no
// Primary role to pick): a pure class's fixed role, else the spec's.
export function specRole(className: string, mainSpec: string): 'Tank' | 'Heal' | 'Melee' | 'Ranged' | null {
  const cls = CLASS_SPECS[className];
  if (!cls) return null;
  return cls.role ?? SPEC_ROLE[mainSpec] ?? null;
}
