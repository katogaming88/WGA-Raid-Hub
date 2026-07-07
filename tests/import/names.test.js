import { describe, it, expect } from 'vitest';
import { normName, stripNickname, firstName } from '../../scripts/import/lib/names.js';

describe('normName', () => {
  it('lowercases and trims', () => {
    expect(normName('  Hinda ')).toBe('hinda');
  });
  it('strips diacritics like the Apps Script matcher', () => {
    expect(normName('Ñara')).toBe('nara');
    expect(normName('Séraphine-Thrall')).toBe('seraphine-thrall');
  });
  it('handles empty and null', () => {
    expect(normName('')).toBe('');
    expect(normName(null)).toBe('');
  });
});

describe('stripNickname', () => {
  it('removes a trailing parenthesized nickname', () => {
    expect(stripNickname('Hinda-Thrall (Roth)')).toBe('Hinda-Thrall');
  });
  it('removes a trailing dash-separated nickname', () => {
    expect(stripNickname('Hinda-Thrall - Roth')).toBe('Hinda-Thrall');
  });
  it('keeps realm names that contain spaces', () => {
    expect(stripNickname('Fxd-Area 52 - FX')).toBe('Fxd-Area 52');
    expect(stripNickname('Zuggz-Area 52')).toBe('Zuggz-Area 52');
  });
  it('leaves plain names alone', () => {
    expect(stripNickname('Hinda-Thrall')).toBe('Hinda-Thrall');
  });
});

describe('firstName', () => {
  it('splits First-Realm', () => {
    expect(firstName('Hinda-Thrall')).toBe('Hinda');
  });
  it('passes bare names through', () => {
    expect(firstName('Hinda')).toBe('Hinda');
  });
});
