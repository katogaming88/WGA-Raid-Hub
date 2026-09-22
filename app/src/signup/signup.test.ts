import { describe, expect, it } from 'vitest';
import {
  buildSubmission,
  classMismatch,
  classmatesPool,
  claimDiffers,
  realmMatches,
  type ClassmateRow,
  type IncomingSignupRow
} from './signup';

const row = (nameRealm: string, cls: string, spec: string, role: string): ClassmateRow => ({
  nameRealm,
  class: cls,
  spec,
  role
});

describe('classmatesPool', () => {
  const incoming: IncomingSignupRow[] = [{ ...row('New-Illidan', 'Mage', 'Fire', 'Ranged'), swapFromNameRealm: null }];
  const roster: ClassmateRow[] = [row('Old-Illidan', 'Warrior', 'Fury', 'Melee')];

  it('is only the incoming roster when the live season differs from the signup tier', () => {
    expect(classmatesPool(incoming, roster, 'MID1', 'MID2')).toEqual(incoming);
    expect(classmatesPool(incoming, roster, null, 'MID2')).toEqual(incoming);
  });

  it('adds the active roster once the live season matches', () => {
    const pool = classmatesPool(incoming, roster, 'MID2', 'MID2');
    expect(pool.map((p) => p.nameRealm).sort()).toEqual(['New-Illidan', 'Old-Illidan']);
  });

  it('excludes a roster character who has an incoming swap away from them', () => {
    const swapIncoming: IncomingSignupRow[] = [
      { ...row('New-Illidan', 'Mage', 'Fire', 'Ranged'), swapFromNameRealm: 'Old-Illidan' }
    ];
    const pool = classmatesPool(swapIncoming, roster, 'MID2', 'MID2');
    expect(pool.map((p) => p.nameRealm)).toEqual(['New-Illidan']);
  });
});

describe('realmMatches', () => {
  const realms = ['Illidan', 'Area 52', 'Stormrage', "Zul'jin"];

  it('is empty for an empty query', () => {
    expect(realmMatches(realms, '')).toEqual([]);
  });

  it('matches a substring, case-insensitively', () => {
    expect(realmMatches(realms, 'rea')).toEqual(['Area 52']);
    expect(realmMatches(realms, 'storm')).toEqual(['Stormrage']);
  });
});

describe('claimDiffers', () => {
  it('is false with no claim', () => {
    expect(claimDiffers(null, 'Katorri', 'Stormrage')).toBe(false);
  });

  it('is false when the typed name matches, case-insensitively', () => {
    expect(claimDiffers('katorri-stormrage', 'Katorri', 'Stormrage')).toBe(false);
  });

  it('is true when they differ', () => {
    expect(claimDiffers('Katorri-Stormrage', 'Rex', 'Stormrage')).toBe(true);
  });
});

describe('classMismatch', () => {
  it('is false when the claim itself differs (that is its own warning)', () => {
    expect(classMismatch('Warrior', 'Katorri-Stormrage', 'Rex', 'Stormrage', 'Mage')).toBe(false);
  });

  it('is true when the typed name matches the claim but the class does not', () => {
    expect(classMismatch('Warrior', 'Katorri-Stormrage', 'Katorri', 'Stormrage', 'Mage')).toBe(true);
  });

  it('is false when the class matches', () => {
    expect(classMismatch('Warrior', 'Katorri-Stormrage', 'Katorri', 'Stormrage', 'Warrior')).toBe(false);
  });

  it('is false with no claimed character on file', () => {
    expect(classMismatch(null, 'Katorri-Stormrage', 'Katorri', 'Stormrage', 'Mage')).toBe(false);
  });
});

describe('buildSubmission', () => {
  const fields = {
    charName: 'Katorri',
    realm: 'Stormrage',
    className: 'Priest',
    mainSpec: 'Holy',
    offSpecs: ['Discipline'],
    primaryRole: 'Healer',
    notes: 'Trial run'
  };

  it('is not a swap when the raider is not swapping', () => {
    expect(buildSubmission(fields, false, null)).toEqual({
      p_name_realm: 'Katorri-Stormrage',
      p_class: 'Priest',
      p_spec: 'Holy',
      p_off_specs: 'Discipline',
      p_main_swap: false,
      p_player_note: 'Trial run',
      p_swap_from_name_realm: null
    });
  });

  it('carries the claim as the swap-from character', () => {
    expect(buildSubmission(fields, true, 'Rex-Stormrage').p_swap_from_name_realm).toBe('Rex-Stormrage');
    expect(buildSubmission(fields, true, 'Rex-Stormrage').p_main_swap).toBe(true);
  });
});
