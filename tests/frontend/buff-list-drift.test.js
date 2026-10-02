import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';
import { BUFFS } from '../../app/src/roster/buffs.ts';

// The new app keeps the one buff list (app/src/roster/buffs.ts, #1244). The
// current site keeps its own copy in js/common.js until cutover retires it, so
// this fails when the two disagree: a change to one has to reach the other.
// frontend-tests.yml watches the app's file for that reason.

const common = loadCommonJs(quietConsole);

// Copied out of the vm's realm, so toEqual compares plain arrays.
const plain = (value) => JSON.parse(JSON.stringify(value));

const appGroup = (group) =>
  BUFFS.filter((b) => b.group === group).map(({ name, classes, specs, spellId }) => ({
    name,
    classes,
    ...(specs ? { specs } : {}),
    spellId
  }));

describe('js/common.js’s buff lists match app/src/roster/buffs.ts (#1244)', () => {
  it('raid buffs', () => {
    expect(plain(common.RAID_BUFFS)).toEqual(appGroup('buff'));
  });

  it('boss debuffs', () => {
    expect(plain(common.BOSS_DEBUFFS)).toEqual(appGroup('debuff'));
  });

  it('utility', () => {
    expect(plain(common.RAID_UTILITY)).toEqual(appGroup('utility'));
  });
});
