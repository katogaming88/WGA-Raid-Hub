import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// tab-pending-roster.js is a plain browser script (no exports), so this test
// loads it into a vm sandbox with just enough browser/global stubs to drive
// the selection-based push added for #273: per-card checkboxes, a filter-aware
// "select all", and a batch push that loops add_signup_to_roster() per
// selected signup, tolerating a partial-batch failure (e.g. a main-swap row
// missing its archive-target picker).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PENDING_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-pending-roster.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeCard(signupId, { trialChecked = true, swapValue = undefined } = {}) {
  var els = {
    '.pending-trial-checkbox': { checked: trialChecked },
    '.pending-swap-select': swapValue === undefined ? null : { value: swapValue }
  };
  return {
    remove: vi.fn(),
    querySelector: (sel) => els[sel] || null
  };
}

function makeSandbox({ cards = {}, rpcImpl } = {}) {
  var rpcCalls = [];
  var supabaseClient = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      var result = rpcImpl ? rpcImpl(params) : { data: null, error: null };
      return { then: (cb) => Promise.resolve(result).then(cb) };
    }
  };

  var containerEl = { innerHTML: '' };
  var sandbox = {
    console,
    document: {
      getElementById: (id) => (id === 'pendingRosterContainer' ? containerEl : { style: {}, textContent: '' }),
      querySelector: (sel) => {
        var match = /data-row="(\d+)"/.exec(sel);
        if (!match) return null;
        return cards[match[1]] || cards[Number(match[1])] || null;
      }
    },
    window: { DATA: { roster: [] } },
    DATA: { roster: [] },
    escHtml: (s) => String(s == null ? '' : s),
    classColor: () => '#fff',
    computeBuffCoverage: () => ({}),
    RAID_BUFFS: [],
    BOSS_DEBUFFS: [],
    RAID_UTILITY: [],
    updateNavBadges: vi.fn(),
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(PENDING_JS, sandbox, { filename: 'tab-pending-roster.js' });
  return { sandbox, rpcCalls, containerEl };
}

function entry(signupId, overrides) {
  return Object.assign(
    { signupId, nameRealm: 'Player' + signupId + '-Illidan', className: 'Warrior', mainSpec: 'Arms', role: 'Melee' },
    overrides
  );
}

describe('pending roster selection-based push (#273)', () => {
  it('renders every card unchecked by default', () => {
    const { sandbox } = makeSandbox();
    sandbox._pendingRosterEntries = [entry(1), entry(2)];
    sandbox.renderPendingRoster(sandbox._pendingRosterEntries, []);
    expect(sandbox._pendingSelected).toEqual({});
  });

  it('togglePendingSelected checks then unchecks a single entry', () => {
    const { sandbox } = makeSandbox();
    sandbox._pendingRosterEntries = [entry(1), entry(2)];
    sandbox.togglePendingSelected(1);
    expect(sandbox._pendingSelected).toEqual({ 1: true });
    sandbox.togglePendingSelected(1);
    expect(sandbox._pendingSelected).toEqual({});
  });

  it('select all only selects the currently filtered/visible entries', () => {
    const { sandbox } = makeSandbox();
    sandbox._pendingRosterEntries = [entry(1, { role: 'Tank' }), entry(2, { role: 'Melee' })];
    sandbox._pendingFilterRole = 'Tank';
    sandbox.toggleSelectAllPending();
    expect(sandbox._pendingSelected).toEqual({ 1: true });

    // toggling again while all-visible are selected clears just the visible set
    sandbox.toggleSelectAllPending();
    expect(sandbox._pendingSelected).toEqual({});
  });

  it('batch push calls add_signup_to_roster once per selected id and clears them on success', async () => {
    const cards = {
      1: makeCard(1, { trialChecked: true }),
      2: makeCard(2, { trialChecked: false })
    };
    const { sandbox, rpcCalls } = makeSandbox({
      cards,
      rpcImpl: () => ({ data: null, error: null })
    });
    sandbox._pendingRosterEntries = [entry(1), entry(2)];
    sandbox._pendingSelected = { 1: true, 2: true };

    sandbox.batchAddSelectedToRoster();
    await flush();
    await flush();

    expect(rpcCalls).toHaveLength(2);
    expect(rpcCalls.map((c) => c.name)).toEqual(['add_signup_to_roster', 'add_signup_to_roster']);
    expect(rpcCalls.find((c) => c.params.p_signup_id === 1).params.p_is_trial).toBe(true);
    expect(rpcCalls.find((c) => c.params.p_signup_id === 2).params.p_is_trial).toBe(false);
    expect(sandbox._pendingSelected).toEqual({});
    expect(sandbox._pendingRosterEntries).toEqual([]);
    expect(sandbox._pendingBatchMessage).toBe('2 of 2 added');
    expect(sandbox.updateNavBadges).toHaveBeenCalled();
  });

  it('a partial-batch failure (missing main-swap picker) does not block the other row from succeeding', async () => {
    const cards = {
      1: makeCard(1, { trialChecked: true, swapValue: '' }), // main swap, nothing picked
      2: makeCard(2, { trialChecked: true })
    };
    const { sandbox, rpcCalls } = makeSandbox({
      cards,
      rpcImpl: () => ({ data: null, error: null })
    });
    sandbox._pendingRosterEntries = [entry(1, { mainSwap: true }), entry(2)];
    sandbox._pendingSelected = { 1: true, 2: true };

    sandbox.batchAddSelectedToRoster();
    await flush();
    await flush();

    // only the valid row (2) hits the RPC -- row 1 fails client-side pre-check
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].params.p_signup_id).toBe(2);
    expect(sandbox._pendingSelected).toEqual({ 1: true });
    expect(sandbox._pendingRosterEntries.map((e) => e.signupId)).toEqual([1]);
    expect(sandbox._pendingBatchMessage).toContain('1 of 2 added');
    expect(sandbox._pendingBatchMessage).toContain('missing archive selection');
  });

  it('a server-rejected row reports its failure without discarding the successful ones', async () => {
    const cards = {
      1: makeCard(1),
      2: makeCard(2)
    };
    const { sandbox } = makeSandbox({
      cards,
      rpcImpl: (params) =>
        params.p_signup_id === 2 ? { data: null, error: { message: 'already on roster' } } : { data: null, error: null }
    });
    sandbox._pendingRosterEntries = [entry(1), entry(2)];
    sandbox._pendingSelected = { 1: true, 2: true };

    sandbox.batchAddSelectedToRoster();
    await flush();
    await flush();

    expect(sandbox._pendingSelected).toEqual({ 2: true });
    expect(sandbox._pendingRosterEntries.map((e) => e.signupId)).toEqual([2]);
    expect(sandbox._pendingBatchMessage).toContain('1 of 2 added');
    expect(sandbox._pendingBatchMessage).toContain('already on roster');
  });

  it('does nothing when nothing is selected (no RPC call)', () => {
    const { sandbox, rpcCalls } = makeSandbox();
    sandbox._pendingRosterEntries = [entry(1)];
    sandbox._pendingSelected = {};
    sandbox.batchAddSelectedToRoster();
    expect(rpcCalls).toHaveLength(0);
  });

  it('removing a single row via addSignupToRoster also clears its selection state', async () => {
    const cards = { 1: makeCard(1) };
    const { sandbox } = makeSandbox({ cards, rpcImpl: () => ({ data: null, error: null }) });
    sandbox._pendingRosterEntries = [entry(1), entry(2)];
    sandbox._pendingSelected = { 1: true, 2: true };

    var btn = { disabled: false, textContent: '', closest: () => cards[1] };
    sandbox.addSignupToRoster(1, btn);
    await flush();

    expect(sandbox._pendingSelected).toEqual({ 2: true });
    expect(sandbox._pendingRosterEntries.map((e) => e.signupId)).toEqual([2]);
  });
});
