import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/common.js is a plain browser script; this loads it into a vm sandbox
// the same way tests/frontend/roster-supabase.test.js does, to reach
// fetchSupabaseSettings/applyTeamSettingsToData/saveTeamSetting (#221) --
// the team_settings.config read/write path that replaces Script Properties
// for season name/dates/history, raid progression, trial thresholds, and
// the signup/BiS/M+ toggles.

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

// Chainable stand-in for .from('team_settings').select('config').eq(...).maybeSingle()
function mockSettingsSupabase(result) {
  const calls = { from: null, select: null, eq: [], maybeSingle: false };
  const builder = {
    select(cols) {
      calls.select = cols;
      return builder;
    },
    eq(col, val) {
      calls.eq.push([col, val]);
      return builder;
    },
    maybeSingle() {
      calls.maybeSingle = true;
      return {
        then(onFulfilled, onRejected) {
          return Promise.resolve()
            .then(() => result())
            .then(onFulfilled, onRejected);
        }
      };
    }
  };
  const supabase = {
    createClient: () => ({
      from(table) {
        calls.from = table;
        return builder;
      }
    })
  };
  return { calls, supabase };
}

describe('fetchSupabaseSettings', () => {
  it('resolves null when the CDN script never loaded', async () => {
    const sandbox = loadCommonJs();
    await expect(sandbox.fetchSupabaseSettings()).resolves.toBeNull();
  });

  it('queries team_settings.config for the configured team', async () => {
    const { calls, supabase } = mockSettingsSupabase(() => ({ data: { config: { seasonName: 'S1' } }, error: null }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSettings()).resolves.toEqual({ seasonName: 'S1' });
    expect(calls.from).toBe('team_settings');
    expect(calls.select).toBe('config');
    expect(calls.eq).toEqual([['team_id', 1]]);
    expect(calls.maybeSingle).toBe(true);
  });

  it('resolves null when no row exists for the team', async () => {
    const { supabase } = mockSettingsSupabase(() => ({ data: null, error: null }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSettings()).resolves.toBeNull();
  });

  it('resolves null on a query error result', async () => {
    const { supabase } = mockSettingsSupabase(() => ({ data: null, error: { message: 'nope' } }));
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSettings()).resolves.toBeNull();
  });

  it('resolves null on a rejected query', async () => {
    const { supabase } = mockSettingsSupabase(() => {
      throw new Error('network down');
    });
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.fetchSupabaseSettings()).resolves.toBeNull();
  });
});

describe('applyTeamSettingsToData', () => {
  it('overlays every config key onto DATA', () => {
    const sandbox = loadCommonJs();
    const data = { trialWeeks: 9, extraField: 'untouched' };
    sandbox.applyTeamSettingsToData(data, {
      seasonName: 'Left behind',
      seasonStart: '2026-01-01',
      seasonEnd: '',
      seasonHistory: [{ name: 'Prior' }],
      raidProgression: [{ name: 'Raid' }],
      trialWeeks: 2,
      trialAttend: 95,
      signupsOpen: true,
      bisSubmissionsOpen: false,
      mPlusExclusionsOpen: true,
      seasonView: 'MID2',
      activeSignupSeason: 'S2'
    });
    expect(data).toMatchObject({
      seasonHistory: [{ name: 'Prior' }],
      raidProgression: [{ name: 'Raid' }],
      trialWeeks: 2,
      trialAttend: 95,
      bisSubmissionsOpen: false,
      mPlusExclusionsOpen: true,
      seasonView: 'MID2',
      extraField: 'untouched'
    });
    // The two switches live on team_seasons since #939, the signup season
    // is that table's open rows since #934, the season a team is on is the
    // tier since #938, and its start is the team's first raid night since
    // #1269; a key left behind in config is not a setting any more and is
    // not copied.
    expect(data.signupsOpen).toBeUndefined();
    expect(data.signupSeason).toBeUndefined();
    expect(data.seasonName).toBeUndefined();
    expect(data.seasonStart).toBeUndefined();
    expect(data.seasonEnd).toBeUndefined();
  });

  it('leaves DATA fields untouched when config is null (falls back to Apps Script values)', () => {
    const sandbox = loadCommonJs();
    const data = { trialWeeks: 'From GAS', signupsOpen: true };
    sandbox.applyTeamSettingsToData(data, null);
    expect(data).toEqual({ trialWeeks: 'From GAS', signupsOpen: true });
  });

  it('only overlays keys actually present in a partial config, keeping the rest from GAS', () => {
    const sandbox = loadCommonJs();
    const data = { trialAttend: 'From GAS', trialWeeks: 4, signupsOpen: true };
    sandbox.applyTeamSettingsToData(data, { trialAttend: 'From Supabase' });
    expect(data).toEqual({
      trialAttend: 'From Supabase',
      trialWeeks: 4,
      signupsOpen: true,
      features: {},
      externalLinks: {},
      discordSignupChannelId: null,
      signupSheetLeadHours: null,
      teamOfficerBios: [],
      wishlistStatusLabels: {}
    });
  });
});

describe('saveTeamSetting', () => {
  it('calls the set_team_setting RPC with the team id and updates, resolving the new config', async () => {
    const rpcCalls = [];
    const supabase = {
      createClient: () => ({
        rpc(name, params) {
          rpcCalls.push({ name, params });
          return Promise.resolve({ data: { seasonName: 'New' }, error: null });
        }
      })
    };
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.saveTeamSetting({ seasonName: 'New' })).resolves.toEqual({ seasonName: 'New' });
    expect(rpcCalls).toEqual([
      {
        name: 'set_team_setting',
        params: { p_team_id: 1, p_updates: { seasonName: 'New' }, p_skip_audit: false }
      }
    ]);
  });

  it('passes p_skip_audit: true when the caller opts out (its own friendly writeAuditLog() covers this save)', async () => {
    const rpcCalls = [];
    const supabase = {
      createClient: () => ({
        rpc(name, params) {
          rpcCalls.push({ name, params });
          return Promise.resolve({ data: { seasonName: 'New' }, error: null });
        }
      })
    };
    const sandbox = loadCommonJs(supabase);
    await sandbox.saveTeamSetting({ seasonName: 'New' }, true);
    expect(rpcCalls).toEqual([
      {
        name: 'set_team_setting',
        params: { p_team_id: 1, p_updates: { seasonName: 'New' }, p_skip_audit: true }
      }
    ]);
  });

  it('rejects with the RPC error message on failure', async () => {
    const supabase = {
      createClient: () => ({
        rpc() {
          return Promise.resolve({ data: null, error: { message: 'Not authorized' } });
        }
      })
    };
    const sandbox = loadCommonJs(supabase);
    await expect(sandbox.saveTeamSetting({ seasonName: 'New' })).rejects.toThrow('Not authorized');
  });
});
