import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// js/tabs/tab-roster.js is a plain browser script (no exports); this test
// loads it into a vm sandbox to reach backfillNotOnRosterForPlayer (#241) --
// the bulk write that marks every pre-join raid night "Not on Roster" for a
// mid-season roster add, so the player detail panel's attendance history
// doesn't show every historical night as blank/editable.

const ROSTER_JS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/tabs/tab-roster.js'),
  'utf8'
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Routes .from(table).select().eq()... / .insert() / .rpc() to per-test
// resolvers, keyed by table+kind so a test can distinguish the "all raid
// dates" read from the "this player's existing dates" read.
function makeSupabase(config) {
  const calls = { selects: [], inserts: [], rpc: null };
  function builder(kind, record) {
    const b = {
      eq(col, val) {
        record.eq = record.eq || [];
        record.eq.push([col, val]);
        return b;
      },
      lt(col, val) {
        record.lt = [col, val];
        return b;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => (config[kind] ? config[kind](record) : { data: null, error: null }))
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
          return builder('select_' + (calls.selects.length === 1 ? 'all' : 'existing'), record);
        },
        insert(rows) {
          const record = { table, rows };
          calls.inserts.push(record);
          return builder('insert', record);
        }
      };
    },
    rpc(name, params) {
      calls.rpc = { name, params };
      return builder('rpc', { name, params });
    }
  };
  return { client, calls };
}

function loadSandbox(supabaseClient) {
  const sandbox = {
    console,
    document: { getElementById: () => null },
    window: {},
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(ROSTER_JS, sandbox, { filename: 'tab-roster.js' });
  sandbox.supabaseClient = supabaseClient;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  // js/common.js's real writeAuditLog(), reimplemented here rather than
  // loading that whole file just for this one function.
  sandbox.writeAuditLog = function (action, targetType, targetId, detail) {
    return supabaseClient
      .rpc('write_audit_log', {
        p_team_id: sandbox._teamCfg.supabaseTeamId,
        p_action: action,
        p_target_type: targetType || null,
        p_target_id: targetId == null ? null : targetId,
        p_detail: detail == null ? null : String(detail)
      })
      .then(function (result) {
        if (result.error) console.warn('Failed to write audit log entry.', result.error.message);
      });
  };
  return sandbox;
}

describe('backfillNotOnRosterForPlayer (#241)', () => {
  it('does nothing when no join date is given', async () => {
    const { client, calls } = makeSupabase({});
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, null);
    expect(calls.selects).toHaveLength(0);
  });

  it('does nothing when the team has no raid nights before the join date', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    expect(calls.inserts).toHaveLength(0);
  });

  it('inserts Not on Roster only for dates the player has no row for yet', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({
        data: [{ raid_date: '2026-06-01' }, { raid_date: '2026-06-08' }, { raid_date: '2026-06-08' }],
        error: null
      }),
      select_existing: () => ({ data: [{ raid_date: '2026-06-01' }], error: null }),
      insert: () => ({ data: null, error: null }),
      rpc: () => ({ data: null, error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    await flush();

    expect(calls.inserts).toHaveLength(1);
    expect(calls.inserts[0].table).toBe('attendance');
    expect(calls.inserts[0].rows).toEqual([
      { team_id: 1, player_id: 5, raid_date: '2026-06-08', status: 'Not on Roster' }
    ]);
  });

  it('never overwrites a date the player already has a real status for', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({ data: [{ raid_date: '2026-06-01' }], error: null }),
      select_existing: () => ({ data: [{ raid_date: '2026-06-01' }], error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    expect(calls.inserts).toHaveLength(0);
  });

  it('writes a single summary audit log entry, not one per date', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({ data: [{ raid_date: '2026-06-01' }, { raid_date: '2026-06-08' }], error: null }),
      select_existing: () => ({ data: [], error: null }),
      insert: () => ({ data: null, error: null }),
      rpc: () => ({ data: null, error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    await flush();

    expect(calls.rpc.name).toBe('write_audit_log');
    expect(calls.rpc.params.p_action).toBe('Attendance Backfilled');
    expect(calls.rpc.params.p_detail).toContain('2 pre-join night(s)');
  });

  it('only looks at dates before the join date', async () => {
    const { client, calls } = makeSupabase({
      select_all: () => ({ data: [], error: null })
    });
    const sandbox = loadSandbox(client);
    await sandbox.backfillNotOnRosterForPlayer(1, 5, '2026-07-01');
    expect(calls.selects[0].lt).toEqual(['raid_date', '2026-07-01']);
  });
});
