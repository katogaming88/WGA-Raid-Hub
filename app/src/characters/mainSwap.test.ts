import { describe, expect, it } from 'vitest';
import { altAsk, askedAgo, characterName, specLabel, specsFor, swapLine, type ReviewRow } from './mainSwap';

const SPECS = [
  { id: 1, class: 'Evoker', spec: 'Preservation', role: 'Heal' },
  { id: 2, class: 'Evoker', spec: 'Augmentation', role: 'Ranged' },
  { id: 3, class: 'Mage', spec: 'Frost', role: 'Ranged' }
];

const request = (extra: Partial<ReviewRow> = {}): ReviewRow => ({
  id: 1,
  team_id: 1,
  person_id: 7,
  from_player_id: 5,
  character_id: 9,
  name_realm: 'Grihzy-Illidan',
  class_spec_id: 1,
  note: null,
  status: 'pending',
  requested_at: '2026-09-14T18:00:00Z',
  from_player: { name_realm: 'Grihzold-Illidan' },
  classes_specs: { class: 'Evoker', spec: 'Preservation', role: 'Heal' },
  ...extra
});

describe('specsFor()', () => {
  it("offers the character's own class, in spec order", () => {
    expect(specsFor(SPECS, 'Evoker').map((s) => s.spec)).toEqual(['Augmentation', 'Preservation']);
  });

  it('offers none when Battle.net gave no class, so nothing is guessed', () => {
    expect(specsFor(SPECS, null)).toEqual([]);
  });
});

describe('what an officer reads', () => {
  it('names who moves where, and as what', () => {
    expect(swapLine(request())).toBe('Grihzold to Grihzy-Illidan, Preservation Evoker');
  });

  it('says so rather than inventing a spec when the request has none', () => {
    expect(specLabel(null)).toBe('Spec not recorded');
  });

  it('drops the realm from a name that already sits beside one', () => {
    expect(characterName('Grihzold-Illidan')).toBe('Grihzold');
  });
});

describe('askedAgo()', () => {
  const now = new Date('2026-09-16T12:00:00Z');

  it('counts whole days, and calls anything under one today', () => {
    expect(askedAgo('2026-09-16T06:00:00Z', now)).toBe('asked today');
    expect(askedAgo('2026-09-15T06:00:00Z', now)).toBe('asked yesterday');
    expect(askedAgo('2026-09-12T06:00:00Z', now)).toBe('asked 4 days ago');
  });

  it('does not read a broken date as a long wait', () => {
    expect(askedAgo('not a date', now)).toBe('asked today');
  });
});

describe('altAsk()', () => {
  it('offers the ask when nothing is waiting', () => {
    expect(altAsk(null, 'Grihzy-Illidan')).toEqual({ kind: 'ask' });
  });

  it('marks the alt the waiting request names, and blocks the others', () => {
    const pending = request();
    expect(altAsk(pending, 'Grihzy-Illidan')).toEqual({ kind: 'waiting' });
    expect(altAsk(pending, 'Grihznak-Illidan')).toEqual({ kind: 'blocked' });
  });
});
