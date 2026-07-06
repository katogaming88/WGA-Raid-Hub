import { describe, it, expect } from 'vitest';
import { parseScoring, scoringSql } from '../../scripts/import/tables/scoring.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';

// Scoring layout: rows 1-3 header block, data from row 4.
// Cols: A player, C performance, D attendance score, E attendance pct, J recent, K trend.
function scoringRows() {
  return [
    ['Scoring'],
    [],
    ['Player', '', 'Performance', 'Attendance', 'Attend %', '', '', '', '', 'Recent', 'Trend'],
    ['Hinda', '', '9.2', '10', '98.5%', '', '', '', '', '9.4', '9.1'],
    ['Tanky', '', 'Excluded', '9.5', '90.0%', '', '', '', '', 'Excluded', 'Excluded'],
    ['Oldguy', '', '7.5', '8', '80.0%', '', '', '', '', '', '']
  ];
}

describe('parseScoring + scoringSql', () => {
  const registry = () => buildPlayerRegistry(['Hinda-Thrall', 'Tanky-Thrall']);

  it('parses rows and maps Excluded and % values', () => {
    const { sql, count } = scoringSql(1, parseScoring(scoringRows()), registry(), 'Season 3');
    expect(count).toBe(3);
    expect(sql).toContain("name_realm = 'Hinda-Thrall'");
    const tanky = sql.split('\n').find((l) => l.includes('Tanky-Thrall'));
    expect(tanky).toContain("'Season 3', null, 9.5, 90"); // performance Excluded -> null, pct stripped
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
