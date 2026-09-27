import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realFetchAllPaged, realScopeToSeasonView } from './helpers/common-sandbox.js';
import { keysetClient, failingClient } from './helpers/supabase-mock.js';

const SEASONS = [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null }];

// fetchTeamItemPreferences pages through the shared helper (#707 item 3).
//
// It was the third hand-rolled loop: OFFSET paging, advancing by page size and
// stopping on a short page, with a single 20s budget raced against the whole
// read rather than against each page. A budget spanning N sequential round
// trips becomes a truncation mechanism as N grows, which is the failure #691
// already hit once by raising 10s to 20s in the same diff that added paging.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRIORITY_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-priority.js'), 'utf8');

function prefRows(total, startId = 1) {
  const rows = [];
  for (let i = 0; i < total; i++) {
    rows.push({
      id: startId + i,
      player_id: (i % 25) + 1,
      item_id: 1000 + i,
      status: 'bis',
      slot: null,
      season: 'Midnight Season 2',
      note: null
    });
  }
  return rows;
}

function load(client, { seasons = SEASONS, seasonView = null } = {}) {
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: { getElementById: () => null },
    DATA: {},
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient: client,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PRIORITY_JS, sandbox, { filename: 'tab-priority.js' });
  // js/common.js owns fetchAllPaged and scopeToSeasonView; tab-priority.js
  // calls both as globals.
  sandbox.fetchAllPaged = realFetchAllPaged();
  sandbox.scopeToSeasonView = realScopeToSeasonView(seasons, seasonView);
  return sandbox;
}

describe('fetchTeamItemPreferences (#707)', () => {
  it('collects every row across pages, each exactly once', async () => {
    const { client } = keysetClient(prefRows(2562));
    const rows = await load(client).fetchTeamItemPreferences();
    expect(rows).toHaveLength(2562);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2562);
  });

  it('still selects season, which the officer view needs to scope rows', async () => {
    const { client, calls } = keysetClient(prefRows(3));
    await load(client).fetchTeamItemPreferences();
    expect(calls.selects[0].select).toContain('season');
    expect(calls.selects[0].select).toContain('id');
    expect(calls.selects[0].select).toContain('note');
  });

  it('does not spend a request past the end when the total is an exact multiple of the page size', async () => {
    const { client, calls } = keysetClient(prefRows(2000));
    const rows = await load(client).fetchTeamItemPreferences();
    expect(rows).toHaveLength(2000);
    expect(calls.selects).toHaveLength(2);
  });

  it('resolves an empty array for a team whose wishlists are untouched', async () => {
    const { client } = keysetClient([]);
    await expect(load(client).fetchTeamItemPreferences()).resolves.toEqual([]);
  });

  it('resolves null on a failed read rather than the rows it managed to collect', async () => {
    const { client } = failingClient('prefs boom');
    await expect(load(client).fetchTeamItemPreferences()).resolves.toBeNull();
  });

  // One tier's picks (#936). Every officer-side consumer of this read takes the
  // rows as fetched -- the status beside a ranked row, the completion badge, the
  // roster's Wishlists Completed card, the Notes sub-tab -- so the tier is
  // settled here rather than in each of them.
  it('asks for the tier the officer is viewing, on every page', async () => {
    const { client, calls } = keysetClient(prefRows(2200));
    await load(client).fetchTeamItemPreferences();
    expect(calls.selects).toHaveLength(3);
    for (const select of calls.selects) expect(select.eq).toContainEqual(['season', 'MID2']);
  });

  it('asks for the pinned tier over the live one', async () => {
    const { client, calls } = keysetClient(prefRows(3));
    const seasons = [...SEASONS, { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-04-01' }];
    await load(client, { seasons, seasonView: 'Midnight Season 1' }).fetchTeamItemPreferences();
    expect(calls.eqs).toContainEqual(['season', 'MID1']);
    expect(calls.eqs).not.toContainEqual(['season', 'MID2']);
  });

  it('asks for every tier when no tier resolves, rather than for none', async () => {
    const { client, calls } = keysetClient(prefRows(3));
    const rows = await load(client, { seasons: [] }).fetchTeamItemPreferences();
    expect(calls.eqs.map(([col]) => col)).not.toContain('season');
    expect(rows).toHaveLength(3);
  });

  it('budgets each page rather than the whole read', async () => {
    // Every page is slow but none is stuck. A single budget across the read
    // would fail this as the row count grows; a per-page one does not.
    const rows = prefRows(2500);
    const client = {
      from() {
        const record = {};
        const b = {
          select() {
            return b;
          },
          eq() {
            return b;
          },
          order() {
            return b;
          },
          gt(col, val) {
            record.after = val;
            return b;
          },
          limit(n) {
            record.limit = n;
            return b;
          },
          then(onFulfilled, onRejected) {
            return new Promise((resolve) => setTimeout(resolve, 30))
              .then(() => {
                const after = record.after === undefined ? null : record.after;
                const slice = rows.filter((r) => after === null || r.id > after).slice(0, record.limit || 1000);
                return { data: slice, error: null, count: after === null ? rows.length : null };
              })
              .then(onFulfilled, onRejected);
          }
        };
        return b;
      }
    };
    const sandbox = load(client);
    sandbox.fetchAllPaged = realFetchAllPaged();
    const result = await sandbox.fetchTeamItemPreferences();
    expect(result).toHaveLength(2500);
  });
});

// Changing the Season View pin never reloaded the page: tab-season.js sets
// DATA.seasonView, remaps the priority data from rows it already holds, and
// rebuilds the visible sub-tab. That was right while this read carried every
// tier, and wrong the moment it carries one (#936), so the pin has to drop what
// was fetched for the tier it left.
describe('resetTeamItemPreferencesForSeasonView (#936)', () => {
  it('drops the cached rows so the next render fetches the new tier', () => {
    const { client } = keysetClient(prefRows(3));
    const sandbox = load(client);
    sandbox._setTeamItemPreferences(prefRows(3));
    expect(sandbox._teamItemPreferences).toHaveLength(3);

    sandbox.resetTeamItemPreferencesForSeasonView();

    expect(sandbox._teamItemPreferences).toBeNull();
    expect(sandbox._teamItemPreferencesUnavailable()).toBe(false);
  });

  // A failed read latches so a render cannot loop on it. The pin is a fresh
  // ask, so it clears the latch too, or an officer who changed tier after one
  // failure would be stuck on the error until a reload.
  it('clears a latched read failure, so the new tier is actually asked for', () => {
    const { client } = keysetClient([]);
    const sandbox = load(client);
    sandbox._setTeamItemPreferences(null);
    expect(sandbox._teamItemPreferencesUnavailable()).toBe(true);

    sandbox.resetTeamItemPreferencesForSeasonView();

    expect(sandbox._teamItemPreferencesUnavailable()).toBe(false);
  });

  // The profile card has its own per-player cache in js/common.js, filled by
  // fetchPlayerItemPreferences() and read whenever the team-wide rows are not
  // loaded. It is scoped to a tier now too, so it goes with them.
  it('empties the per-player profile cache js/common.js keeps', () => {
    const { client } = keysetClient([]);
    const sandbox = load(client);
    sandbox._profileWishlistPrefsCache = { 7: prefRows(2) };

    sandbox.resetTeamItemPreferencesForSeasonView();

    expect(sandbox._profileWishlistPrefsCache).toEqual({});
  });
});

// Five renders fill this cache, each on its own "not loaded yet" branch, and a
// pin change now asks two of them to run at once. loadTeamItemPreferences() is
// the single door: one read while one is in flight, and a read that started
// before a pin change never installs what it collected.
describe('loadTeamItemPreferences (#936)', () => {
  it('serves two renders that both need the rows from one read', async () => {
    const { client, calls } = keysetClient(prefRows(2200));
    const sandbox = load(client);

    const [a, b] = await Promise.all([sandbox.loadTeamItemPreferences(), sandbox.loadTeamItemPreferences()]);

    // 2200 rows is three pages for one read, six for two.
    expect(calls.selects).toHaveLength(3);
    expect(a).toHaveLength(2200);
    expect(b).toHaveLength(2200);
    expect(sandbox._teamItemPreferences).toHaveLength(2200);
  });

  it('installs the rows, so a caller does not have to', async () => {
    const { client } = keysetClient(prefRows(4));
    const sandbox = load(client);

    await sandbox.loadTeamItemPreferences();

    expect(sandbox._teamItemPreferences).toHaveLength(4);
  });

  // The boot read is three round trips over a few thousand rows, which is long
  // enough for an officer to change the pin inside it.
  it('discards a read that a pin change has already superseded', async () => {
    const { client } = keysetClient(prefRows(3));
    const sandbox = load(client);

    const pending = sandbox.loadTeamItemPreferences();
    sandbox.resetTeamItemPreferencesForSeasonView();
    await pending;

    expect(sandbox._teamItemPreferences).toBeNull();
  });

  it('lets the next render start a fresh read after a pin change', async () => {
    const { client, calls } = keysetClient(prefRows(3));
    const sandbox = load(client);

    await sandbox.loadTeamItemPreferences();
    const afterFirst = calls.selects.length;
    sandbox.resetTeamItemPreferencesForSeasonView();
    await sandbox.loadTeamItemPreferences();

    expect(calls.selects.length).toBeGreaterThan(afterFirst);
    expect(sandbox._teamItemPreferences).toHaveLength(3);
  });

  it('leaves a failed read reported rather than installed', async () => {
    const { client } = failingClient('prefs boom');
    const sandbox = load(client);

    await sandbox.loadTeamItemPreferences();

    expect(sandbox._teamItemPreferences).toBeNull();
    expect(sandbox._teamItemPreferencesUnavailable()).toBe(true);
  });
});
