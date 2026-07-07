import { describe, it, expect } from 'vitest';
import { parseAttendance, attendanceSql } from '../../scripts/import/tables/attendance.js';
import { buildPlayerRegistry } from '../../scripts/import/lib/registry.js';

// Post-cleanup export: header row 1, columns located by header text
// (Source was skipped on export here, proving position independence).
function attendanceRows() {
  return [
    ['Raid Date', 'Player (First Name)', 'Status', 'Exclude Report'],
    ['2026-06-22', 'Hinda', 'Present', ''],
    ['2026-06-22', 'Oldguy', 'No Show', 'TRUE'],
    ['2026/06/23', 'Hinda', 'Medical Leave', ''],
    ['2026-06-23', '', '', ''] // stray blank row
  ];
}

describe('parseAttendance', () => {
  it('locates columns by header text and reads the exclude flag', () => {
    const { entries, warnings } = parseAttendance(attendanceRows());
    expect(entries).toHaveLength(3);
    expect(entries[1]).toMatchObject({ name: 'Oldguy', status: 'No Show', excluded: true });
    expect(warnings).toHaveLength(0);
  });
  it('rejects statuses outside the schema CHECK', () => {
    const rows = attendanceRows();
    rows[1][2] = 'Vacation';
    expect(() => parseAttendance(rows)).toThrow(/CHECK/);
  });
  it('warns on duplicate (player, date) rows', () => {
    const rows = attendanceRows();
    rows.push(['2026-06-22', 'Hinda', 'Bench', '']);
    const { warnings } = parseAttendance(rows);
    expect(warnings.join('\n')).toContain('Hinda 2026-06-22');
  });
  it('fails loudly on a wrong-tab export', () => {
    expect(() => parseAttendance([['Item Name', 'Slot'], []])).toThrow(/header/);
  });
  it('skips the excluded-reports trailer with a warning', () => {
    const rows = attendanceRows();
    rows.push(
      ['', '', '', ''],
      ['── Excluded Reports ──', '', '', ''],
      ['Report Title', 'Date', 'Reason', 'Roster Members Found'],
      ['Phoenix Alt run', '2026-04-27', 'Alt run (title contains "Alt")', '9']
    );
    const { entries, warnings } = parseAttendance(rows);
    expect(entries).toHaveLength(3);
    expect(warnings.join('\n')).toContain('not a date');
  });
  it('skips rows with an empty status with a warning', () => {
    const rows = attendanceRows();
    rows.push(['2026-05-04', 'Fxd', '', '']);
    const { entries, warnings } = parseAttendance(rows);
    expect(entries).toHaveLength(3);
    expect(warnings.join('\n')).toContain('Fxd 2026-05-04 has no status');
  });
});

describe('attendanceSql', () => {
  it('emits subselect FKs, ISO dates, and routes departed players to stubs', () => {
    const registry = buildPlayerRegistry(['Hinda-Thrall']);
    const { entries } = parseAttendance(attendanceRows());
    const { sql, count } = attendanceSql(1, entries, registry);
    expect(count).toBe(3);
    expect(sql).toContain("name_realm = 'Hinda-Thrall'");
    expect(sql).toContain("'2026-06-23'"); // slash date normalized
    expect(sql).toContain('on conflict (team_id, player_id, raid_date) do nothing');
    expect(registry.stubNames()).toEqual(['Oldguy']);
  });
});
