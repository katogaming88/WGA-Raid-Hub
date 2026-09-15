import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #1174: the Features sub-tab shows when the gear sweep last ran, from the
// record the blizzard-gear-sync function leaves on site_settings. The
// scheduled sweep and an officer's on-demand sync each keep their own column,
// so a sync by hand cannot refresh the sweep's age and hide a dead cron. Same
// vm sandbox over the real tab-admin.js as admin-tab-visibility.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-admin.js'), 'utf8');

const NOW = Date.parse('2026-09-15T19:07:00Z');
const HOUR = 3600 * 1000;

function makeEl() {
  return {
    disabled: false,
    textContent: '',
    value: '',
    innerHTML: '',
    style: {},
    classList: { add: vi.fn(), remove: vi.fn() }
  };
}

// Routes .from('site_settings').select().eq().maybeSingle() to one row and
// records what was asked for.
function makeSupabaseClient(row) {
  const selects = [];
  const client = {
    from(table) {
      return {
        select(columns) {
          return {
            eq(col, val) {
              selects.push({ table, columns, col, val });
              return { maybeSingle: () => Promise.resolve({ data: row, error: null }) };
            }
          };
        }
      };
    }
  };
  return { client, selects };
}

function makeSandbox({ row = null } = {}) {
  const els = {};
  const { client: supabaseClient, selects } = makeSupabaseClient(row);
  const sandbox = {
    console,
    window: { _adminAccessLevel: true },
    document: {
      getElementById: (id) => {
        if (!els[id]) els[id] = makeEl();
        return els[id];
      },
      querySelectorAll: () => []
    },
    DATA: {},
    supabaseClient,
    featureEnabled: () => true,
    escHtml: (s) => String(s),
    // common.js's relative-age label, pinned to NOW so the text is exact.
    timeAgoLabel: (iso) => Math.floor((NOW - Date.parse(iso)) / HOUR) + 'h ago',
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(ADMIN_JS, sandbox, { filename: 'tab-admin.js' });
  return { sandbox, els, selects };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const cronRun = (over = {}) => ({
  trigger: 'cron',
  started_at: new Date(NOW - 9 * HOUR - 20000).toISOString(),
  finished_at: new Date(NOW - 9 * HOUR).toISOString(),
  synced: 55,
  skipped: 0,
  teams: 3,
  players: 55,
  error: null,
  ...over
});

describe('gearSyncStatusText (#1174)', () => {
  // The review of PR #1196: an empty cron column is the state right after
  // the deploy, and also the state when the record write has failed every
  // day since, so it warns rather than staying grey forever.
  it('warns when no scheduled sweep has been recorded', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.gearSyncStatusText(null, null, NOW)).toEqual({
      text: 'No scheduled sweep recorded yet.',
      warn: true
    });
  });

  it('reads a clean recent sweep as one line with its age and counts', () => {
    const { sandbox } = makeSandbox();
    expect(sandbox.gearSyncStatusText(cronRun(), null, NOW)).toEqual({
      text: 'Last sweep: 9h ago, 55 synced, 0 skipped.',
      warn: false
    });
  });

  it('warns on a recorded error and carries the message', () => {
    const { sandbox } = makeSandbox();
    const status = sandbox.gearSyncStatusText(cronRun({ synced: 0, skipped: 55, error: 'Gateway Timeout' }), null, NOW);
    expect(status.warn).toBe(true);
    expect(status.text).toBe('Last sweep: 9h ago, 0 synced, 55 skipped. Error: Gateway Timeout');
  });

  // Same review: a sweep that reached raiders and synced none of them is not
  // a healthy morning, whether or not a message was recorded.
  it('warns when a sweep reached raiders and synced none, with no error recorded', () => {
    const { sandbox } = makeSandbox();
    const status = sandbox.gearSyncStatusText(cronRun({ synced: 0, skipped: 55, error: null }), null, NOW);
    expect(status.warn).toBe(true);
    expect(status.text).toBe('Last sweep: 9h ago, 0 synced, 55 skipped. Nothing was synced.');
  });

  it('does not warn on an empty roster that synced nobody', () => {
    const { sandbox } = makeSandbox();
    const status = sandbox.gearSyncStatusText(cronRun({ synced: 0, skipped: 0, players: 0 }), null, NOW);
    expect(status).toEqual({ text: 'Last sweep: 9h ago, 0 synced, 0 skipped.', warn: false });
  });

  it('warns when the last sweep finished more than 36 hours ago', () => {
    const { sandbox } = makeSandbox();
    const old = cronRun({ finished_at: new Date(NOW - 37 * HOUR).toISOString() });
    const status = sandbox.gearSyncStatusText(old, null, NOW);
    expect(status.warn).toBe(true);
    expect(status.text).toBe('Last sweep: 37h ago, 55 synced, 0 skipped. The scheduled sweep has not run in 36 hours.');
  });

  it('appends the last on-demand sync after the sweep line', () => {
    const { sandbox } = makeSandbox();
    const officer = { trigger: 'officer', finished_at: new Date(NOW - 2 * HOUR).toISOString(), synced: 24, skipped: 1 };
    const status = sandbox.gearSyncStatusText(cronRun(), officer, NOW);
    expect(status.warn).toBe(false);
    expect(status.text).toBe('Last sweep: 9h ago, 55 synced, 0 skipped. Last on-demand sync: 2h ago, 24 synced.');
  });
});

describe('renderGearSyncStatus (#1174)', () => {
  it('reads both columns from the settings row and writes the text and colour', async () => {
    const row = { gear_sync_last_cron_run: cronRun({ error: 'Gateway Timeout' }), gear_sync_last_officer_run: null };
    const { sandbox, els, selects } = makeSandbox({ row });
    await sandbox.renderGearSyncStatus();
    expect(selects).toEqual([
      { table: 'site_settings', columns: 'gear_sync_last_cron_run, gear_sync_last_officer_run', col: 'id', val: 1 }
    ]);
    expect(els.gearSyncStatus.textContent).toContain('Error: Gateway Timeout');
    expect(els.gearSyncStatus.style.color).toBe('var(--melee)');
  });

  it('runs when the Features sub-tab opens, beside the three renders already there', async () => {
    const { sandbox, els, selects } = makeSandbox({
      row: { gear_sync_last_cron_run: cronRun(), gear_sync_last_officer_run: null }
    });
    sandbox.switchAdminSubTab('features');
    await flush();
    expect(selects).toHaveLength(1);
    expect(els.gearSyncStatus.textContent).toBe('Last sweep: 9h ago, 55 synced, 0 skipped.');
    expect(els.gearSyncStatus.style.color).toBe('');
    expect(els.adminFeatureFlagsContent.innerHTML).not.toBe('');
    expect(els.adminWishlistLabelsContent.innerHTML).not.toBe('');
    expect(els.adminTrackThresholdsContent.innerHTML).not.toBe('');
  });
});
