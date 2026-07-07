import { describe, it, expect } from 'vitest';
import { parsePlayers, parseApprovedMplus, playersSql } from '../../scripts/import/tables/players.js';

// Roster layout (cleaned export): header row 1, data from row 2.
// Cols: A trial, B name_realm, C nick, D class, E spec, F role, G bis link,
// H priority, I join date.
function rosterRows() {
  return [
    ['Is Trial', 'Player (Name-Realm)', 'Nickname', 'Class', 'Spec', 'Role', 'BIS Link', 'Priority', 'Join Date'],
    ['TRUE', 'Hinda-Thrall', 'Roth', 'Mage', 'Frost', 'Ranged', 'https://x', '3', '2025-11-02'],
    ['FALSE', 'Séraphine-Thrall', '', 'Priest', 'Holy', 'Heal', '', '6', '1/10/2026'],
    ['', '', '', '', '', '', '', '', '']
  ];
}

// M+ requests: header row 1; cols B name_realm, E status, F officer note.
function mplusRows() {
  return [
    ['Timestamp', 'Name-Realm', 'Raider.io URL', 'Notes', 'Status', 'Officer Note'],
    ['Jan 3, 2026 19:00', 'Hinda-Thrall', 'https://rio', 'plz', 'Approved', 'until next tier'],
    ['Jan 4, 2026 19:00', 'Séraphine-Thrall', '', '', 'Rejected', 'nope']
  ];
}

describe('parsePlayers', () => {
  it('reads data rows, trial and bench flags, skipping blanks', () => {
    const players = parsePlayers(rosterRows());
    expect(players).toHaveLength(2);
    expect(players[0]).toMatchObject({ nameRealm: 'Hinda-Thrall', isTrial: true, isBench: false, nickname: 'Roth' });
    expect(players[1]).toMatchObject({ nameRealm: 'Séraphine-Thrall', isTrial: false, isBench: true });
  });
});

describe('parseApprovedMplus', () => {
  it('keeps only Approved rows keyed by normalized name', () => {
    const approved = parseApprovedMplus(mplusRows());
    expect(approved.get('hinda-thrall')).toBe('until next tier');
    expect(approved.has('seraphine-thrall')).toBe(false);
  });
  it('tolerates a missing export', () => {
    expect(parseApprovedMplus(null).size).toBe(0);
  });
});

describe('playersSql', () => {
  it('emits class_spec subselects, m_plus fields, and the conflict clause', () => {
    const players = parsePlayers(rosterRows());
    const { sql, count } = playersSql(1, players, parseApprovedMplus(mplusRows()), [], []);
    expect(count).toBe(2);
    expect(sql).toContain("class = 'Mage' and spec = 'Frost'");
    expect(sql).toContain('on conflict (team_id, name_realm) do nothing');
    const hinda = sql.split('\n').find((l) => l.includes('Hinda-Thrall'));
    expect(hinda).toContain("'until next tier'");
    expect(hinda).toContain('true, false'); // is_trial, is_bench
  });
  it('applies manual overrides and appends archived stubs', () => {
    const players = parsePlayers(rosterRows());
    const { sql, count } = playersSql(1, players, new Map(), ['Séraphine-Thrall'], ['Oldguy']);
    expect(count).toBe(3);
    const sera = sql.split('\n').find((l) => l.includes('Séraphine-Thrall'));
    expect(sera).toMatch(/true, null,\s*$|true, null,/); // m_plus_excluded true, note null
    const stub = sql.split('\n').find((l) => l.includes("'Oldguy'"));
    expect(stub).toContain('now()');
  });
  it('normalizes join dates from both sheet formats', () => {
    const { sql } = playersSql(1, parsePlayers(rosterRows()), new Map(), [], []);
    expect(sql).toContain("'2025-11-02'");
    expect(sql).toContain("'2026-01-10'");
  });
});
