import { describe, expect, it } from 'vitest';
import { boeFieldError, boeSeasonCatalog, defaultBoeTeamId, EMPTY_BOE_FIELDS } from './boe';

describe('boeFieldError', () => {
  const filled = {
    teamId: 2,
    charName: 'Kae-Tichondrius',
    itemName: 'Voidglass Cloak',
    track: 'Hero',
    rank: '2/6',
    note: '',
    donate: false
  };

  it('passes a fully filled form', () => {
    expect(boeFieldError(filled)).toBeNull();
  });

  it('names the team first, since it is the first field', () => {
    expect(boeFieldError(EMPTY_BOE_FIELDS)).toBe('Please select the team you raided with.');
  });

  it.each([
    ['charName', '', 'Please enter your character name.'],
    ['itemName', '', 'Please select an item.'],
    ['track', '', 'Please select the track.'],
    ['rank', '', 'Please select the upgrade rank.']
  ] as const)('requires %s', (field, blank, message) => {
    expect(boeFieldError({ ...filled, [field]: blank })).toBe(message);
  });
});

describe('boeSeasonCatalog', () => {
  const S1 = { id: 10, name: 'Visage of Unseen Truths', wcl_zone_id: 46 };
  const S2 = { id: 11, name: 'Crushing Coiler Coif', wcl_zone_id: 53 };
  const UNSCOPED = { id: 12, name: 'Seed Test BoE Belt', wcl_zone_id: null };
  const ZONES = [
    { wcl_zone_id: 46, season: 'MID1' },
    { wcl_zone_id: 53, season: 'MID2' }
  ];

  it("offers the season's items plus any unscoped one, sorted by name", () => {
    expect(boeSeasonCatalog([S1, S2, UNSCOPED], 'MID2', ZONES).map((i) => i.name)).toEqual([
      'Crushing Coiler Coif',
      'Seed Test BoE Belt'
    ]);
  });

  it('offers every item when there is no current season', () => {
    expect(boeSeasonCatalog([S1, S2, UNSCOPED], null, ZONES).map((i) => i.id)).toEqual([11, 12, 10]);
  });

  it('fails open to the whole catalog when the season has no zones recorded', () => {
    expect(boeSeasonCatalog([S1, S2], 'MID3', ZONES).map((i) => i.id)).toEqual([11, 10]);
  });
});

describe('defaultBoeTeamId', () => {
  it('picks the one claimed team', () => {
    expect(defaultBoeTeamId([3])).toBe(3);
  });

  it('leaves the placeholder for no claim', () => {
    expect(defaultBoeTeamId([])).toBeNull();
  });

  it('leaves the placeholder for alts on multiple teams', () => {
    expect(defaultBoeTeamId([2, 3])).toBeNull();
  });
});
