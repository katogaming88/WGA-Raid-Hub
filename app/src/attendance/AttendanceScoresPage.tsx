import { useState } from 'react';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { DataState } from '../components/DataState';
import type { AttendanceRow, SeasonWindow } from '../profile/profile';
import { useCurrentSeason } from '../profile/useProfile';
import { firstName, type PlayerRow } from '../roster/roster';
import { useRosterPlayers } from '../roster/useRoster';
import { attendColor, belowThreshold, type FullAttendanceRow } from './attendance';
import { useAttendanceRows } from './useAttendance';
import './attendance.css';

// The officer's Attendance Scores page (#1354, #1103 row 1): who's at or
// below a threshold this season, and their recent penalty history, ported
// from tab-attendance.js's Attendance Scores sub-tab (buildAttendanceTab()).
export function AttendanceScoresPage() {
  const team = useTeam();
  const page = bothQueries(
    bothQueries(useAttendanceRows(team.id), useRosterPlayers(team.id)),
    useCurrentSeason(team.id)
  );

  return (
    <section className="page attendance-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Attendance scores</h1>
        <p className="text-muted page-subtitle">Who's at or below a threshold this season, and why.</p>
      </div>
      <DataState query={page} label="attendance">
        {([[rows, roster], season]) => <Scores rows={rows} roster={roster} season={season} />}
      </DataState>
    </section>
  );
}

function Scores({ rows, roster, season }: { rows: FullAttendanceRow[]; roster: PlayerRow[]; season: SeasonWindow }) {
  const [threshold, setThreshold] = useState(95);
  const rowsByPlayer = new Map<number, AttendanceRow[]>();
  for (const row of rows) {
    if (row.player_id === null) continue;
    const list = rowsByPlayer.get(row.player_id) ?? [];
    list.push({ raid_date: row.raid_date, status: row.status, report_excluded: row.report_excluded });
    rowsByPlayer.set(row.player_id, list);
  }
  const below = belowThreshold(roster, rowsByPlayer, season, threshold);
  const seasonLabel = season.name ? ` (${season.name})` : '';

  return (
    <div className="card attendance-scores-panel">
      <div className="attend-threshold-row">
        <label className="attend-threshold-label" htmlFor="attend-threshold">
          Show at or below <strong>{threshold}%</strong>
        </label>
        <input
          id="attend-threshold"
          type="range"
          className="attend-slider"
          min={0}
          max={100}
          value={threshold}
          onChange={(e) => setThreshold(Number(e.target.value))}
        />
      </div>

      {below.length === 0 ? (
        <p className="text-muted">
          All raiders are at or above {threshold}% attendance{seasonLabel}.
        </p>
      ) : (
        <>
          <p className="text-muted attend-scores-count">
            {below.length} raider{below.length !== 1 ? 's' : ''} at or below {threshold}% attendance{seasonLabel}
          </p>
          {below.map(({ player, pct, flagged }) => (
            <div className="attend-player-row" key={player.id}>
              <div className="attend-player-header">
                <span className="attend-player-name">{player.nickname?.trim() || firstName(player.name_realm)}</span>
                <span className="attend-player-pct" style={{ color: attendColor(pct) }}>
                  {pct.toFixed(1)}%
                </span>
              </div>
              <div className="attend-bar-wrap">
                <div className="attend-bar" style={{ width: `${pct}%`, background: attendColor(pct) }} />
              </div>
              {flagged.length > 0 && (
                <div className="attend-penalty-list">
                  {flagged.map((f) => (
                    <div className="attend-penalty-entry" key={f.date}>
                      <span>{f.date}</span>
                      <span className={f.status === 'No Show' ? 'attend-penalty-noshow' : 'attend-penalty-other'}>
                        {f.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
