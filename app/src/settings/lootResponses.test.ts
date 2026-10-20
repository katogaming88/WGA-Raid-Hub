import { describe, expect, it } from 'vitest';
import { draftFromSeen, moveItem, seenResponses, todaysCountsAs, unlistedResponses } from './lootResponses';

describe('what gets counted as loot received (#1561)', () => {
  it('counts a response with no list saved the way it is counted today', () => {
    expect(todaysCountsAs('Upgrade')).toBe('main');
    expect(todaysCountsAs('OS/M+')).toBe('off');
    expect(todaysCountsAs('Offspec/Greed')).toBe('main');
    expect(todaysCountsAs('Bonus Loot')).toBe('none');
    expect(todaysCountsAs('Disenchant')).toBe('none');
    expect(todaysCountsAs('xmog')).toBe('hidden');
    expect(todaysCountsAs('Pet')).toBe('hidden');
  });

  it('merges spellings that differ only in case, keeping the one used most', () => {
    const seen = seenResponses(['Track upgrade', 'Track Upgrade', 'Track upgrade', null, '', 'Upgrade']);
    expect(seen).toEqual([
      { text: 'Track upgrade', count: 3 },
      { text: 'Upgrade', count: 1 }
    ]);
  });

  it('starts a first list from the imports, most used first, without the fixed rows', () => {
    const seen = seenResponses(['Disenchant', 'Upgrade', 'Upgrade', 'OS/M+', 'Personal Loot - Non tradeable']);
    expect(draftFromSeen(seen)).toEqual({
      buttons: [
        { text: 'Upgrade', countsAs: 'main' },
        { text: 'OS/M+', countsAs: 'off' }
      ],
      groups: []
    });
  });

  it('finds a used response the list does not name, in any list or group', () => {
    const seen = seenResponses(['Upgrade', 'Mythic+', 'Mythic+', '2/4 Set', 'Disenchant']);
    const list = {
      buttons: [{ text: 'upgrade', countsAs: 'main' as const }],
      groups: [{ name: 'Armor Token', buttons: [{ text: '2/4 Set', countsAs: 'main' as const }] }]
    };
    expect(unlistedResponses(list, seen)).toEqual([{ text: 'Mythic+', count: 2 }]);
  });

  it('moves a button one place, and not past either end', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});
