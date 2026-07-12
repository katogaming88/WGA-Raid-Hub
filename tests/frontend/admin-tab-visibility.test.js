import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// #317: the Admin tab honors the officer/team_leader split the RLS policies
// already enforce. adminSubTabVisibility() is the single source of truth for
// which sub-tabs each access level sees, and visibleDangerOps() scopes the
// Danger Zone down to Clear Season History for team leaders. This loads the
// real tab-admin.js into a vm sandbox (same pattern as priority-export
// .test.js) and checks the visibility map, the danger-op filter, and the
// landing sub-tab for each access level.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-admin.js'), 'utf8');

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

function makeSandbox({ access, els = {}, saveTeamSettingResult } = {}) {
  const allEls = { ...els };
  const jsonpRequest = vi.fn();
  // clearSeasonHistorySupabase() (#423) goes through saveTeamSetting()/
  // writeAuditLog()/buildSeasonTab() -- common.js/tab-season.js helpers this
  // sandbox doesn't load (same pattern as priority-export.test.js stubbing
  // _utf8ToBase64 rather than pulling in all of common.js).
  const saveTeamSetting = vi.fn(() => saveTeamSettingResult || Promise.resolve({ seasonHistory: [] }));
  const writeAuditLog = vi.fn(() => Promise.resolve());
  const buildSeasonTab = vi.fn();
  const sandbox = {
    console,
    window: { _adminAccessLevel: access },
    document: {
      getElementById: (id) => {
        if (!allEls[id]) allEls[id] = makeEl();
        return allEls[id];
      },
      querySelectorAll: () => []
    },
    jsonpRequest,
    saveTeamSetting,
    writeAuditLog,
    buildSeasonTab,
    WEB_APP_URL: 'https://gas.example/exec',
    TEAM_NAME: 'Phoenix Reborn',
    DATA: { seasonHistory: [{ name: 'Old Season' }] },
    supabaseClient: {},
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(ADMIN_JS, sandbox, { filename: 'tab-admin.js' });
  return { sandbox, els: allEls, jsonpRequest, saveTeamSetting, writeAuditLog, buildSeasonTab };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('adminSubTabVisibility (#317)', () => {
  it('shows all five sub-tabs at full access', () => {
    const { sandbox } = makeSandbox({ access: true });
    expect(sandbox.adminSubTabVisibility(true)).toEqual({
      properties: true,
      export: true,
      officers: true,
      features: true,
      danger: true
    });
  });

  it('shows everything except Data Export to a team leader', () => {
    const { sandbox } = makeSandbox({ access: 'team_leader' });
    expect(sandbox.adminSubTabVisibility('team_leader')).toEqual({
      properties: true,
      export: false,
      officers: true,
      features: true,
      danger: true
    });
  });

  it('shows nothing for falsy access', () => {
    const { sandbox } = makeSandbox({ access: false });
    expect(sandbox.adminSubTabVisibility(false)).toEqual({
      properties: false,
      export: false,
      officers: false,
      features: false,
      danger: false
    });
  });
});

describe('visibleDangerOps (#317)', () => {
  it('returns all ops in order at full access', () => {
    const { sandbox } = makeSandbox({ access: true });
    const keys = sandbox.visibleDangerOps(true).map((op) => op.key);
    expect(keys).toEqual(sandbox.DANGER_OPS.map((op) => op.key));
    expect(keys.length).toBe(8);
  });

  it('returns only Clear Season History for a team leader', () => {
    const { sandbox } = makeSandbox({ access: 'team_leader' });
    const keys = sandbox.visibleDangerOps('team_leader').map((op) => op.key);
    expect(keys).toEqual(['clearSeasonHistory']);
  });
});

describe('renderDangerZone (#317)', () => {
  it('renders every op card at full access', () => {
    const { sandbox, els } = makeSandbox({ access: true });
    sandbox.renderDangerZone();
    const html = els.adminDangerContent.innerHTML;
    sandbox.DANGER_OPS.forEach((op) => {
      expect(html).toContain('danger-btn-' + op.key);
    });
  });

  it('renders only the Clear Season History card for a team leader', () => {
    const { sandbox, els } = makeSandbox({ access: 'team_leader' });
    sandbox.renderDangerZone();
    const html = els.adminDangerContent.innerHTML;
    expect(html).toContain('danger-btn-clearSeasonHistory');
    expect(html).not.toContain('danger-btn-clearLootData');
    expect(html).not.toContain('danger-btn-clearSignups');
  });
});

describe('executeDangerOp guard (#317)', () => {
  it('refuses an op hidden from the current access level even with a valid confirm', () => {
    const els = { 'danger-confirm-clearLootData': makeEl() };
    els['danger-confirm-clearLootData'].value = 'Phoenix Reborn';
    const { sandbox, jsonpRequest } = makeSandbox({ access: 'team_leader', els });
    sandbox.executeDangerOp('clearLootData');
    expect(jsonpRequest).not.toHaveBeenCalled();
  });

  it('still runs sheet wipes at full access', () => {
    const els = { 'danger-confirm-clearLootData': makeEl() };
    els['danger-confirm-clearLootData'].value = 'Phoenix Reborn';
    const { sandbox, jsonpRequest } = makeSandbox({ access: true, els });
    sandbox.executeDangerOp('clearLootData');
    expect(jsonpRequest).toHaveBeenCalledTimes(1);
    expect(jsonpRequest.mock.calls[0][0]).toContain('action=dangerClearSheet');
  });
});

describe('Clear Season History goes through Supabase, not GAS (#423)', () => {
  function confirmedEls() {
    const els = { 'danger-confirm-clearSeasonHistory': makeEl() };
    els['danger-confirm-clearSeasonHistory'].value = 'Phoenix Reborn';
    return els;
  }

  it('clears team_settings.config.seasonHistory via saveTeamSetting, never GAS', async () => {
    const { sandbox, jsonpRequest, saveTeamSetting, writeAuditLog } = makeSandbox({
      access: 'team_leader',
      els: confirmedEls()
    });
    sandbox.executeDangerOp('clearSeasonHistory');
    await flush();

    expect(saveTeamSetting).toHaveBeenCalledTimes(1);
    expect(saveTeamSetting).toHaveBeenCalledWith({ seasonHistory: [] });
    // The old GAS action ("dangerClearSeasonHistory") is never called -- this
    // was the actual bug: it cleared Script Properties while the archived
    // seasons in team_settings.config survived (#423).
    expect(jsonpRequest).not.toHaveBeenCalled();
    expect(writeAuditLog).toHaveBeenCalledWith('Season History Cleared', null, null, null);
  });

  it('updates DATA.seasonHistory and re-renders the Season tab', async () => {
    const { sandbox, buildSeasonTab } = makeSandbox({
      access: 'team_leader',
      els: confirmedEls(),
      saveTeamSettingResult: Promise.resolve({ seasonHistory: [] })
    });
    expect(sandbox.DATA.seasonHistory).toEqual([{ name: 'Old Season' }]);
    sandbox.executeDangerOp('clearSeasonHistory');
    await flush();

    expect(sandbox.DATA.seasonHistory).toEqual([]);
    expect(buildSeasonTab).toHaveBeenCalledTimes(1);
  });

  it('shows an error and leaves the button re-enabled if the RPC fails', async () => {
    const els = confirmedEls();
    els['danger-btn-clearSeasonHistory'] = makeEl();
    els['danger-status-clearSeasonHistory'] = makeEl();
    const { sandbox } = makeSandbox({
      access: 'team_leader',
      els,
      saveTeamSettingResult: Promise.reject(new Error('RLS denied'))
    });
    sandbox.executeDangerOp('clearSeasonHistory');
    await flush();

    expect(els['danger-btn-clearSeasonHistory'].disabled).toBe(false);
    expect(els['danger-status-clearSeasonHistory'].textContent).toBe('RLS denied');
  });

  it('still refuses without a matching team-name confirm', () => {
    const { sandbox, saveTeamSetting } = makeSandbox({ access: 'team_leader', els: {} });
    sandbox.executeDangerOp('clearSeasonHistory');
    expect(saveTeamSetting).not.toHaveBeenCalled();
  });
});

describe('buildAdminTab landing (#317)', () => {
  it('lands a site admin on Properties', () => {
    const { sandbox, els } = makeSandbox({ access: true });
    sandbox.buildAdminTab();
    expect(els['admin-sub-properties'].style.display).toBe('');
    expect(els['admin-sub-danger'].style.display).toBe('none');
  });

  it('lands a team leader on Properties too', () => {
    const { sandbox, els } = makeSandbox({ access: 'team_leader' });
    sandbox.buildAdminTab();
    expect(els['admin-sub-properties'].style.display).toBe('');
    expect(els['admin-sub-officers'].style.display).toBe('none');
  });
});
