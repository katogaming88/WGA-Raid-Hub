import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';

// Officer-side item_preferences reads and season scope (#707 item 1).
//
// close_season() never touches item_preferences, so at a rollover
// the previous season's rows stay put and the new season's land beside them. The raider path filters on the row's own season
// (js/wishlist.js, via isItemInSeasonScope); the officer path never fetched the
// column, so every officer-side consumer saw season undefined and
// isItemInSeasonScope's placeholder branch failed open.
//
// bisItemsFromWishlistPrefs is where that bites: it is the funnel both officer
// consumers share (the profile BiS list in renderProfile, and
// buildContestedItemMap in tab-conflicts.js), so it scopes each row itself.

function sandboxWithCatalog() {
  const sandbox = loadCommonJs(quietConsole);
  sandbox.DATA = {
    itemIds: { 'M+': 9001, Crafted: 9002, 'Old Tier Helm': 101, 'New Tier Helm': 202 },
    itemSlots: { 'Old Tier Helm': 'Head', 'New Tier Helm': 'Head' },
    itemPlaceholders: { 'M+': true, Crafted: true },
    itemZones: { 'Old Tier Helm': 10, 'New Tier Helm': 20 },
    // currentZoneIdsForSeason reads wclZoneId, the camelCase name the
    // raid_zones fetch maps to -- not the raw column name.
    raidZones: [
      { wclZoneId: 10, season: 'MID1' },
      { wclZoneId: 20, season: 'MID2' }
    ],
    seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null }]
  };
  return sandbox;
}

describe('officer item_preferences carry season (#707)', () => {
  it('drops a placeholder wishlist row tagged in a previous season', () => {
    const sandbox = sandboxWithCatalog();
    const prefs = [
      { player_id: 7, item_id: 9001, status: 'bis', slot: 'Trinket 1', season: 'MID1' },
      { player_id: 7, item_id: 9002, status: 'bis', slot: 'Trinket 2', season: 'MID2' }
    ];
    const items = sandbox.bisItemsFromWishlistPrefs(prefs, 7).map((e) => e.item);
    expect(items).toEqual(['Crafted']);
  });

  it('keeps a placeholder row with no season, which predates the column', () => {
    const sandbox = sandboxWithCatalog();
    const prefs = [{ player_id: 7, item_id: 9001, status: 'bis', slot: 'Trinket 1', season: null }];
    expect(sandbox.bisItemsFromWishlistPrefs(prefs, 7).map((e) => e.item)).toEqual(['M+']);
  });

  it('drops a real item whose zone belongs to a previous season', () => {
    const sandbox = sandboxWithCatalog();
    const prefs = [
      { player_id: 7, item_id: 101, status: 'bis', slot: null, season: 'MID1' },
      { player_id: 7, item_id: 202, status: 'bis', slot: null, season: 'MID2' }
    ];
    expect(sandbox.bisItemsFromWishlistPrefs(prefs, 7).map((e) => e.item)).toEqual(['New Tier Helm']);
  });
});
