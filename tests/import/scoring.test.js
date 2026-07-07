import { describe, it, expect } from 'vitest';
import { parseScoring, scoringSql } from '../../scripts/import/tables/scoring.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';

// Scoring layout (cleaned export): header row 1, data from row 2.
// Cols: A "First-Realm - Nick", B performance, C attendance score, D weighted
// total (derived, not imported).
function scoringRows() {
  return [
    ['Player (Name-Realm)', 'Performance\n(1–10)', 'Attendance\n(1–10)', 'Weighted Total'],
    ['Hinda-Thrall - Roth', '9.2', '10', '9.6'],
    ['Tanky-Thrall', 'Excluded', '9.5', ''],
    ['Oldguy', '7.5', '8', '7.75']
  ];
}

describe('parseScoring + scoringSql', () => {
  const registry = () => buildPlayerRegistry(['Hinda-Thrall', 'Tanky-Thrall']);

  it('parses rows, strips nicknames, and maps Excluded values', () => {
    const { sql, count } = scoringSql(1, parseScoring(scoringRows()), registry(), 'Season 3');
    expect(count).toBe(3);
    expect(sql).toContain("name_realm = 'Hinda-Thrall'");
    const tanky = sql.split('\n').find((l) => l.includes('Tanky-Thrall'));
    expect(tanky).toContain("'Season 3', null, 9.5, null"); // performance Excluded -> null, pct not exported
    expect(sql).toContain('on conflict (player_id, season) do nothing');
  });

  it('routes unknown names through archived stubs', () => {
    const reg = registry();
    scoringSql(1, parseScoring(scoringRows()), reg, 'Season 3');
    expect(reg.stubNames()).toEqual(['Oldguy']);
  });

  it('requires the season argument', () => {
    expect(() => scoringSql(1, [], registry(), '')).toThrow(/--season/);
  });
});
