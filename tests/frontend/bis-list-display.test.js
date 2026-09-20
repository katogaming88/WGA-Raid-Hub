import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// BiS List display: (1) rows sort into canonical gear-slot order; (2) the
// rows come from the raider's wishlist BiS tags through the shared
// bisItemsFromWishlistPrefs() core, on the raider's own profile and on the
// officer's read view alike.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeSandbox() {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console,
    Intl,
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

describe('bisDisplaySortKey / BiS List row ordering', () => {
  it('sorts entries into canonical gear-slot order regardless of input order', () => {
    const sandbox = makeSandbox();
    const itemSlots = { Helm: 'Head', Girdle: 'Waist', Bands: 'Wrist', Cape: 'Back', Necklace: 'Neck' };
    const entries = [
      { item: 'Girdle', slot: '', dbSlot: '' },
      { item: 'Bands', slot: '', dbSlot: '' },
      { item: 'Cape', slot: '', dbSlot: '' },
      { item: 'Helm', slot: '', dbSlot: '' },
      { item: 'Necklace', slot: '', dbSlot: '' }
    ];

    const sorted = entries
      .slice()
      .sort((a, b) => sandbox.bisDisplaySortKey(a, itemSlots) - sandbox.bisDisplaySortKey(b, itemSlots));

    expect(sorted.map((e) => e.item)).toEqual(['Helm', 'Necklace', 'Cape', 'Bands', 'Girdle']);
  });

  it('prefers an explicit dbSlot/slot over the catalog-derived row', () => {
    const sandbox = makeSandbox();
    const itemSlots = { Ring: 'Finger' };
    const entry = { item: 'Ring', slot: '', dbSlot: 'Finger 2' };
    expect(sandbox.bisDisplaySortKey(entry, itemSlots)).toBe(sandbox.BIS_DISPLAY_SLOT_ORDER.indexOf('Finger 2'));
  });

  it('falls back to the catalog slot, collapsing Finger/Trinket to their first row', () => {
    const sandbox = makeSandbox();
    const itemSlots = { Ring: 'Finger', Charm: 'Trinket' };
    const ringEntry = { item: 'Ring', slot: '', dbSlot: '' };
    const trinketEntry = { item: 'Charm', slot: '', dbSlot: '' };
    expect(sandbox.bisDisplaySortKey(ringEntry, itemSlots)).toBe(sandbox.BIS_DISPLAY_SLOT_ORDER.indexOf('Finger 1'));
    expect(sandbox.bisDisplaySortKey(trinketEntry, itemSlots)).toBe(
      sandbox.BIS_DISPLAY_SLOT_ORDER.indexOf('Trinket 1')
    );
  });

  it('places an unrecognisable entry (e.g. a placeholder without a slot) last', () => {
    const sandbox = makeSandbox();
    const entry = { item: 'M+', slot: '', dbSlot: '' };
    expect(sandbox.bisDisplaySortKey(entry, {})).toBe(sandbox.BIS_DISPLAY_SLOT_ORDER.length);
  });
});

describe('bisItemsFromWishlistPrefs (the BiS List rows)', () => {
  it('turns a wishlist BiS tag into a display row', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'New Helm': 1 },
      itemSlots: { 'New Helm': 'Head' },
      itemPlaceholders: {}
    };
    const prefs = [{ item_id: 1, status: 'bis', slot: null }];

    expect(sandbox.bisItemsFromWishlistPrefs(prefs, 11)).toEqual([
      { item: 'New Helm', slot: '', dbSlot: '', obtained: false, playerId: 11, itemId: 1, fromWishlist: true }
    ]);
  });

  it('keeps a placeholder row (Other Sources) on its exact tagged row', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'M+': 1 },
      itemSlots: {},
      itemPlaceholders: { 'M+': true }
    };
    const prefs = [{ item_id: 1, status: 'bis', slot: 'Waist' }];

    expect(sandbox.bisItemsFromWishlistPrefs(prefs, 11).map((e) => [e.item, e.slot, e.dbSlot])).toEqual([
      ['M+', 'Waist', 'Waist']
    ]);
  });

  it('returns nothing when prefs is empty', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = { itemIds: {}, itemSlots: {}, itemPlaceholders: {} };
    expect(sandbox.bisItemsFromWishlistPrefs([], 11)).toEqual([]);
  });

  it('dedupes a real item BiS on both numbered slots (Trinket 1 + Trinket 2) into a single row', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'Soulcoiler Ritual Vessel': 320 },
      itemSlots: { 'Soulcoiler Ritual Vessel': 'Trinket' },
      itemPlaceholders: {}
    };
    const prefs = [
      { item_id: 320, status: 'bis', slot: 'Trinket 1' },
      { item_id: 320, status: 'bis', slot: 'Trinket 2' }
    ];

    expect(sandbox.bisItemsFromWishlistPrefs(prefs, 175)).toEqual([
      {
        item: 'Soulcoiler Ritual Vessel',
        slot: '',
        dbSlot: '',
        obtained: false,
        playerId: 175,
        itemId: 320,
        fromWishlist: true
      }
    ]);
  });

  it('does not dedupe a dual-wielder BiS on the same one-hander for both Weapon and Off Hand (wants 2 copies)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { "Jan'thrazet, the Soul Fang": 400 },
      itemSlots: { "Jan'thrazet, the Soul Fang": 'One-Hand' },
      itemPlaceholders: {}
    };
    const prefs = [
      { item_id: 400, status: 'bis', slot: 'Weapon' },
      { item_id: 400, status: 'bis', slot: 'Off Hand' }
    ];

    expect(sandbox.bisItemsFromWishlistPrefs(prefs, 175)).toHaveLength(2);
  });

  it('does not dedupe two different placeholder rows for the same catalog item (e.g. M+ wanted on both rings)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'M+': 1 },
      itemSlots: {},
      itemPlaceholders: { 'M+': true }
    };
    const prefs = [
      { item_id: 1, status: 'bis', slot: 'Finger 1' },
      { item_id: 1, status: 'bis', slot: 'Finger 2' }
    ];

    const rows = sandbox.bisItemsFromWishlistPrefs(prefs, 175);
    expect(rows).toHaveLength(2);
    expect(rows.map((e) => e.slot).sort()).toEqual(['Finger 1', 'Finger 2']);
  });

  it('ignores non-BiS wishlist tags (Good/OK/etc. are not BiS List rows)', () => {
    const sandbox = makeSandbox();
    sandbox.DATA = {
      itemIds: { 'New Helm': 1 },
      itemSlots: { 'New Helm': 'Head' },
      itemPlaceholders: {}
    };
    const prefs = [{ item_id: 1, status: 'good', slot: null }];

    expect(sandbox.bisItemsFromWishlistPrefs(prefs, 11)).toEqual([]);
  });
});
