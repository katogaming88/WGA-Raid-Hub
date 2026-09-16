import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// wcl-progression-sync has always recorded team_raid_progress.mythic_date,
// but the column was never selected by fetchSupabaseRaidProgress() nor
// mapped by mapSupabaseRaidProgress(), so it never reached the browser.
// buildProgression() therefore had only the officer-typed Season Settings
// field (boss.mythicDate) to go on, and sat at "0/8 M" for a team with real
// Mythic kills -- while showing that same boss's synced Mythic pull count
// right next to it. _bossMythicKillDate() now prefers the synced date and
// keeps the officer-typed one as a fallback.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROSTER_JS = readFileSync(path.join(HERE, '../../js/roster.js'), 'utf8');
const COMMON_JS = readFileSync(path.join(HERE, '../../js/common.js'), 'utf8');

function makeRosterSandbox() {
  const sandbox = {
    console,
    document: {
      getElementById: () => ({ addEventListener: () => {}, style: {} }),
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({}),
      addEventListener: () => {}
    },
    window: {},
    location: { search: '', pathname: '/' }
  };
  vm.createContext(sandbox);
  try {
    vm.runInContext(ROSTER_JS, sandbox, { filename: 'roster.js' });
  } catch (err) {
    if (!/checkMaintenanceMode/.test(err.message)) throw err;
  }
  return sandbox;
}

describe('_bossMythicKillDate', () => {
  it('uses the synced kill date when the officer never typed one', () => {
    const sandbox = makeRosterSandbox();
    expect(sandbox._bossMythicKillDate({ name: "Nek'zali", mythicDate: '' }, { mythicDate: '2026-09-15' })).toBe(
      '2026-09-15'
    );
  });

  it('prefers the synced date over a stale officer-typed one', () => {
    const sandbox = makeRosterSandbox();
    expect(sandbox._bossMythicKillDate({ mythicDate: '2026-01-01' }, { mythicDate: '2026-09-15' })).toBe('2026-09-15');
  });

  it('falls back to the officer-typed date when the sync has no kill', () => {
    const sandbox = makeRosterSandbox();
    // A raid WCL never saw, or a season predating the sync.
    expect(sandbox._bossMythicKillDate({ mythicDate: '2026-04-09' }, { mythicDate: null, pulls: 19 })).toBe(
      '2026-04-09'
    );
    expect(sandbox._bossMythicKillDate({ mythicDate: '2026-04-09' }, null)).toBe('2026-04-09');
  });

  it('reports no kill when neither source has a date', () => {
    const sandbox = makeRosterSandbox();
    expect(sandbox._bossMythicKillDate({ mythicDate: '' }, { mythicDate: null, pulls: 61 })).toBe('');
    expect(sandbox._bossMythicKillDate(null, null)).toBe('');
  });
});

function makeCommonSandbox() {
  const sandbox = { console, window: {}, document: { addEventListener: () => {} }, location: { search: '' } };
  vm.createContext(sandbox);
  try {
    vm.runInContext(COMMON_JS, sandbox, { filename: 'common.js' });
  } catch {
    // common.js self-boots too; the mapper is hoisted before that runs.
  }
  return sandbox;
}

describe('mapSupabaseRaidProgress', () => {
  // The real shape of Phoenix's row for Nek'zali the Soulcoiler: killed on
  // Heroic in August, killed on Mythic 2026-09-15, 3 Mythic pulls.
  const row = {
    mythic_date: '2026-09-15',
    mythic_pulls: 3,
    mythic_best_pct: null,
    mythic_report_code: '4vH6RWVLcKwZDNJf',
    mythic_fight_id: 20,
    heroic_date: '2026-08-20',
    heroic_pulls: 6,
    heroic_best_pct: null,
    heroic_report_code: 'NJnmyxkbpVHtzP8M',
    heroic_fight_id: 3,
    raid_encounters: { name: "Nek'zali the Soulcoiler", wcl_encounter_id: 1768, raid_zones: { wcl_zone_id: 47 } }
  };

  it('carries the Mythic kill date through, keyed by encounter id and by name', () => {
    const sandbox = makeCommonSandbox();
    const map = sandbox.mapSupabaseRaidProgress([row]);
    expect(map['47|id|1768'].mythicDate).toBe('2026-09-15');
    expect(map["47|nek'zali the soulcoiler"].mythicDate).toBe('2026-09-15');
  });

  it('leaves mythicDate null for a boss with pulls but no kill', () => {
    const sandbox = makeCommonSandbox();
    const map = sandbox.mapSupabaseRaidProgress([{ ...row, mythic_date: null, mythic_pulls: 61 }]);
    expect(map['47|id|1768'].mythicDate).toBeNull();
    expect(map['47|id|1768'].pulls).toBe(61);
  });
});
