import { describe, expect, it } from 'vitest';
import { altAsk, askedAgo, characterName, specLabel, specsFor, splitMine, swapLine, type ReviewRow } from './mainSwap';

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
  officer_note: null,
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

  // A decline stands (#1430): the database refuses that alt again, so the card
  // says so instead of offering the ask.
  it('marks an alt an officer declined, with the officer note, in place of the ask', () => {
    const declined = [request({ id: 2, status: 'declined', officer_note: 'Finish the tier on your Mage first.' })];
    expect(altAsk(null, 'Grihzy-Illidan', declined)).toEqual({
      kind: 'declined',
      note: 'Finish the tier on your Mage first.'
    });
    expect(altAsk(null, 'Grihznak-Illidan', declined)).toEqual({ kind: 'ask' });
  });

  it('matches a declined alt whatever the letter case or spaces, as the database does', () => {
    const declined = [request({ status: 'declined', name_realm: 'GRIHZBEAR-Area52' })];
    expect(altAsk(null, 'Grihzbear-Area 52', declined)).toEqual({ kind: 'declined', note: null });
  });

  it('keeps a declined alt declined while another swap waits', () => {
    const pending = request({ id: 3, name_realm: 'Grihznak-Illidan' });
    const declined = [request({ id: 2, status: 'declined', officer_note: 'Not this tier.' })];
    expect(altAsk(pending, 'Grihzy-Illidan', declined)).toEqual({ kind: 'declined', note: 'Not this tier.' });
    expect(altAsk(pending, 'Grihznak-Illidan', declined)).toEqual({ kind: 'waiting' });
    expect(altAsk(pending, 'Grihzbear-Area 52', declined)).toEqual({ kind: 'blocked' });
  });
});

describe('splitMine()', () => {
  it("splits the raider's requests into the one waiting and the declined ones, and drops the rest", () => {
    const mine = splitMine([
      request({ id: 1, status: 'declined' }),
      request({ id: 2, status: 'cancelled', name_realm: 'Grihzbear-Area 52' }),
      request({ id: 3, status: 'pending', name_realm: 'Grihznak-Illidan' }),
      request({ id: 4, status: 'approved', name_realm: 'Grihzold-Illidan' })
    ]);
    expect(mine.pending?.id).toBe(3);
    expect(mine.declined.map((r) => r.id)).toEqual([1]);
  });

  it('has nothing waiting and nothing declined for a raider with no requests', () => {
    expect(splitMine([])).toEqual({ pending: null, declined: [] });
  });
});
