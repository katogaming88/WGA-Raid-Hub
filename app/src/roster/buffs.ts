// Raid buffs, boss debuffs and raid utility, and who brings each: the one list
// every page that checks buff coverage reads (#1244). The current site keeps a
// copy in js/common.js until cutover, and a test fails when the two disagree,
// so a change here goes there too. frontend-tests.yml watches this one file
// for that test, so it imports nothing. spellId is the Wowhead spell a name
// links to; where a row covers several classes' versions of one effect, it is
// one representative spell.
export type BuffGroup = 'buff' | 'debuff' | 'utility';

export type Buff = {
  name: string;
  group: BuffGroup;
  classes: string[];
  // Only these specs bring it; absent means every spec of the classes.
  specs?: string[];
  spellId: number;
  // A utility the boss lineup checks for alongside the buffs and debuffs.
  mustHave?: boolean;
};

export const BUFFS: Buff[] = [
  { name: 'Mark of the Wild', group: 'buff', classes: ['Druid'], spellId: 1126 },
  { name: 'Arcane Intellect', group: 'buff', classes: ['Mage'], spellId: 1459 },
  { name: 'Battle Shout', group: 'buff', classes: ['Warrior'], spellId: 6673 },
  { name: 'Power Word: Fortitude', group: 'buff', classes: ['Priest'], spellId: 21562 },
  { name: 'Blessing of the Bronze', group: 'buff', classes: ['Evoker'], spellId: 364342 },
  { name: 'Skyfury', group: 'buff', classes: ['Shaman'], spellId: 462854 },
  { name: 'Devotion Aura', group: 'buff', classes: ['Paladin'], spellId: 465 },
  // Hunter's Mark goes on the boss, not the raid.
  { name: "Hunter's Mark", group: 'debuff', classes: ['Hunter'], spellId: 257284 },
  { name: 'Mystic Touch', group: 'debuff', classes: ['Monk'], spellId: 8647 },
  { name: 'Chaos Brand', group: 'debuff', classes: ['Demon Hunter'], spellId: 255260 },
  { name: 'Atrophic Poison', group: 'debuff', classes: ['Rogue'], spellId: 381637 },
  {
    name: 'Heroism / Bloodlust',
    group: 'utility',
    classes: ['Shaman', 'Mage', 'Hunter', 'Evoker'],
    spellId: 2825,
    mustHave: true
  },
  {
    name: 'Combat Res',
    group: 'utility',
    classes: ['Druid', 'Warlock', 'Paladin', 'Death Knight'],
    spellId: 20484,
    mustHave: true
  },
  { name: 'Healthstone', group: 'utility', classes: ['Warlock'], spellId: 6201 },
  { name: 'Gateway', group: 'utility', classes: ['Warlock'], spellId: 111771 },
  { name: 'Death Grip', group: 'utility', classes: ['Death Knight'], spellId: 49576 },
  { name: 'Mass Grip', group: 'utility', classes: ['Death Knight'], specs: ['Blood'], spellId: 108199 },
  { name: 'Life Grip / Rescue', group: 'utility', classes: ['Priest', 'Evoker'], spellId: 73325 },
  { name: 'Blessing of Protection', group: 'utility', classes: ['Paladin'], spellId: 1022 },
  { name: 'Darkness', group: 'utility', classes: ['Demon Hunter'], spellId: 196718 },
  { name: 'Zephyr', group: 'utility', classes: ['Evoker'], spellId: 374229 }
];

// What the boss lineup checks each boss for.
export const LINEUP_BUFFS = BUFFS.filter((b) => b.group !== 'utility' || b.mustHave);

export const brings = (buff: Buff, className: string, spec: string) =>
  buff.classes.includes(className) && (!buff.specs || buff.specs.includes(spec));
