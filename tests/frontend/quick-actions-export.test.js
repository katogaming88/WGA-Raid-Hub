import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// officer-quick-actions.js is a plain browser script; qaExportString() (#408)
// now calls the same build_rclc_export() RPC the Priority tab uses instead
// of the GAS getExportString action, so the two "copy priority export"
// entry points can no longer disagree. This loads just enough of the real
// file (and stubs for what it depends on) into a vm sandbox to exercise the
// RPC call and clipboard write.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUICK_ACTIONS_JS = readFileSync(path.join(HERE, '../../js/officer-quick-actions.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeEl() {
  return { disabled: false, textContent: '', style: {} };
}

function makeSandbox({ rpcResult, writeText } = {}) {
  var rpcCalls = [];
  var supabaseClient = {
    rpc(name, params) {
      rpcCalls.push({ name, params });
      return { then: (cb) => Promise.resolve(rpcResult).then(cb) };
    }
  };
  var els = { oqaExportBtn: makeEl(), oqaStatus: makeEl() };

  var sandbox = {
    console,
    document: { getElementById: (id) => els[id] || null },
    window: { DATA: { seasonName: 'Season 1' } },
    DATA: { seasonName: 'Season 1' },
    seasonCodeForDisplay: (name) => (name === 'Season 1' ? 'S1' : name),
    _teamCfg: { supabaseTeamId: 1 },
    supabaseClient,
    navigator: { clipboard: { writeText: writeText || (() => Promise.resolve()) } },
    // _utf8ToBase64() lives in js/common.js (#408); stubbed here rather than
    // loading the whole of common.js just for this one helper.
    _utf8ToBase64(str) {
      var bytes = new TextEncoder().encode(str);
      var binary = '';
      for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    },
    btoa,
    TextEncoder,
    setTimeout,
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(QUICK_ACTIONS_JS, sandbox, { filename: 'officer-quick-actions.js' });
  return { sandbox, rpcCalls, els };
}

describe('qaExportString (#408)', () => {
  it('calls build_rclc_export with the team id and current season code, not the GAS getExportString action', async () => {
    const { sandbox, rpcCalls } = makeSandbox({ rpcResult: { data: { players: {}, priority: {} }, error: null } });
    sandbox.qaExportString();
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({ name: 'build_rclc_export', params: { p_team_id: 1, p_season: 'S1' } });
    await flush();
  });

  it('base64-encodes the JSON payload and copies it to the clipboard', async () => {
    const payload = { players: { 'Kato-Illidan': { chest: { bis: [100002] } } }, priority: {} };
    const writeText = vi.fn(() => Promise.resolve());
    const { sandbox, els } = makeSandbox({ rpcResult: { data: payload, error: null }, writeText });
    sandbox.qaExportString();
    await flush();
    await flush();

    expect(writeText).toHaveBeenCalledTimes(1);
    const decoded = JSON.parse(Buffer.from(writeText.mock.calls[0][0], 'base64').toString('utf8'));
    expect(decoded).toEqual(payload);
    expect(els.oqaStatus.textContent).toBe('Copied!');
    expect(els.oqaExportBtn.disabled).toBe(false);
  });

  it('shows the RPC error message and does not touch the clipboard on failure', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const { sandbox, els } = makeSandbox({
      rpcResult: { data: null, error: { message: 'Not authorized' } },
      writeText
    });
    sandbox.qaExportString();
    await flush();

    expect(writeText).not.toHaveBeenCalled();
    expect(els.oqaStatus.textContent).toBe('Not authorized');
  });
});
