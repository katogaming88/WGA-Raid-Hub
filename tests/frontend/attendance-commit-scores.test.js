import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// executeCommitScores (#1845): the score math moved into
// commit_attendance_scores(), which the new app's button and the hourly
// wcl-sync run call too, so this button only asks for it and reports the
// answer. The SQL, and the full-season read #707 had to page for, are in
// tests/rls/attendance-scheduled-sync.test.js.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ATTENDANCE_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-attendance.js'), 'utf8');

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function loadSandbox(answer) {
  const els = {
    commitScoresBtn: { disabled: false, textContent: '', style: {} },
    commitScoresStatus: { textContent: '', style: {} }
  };
  const rpcs = [];
  const audits = [];
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    document: { getElementById: (id) => els[id] || null },
    window: { DATA: {} },
    DATA: {},
    _teamCfg: { supabaseTeamId: 3 },
    writeAuditLog: (...args) => (audits.push(args), Promise.resolve()),
    supabaseClient: {
      rpc(name, args) {
        rpcs.push([name, args]);
        return Promise.resolve(answer);
      }
    },
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(ATTENDANCE_JS, sandbox, { filename: 'tab-attendance.js' });
  return { sandbox, els, rpcs, audits };
}

describe('executeCommitScores', () => {
  it("asks the database for the team's commit and shows what it did", async () => {
    const { sandbox, els, rpcs, audits } = loadSandbox({ data: { committed: 12, totalNights: 9 }, error: null });
    sandbox.executeCommitScores();
    for (let i = 0; i < 6; i++) await flush();

    expect(rpcs).toEqual([['commit_attendance_scores', { p_team_id: 3 }]]);
    expect(els.commitScoresStatus.textContent).toBe('12 players scored (9 nights)');
    expect(audits).toEqual([['Attendance Scores Committed', null, null, '12 players, 9 nights']]);
    expect(els.commitScoresBtn.disabled).toBe(false);
  });

  it('shows the error and logs nothing when the commit fails', async () => {
    const { sandbox, els, audits } = loadSandbox({ data: null, error: { message: 'permission denied' } });
    sandbox.executeCommitScores();
    for (let i = 0; i < 6; i++) await flush();

    expect(els.commitScoresStatus.textContent).toBe('Error committing scores: permission denied');
    expect(audits).toEqual([]);
  });
});
