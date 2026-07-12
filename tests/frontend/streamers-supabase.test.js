import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #286: guild-wide Twitch streams, wired to the real streamers table instead
// of MOCK_STREAMERS. Loads the real common.js (fetchSupabaseStreamers/
// mapSupabaseStreamers/_esc/normalise) and the real streamers.js on top, same
// vm-sandbox pattern as the rest of this suite -- js/streamers.js depends on
// common.js globals (_teamCfg, TEAM_SLUG, DATA, supabaseClient, normalise,
// _esc) and on renderProfile (js/common.js), which is stubbed since nothing
// here asserts on the profile re-render itself.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');
const STREAMERS_JS = readFileSync(path.join(HERE, '../../js/streamers.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEl(extra) {
  return Object.assign({ style: {}, textContent: '', innerHTML: '', value: '', checked: false }, extra);
}

// Chainable stand-in for the supabase-js query builder used by
// fetchSupabaseStreamers() (select/then) and saveOwnStreamer/
// removeOwnStreamer (upsert/delete/eq/select/then).
function makeSupabase({ selectResult, upsertResult, deleteResult } = {}) {
  const calls = { selects: [], upserts: [], deletes: [] };
  function builder(kind, record) {
    const b = {
      select(cols) {
        record.select = cols;
        return b;
      },
      eq(col, val) {
        record.eq = [col, val];
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => {
            if (kind === 'select') return selectResult ?? { data: null, error: { message: 'not mocked' } };
            if (kind === 'upsert') return upsertResult ?? { data: [{ id: 99, is_live: false }], error: null };
            if (kind === 'delete') return deleteResult ?? { data: null, error: null };
          })
          .then(onFulfilled, onRejected);
      }
    };
    return b;
  }
  const client = {
    from(table) {
      return {
        select(cols) {
          const record = { table, select: cols };
          calls.selects.push(record);
          return builder('select', record);
        },
        upsert(payload, opts) {
          const record = { table, payload, opts };
          calls.upserts.push(record);
          return builder('upsert', record);
        },
        delete() {
          const record = { table };
          calls.deletes.push(record);
          return builder('delete', record);
        }
      };
    }
  };
  return { calls, client };
}

function loadSandbox({ supabaseClient, streamers, roster = [], els = {}, search = '' } = {}) {
  const allEls = { ...els };
  const renderProfile = vi.fn();
  const buildStreamWidgetCalls = [];
  const sandbox = {
    window: {},
    location: { search, pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => {
        if (!allEls[id]) allEls[id] = makeEl();
        return allEls[id];
      },
      createElement: () => ({}),
      head: { appendChild: () => {} },
      querySelectorAll: () => []
    },
    console,
    Intl,
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    confirm: () => true,
    IntersectionObserver: undefined
  };
  vm.createContext(sandbox);
  vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  vm.runInContext(STREAMERS_JS, sandbox, { filename: 'streamers.js' });
  sandbox.supabaseClient = supabaseClient;
  sandbox.DATA = { roster, streamers: streamers || [] };
  sandbox.renderProfile = renderProfile;
  // buildStreamWidget touches DOM elements (streamWidget/streamWidgetPill/
  // streamWidgetPanel) this suite doesn't set up; stubbing it keeps these
  // tests focused on the read/write wiring, not the widget's own render path
  // (covered separately by nothing here breaking when it's called).
  sandbox.buildStreamWidget = () => buildStreamWidgetCalls.push(true);
  return { sandbox, els: allEls, renderProfile, buildStreamWidgetCalls };
}

function streamerRow(overrides) {
  return {
    id: 1,
    team_id: 1,
    player_id: 5,
    twitch_channel: 'katogaming',
    schedule_note: 'Raids Tue/Thu 8pm ET.',
    guild_wide_opt_out: false,
    is_live: true,
    players: { name_realm: 'Kato-Illidan', nickname: 'Kato Gaming' },
    ...overrides
  };
}

describe('mapSupabaseStreamers', () => {
  it('maps team_id to team_slug via TEAMS, not the raw id', () => {
    const { sandbox } = loadSandbox({});
    const mapped = sandbox.mapSupabaseStreamers([streamerRow({ team_id: 2 })]);
    expect(mapped[0].team_slug).toBe('hellfire');
  });

  it('uses the joined nickname as display_name, falling back to first name', () => {
    const { sandbox } = loadSandbox({});
    const withNick = sandbox.mapSupabaseStreamers([streamerRow()]);
    expect(withNick[0].display_name).toBe('Kato Gaming');

    const noNick = sandbox.mapSupabaseStreamers([streamerRow({ players: { name_realm: 'Ashlynn-Area52' } })]);
    expect(noNick[0].display_name).toBe('Ashlynn');
    expect(noNick[0].player_first_name).toBe('Ashlynn');
  });

  it('skips a row with no linked player rather than crashing', () => {
    const { sandbox } = loadSandbox({});
    const mapped = sandbox.mapSupabaseStreamers([streamerRow({ players: null }), streamerRow()]);
    expect(mapped).toHaveLength(1);
  });

  it('resolves to an empty array for null/empty input', () => {
    const { sandbox } = loadSandbox({});
    expect(sandbox.mapSupabaseStreamers(null)).toEqual([]);
    expect(sandbox.mapSupabaseStreamers([])).toEqual([]);
  });
});

describe('fetchSupabaseStreamers', () => {
  it('queries with no team_id filter -- guild-wide, unlike every other fetchSupabaseX()', async () => {
    const { calls, client } = makeSupabase({ selectResult: { data: [streamerRow()], error: null } });
    const { sandbox } = loadSandbox({ supabaseClient: client });
    const rows = await sandbox.fetchSupabaseStreamers();
    expect(rows).toHaveLength(1);
    expect(calls.selects[0].table).toBe('streamers');
    expect(calls.selects[0].eq).toBeUndefined();
  });

  it('resolves null on a query error', async () => {
    const { client } = makeSupabase({ selectResult: { data: null, error: { message: 'boom' } } });
    const { sandbox } = loadSandbox({ supabaseClient: client });
    await expect(sandbox.fetchSupabaseStreamers()).resolves.toBeNull();
  });
});

describe('getTeamStreamers / getGuildStreamers / getVisibleStreamers / getOwnStreamer', () => {
  const streamers = [
    { team_slug: 'phoenix', player_first_name: 'Kato', guild_wide_opt_out: false },
    { team_slug: 'hellfire', player_first_name: 'Brakka', guild_wide_opt_out: false },
    { team_slug: 'hellfire', player_first_name: 'Novabyte', guild_wide_opt_out: true }
  ];

  it('splits by TEAM_SLUG and excludes opted-out guild streamers', () => {
    const { sandbox } = loadSandbox({ streamers, search: '' }); // default team: phoenix
    expect(sandbox.getTeamStreamers().map((s) => s.player_first_name)).toEqual(['Kato']);
    expect(sandbox.getGuildStreamers().map((s) => s.player_first_name)).toEqual(['Brakka']);
    expect(sandbox.getVisibleStreamers().map((s) => s.player_first_name)).toEqual(['Kato', 'Brakka']);
  });

  it('getOwnStreamer only matches within the current team, case/diacritic-insensitively', () => {
    const { sandbox } = loadSandbox({ streamers, search: '' });
    expect(sandbox.getOwnStreamer('KATO')).toBeTruthy();
    expect(sandbox.getOwnStreamer('Brakka')).toBeNull(); // hellfire, not the current team
  });
});

describe('_esc (#286 fix -- was called but never defined anywhere)', () => {
  it('escapes every HTML-significant character', () => {
    const { sandbox } = loadSandbox({});
    expect(sandbox._esc(`<script>alert('x')</script> & "quotes"`)).toBe(
      '&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;quotes&quot;'
    );
  });

  it('null/undefined become an empty string, not "null"/"undefined"', () => {
    const { sandbox } = loadSandbox({});
    expect(sandbox._esc(null)).toBe('');
    expect(sandbox._esc(undefined)).toBe('');
  });
});

describe('streamerCardHTML escapes raider-controlled fields (#286 security fix)', () => {
  it('a malicious schedule_note/display_name cannot break out of the markup', () => {
    const { sandbox } = loadSandbox({});
    const s = {
      team_slug: 'other',
      display_name: '<img src=x onerror=alert(1)>',
      twitch_channel: 'realchannel',
      schedule_note: '</p><script>alert(2)</script>',
      is_live: false
    };
    const html = sandbox.streamerCardHTML(s);
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(2)&lt;/script&gt;');
  });
});

describe('saveOwnStreamer', () => {
  function setup(overrides) {
    const { calls, client } = makeSupabase(overrides);
    const els = {
      'streamerChannel-Kato': makeEl({ value: 'katogaming' }),
      'streamerNote-Kato': makeEl({ value: 'Raids Tue/Thu' }),
      'streamerOptOut-Kato': makeEl({ checked: true }),
      'streamerSaveMsg-Kato': makeEl()
    };
    const { sandbox, renderProfile, buildStreamWidgetCalls } = loadSandbox({
      supabaseClient: client,
      roster: [{ id: 5, firstName: 'Kato', nick: 'Kato Gaming' }],
      streamers: [],
      els
    });
    return { sandbox, calls, els, renderProfile, buildStreamWidgetCalls };
  }

  it('upserts with the resolved player_id, current team, and form values', async () => {
    const { sandbox, calls } = setup();
    sandbox.saveOwnStreamer('Kato');
    await flush();
    expect(calls.upserts).toHaveLength(1);
    expect(calls.upserts[0].payload).toEqual({
      team_id: 1,
      player_id: 5,
      twitch_channel: 'katogaming',
      schedule_note: 'Raids Tue/Thu',
      guild_wide_opt_out: true
    });
    expect(calls.upserts[0].opts).toEqual({ onConflict: 'player_id' });
  });

  it('strips a pasted twitch.tv URL down to the bare channel name', async () => {
    const { sandbox, calls, els } = setup();
    els['streamerChannel-Kato'].value = 'https://www.twitch.tv/katogaming';
    sandbox.saveOwnStreamer('Kato');
    await flush();
    expect(calls.upserts[0].payload.twitch_channel).toBe('katogaming');
  });

  it('rejects an invalid channel name before ever calling Supabase', () => {
    const { sandbox, calls, els } = setup();
    els['streamerChannel-Kato'].value = '!!';
    sandbox.saveOwnStreamer('Kato');
    expect(calls.upserts).toHaveLength(0);
    expect(els['streamerSaveMsg-Kato'].textContent).toContain('valid Twitch channel name');
  });

  it('patches DATA.streamers locally and re-renders on success', async () => {
    const { sandbox, renderProfile, buildStreamWidgetCalls } = setup({
      upsertResult: { data: [{ id: 42, is_live: false }], error: null }
    });
    sandbox.saveOwnStreamer('Kato');
    await flush();

    expect(sandbox.DATA.streamers).toHaveLength(1);
    expect(sandbox.DATA.streamers[0]).toEqual({
      id: 42,
      team_slug: 'phoenix',
      player_first_name: 'Kato',
      display_name: 'Kato Gaming',
      twitch_channel: 'katogaming',
      schedule_note: 'Raids Tue/Thu',
      guild_wide_opt_out: true,
      is_live: false
    });
    expect(renderProfile).toHaveBeenCalledWith('Kato', 'landing');
    expect(buildStreamWidgetCalls).toHaveLength(1);
  });

  it('updates the existing entry in place instead of duplicating it', async () => {
    const { sandbox } = setup({ upsertResult: { data: [{ id: 1, is_live: true }], error: null } });
    sandbox.DATA.streamers = [
      { id: 1, team_slug: 'phoenix', player_first_name: 'Kato', display_name: 'Old Name', is_live: true }
    ];
    sandbox.saveOwnStreamer('Kato');
    await flush();
    expect(sandbox.DATA.streamers).toHaveLength(1);
    expect(sandbox.DATA.streamers[0].display_name).toBe('Kato Gaming');
  });

  it('shows the RLS/error message and never touches DATA.streamers on failure', async () => {
    const { sandbox, els } = setup({ upsertResult: { data: null, error: { message: 'permission denied' } } });
    sandbox.saveOwnStreamer('Kato');
    await flush();
    expect(sandbox.DATA.streamers).toEqual([]);
    expect(els['streamerSaveMsg-Kato'].textContent).toBe('permission denied');
  });

  it('refuses to call Supabase for a firstName with no roster match', () => {
    const { sandbox, calls, els } = setup();
    sandbox.saveOwnStreamer('NotOnRoster');
    expect(calls.upserts).toHaveLength(0);
    expect(els['streamerSaveMsg-NotOnRoster']).toBeUndefined();
  });
});

describe('removeOwnStreamer', () => {
  it('deletes by id and removes only that entry from DATA.streamers', async () => {
    const { calls, client } = makeSupabase({ deleteResult: { data: null, error: null } });
    const { sandbox, renderProfile } = loadSandbox({
      supabaseClient: client,
      streamers: [
        { id: 7, team_slug: 'phoenix', player_first_name: 'Kato' },
        { id: 8, team_slug: 'phoenix', player_first_name: 'Ashlynn' }
      ]
    });
    sandbox.removeOwnStreamer('Kato');
    await flush();

    expect(calls.deletes[0].table).toBe('streamers');
    expect(sandbox.DATA.streamers.map((s) => s.player_first_name)).toEqual(['Ashlynn']);
    expect(renderProfile).toHaveBeenCalledWith('Kato', 'landing');
  });

  it('does nothing if the raider has no streamer entry to remove', async () => {
    const { calls, client } = makeSupabase({});
    const { sandbox } = loadSandbox({ supabaseClient: client, streamers: [] });
    sandbox.removeOwnStreamer('Kato');
    await flush();
    expect(calls.deletes).toHaveLength(0);
  });

  it('shows the error message and leaves DATA.streamers untouched on failure', async () => {
    const { client } = makeSupabase({ deleteResult: { data: null, error: { message: 'network error' } } });
    const els = { 'streamerSaveMsg-Kato': makeEl() };
    const { sandbox } = loadSandbox({
      supabaseClient: client,
      streamers: [{ id: 7, team_slug: 'phoenix', player_first_name: 'Kato' }],
      els
    });
    sandbox.removeOwnStreamer('Kato');
    await flush();
    expect(sandbox.DATA.streamers).toHaveLength(1);
    expect(els['streamerSaveMsg-Kato'].textContent).toBe('network error');
  });
});
