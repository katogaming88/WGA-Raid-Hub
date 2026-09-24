import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #936: the wishlist key carries the season, so a raider can hold the same item
// in the same slot in two tiers. The page reads and writes one tier at a time,
// so every query it sends for a raider's own picks says which one. Without the
// season on them, the read hands back another tier's picks and the update and
// delete reach that tier's row, which the write gate then refuses part-way
// through a re-tag.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const WISHLIST_JS = readFileSync(path.join(HERE, '../../js/wishlist.js'), 'utf8');

function makeSandbox() {
  const calls = [];
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
    confirm: () => true,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(WISHLIST_JS, sandbox, { filename: 'wishlist.js' });

  sandbox.DATA = {
    itemSlots: {},
    itemPlaceholders: {},
    itemIds: {},
    // Newest first, the order the bootstrap read gives DATA.seasons, which is
    // what currentSeasonCode() walks.
    seasons: [
      { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null },
      { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-02-01', ends_at: '2026-08-10' }
    ],
    teamSeasons: [{ season_code: 'MID2', wishlist_open: true }]
  };
  sandbox._wishlistPlayerId = 11;
  sandbox._wishlistPlayerFirstName = 'Kat';
  sandbox._wishlistPrefs = [];

  // One chainable builder per from(), recording the filters the page put on it.
  // Thenable, because the page awaits the builder itself on a read and a
  // delete, and its .select() result on a write.
  sandbox.supabaseClient = {
    from(table) {
      const call = { table, op: null, payload: null, filters: [] };
      calls.push(call);
      const chain = {
        select(cols) {
          if (!call.op) {
            call.op = 'select';
            call.payload = cols;
          }
          return chain;
        },
        insert(row) {
          call.op = 'insert';
          call.payload = row;
          return chain;
        },
        update(patch) {
          call.op = 'update';
          call.payload = patch;
          return chain;
        },
        delete() {
          call.op = 'delete';
          return chain;
        },
        eq(column, value) {
          call.filters.push(['eq', column, value]);
          return chain;
        },
        is(column, value) {
          call.filters.push(['is', column, value]);
          return chain;
        },
        then(onFulfilled, onRejected) {
          const row = { id: 5, item_id: 42, slot: null, season: 'MID2', status: 'bis', note: null, synced_bis: false };
          return Promise.resolve({ data: [row], error: null }).then(onFulfilled, onRejected);
        }
      };
      return chain;
    }
  };
  return { sandbox, calls };
}

const filterOn = (call, column) => call.filters.filter((f) => f[1] === column);

describe('the page reads one season of its own picks', () => {
  it('asks for the season it plans for', async () => {
    const { sandbox, calls } = makeSandbox();
    await sandbox.fetchMyItemPreferences(11);

    const read = calls.find((c) => c.op === 'select');
    expect(filterOn(read, 'player_id')).toEqual([['eq', 'player_id', 11]]);
    expect(filterOn(read, 'season')).toEqual([['eq', 'season', 'MID2']]);
  });

  it('asks for the picks with no season when no tier resolves, as the insert stamps', async () => {
    const { sandbox, calls } = makeSandbox();
    sandbox.DATA.seasons = [];
    await sandbox.fetchMyItemPreferences(11);

    const read = calls.find((c) => c.op === 'select');
    expect(filterOn(read, 'season')).toEqual([['is', 'season', null]]);
  });

  it('reads the season an officer pinned rather than the live tier', async () => {
    const { sandbox, calls } = makeSandbox();
    sandbox.DATA.seasonView = 'MID1';
    await sandbox.fetchMyItemPreferences(11);

    const read = calls.find((c) => c.op === 'select');
    expect(filterOn(read, 'season')).toEqual([['eq', 'season', 'MID1']]);
  });
});

describe('a change to an existing pick stays in the season the page plans for', () => {
  const existing = (season) => ({
    id: 5,
    item_id: 42,
    slot: null,
    season,
    status: 'good',
    note: null,
    synced_bis: false
  });

  it('filters the update on the season as well as the item and slot', () => {
    const { sandbox, calls } = makeSandbox();
    sandbox._wishlistPrefs = [existing('MID2')];
    sandbox.wishlistSetStatus(42, null, 'bis');

    const write = calls.find((c) => c.op === 'update');
    expect(write, 'an existing pick is updated, not inserted again').toBeTruthy();
    expect(filterOn(write, 'season')).toEqual([['eq', 'season', 'MID2']]);
    expect(filterOn(write, 'item_id')).toEqual([['eq', 'item_id', 42]]);
  });

  it('filters the delete on the season as well as the item and slot', () => {
    const { sandbox, calls } = makeSandbox();
    sandbox._wishlistPrefs = [existing('MID2')];
    sandbox.wishlistRemovePreference(42, null);

    const write = calls.find((c) => c.op === 'delete');
    expect(write).toBeTruthy();
    expect(filterOn(write, 'season')).toEqual([['eq', 'season', 'MID2']]);
  });

  it('filters both on a missing season when no tier resolves', () => {
    const { sandbox, calls } = makeSandbox();
    sandbox.DATA.seasons = [];
    sandbox._wishlistPlayerNameRealm = 'Kat-Stormrage';
    sandbox.DATA.roster = [{ nameRealm: 'Kat-Stormrage', wishlistAllowed: true }];
    sandbox.window.DATA = sandbox.DATA;
    sandbox._wishlistPrefs = [existing(null)];
    sandbox.wishlistSetStatus(42, null, 'bis');

    const write = calls.find((c) => c.op === 'update');
    expect(write).toBeTruthy();
    expect(filterOn(write, 'season')).toEqual([['is', 'season', null]]);
  });

  // Clear All has no item or slot filter by design, and the write gate refuses
  // the whole statement if any row it would remove sits in a closed season, so
  // it is scoped to the season the page plans for like every other write here.
  it('scopes Clear All to the season the page plans for', () => {
    const { sandbox, calls } = makeSandbox();
    sandbox._wishlistPrefs = [existing('MID2')];
    sandbox.clearMyWishlist('Kat');

    const write = calls.find((c) => c.op === 'delete');
    expect(write).toBeTruthy();
    expect(filterOn(write, 'player_id')).toEqual([['eq', 'player_id', 11]]);
    expect(filterOn(write, 'season')).toEqual([['eq', 'season', 'MID2']]);
  });
});
