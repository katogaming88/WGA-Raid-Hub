import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/common.js is a plain browser script (no exports), so these tests load it
// into a vm sandbox with just enough of the browser globals stubbed for its
// top-level statements. Everything the file declares with var/function lands
// on the sandbox, which is how the tests reach mapSupabaseRoster and friends.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs(supabase) {
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
    console,
    // Unref'd so fetchSupabaseRoster's 10s fallback timer never holds the
    // test process open after the query side of the race resolves.
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

// Chainable stand-in for the supabase-js query builder. `result` is a
// function so tests can resolve rows, resolve an error result, or throw.
function mockSupabase(result) {
  const calls = { from: null, select: null, eq: [], is: [], order: [] };
  const builder = {
    select(cols) {
      calls.select = cols;
      return builder;
    },
    eq(col, val) {
      calls.eq.push([col, val]);
      return builder;
    },
    is(col, val) {
      calls.is.push([col, val]);
      return builder;
    },
    order(col) {
      calls.order.push(col);
      return builder;
    },
    // loadData also fires the loot query (#209); these tests only assert the
    // roster path, but the builder must accept the loot chain's range().
    range() {
      return builder;
    },
    // ...and the team_settings query (#221); result().data here is either
    // SUPABASE_ROW (no .config key, so applyTeamSettingsToData() is a no-op)
    // or null, so reusing the same result() is safe for these tests.
    maybeSingle() {
      return builder;
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve()
        .then(() => result())
        .then(onFulfilled, onRejected);
    }
  };
  const client = {
    from(table) {
      calls.from = table;
      return builder;
    }
  };
  return { calls, supabase: { createClient: () => client } };
}

const SUPABASE_ROW = {
  name_realm: 'Katorri-Stormrage',
  nickname: 'Kat',
  is_trial: false,
  is_bench: true,
  bis_link: 'https://example.com/bis',
  join_date: '2026-03-17',
  classes_specs: { class: 'Paladin', spec: 'Holy', role: 'Heal' }
};

describe('mapSupabaseRoster', () => {
  const sandbox = loadCommonJs();

  it('maps a players row to the Apps Script roster shape', () => {
    const jsonp = [
      {
        nameRealm: 'Katorri-Stormrage',
        attendance: '97.3%',
        mPlusExcluded: true,
        mPlusNote: 'weeknight scheduling',
        mPlusRejected: false,
        mPlusRejectionNote: ''
      }
    ];
    expect(sandbox.mapSupabaseRoster([SUPABASE_ROW], jsonp)).toEqual([
      {
        nameRealm: 'Katorri-Stormrage',
        firstName: 'Katorri',
        realm: 'Stormrage',
        isTrial: false,
        isBench: true,
        attendance: '97.3%',
        nick: 'Kat',
        class: 'Paladin',
        spec: 'Holy',
        role: 'Heal',
        bisLink: 'https://example.com/bis',
        bisAllowed: false,
        joinDate: '2026-03-17',
        mPlusExcluded: true,
        mPlusNote: 'weeknight scheduling',
        mPlusRejected: false,
        mPlusRejectionNote: ''
      }
    ]);
  });

  it('keeps everything after the first dash as the realm', () => {
    const rows = [{ ...SUPABASE_ROW, name_realm: 'Snarge-Area-52' }];
    const mapped = sandbox.mapSupabaseRoster(rows, []);
    expect(mapped[0].firstName).toBe('Snarge');
    expect(mapped[0].realm).toBe('Area-52');
  });

  it('defaults null columns the way getRoster() emits empty cells', () => {
    const rows = [
      {
        name_realm: 'Epyon-Stormrage',
        nickname: null,
        is_trial: true,
        is_bench: false,
        bis_link: null,
        join_date: null,
        classes_specs: { class: 'Mage', spec: 'Frost', role: 'Ranged' }
      }
    ];
    expect(sandbox.mapSupabaseRoster(rows, [])).toEqual([
      {
        nameRealm: 'Epyon-Stormrage',
        firstName: 'Epyon',
        realm: 'Stormrage',
        isTrial: true,
        isBench: false,
        attendance: '',
        nick: '',
        class: 'Mage',
        spec: 'Frost',
        role: 'Ranged',
        bisLink: '',
        bisAllowed: false,
        joinDate: '',
        mPlusExcluded: false,
        mPlusNote: '',
        mPlusRejected: false,
        mPlusRejectionNote: ''
      }
    ]);
  });

  it('merges the JSONP-only fields case-insensitively by nameRealm', () => {
    const jsonp = [
      {
        nameRealm: 'KATORRI-Stormrage',
        attendance: '88.0%',
        mPlusExcluded: true,
        mPlusNote: 'approved for this season',
        mPlusRejected: true,
        mPlusRejectionNote: 'resubmit next season'
      }
    ];
    const mapped = sandbox.mapSupabaseRoster([SUPABASE_ROW], jsonp);
    expect(mapped[0].attendance).toBe('88.0%');
    expect(mapped[0].mPlusExcluded).toBe(true);
    expect(mapped[0].mPlusNote).toBe('approved for this season');
    expect(mapped[0].mPlusRejected).toBe(true);
    expect(mapped[0].mPlusRejectionNote).toBe('resubmit next season');
  });

  it('skips rows without a role or name, like getRoster() does', () => {
    const rows = [{ ...SUPABASE_ROW, classes_specs: null }, { ...SUPABASE_ROW, name_realm: '  ' }, SUPABASE_ROW];
    const mapped = sandbox.mapSupabaseRoster(rows, []);
    expect(mapped).toHaveLength(1);
    expect(mapped[0].nameRealm).toBe('Katorri-Stormrage');
  });
});

describe('fetchSupabaseRoster', () => {
  it('resolves null when the CDN script never loaded', async () => {
    const sandbox = loadCommonJs();
    await expect(sandbox.fetchSupabaseRoster()).resolves.toBeNull();
  });

  it('queries active players for the configured team', async () => {
    const rows = [SUPABASE_ROW];
    const { calls, supabase } = mockSupabase(() => ({ data: rows, error: null }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseRoster()).resolves.toEqual(rows);
    expect(calls.from).toBe('players');
    expect(calls.select).toContain('classes_specs(class, spec, role)');
    expect(calls.eq).toEqual([['team_id', 1]]);
    expect(calls.is).toEqual([['archived_at', null]]);
    expect(calls.order).toEqual(['name_realm']);
  });

  it('resolves null on a query error result', async () => {
    const { supabase } = mockSupabase(() => ({ data: null, error: { message: 'nope' } }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseRoster()).resolves.toBeNull();
  });

  it('resolves null on a rejected query', async () => {
    const { supabase } = mockSupabase(() => {
      throw new Error('network down');
    });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseRoster()).resolves.toBeNull();
  });

  it('resolves null on an empty result so the JSONP roster stays', async () => {
    const { supabase } = mockSupabase(() => ({ data: [], error: null }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseRoster()).resolves.toBeNull();
  });
});

describe('loadData roster override', () => {
  function corePayload() {
    return {
      roster: [
        {
          nameRealm: 'Katorri-Stormrage',
          firstName: 'Katorri',
          attendance: '97.3%',
          mPlusRejected: false,
          mPlusRejectionNote: '',
          nick: 'SheetNick'
        }
      ],
      seasonName: 'MID1'
    };
  }

  it('replaces DATA.roster with mapped Supabase rows before onCoreReady', async () => {
    const { supabase } = mockSupabase(() => ({ data: [SUPABASE_ROW], error: null }));
    const sandbox = loadCommonJs(supabase);
    let rosterAtReady = null;
    const ready = new Promise((resolve) => {
      sandbox.loadData(() => {
        rosterAtReady = sandbox.DATA.roster;
        resolve();
      });
    });
    sandbox.window._rosterCoreCallback(corePayload());
    await ready;
    expect(rosterAtReady).toHaveLength(1);
    // Supabase wins for its own fields, the JSONP payload for the merged ones.
    expect(rosterAtReady[0].nick).toBe('Kat');
    expect(rosterAtReady[0].attendance).toBe('97.3%');
    expect(sandbox.DATA.seasonName).toBe('MID1');
  });

  it('keeps the JSONP roster when the Supabase query fails', async () => {
    const { supabase } = mockSupabase(() => ({ data: null, error: { message: 'nope' } }));
    const sandbox = loadCommonJs(supabase);
    const ready = new Promise((resolve) => {
      sandbox.loadData(() => resolve());
    });
    sandbox.window._rosterCoreCallback(corePayload());
    await ready;
    expect(sandbox.DATA.roster[0].nick).toBe('SheetNick');
  });
});
