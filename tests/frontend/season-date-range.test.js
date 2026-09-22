import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #1269 -- the window a season's attendance counts over. The start is the
// team's own first raid night in the tier, answered by team_season_start()
// and loaded once per page into DATA.seasonStartDate; the end is the tier's.
// Nothing per team is typed any more, so a team that started the tier a week
// late is no longer marked absent for the week before it raided.
//
// seasonDateRangeFor() is the one place that decides it: a closed tier reads
// the entry the close froze, the live tier reads the derived night, and any
// other tier reads its own dates.

const COMMON_JS = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/common.js'), 'utf8');

function loadCommonJs(supabase) {
  const windowObj = {};
  if (supabase) windowObj.supabase = supabase;
  const sandbox = {
    window: windowObj,
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { getElementById: () => null, createElement: () => ({}), head: { appendChild: () => {} } },
    console,
    Intl,
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

// Two tiers, the later one open-ended and current: currentSeasonCode() reads
// the newest row whose start has passed, and these are both in the past.
const TIERS = [
  { code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: null },
  { code: 'MID1', display_name: 'Midnight Season 1', starts_at: '2026-03-17', ends_at: '2026-08-10' }
];

describe('seasonDateRangeFor (#1269)', () => {
  it("answers a closed tier from the entry the close froze, not the tier's own dates", () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      seasons: TIERS,
      seasonStartDate: '2026-08-18',
      seasonHistory: [{ code: 'MID1', name: 'Midnight Season 1', start: '2026-03-24', end: '2026-08-10' }]
    };
    expect(sandbox.seasonDateRangeFor('MID1')).toEqual({ start: '2026-03-24', end: '2026-08-10' });
  });

  it("answers the live tier from the team's derived first raid night", () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = { seasons: TIERS, seasonStartDate: '2026-08-18', seasonHistory: [] };
    expect(sandbox.seasonDateRangeFor('MID2')).toEqual({ start: '2026-08-18', end: null });
  });

  it("falls back to the tier's start when the team has no raid night in it yet", () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = { seasons: TIERS, seasonStartDate: null, seasonHistory: [] };
    expect(sandbox.seasonDateRangeFor('MID2')).toEqual({ start: '2026-08-11', end: null });
  });

  it("answers the live tier's own end date, since nothing per team bounds it", () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      seasons: [{ code: 'MID2', display_name: 'Midnight Season 2', starts_at: '2026-08-11', ends_at: '2026-12-31' }],
      seasonStartDate: '2026-08-18',
      seasonHistory: []
    };
    expect(sandbox.seasonDateRangeFor('MID2')).toEqual({ start: '2026-08-18', end: '2026-12-31' });
  });

  it("answers an ended tier nobody closed from its own dates, not the team's night", () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = { seasons: TIERS, seasonStartDate: '2026-08-18', seasonHistory: [] };
    expect(sandbox.seasonDateRangeFor('MID1')).toEqual({ start: '2026-03-17', end: '2026-08-10' });
  });

  it('answers nothing for a code the seasons table does not hold', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = { seasons: TIERS, seasonStartDate: '2026-08-18', seasonHistory: [] };
    expect(sandbox.seasonDateRangeFor('MID9')).toEqual({ start: null, end: null });
  });

  // The issue's Done-when case: a team whose first report is a week into the
  // tier counts no absences for the week before it. The officer-typed row on
  // day 3 sits before the derived night, so it is outside the window.
  it('counts nothing before the derived night, so a late-starting team has no false absences', () => {
    const sandbox = loadCommonJs();
    sandbox.DATA = {
      seasons: TIERS,
      seasonStartDate: '2026-08-18',
      seasonHistory: [],
      rawAttendanceData: {
        players: {
          Kato: [
            { date: '2026-08-14', status: 'No Show' },
            { date: '2026-08-18', status: 'Present' },
            { date: '2026-08-21', status: 'Present' }
          ]
        },
        joinDates: { Kato: '2026-01-01' }
      }
    };
    sandbox.ACTIVE_SEASON = 'Midnight Season 2';
    expect(sandbox.computeSeasonAttendancePct('Kato')).toBe('100.0%');
  });
});

// Chainable stand-in for supabaseClient.rpc(name, params).
function mockRpcSupabase(answer, { throws = false } = {}) {
  const calls = [];
  const supabase = {
    createClient: () => ({
      rpc(name, params) {
        calls.push({ name, params });
        if (throws) throw new Error('client blew up');
        return {
          then(onFulfilled, onRejected) {
            return Promise.resolve()
              .then(() => answer())
              .then(onFulfilled, onRejected);
          }
        };
      }
    })
  };
  return { calls, supabase };
}

describe('fetchSupabaseSeasonStart (#1269)', () => {
  it("answers the team's first raid night, asking for the configured team", async () => {
    const { calls, supabase } = mockRpcSupabase(() => ({ data: '2026-08-18', error: null }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSeasonStart()).resolves.toBe('2026-08-18');
    expect(calls).toEqual([{ name: 'team_season_start', params: { p_team_id: 1 } }]);
  });

  it('answers null when no tier has started, which the function answers as null', async () => {
    const { supabase } = mockRpcSupabase(() => ({ data: null, error: null }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSeasonStart()).resolves.toBeNull();
  });

  it("answers null on an error result, so the page falls back to the tier's start", async () => {
    const { supabase } = mockRpcSupabase(() => ({ data: null, error: { message: 'nope' } }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSeasonStart()).resolves.toBeNull();
  });

  it('answers null on a rejected call', async () => {
    const { supabase } = mockRpcSupabase(() => {
      throw new Error('network down');
    });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSeasonStart()).resolves.toBeNull();
  });

  // The call itself throws where the client has no rpc at all, which is what
  // a test double without one is; a synchronous throw must not escape the
  // core batch.
  it('answers null when the call itself throws', async () => {
    const { supabase } = mockRpcSupabase(() => ({ data: null, error: null }), { throws: true });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSeasonStart()).resolves.toBeNull();
  });

  it('answers null when the CDN script never loaded', async () => {
    const sandbox = loadCommonJs();
    await expect(sandbox.fetchSupabaseSeasonStart()).resolves.toBeNull();
  });
});
