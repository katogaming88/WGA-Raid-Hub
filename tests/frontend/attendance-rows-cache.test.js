import { describe, it, expect } from 'vitest';
import { loadCommonJs, quietConsole } from './helpers/common-sandbox.js';
import { keysetClient, failingClient } from './helpers/supabase-mock.js';

// #837: four separate call sites (main page load, the officer Attendance
// grid, the per-player "add raid night" control, and Commit Attendance
// Scores) each independently paged the whole `attendance` table. This suite
// covers the shared cache (fetchAttendanceRowsCached/invalidateAttendanceRowsCache,
// js/common.js) that the first three now go through instead of each paying
// their own multi-page read -- Commit Attendance Scores deliberately keeps
// its own independent fetch and isn't part of this cache.

function makeRows(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      id: i + 1,
      player_id: 1,
      raid_date: '2026-01-01',
      status: 'Present',
      report_excluded: false,
      report_title: 'Night',
      source: 'WCL'
    });
  }
  return rows;
}

function loadSandbox(client) {
  const sandbox = loadCommonJs(quietConsole);
  sandbox.supabaseClient = client;
  sandbox._teamCfg = { supabaseTeamId: 1 };
  return sandbox;
}

describe('fetchAttendanceRowsCached (#837)', () => {
  it('only pages the table once across repeated calls', async () => {
    const { client, calls } = keysetClient(makeRows(5));
    const sandbox = loadSandbox(client);

    const [first, second] = await Promise.all([
      sandbox.fetchAttendanceRowsCached(),
      sandbox.fetchAttendanceRowsCached()
    ]);

    expect(first).toHaveLength(5);
    expect(second).toBe(first);
    expect(calls.selects.length).toBe(1);

    const third = await sandbox.fetchAttendanceRowsCached();
    expect(third).toBe(first);
    expect(calls.selects.length).toBe(1);
  });

  it('re-fetches after invalidateAttendanceRowsCache()', async () => {
    const { client, calls } = keysetClient(makeRows(3));
    const sandbox = loadSandbox(client);

    await sandbox.fetchAttendanceRowsCached();
    expect(calls.selects.length).toBe(1);

    sandbox.invalidateAttendanceRowsCache();
    await sandbox.fetchAttendanceRowsCached();
    expect(calls.selects.length).toBe(2);
  });

  it('does not cache a failed read, so the next call retries', async () => {
    const { client, calls } = failingClient('boom');
    const sandbox = loadSandbox(client);

    const failed = await sandbox.fetchAttendanceRowsCached();
    expect(failed).toBeNull();
    expect(calls.reads).toBe(1);

    const retried = await sandbox.fetchAttendanceRowsCached();
    expect(retried).toBeNull();
    expect(calls.reads).toBe(2);
  });

  it('fetchSupabaseAttendanceRaw shares the same cache', async () => {
    const { client, calls } = keysetClient(makeRows(2));
    const sandbox = loadSandbox(client);

    await sandbox.fetchSupabaseAttendanceRaw();
    await sandbox.fetchAttendanceRowsCached();
    expect(calls.selects.length).toBe(1);
  });
});
