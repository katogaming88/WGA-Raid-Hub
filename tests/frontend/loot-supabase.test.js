import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Same vm-sandbox harness as roster-supabase.test.js: js/common.js is a plain
// browser script, so it loads into a context with the browser globals stubbed
// and its var/function declarations land on the sandbox.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs(supabase, consoleObj) {
  const windowObj = {};
  if (supabase) windowObj.supabase = supabase;
  const sandbox = {
    window: windowObj,
    location: { search: '', pathname: '/' },
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
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => {
            if (table === 'players') {
              return rosterResult ? rosterResult() : { data: null, error: { message: 'roster not mocked' } };
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

  it('passes unknown season codes through unchanged', () => {
    const map = sandbox.mapSupabaseLoot([lootRow({ season: 'MID2' })]);
    expect(map.katorri.items[0].season).toBe('MID2');
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

describe('loadData lootCounts wiring', () => {
  function heavyPayload() {
    return {
      lootCounts: { sheetkey: { count: 1, heroicCount: 1, mythicCount: 0, items: [] } },
      attendanceDetails: { some: 'attendance' },
      bisList: ['bis'],
      priorityOrder: ['prio'],
      itemSlots: {},
      selfReceived: []
    };
  }

  async function runLoadData(mock) {
    const sandbox = loadCommonJs(mock.supabase);
    const coreReady = new Promise((resolve) => {
      sandbox.loadData(
        () => resolve(),
        () => sandbox._onHeavyDone && sandbox._onHeavyDone()
      );
    });
    sandbox.window._rosterCoreCallback({ roster: [], seasonName: 'Midnight Season 1' });
    await coreReady;
    const heavyReady = new Promise((resolve) => {
      sandbox._onHeavyDone = resolve;
    });
    sandbox.window._rosterHeavyCallback(heavyPayload());
    await heavyReady;
    return sandbox;
  }

  it('replaces lootCounts with the mapped Supabase feed', async () => {
    const mock = mockSupabase({ lootPages: [{ data: [lootRow()], error: null }] });
    const sandbox = await runLoadData(mock);
    expect(Object.keys(sandbox.DATA.lootCounts)).toEqual(['katorri']);
    expect(sandbox.DATA.lootCounts.katorri.heroicCount).toBe(1);
    // The rest of the heavy payload still lands.
    expect(sandbox.DATA.bisList).toEqual(['bis']);
    expect(sandbox.DATA.priorityOrder).toEqual(['prio']);
  });

  it('falls back to the Apps Script lootCounts when the query fails', async () => {
    const mock = mockSupabase({ lootPages: [{ data: null, error: { message: 'nope' } }] });
    const sandbox = await runLoadData(mock);
    expect(Object.keys(sandbox.DATA.lootCounts)).toEqual(['sheetkey']);
  });
});
