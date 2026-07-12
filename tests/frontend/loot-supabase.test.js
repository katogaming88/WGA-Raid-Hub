import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same vm-sandbox harness as roster-supabase.test.js: js/common.js is a plain
// browser script, so it loads into a context with the browser globals stubbed
// and its var/function declarations land on the sandbox.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs(supabase, consoleObj, search = '') {
  const windowObj = {};
  if (supabase) windowObj.supabase = supabase;
  const sandbox = {
    window: windowObj,
    location: { search, pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild: () => {} }
    },
    console: consoleObj || console,
    Intl,
    // Unref'd so the 10s fallback timers never hold the test process open.
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  return sandbox;
}

// Table-aware stand-in for the supabase-js builder. Loot pages come from a
// queue (one entry per rclc_loot query); the players query gets rosterResult
// (loadData always fires both).
function mockSupabase({ lootPages = [], rosterResult } = {}) {
  const calls = { selects: [], eq: [], orders: [], ranges: [] };
  let page = 0;
  function makeBuilder(table) {
    const builder = {
      select(cols) {
        if (table === 'rclc_loot') calls.selects.push(cols);
        return builder;
      },
      eq(col, val) {
        if (table === 'rclc_loot') calls.eq.push([col, val]);
        return builder;
      },
      is() {
        return builder;
      },
      order(col) {
        if (table === 'rclc_loot') calls.orders.push(col);
        return builder;
      },
      range(from, to) {
        calls.ranges.push([from, to]);
        return builder;
      },
      maybeSingle() {
        // team_settings (#221) fires alongside the roster query; this suite
        // isn't exercising it, so fall back to whatever the Apps Script core
        // payload already set, same as the other untested tables below.
        return builder;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => {
            if (table === 'players') {
              return rosterResult ? rosterResult() : { data: null, error: { message: 'roster not mocked' } };
            }
            if (table === 'team_settings') {
              return { data: null, error: { message: 'team_settings not mocked' } };
            }
            // bis_items, items, item_bosses, and priority_order are separate
            // queries loadData() fires alongside the loot pages (#217 item
            // search fix, #220 priority generator); this suite is only
            // exercising lootCounts wiring, so none of them are mocked and
            // all should fall back to the heavy payload's
            // bisList/itemSlots/itemBosses/priorityOrder untouched, same as
            // the 'players' default above. Without an explicit branch here,
            // these would fall through to the loot-page queue below and get
            // mistaken for real rows, since lootRow()'s fields
            // (items.name/players.name_realm/track/season) happen to overlap
            // what mapSupabasePriorityOrder() reads.
            if (table === 'bis_items') {
              return { data: null, error: { message: 'bis_items not mocked' } };
            }
            if (table === 'items') {
              return { data: null, error: { message: 'items not mocked' } };
            }
            if (table === 'item_bosses') {
              return { data: null, error: { message: 'item_bosses not mocked' } };
            }
            if (table === 'priority_order') {
              return { data: null, error: { message: 'priority_order not mocked' } };
            }
            const result = lootPages[Math.min(page, lootPages.length - 1)];
            page++;
            return typeof result === 'function' ? result() : result;
          })
          .then(onFulfilled, onRejected);
      }
    };
    return builder;
  }
  const client = { from: (table) => makeBuilder(table) };
  return { calls, supabase: { createClient: () => client } };
}

function lootRow(overrides) {
  return {
    track: 'Hero',
    season: 'MID1',
    awarded_at: '2026-03-25T04:07:00+00:00',
    items: { name: 'Signet of the Starved Beast' },
    players: { name_realm: 'Katorri-Stormrage' },
    ...overrides
  };
}

describe('mapSupabaseLoot', () => {
  const sandbox = loadCommonJs();

  it('rebuilds the getLootCounts() shape with GAS difficulty labels', () => {
    const rows = [
      lootRow(),
      lootRow({ track: 'Myth', items: { name: 'Frenzy’s Rebuke' } }),
      lootRow({ track: 'Champion', items: { name: 'Bond of Light' } })
    ];
    const map = sandbox.mapSupabaseLoot(rows);
    expect(Object.keys(map)).toEqual(['katorri']);
    expect(map.katorri.count).toBe(3);
    expect(map.katorri.heroicCount).toBe(1);
    expect(map.katorri.mythicCount).toBe(1);
    expect(map.katorri.items.map((i) => i.difficulty)).toEqual(['Heroic', 'Mythic', 'Other']);
    expect(map.katorri.items[0]).toEqual({
      name: 'Signet of the Starved Beast',
      difficulty: 'Heroic',
      date: 'Mar 25, 2026',
      season: 'Midnight Season 1'
    });
  });

  it('strips diacritics from the key exactly like the GAS normName', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ players: { name_realm: 'Katorrí-Stormrage' } })]);
    expect(Object.keys(map)).toEqual(['katorri']);
  });

  it('formats award dates in the sheet timezone, not the viewer timezone', () => {
    // 01:30 UTC on Mar 18 is still Mar 17 in America/New_York.
    const map = sandbox.mapSupabaseLoot([lootRow({ awarded_at: '2026-03-18T01:30:00+00:00' })]);
    expect(map.katorri.items[0].date).toBe('Mar 17, 2026');
  });

  it('translates a season code that has never been hardcoded (#341 pattern match)', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ season: 'MID2' })]);
    expect(map.katorri.items[0].season).toBe('Midnight Season 2');
  });

  it('passes a season code matching neither an override nor the pattern through unchanged', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ season: 'DF3' })]);
    expect(map.katorri.items[0].season).toBe('DF3');
  });

  it('skips rows without a linked player and defaults missing item names', () => {
    const rows = [lootRow({ players: null }), lootRow({ items: null })];
    const map = sandbox.mapSupabaseLoot(rows);
    expect(map.katorri.count).toBe(1);
    expect(map.katorri.items[0].name).toBe('Unknown Item');
  });

  it('warns when two characters collapse into one first-name key', () => {
    const warn = vi.fn();
    const warnSandbox = loadCommonJs(undefined, { ...console, warn });
    const rows = [lootRow(), lootRow({ players: { name_realm: 'Katorrí-Illidan' } })];
    const map = warnSandbox.mapSupabaseLoot(rows);
    expect(map.katorri.count).toBe(2); // merged, same as the GAS feed
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('Katorri-Stormrage');
    expect(warn.mock.calls[0][0]).toContain('Katorrí-Illidan');
  });
});

describe('fetchSupabaseLoot', () => {
  it('resolves null when the CDN script never loaded', async () => {
    const sandbox = loadCommonJs();
    await expect(sandbox.fetchSupabaseLoot()).resolves.toBeNull();
  });

  it('queries the team loot newest first', async () => {
    const rows = [lootRow()];
    const { calls, supabase } = mockSupabase({ lootPages: [{ data: rows, error: null }] });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toEqual(rows);
    expect(calls.selects[0]).toContain('items(name)');
    expect(calls.selects[0]).toContain('players(name_realm)');
    expect(calls.eq).toEqual([['team_id', 1]]);
    expect(calls.orders).toEqual(['awarded_at', 'id']);
    expect(calls.ranges).toEqual([[0, 999]]);
  });

  it('pages past the PostgREST row cap until a short page', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => lootRow({ awarded_at: `2026-01-01T00:00:${i % 60}Z` }));
    const shortPage = [lootRow(), lootRow()];
    const { calls, supabase } = mockSupabase({
      lootPages: [
        { data: fullPage, error: null },
        { data: shortPage, error: null }
      ]
    });
    const sandbox = loadCommonJs(supabase);
    const rows = await sandbox.fetchSupabaseLoot();
    expect(rows).toHaveLength(1002);
    expect(calls.ranges).toEqual([
      [0, 999],
      [1000, 1999]
    ]);
  });

  it('resolves null on a query error result', async () => {
    const { supabase } = mockSupabase({ lootPages: [{ data: null, error: { message: 'nope' } }] });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toBeNull();
  });

  it('resolves null on a rejected query', async () => {
    const { supabase } = mockSupabase({
      lootPages: [
        () => {
          throw new Error('network down');
        }
      ]
    });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toBeNull();
  });

  it('resolves null on an empty result so the fallback applies', async () => {
    const { supabase } = mockSupabase({ lootPages: [{ data: [], error: null }] });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseLoot()).resolves.toBeNull();
  });
});

// GAS is retired (#225): loadData() no longer injects any core/heavy JSONP
// <script>, waits on window._rosterCoreCallback/_rosterHeavyCallback, or falls
// back to a GAS payload on a Supabase failure. It always builds DATA straight
// from the Supabase reads, seeding an empty roster/containers where a query
// has nothing -- the same path #426 originally built just for a gasUrl-less
// team (Immolation) and #225 now makes universal.
describe('loadData builds DATA from Supabase only', () => {
  async function runLoadData(mock) {
    const sandbox = loadCommonJs(mock.supabase);
    await new Promise((resolve) => {
      sandbox.loadData(
        () => {},
        () => resolve()
      );
    });
    return sandbox;
  }

  it('replaces lootCounts with the mapped Supabase feed', async () => {
    const mock = mockSupabase({ lootPages: [{ data: [lootRow()], error: null }] });
    const sandbox = await runLoadData(mock);
    expect(Object.keys(sandbox.DATA.lootCounts)).toEqual(['katorri']);
    expect(sandbox.DATA.lootCounts.katorri.heroicCount).toBe(1);
  });

  it('resolves to an empty loot feed when the query fails', async () => {
    const mock = mockSupabase({ lootPages: [{ data: null, error: { message: 'nope' } }] });
    const sandbox = await runLoadData(mock);
    expect(sandbox.DATA.lootCounts).toEqual({});
  });

  it('never installs the retired JSONP callback globals', async () => {
    const mock = mockSupabase({ lootPages: [{ data: [lootRow()], error: null }] });
    const sandbox = await runLoadData(mock);
    expect(sandbox.window._rosterCoreCallback).toBeUndefined();
    expect(sandbox.window._rosterHeavyCallback).toBeUndefined();
  });

  it('seeds an empty array roster and empty containers when nothing is mocked', async () => {
    const mock = mockSupabase({ lootPages: [{ data: [], error: null }] });
    const sandbox = await runLoadData(mock);
    // Empty, not undefined -- the write paths in tab-bis.js/tab-priority.js
    // index bisList/priorityOrder/selfReceived without their own guard, and
    // there is no GAS payload left to have supplied a non-empty fallback.
    expect(Array.isArray(sandbox.DATA.roster)).toBe(true);
    expect(sandbox.DATA.roster).toEqual([]);
    expect(sandbox.DATA.lootCounts).toEqual({});
    expect(sandbox.DATA.bisList).toEqual({});
    expect(sandbox.DATA.priorityOrder).toEqual({});
    expect(sandbox.DATA.selfReceived).toEqual({});
  });
});
