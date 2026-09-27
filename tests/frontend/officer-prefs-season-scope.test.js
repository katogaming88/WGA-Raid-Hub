import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';
import { keysetClient } from './helpers/supabase-mock.js';

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
    itemNamesById: { 9001: 'M+', 9002: 'Crafted', 101: 'Old Tier Helm', 202: 'New Tier Helm' },
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

// The read itself asks for one tier (#936). bisItemsFromWishlistPrefs above is
// one funnel of several: the ranked-row status, the completion badge, the
// roster's Wishlists Completed card and the Notes sub-tab each read the rows as
// fetched, so the tier has to be settled where the rows arrive rather than once
// per consumer. scopeToSeasonView() is where that decision lives, beside
// resolveSeasonViewCode(), and it mirrors wishlistScopeToSeason() on the
// raider's own page.
describe('scopeToSeasonView (#936)', () => {
  it('narrows to the tier the officer is viewing', () => {
    const sandbox = sandboxWithCatalog();
    const calls = [];
    const query = { eq: (col, val) => (calls.push([col, val]), query) };
    expect(sandbox.scopeToSeasonView(query)).toBe(query);
    expect(calls).toEqual([['season', 'MID2']]);
  });

  it('narrows to the pin over the live tier', () => {
    const sandbox = sandboxWithCatalog();
    sandbox.DATA.seasonView = 'Midnight Season 1';
    sandbox.DATA.seasons.push({ code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-04-01' });
    const calls = [];
    const query = { eq: (col, val) => (calls.push([col, val]), query) };
    sandbox.scopeToSeasonView(query);
    expect(calls).toEqual([['season', 'MID1']]);
  });

  // The seasons table is filled by migration and read app-wide, so no tier
  // resolving means the read failed rather than that there are no tiers. These
  // are read-only officer views with no editing to close, so the answer is the
  // pre-#936 behaviour: show every pick rather than none. Narrowing to the empty
  // string would read as every raider holding an empty wishlist.
  it('narrows nothing when no tier resolves', () => {
    const sandbox = sandboxWithCatalog();
    sandbox.DATA.seasons = [];
    const calls = [];
    const query = { eq: (col, val) => (calls.push([col, val]), query) };
    expect(sandbox.scopeToSeasonView(query)).toBe(query);
    expect(calls).toEqual([]);
  });
});

describe('fetchPlayerItemPreferences season scope (#936)', () => {
  function sandboxWithClient(seasons) {
    const sandbox = sandboxWithCatalog();
    if (seasons !== undefined) sandbox.DATA.seasons = seasons;
    const { client, calls } = keysetClient([]);
    sandbox.supabaseClient = client;
    return { sandbox, calls };
  }

  it('asks for the tier the officer is viewing, and for that one player', async () => {
    const { sandbox, calls } = sandboxWithClient();
    await sandbox.fetchPlayerItemPreferences(7);
    expect(calls.eqs).toEqual([
      ['player_id', 7],
      ['season', 'MID2']
    ]);
  });

  it('asks for every tier when no tier resolves', async () => {
    const { sandbox, calls } = sandboxWithClient([]);
    await sandbox.fetchPlayerItemPreferences(7);
    expect(calls.eqs).toEqual([['player_id', 7]]);
  });
});
