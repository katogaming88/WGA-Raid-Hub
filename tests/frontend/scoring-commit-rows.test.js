import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// scoring carries its own team_id since #944, checked against the player's
// team by a trigger, so every writer has to name the team on each row. Two
// writers besides the attendance commit: executeCommitPerformance
// (tab-scoring.js) writes the WCL performance columns, and
// _seedScoringFromSeasonPerf (tab-season.js) seeds performance_score from the
// previous season's fetch. Same sandbox shape as
// tests/frontend/attendance-commit-scores-paging.test.js, which covers the
// third writer.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCORING_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-scoring.js'), 'utf8');
const SEASON_JS = readFileSync(path.join(HERE, '../../js/tabs/tab-season.js'), 'utf8');

const TEAM_ID = 3;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// The scoring upsert is the only client call either writer makes, so the
// client is just a recorder.
function recordingClient(upserts) {
  return {
    from(table) {
      return {
        upsert(rows, opts) {
          upserts.push({ table, rows, opts });
          return Promise.resolve({ data: null, error: null });
        }
      };
    }
  };
}

function baseSandbox(upserts) {
  return {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    window: { DATA: { seasonName: 'Midnight Season 2' } },
    DATA: { seasonName: 'Midnight Season 2' },
    _teamCfg: { supabaseTeamId: TEAM_ID },
    seasonCodeForDisplay: () => 'MID2',
    writeAuditLog: () => Promise.resolve(),
    supabaseClient: recordingClient(upserts),
    setTimeout: (fn, ms) => {
      const t = setTimeout(fn, ms);
      if (t.unref) t.unref();
      return t;
    },
    clearTimeout,
    Promise
  };
}

// tab-scoring.js reads the scores it commits from its sessionStorage cache,
// so the cache stub is how the test hands it players. The status and button
// stubs carry style objects for the same reason as the attendance suite: the
// success path writes style.color and a rejection there would surface after
// the assertions instead of as a failing test.
function loadScoringSandbox(scores) {
  const upserts = [];
  const els = {
    commitPerfBtn: { disabled: false, style: {} },
    commitPerfStatus: { textContent: '', style: {} }
  };
  const sandbox = Object.assign(baseSandbox(upserts), {
    TEAM_SLUG: 'phoenix',
    sessionStorage: {
      getItem: () => JSON.stringify({ scores, status: 'fetched', ts: Date.now() }),
      setItem: () => {},
      removeItem: () => {}
    },
    document: {
      addEventListener: () => {},
      getElementById: (id) => els[id] || null
    }
  });
  vm.createContext(sandbox);
  vm.runInContext(SCORING_JS, sandbox, { filename: 'tab-scoring.js' });
  return { sandbox, upserts, els };
}

function loadSeasonSandbox() {
  const upserts = [];
  const sandbox = Object.assign(baseSandbox(upserts), {
    document: { getElementById: () => null }
  });
  vm.createContext(sandbox);
  vm.runInContext(SEASON_JS, sandbox, { filename: 'tab-season.js' });
  return { sandbox, upserts };
}

describe('scoring writers name the team on every row (#944)', () => {
  it('executeCommitPerformance commits each player with team_id from the team config', async () => {
    const scores = [
      { playerId: 7, role: 'dps', recent: 88.5, trend: 80, best: 91 },
      { playerId: 9, role: 'heal', recent: 70, trend: 72, best: 75 },
      // Tanks, manual scores and players without data are never committed.
      { playerId: 11, role: 'tank', recent: 60, trend: 60, best: 60 },
      { playerId: 12, role: 'dps', recent: 50, trend: 50, best: 50, manual: true },
      { playerId: 13, role: 'dps', recent: null, noData: true }
    ];
    const { sandbox, upserts, els } = loadScoringSandbox(scores);

    sandbox.executeCommitPerformance();
    for (let i = 0; i < 6; i++) await flush();

    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe('scoring');
    expect(upserts[0].rows.map((r) => r.player_id)).toEqual([7, 9]);
    upserts[0].rows.forEach((row) => expect(row.team_id).toBe(TEAM_ID));
    expect(upserts[0].rows[0]).toMatchObject({
      team_id: TEAM_ID,
      player_id: 7,
      season: 'MID2',
      recent_score: 88.5,
      trend_score: 80,
      best_score: 91,
      performance_score: 88.5
    });
    expect(els.commitPerfStatus.textContent).toBe('2 player(s) committed to Performance column.');
  });

  it('_seedScoringFromSeasonPerf seeds each player with team_id from the team config', () => {
    const { sandbox, upserts } = loadSeasonSandbox();

    sandbox._seedScoringFromSeasonPerf([
      { playerId: 7, bestPerfAvg: 83.2 },
      { playerId: 9, bestPerfAvg: 64.9 }
    ]);

    expect(upserts).toHaveLength(1);
    expect(upserts[0].table).toBe('scoring');
    expect(upserts[0].opts).toEqual({ onConflict: 'player_id,season', ignoreDuplicates: true });
    expect(upserts[0].rows).toEqual([
      { team_id: TEAM_ID, player_id: 7, season: 'MID2', performance_score: 83.2 },
      { team_id: TEAM_ID, player_id: 9, season: 'MID2', performance_score: 64.9 }
    ]);
  });
});
