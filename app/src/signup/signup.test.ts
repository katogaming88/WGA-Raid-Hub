import { describe, expect, it } from 'vitest';
import { classmatesPool, readingLabel, readPick, type ClassmateRow, type IncomingSignupRow } from './signup';

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

// What a pick means (#1466), as declare_season_signup() decides it.
describe('readPick', () => {
  const katorri = { playerId: 7, nameRealm: 'Katorrí-Stormrage' };

  it('is the same main when the pick is their character on the roster, spaces and case aside', () => {
    expect(readPick('katorrí-stormrage', [katorri])).toEqual({ kind: 'same' });
    expect(readPick('Grihz-Area 52', [{ playerId: 3, nameRealm: 'Grihz-Area52' }])).toEqual({ kind: 'same' });
  });

  it('is the same main when they have two roster characters and pick either', () => {
    expect(readPick('Grihz-Illidan', [katorri, { playerId: 9, nameRealm: 'Grihz-Illidan' }])).toEqual({ kind: 'same' });
  });

  it('is a new main replacing their roster character when the pick is another', () => {
    expect(readPick('Grihz-Illidan', [katorri])).toEqual({ kind: 'new', replaces: 'Katorrí-Stormrage' });
  });

  it('replaces the earliest roster character when they have two, as the database does', () => {
    const later = { playerId: 12, nameRealm: 'Zed-Illidan' };
    expect(readPick('Grihz-Illidan', [later, katorri])).toEqual({ kind: 'new', replaces: 'Katorrí-Stormrage' });
  });

  it('is a first main when they have no roster character on the team', () => {
    expect(readPick('Katorrí-Stormrage', [])).toEqual({ kind: 'first' });
  });

  it('says each plainly', () => {
    expect(readingLabel({ kind: 'same' })).toBe('Same main as now');
    expect(readingLabel({ kind: 'new', replaces: 'Katorrí-Stormrage' })).toBe('New main: replaces Katorrí-Stormrage');
    expect(readingLabel({ kind: 'first' })).toBe('First main on this team');
  });
});
