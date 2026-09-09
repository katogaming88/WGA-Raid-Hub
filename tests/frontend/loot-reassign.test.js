import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #1029: officer-only correction for a raid-awarded rclc_loot row whose item
// was traded in-game after loot council awarded it. rclc_loot already has a
// full officer RLS write policy, so this is a plain client UPDATE plus an
// audit log entry -- no new RPC/migration. This suite loads js/common.js
// (fetchAllPaged, seasonDisplayName, writeAuditLog) and
// js/tabs/tab-loot-import.js together into one vm sandbox, the same way
// attendance-manual-entry.test.js combines common.js functions with a tab
// file's own. escHtml/auditFormatTs are stubbed rather than loaded from their
// real files (tab-attendance.js/tab-audit.js) -- this suite isn't testing
// HTML-escaping or timestamp formatting, and admin-tab-visibility.test.js
// already establishes that stubbing them this way is fine when they aren't
// the point of the test.

const dir = path.dirname(fileURLToPath(import.meta.url));
const COMMON_JS = readFileSync(path.join(dir, '../../js/common.js'), 'utf8');
const TAB_LOOT_IMPORT_JS = readFileSync(path.join(dir, '../../js/tabs/tab-loot-import.js'), 'utf8');

function makeEl(extra) {
  return Object.assign({ style: {}, innerHTML: '', textContent: '', disabled: false, value: '' }, extra);
}

function loadSandbox({ supabaseClient, els = {}, roster = [] } = {}) {
  const sandbox = {
    window: {},
    location: { search: '', pathname: '/' },
    sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: {
      getElementById: (id) => els[id] || null,
      createElement: () => makeEl(),
      head: { appendChild: () => {} },
      addEventListener: () => {}
    },
    console: { log: () => {}, warn: () => {}, error: () => {} },
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
  vm.runInContext(TAB_LOOT_IMPORT_JS, sandbox, { filename: 'tab-loot-import.js' });
  sandbox.escHtml = (s) => String(s);
  sandbox.auditFormatTs = (iso) => iso;
  sandbox.supabaseClient = supabaseClient;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  // The real code reads both bare `DATA` and `window.DATA` (the latter as a
  // truthiness guard) -- both need to point at the same object here.
  sandbox.DATA = { roster };
  sandbox.window.DATA = sandbox.DATA;
  return sandbox;
}

// Chainable stand-in covering both the paged select rclc_loot read
// (loadLootForReassign) and the update + rpc write (submitLootReassign).
function makeSupabase({ lootRows = [], updateResult = { error: null }, rpcResult = { error: null } } = {}) {
  const calls = { selects: [], updates: [], rpc: null };

  function selectBuilder(record) {
    const b = {
      eq(col, val) {
        record.eq = record.eq || [];
        record.eq.push([col, val]);
        return b;
      },
      order(col, opts) {
        record.order = [col, opts];
        return b;
      },
      gt(col, val) {
        record.gt = [col, val];
        return b;
      },
      limit(n) {
        record.limit = n;
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => {
            const after = record.gt ? record.gt[1] : null;
            const limit = record.limit || 1000;
            const slice = lootRows.filter((r) => after === null || r.id > after).slice(0, limit);
            return { data: slice, error: null, count: after === null ? lootRows.length : null };
          })
          .then(onFulfilled, onRejected);
      }
    };
    return b;
  }

  const client = {
    from(table) {
      return {
        select(cols, opts) {
          const record = { table, select: cols, countRequested: !!(opts && opts.count) };
          calls.selects.push(record);
          return selectBuilder(record);
        },
        update(payload) {
          const record = { table, payload };
          return {
            eq(col, val) {
              record.eq = [col, val];
              calls.updates.push(record);
              return Promise.resolve(updateResult);
            }
          };
        }
      };
    },
    rpc(name, params) {
      calls.rpc = { name, params };
      return Promise.resolve(rpcResult);
    }
  };
  return { client, calls };
}

function lootRow(overrides) {
  return {
    id: 1,
    item_id: 10,
    track: 'Hero',
    season: 'MID2',
    awarded_at: '2026-08-20T22:15:00-04:00',
    items: { name: 'Errant Scrollsage’s Hood' },
    ...overrides
  };
}

const roster = [
  { id: 20, firstName: 'Strika', nameRealm: 'Strikä-Stormrage' },
  { id: 21, firstName: 'Kato', nameRealm: 'Katorri-Stormrage' }
];

describe('loadLootForReassign (#1029)', () => {
  it("fetches the selected player's rclc_loot rows and sorts newest-first", async () => {
    const oldRow = lootRow({ id: 1, awarded_at: '2026-08-01T00:00:00Z' });
    const newRow = lootRow({ id: 2, awarded_at: '2026-08-20T00:00:00Z' });
    const { client, calls } = makeSupabase({ lootRows: [oldRow, newRow] });
    const els = { lootReassignContent: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els, roster });

    sandbox.loadLootForReassign('20');
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.selects[0].eq).toContainEqual(['player_id', '20']);
    expect(sandbox._lootReassignRows.map((r) => r.id)).toEqual([2, 1]);
    expect(els.lootReassignContent.innerHTML).toContain('Errant');
  });

  it('shows an error message when the read fails', async () => {
    const { client } = makeSupabase();
    client.from = () => ({
      select: () => ({
        eq: function () {
          return this;
        },
        order: function () {
          return this;
        },
        limit: function () {
          return this;
        },
        then: (onFulfilled) =>
          Promise.resolve({ data: null, error: { message: 'boom' }, count: null }).then(onFulfilled)
      })
    });
    const els = { lootReassignContent: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els, roster });

    sandbox.loadLootForReassign('20');
    await new Promise((r) => setTimeout(r, 0));

    expect(els.lootReassignContent.innerHTML).toMatch(/could not load/i);
  });

  it('renders a message when the player has no raid-awarded loot', async () => {
    const { client } = makeSupabase({ lootRows: [] });
    const els = { lootReassignContent: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els, roster });

    sandbox.loadLootForReassign('20');
    await new Promise((r) => setTimeout(r, 0));

    expect(els.lootReassignContent.innerHTML).toMatch(/no raid-awarded loot/i);
  });
});

describe('submitLootReassign (#1029)', () => {
  it('updates rclc_loot.player_id and writes an audit log entry naming both players and the item', async () => {
    const row = lootRow({ id: 5 });
    const { client, calls } = makeSupabase({ lootRows: [row] });
    const els = {
      lootReassignContent: makeEl(),
      'loot-reassign-target-5': makeEl({ value: '21' }),
      'loot-reassign-ind-5': makeEl()
    };
    const sandbox = loadSandbox({ supabaseClient: client, els, roster });
    sandbox._lootReassignRows = [row];
    sandbox._lootReassignPlayerId = '20';

    sandbox.submitLootReassign(5);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.updates[0].table).toBe('rclc_loot');
    expect(calls.updates[0].payload).toEqual({ player_id: '21' });
    expect(calls.updates[0].eq).toEqual(['id', 5]);
    expect(calls.rpc.name).toBe('write_audit_log');
    expect(calls.rpc.params.p_action).toBe('Loot Reassigned');
    expect(calls.rpc.params.p_detail).toContain('Errant');
    expect(calls.rpc.params.p_detail).toContain('Strika');
    expect(calls.rpc.params.p_detail).toContain('Kato');
  });

  it('removes the reassigned row from the current list after success', async () => {
    const row = lootRow({ id: 5 });
    const { client } = makeSupabase({ lootRows: [row] });
    const els = {
      lootReassignContent: makeEl(),
      'loot-reassign-target-5': makeEl({ value: '21' }),
      'loot-reassign-ind-5': makeEl()
    };
    const sandbox = loadSandbox({ supabaseClient: client, els, roster });
    sandbox._lootReassignRows = [row];
    sandbox._lootReassignPlayerId = '20';

    sandbox.submitLootReassign(5);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(sandbox._lootReassignRows).toHaveLength(0);
  });

  it('does not submit (and flags the select) when no target player is chosen', async () => {
    const row = lootRow({ id: 5 });
    const { client, calls } = makeSupabase({ lootRows: [row] });
    const els = {
      lootReassignContent: makeEl(),
      'loot-reassign-target-5': makeEl({ value: '' }),
      'loot-reassign-ind-5': makeEl()
    };
    const sandbox = loadSandbox({ supabaseClient: client, els, roster });
    sandbox._lootReassignRows = [row];
    sandbox._lootReassignPlayerId = '20';

    sandbox.submitLootReassign(5);
    await new Promise((r) => setTimeout(r, 0));

    expect(calls.updates).toHaveLength(0);
    expect(els['loot-reassign-target-5'].style.borderColor).toBe('var(--melee)');
  });

  it('shows an error and re-enables the select on a failed update', async () => {
    const row = lootRow({ id: 5 });
    const { client } = makeSupabase({ lootRows: [row], updateResult: { error: { message: 'boom' } } });
    const els = {
      lootReassignContent: makeEl(),
      'loot-reassign-target-5': makeEl({ value: '21' }),
      'loot-reassign-ind-5': makeEl()
    };
    const sandbox = loadSandbox({ supabaseClient: client, els, roster });
    sandbox._lootReassignRows = [row];
    sandbox._lootReassignPlayerId = '20';

    sandbox.submitLootReassign(5);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(els['loot-reassign-target-5'].disabled).toBe(false);
    expect(els['loot-reassign-ind-5'].textContent).toContain('boom');
    expect(sandbox._lootReassignRows).toHaveLength(1);
  });
});
