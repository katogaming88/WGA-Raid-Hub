import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realWriteAuditLog } from './helpers/common-sandbox.js';

// js/tabs/tab-roster.js is a plain browser script (no exports); this test
// loads it into a vm sandbox. Re-adding someone removed earlier is one
// restore_player() call (#1133) that leaves why they left alone, and clearing
// an officer note never gives a player a blank notes row.

const ROSTER_JS = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../js/tabs/tab-roster.js'),
  'utf8'
);

const TEAM_ID = 7;

// Records every query and call in order. `respond` answers each one from what
// it was asked, so a case describes only the replies it cares about.
function makeClient(respond) {
  const calls = [];
  function query(record) {
    calls.push(record);
    const q = {
      select(cols) {
        record.select = cols;
        return q;
      },
      eq(col, val) {
        record.eq.push([col, val]);
        return q;
      },
      maybeSingle() {
        return q;
      },
      single() {
        return q;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve()
          .then(() => respond(record) || { data: null, error: null })
          .then(onFulfilled, onRejected);
      }
    };
    return q;
  }
  const client = {
    from(table) {
      const start = (op, payload, opts) => query({ table, op, payload, opts, eq: [] });
      return {
        select: (cols) => start('select').select(cols),
        insert: (rows) => start('insert', rows),
        update: (values) => start('update', values),
        upsert: (values, opts) => start('upsert', values, opts)
      };
    },
    rpc(name, params) {
      return query({ rpc: name, params, eq: [] });
    }
  };
  return { client, calls };
}

// The backfill has its own suite (attendance-backfill.test.js); here it only
// records which character it was asked to fill.
function loadSandbox(client) {
  const sandbox = { console, document: { getElementById: () => null }, window: {}, setTimeout, clearTimeout, Promise };
  vm.createContext(sandbox);
  vm.runInContext(ROSTER_JS, sandbox, { filename: 'tab-roster.js' });
  sandbox.supabaseClient = client;
  sandbox._teamCfg = { supabaseTeamId: TEAM_ID };
  sandbox.writeAuditLog = realWriteAuditLog(client, TEAM_ID);
  const backfills = [];
  sandbox.backfillNotOnRosterForPlayer = (teamId, playerId, joinDate) => {
    backfills.push([teamId, playerId, joinDate]);
    return Promise.resolve();
  };
  return { sandbox, backfills };
}

const FORM = {
  nameRealm: 'Back-Illidan',
  nick: '',
  class: 'Mage',
  spec: 'Frost',
  role: 'Ranged',
  isTrial: true,
  joinDate: '2026-10-03'
};

// A players update answers with the row, as the server would, so a page that
// still revives by updating it fails on what it called, not on a null reply.
function respondWith({ existing = null, restore = { data: false, error: null }, insert = null }) {
  return (r) => {
    if (r.table === 'classes_specs') return { data: { id: 12 }, error: null };
    if (r.table === 'players' && r.op === 'select') return { data: existing, error: null };
    if (r.table === 'players' && r.op === 'insert') return insert;
    if (r.table === 'players' && r.op === 'update') return { data: { id: existing.id }, error: null };
    if (r.rpc === 'restore_player') return restore;
    return null;
  };
}

const REMOVED = { id: 55, archived_at: '2026-09-01T00:00:00Z' };

describe('re-adding someone removed earlier (#1133)', () => {
  it("is one restore_player() call carrying the form's values", async () => {
    const { client, calls } = makeClient(respondWith({ existing: REMOVED }));
    const { sandbox, backfills } = loadSandbox(client);
    expect(await sandbox.addPlayerToRosterSupabase(FORM)).toBe(55);
    expect(calls.filter((c) => c.rpc === 'restore_player').map((c) => c.params)).toEqual([
      {
        p_player_id: 55,
        p_name_realm: 'Back-Illidan',
        p_nickname: null,
        p_class_spec_id: 12,
        p_is_trial: true,
        p_join_date: '2026-10-03'
      }
    ]);
    expect(backfills).toEqual([[TEAM_ID, 55, '2026-10-03']]);
  });

  it('writes nothing else: no players update, no notes write, no audit entry of its own', async () => {
    const { client, calls } = makeClient(respondWith({ existing: REMOVED }));
    const { sandbox } = loadSandbox(client);
    await sandbox.addPlayerToRosterSupabase(FORM);
    expect(calls.filter((c) => c.op && c.op !== 'select').map((c) => `${c.table} ${c.op}`)).toEqual([]);
    expect(calls.filter((c) => c.rpc && c.rpc !== 'restore_player').map((c) => c.rpc)).toEqual([]);
  });

  it('sends a blank join date as blank, so the character keeps its own', async () => {
    const { client, calls } = makeClient(respondWith({ existing: REMOVED }));
    const { sandbox } = loadSandbox(client);
    await sandbox.addPlayerToRosterSupabase({ ...FORM, joinDate: '' });
    expect(calls.filter((c) => c.rpc === 'restore_player').map((c) => c.params.p_join_date)).toEqual([null]);
  });

  it('fails the add when the call fails, and backfills nothing', async () => {
    const restore = { data: null, error: { message: 'Back-Illidan is already on the roster' } };
    const { client } = makeClient(respondWith({ existing: REMOVED, restore }));
    const { sandbox, backfills } = loadSandbox(client);
    await expect(sandbox.addPlayerToRosterSupabase(FORM)).rejects.toThrow(/already on the roster/);
    expect(backfills).toEqual([]);
  });
});

describe('adding a brand-new name', () => {
  it('still inserts the row and writes its own Player Added entry', async () => {
    const { client, calls } = makeClient(respondWith({ insert: { data: { id: 77 }, error: null } }));
    const { sandbox, backfills } = loadSandbox(client);
    expect(await sandbox.addPlayerToRosterSupabase(FORM)).toBe(77);
    const inserts = calls.filter((c) => c.table === 'players' && c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({ team_id: TEAM_ID, name_realm: 'Back-Illidan', class_spec_id: 12 });
    expect(
      calls.filter((c) => c.rpc === 'write_audit_log').map((c) => [c.params.p_action, c.params.p_target_id])
    ).toEqual([['Player Added', 77]]);
    expect(calls.filter((c) => c.rpc === 'restore_player')).toEqual([]);
    expect(backfills).toEqual([[TEAM_ID, 77, '2026-10-03']]);
  });
});

describe('saving an officer note (#1133)', () => {
  const noteWrites = (calls) =>
    calls.filter((c) => c.table === 'player_officer_notes').map((c) => [c.op, c.payload, c.opts, c.eq]);

  function loadWithPlayer(client) {
    const loaded = loadSandbox(client);
    loaded.sandbox.DATA = { roster: [{ nameRealm: 'Note-Illidan', id: 42 }] };
    return loaded;
  }

  it('clearing it updates in place, so a player with no notes row does not gain a blank one', async () => {
    const { client, calls } = makeClient(() => null);
    const { sandbox } = loadWithPlayer(client);
    await sandbox.updateRosterFieldSupabase('Note-Illidan', 'officerNote', '');
    expect(noteWrites(calls)).toEqual([['update', { officer_notes: null }, undefined, [['player_id', 42]]]]);
  });

  it('writing one still upserts the row', async () => {
    const { client, calls } = makeClient(() => null);
    const { sandbox } = loadWithPlayer(client);
    await sandbox.updateRosterFieldSupabase('Note-Illidan', 'officerNote', 'watch the pulls');
    expect(noteWrites(calls)).toEqual([
      ['upsert', { player_id: 42, team_id: TEAM_ID, officer_notes: 'watch the pulls' }, { onConflict: 'player_id' }, []]
    ]);
  });
});
