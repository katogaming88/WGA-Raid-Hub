import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/tabs/tab-audit.js is a plain browser script (no exports), so these
// tests load it into a vm sandbox with just enough browser globals stubbed,
// same pattern as tests/frontend/officer-claim-management.test.js. Covers
// the #378 rewire off the legacy GAS ?action=getAuditLog JSONP endpoint onto
// Supabase, against a mocked supabase client -- RLS itself is covered by
// tests/rls/.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TAB_AUDIT_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-audit.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

function makeEl(extra) {
  return Object.assign({ value: '', style: {}, textContent: '', innerHTML: '' }, extra);
}

// Routes .from(table) to per-test resolvers, supporting select/eq/order/in
// chains, and .rpc(name, args) to a per-test resolver keyed by function name.
function makeClient({ tables = {}, rpc = {} } = {}) {
  const captured = { byTable: {}, rpcCalls: [] };
  function builder(table, resolve) {
    const calls = { select: null, eq: [], order: [], in: [] };
    const b = {
      select(c) {
        calls.select = c;
        return b;
      },
      eq(c, v) {
        calls.eq.push([c, v]);
        return b;
      },
      order(c, opts) {
        calls.order.push([c, opts]);
        return b;
      },
      in(c, v) {
        calls.in.push([c, v]);
        return b;
      },
      then(ok, err) {
        return Promise.resolve()
          .then(() => resolve(calls))
          .then(ok, err);
      }
    };
    captured.byTable[table] = captured.byTable[table] || [];
    captured.byTable[table].push(calls);
    return b;
  }
  const client = {
    from(table) {
      return builder(table, () => (tables[table] ? tables[table]() : { data: null, error: null }));
    },
    rpc(name, args) {
      captured.rpcCalls.push({ name, args });
      const fn = rpc[name];
      return Promise.resolve(fn ? fn(args) : { data: null, error: null });
    }
  };
  return { client, captured };
}

function loadSandbox({ supabaseClient, els = {} } = {}) {
  const sandbox = {
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    console,
    document: { getElementById: (id) => els[id] || null },
    escHtml: (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'),
    setTimeout,
    clearTimeout,
    Promise,
    Date,
    isNaN
  };
  vm.createContext(sandbox);
  vm.runInContext(TAB_AUDIT_JS, sandbox, { filename: 'tab-audit.js' });
  return sandbox;
}

describe('buildAuditTab', () => {
  it('queries audit_log for the current team, newest first', async () => {
    const { client, captured } = makeClient({ tables: { audit_log: () => ({ data: [], error: null }) } });
    const els = { auditContainer: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();

    const q = captured.byTable.audit_log[0];
    expect(q.select).toBe('actor_id, action, target_type, target_id, detail, created_at');
    expect(q.eq).toEqual([['team_id', 1]]);
    expect(q.order).toEqual([['created_at', { ascending: false }]]);
  });

  it('shows an error message on a query error', async () => {
    const { client } = makeClient({ tables: { audit_log: () => ({ data: null, error: { message: 'boom' } }) } });
    const els = { auditContainer: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();
    expect(els.auditContainer.innerHTML).toContain('boom');
  });

  it('shows a not-connected message with no supabase client', () => {
    const els = { auditContainer: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: null, els });
    sandbox.buildAuditTab();
    expect(els.auditContainer.innerHTML).toContain('Not connected');
  });

  it('resolves CHANGED BY through resolve_actor_name() and TARGET through a players lookup, then renders DETAIL as plain text', async () => {
    const { client } = makeClient({
      tables: {
        audit_log: () => ({
          data: [
            {
              actor_id: 'uid-1',
              action: 'Trial Status Changed',
              target_type: 'players',
              target_id: 42,
              detail: 'Trial removed',
              created_at: '2026-07-09T13:45:00Z'
            }
          ],
          error: null
        }),
        players: () => ({ data: [{ id: 42, name_realm: 'Voljiin-Illidan' }], error: null })
      },
      rpc: { resolve_actor_name: () => ({ data: 'Kato', error: null }) }
    });
    const els = { auditContainer: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();

    expect(els.auditContainer.innerHTML).toContain('Kato');
    expect(els.auditContainer.innerHTML).toContain('Trial Status Changed');
    expect(els.auditContainer.innerHTML).toContain('Voljiin-Illidan');
    expect(els.auditContainer.innerHTML).toContain('Trial removed');
  });

  it('leaves CHANGED BY and TARGET blank when actor_id/target_type are null (historical rows, #377)', async () => {
    const { client, captured } = makeClient({
      tables: {
        audit_log: () => ({
          data: [
            {
              actor_id: null,
              action: 'Attendance Status Set',
              target_type: null,
              target_id: null,
              detail: 'Bench -> Present',
              created_at: '2026-07-01T09:00:00Z'
            }
          ],
          error: null
        })
      }
    });
    const els = { auditContainer: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();

    expect(captured.rpcCalls).toHaveLength(0);
    expect(captured.byTable.players).toBeUndefined();
    expect(els.auditContainer.innerHTML).toContain('Bench -&gt; Present');
    expect(els.auditContainer.innerHTML).toMatch(/<td class="audit-changedby"><\/td>/);
    expect(els.auditContainer.innerHTML).toMatch(/<td class="audit-target"><\/td>/);
  });

  it('degrades to a blank name when resolve_actor_name() errors, without failing the rest of the row', async () => {
    const { client } = makeClient({
      tables: {
        audit_log: () => ({ data: [{ actor_id: 'uid-1', action: 'Player Removed', created_at: null }], error: null })
      },
      rpc: { resolve_actor_name: () => ({ data: null, error: { message: 'not authorized' } }) }
    });
    const els = { auditContainer: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();
    expect(els.auditContainer.innerHTML).toContain('Player Removed');
    expect(els.auditContainer.innerHTML).toMatch(/<td class="audit-changedby"><\/td>/);
  });

  it('shows an empty state with no entries', async () => {
    const { client } = makeClient({ tables: { audit_log: () => ({ data: [], error: null }) } });
    const els = { auditContainer: makeEl() };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();
    expect(els.auditContainer.innerHTML).toContain('No audit log entries yet.');
  });
});

describe('renderAuditLog search', () => {
  it('filters across changedBy, action, target, and detail', async () => {
    const { client } = makeClient({
      tables: {
        audit_log: () => ({
          data: [
            {
              actor_id: 'uid-1',
              action: 'Trial Status Changed',
              target_type: 'players',
              target_id: 1,
              detail: 'Trial removed',
              created_at: null
            },
            {
              actor_id: 'uid-2',
              action: 'Manual Score Set',
              target_type: 'players',
              target_id: 2,
              detail: '6.2',
              created_at: null
            }
          ],
          error: null
        }),
        players: () => ({
          data: [
            { id: 1, name_realm: 'Voljiin-Illidan' },
            { id: 2, name_realm: 'Elmerdudd-Illidan' }
          ],
          error: null
        })
      },
      rpc: {
        resolve_actor_name: ({ p_actor_id }) => ({ data: p_actor_id === 'uid-1' ? 'Kato' : 'Rex', error: null })
      }
    });
    const els = { auditContainer: makeEl(), auditSearch: makeEl({ value: 'elmerdudd' }) };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();

    expect(els.auditContainer.innerHTML).toContain('Elmerdudd-Illidan');
    expect(els.auditContainer.innerHTML).not.toContain('Voljiin-Illidan');
  });

  it('shows a no-match message when the search excludes every entry', async () => {
    const { client } = makeClient({
      tables: {
        audit_log: () => ({ data: [{ actor_id: null, action: 'Signups Opened', created_at: null }], error: null })
      }
    });
    const els = { auditContainer: makeEl(), auditSearch: makeEl({ value: 'nothing matches this' }) };
    const sandbox = loadSandbox({ supabaseClient: client, els });
    sandbox.buildAuditTab();
    await flush();
    expect(els.auditContainer.innerHTML).toContain('No entries match your search.');
  });
});

describe('auditFormatTs', () => {
  it('formats an ISO timestamp as yyyy-MM-dd HH:mm in local time', () => {
    const sandbox = loadSandbox({ supabaseClient: null });
    const d = new Date('2026-07-09T13:45:00Z');
    const pad = (n) => (n < 10 ? '0' + n : String(n));
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    expect(sandbox.auditFormatTs('2026-07-09T13:45:00Z')).toBe(expected);
  });

  it('returns an empty string for a falsy input', () => {
    const sandbox = loadSandbox({ supabaseClient: null });
    expect(sandbox.auditFormatTs(null)).toBe('');
  });
});
