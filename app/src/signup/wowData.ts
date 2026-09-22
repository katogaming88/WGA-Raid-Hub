// Class, spec and role data for the Sign Up form (#1102), ported from
// js/common.js's CLASS_SPECS/SPEC_ROLE. `role: 'Melee' | 'Ranged'` on a pure
// class fixes its role outright; `roles` on a hybrid lists the choices the
// raider picks a Primary Role from.
export type ClassData = { specs: string[]; roles: string[] | null; role?: 'Melee' | 'Ranged' };

export const CLASS_SPECS: Record<string, ClassData> = {
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

export const CLASS_NAMES = Object.keys(CLASS_SPECS).sort();

// Maps a hybrid class's spec to its raid role, once "DPS"/"Healer" needs to
// become "Melee"/"Ranged"/"Heal". Pure classes never consult this (their role
// is fixed, or, for Hunter, resolved by spec directly below).
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

// The raid role a class/spec plays: a pure class's fixed role, or a hybrid's
// chosen Primary Role -- 'Tank' stays as-is, 'DPS'/'Healer' resolve through
// SPEC_ROLE to the real Melee/Ranged/Heal, and Hunter's own options (its
// Primary Role choices are already 'Melee'/'Ranged', not 'DPS') pass through
// unchanged. Ported rule for rule from js/signup.js's signupNext() step 3.
export function resolveRole(
  className: string,
  mainSpec: string,
  primaryRole: string | null
): 'Tank' | 'Heal' | 'Melee' | 'Ranged' | null {
  const cls = CLASS_SPECS[className];
  if (!cls) return null;
  if (cls.role) return cls.role;
  if (!primaryRole) return null;
  if (primaryRole === 'DPS' || primaryRole === 'Healer')
    return SPEC_ROLE[mainSpec] ?? (primaryRole === 'Healer' ? 'Heal' : null);
  return primaryRole as 'Tank' | 'Heal' | 'Melee' | 'Ranged';
}

// An error string, or null when the name is fine. Ported rule for rule from
// js/common.js's validateCharName().
export function validateCharName(name: string): string | null {
  if (!name) return 'Please enter your character name.';
  if (name.length < 2 || name.length > 12) return 'Character name must be 2-12 characters.';
  // \p{Lu} (any uppercase letter), not [A-Z]: WoW names can start with an
  // accented capital like \u00c9leanor.
  if (!/^\p{Lu}/u.test(name)) return 'Character name must start with a capital letter (e.g. Katorri).';
  if (/\p{Lu}/u.test(name.slice(1))) {
    return `Character name can only have one capital letter (the first). Did you mean ${name[0]}${name.slice(1).toLowerCase()}?`;
  }
  return null;
}
