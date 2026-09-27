import { useState } from 'react';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { useCurrentSeason } from '../profile/useProfile';
import { useRosterPlayers } from '../roster/useRoster';
import type { PlayerRow } from '../roster/roster';
import { ATTENDANCE_STATUSES, buildGrid, type FullAttendanceRow, type Night } from './attendance';
import {
  useAttendanceRows,
  useCommitAttendanceScores,
  useRefreshAttendanceFromWcl,
  useSetAttendanceStatus,
  useToggleReportExcluded
} from './useAttendance';
import './attendance.css';

// The officer's Manage Attendance page (#1354, #1103 row 1): the per-night
// status grid, refresh from WCL, and commit attendance scores, ported from
// tab-attendance.js's Manage sub-tab.
export function AttendanceManagePage() {
  const team = useTeam();
  const page = bothQueries(useAttendanceRows(team.id), useRosterPlayers(team.id));

  return (
    <section className="page attendance-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Manage attendance</h1>
        <p className="text-muted page-subtitle">
          Refresh from Warcraft Logs after each raid night, then fix up any status it couldn't tell on its own. Commit
          Attendance Scores writes each raider's weighted attendance to Scoring, which is what the Priority Generator
          uses.
        </p>
      </div>
      <DataState query={page} label="attendance">
        {([rows, roster]) => <Manage teamId={team.id} rows={rows} roster={roster} />}
      </DataState>
    </section>
  );
}

function Manage({ teamId, rows, roster }: { teamId: number; rows: FullAttendanceRow[]; roster: PlayerRow[] }) {
  const { announce } = useStatus();
  const season = useCurrentSeason(teamId);
  const nights = buildGrid(rows, roster);
  const [shown, setShown] = useState(0);
  const [confirmingCommit, setConfirmingCommit] = useState(false);
  const refresh = useRefreshAttendanceFromWcl(teamId);
  const commit = useCommitAttendanceScores(teamId);

  const onRefresh = () =>
    refresh.mutate(undefined, {
      onSuccess: (result) => {
        setShown(0);
        const text = `Done: ${result.mainNights} night${result.mainNights === 1 ? '' : 's'} found, ${result.excluded} excluded.`;
        announce('success', text);
      },
      onError: (error) => announce('error', errorMessage(error))
    });

  const onCommit = () => {
    setConfirmingCommit(false);
    if (!season.isSuccess || !season.data.code) return;
    commit.mutate(
      { rows, season: season.data.code },
      {
        onSuccess: (summary) => {
          const text = `${summary.committed} player${summary.committed === 1 ? '' : 's'} scored (${summary.totalNights} night${summary.totalNights === 1 ? '' : 's'})`;
          announce('success', text);
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );
  };

  return (
    <div className="attend-manage-panel card">
      <div className="attend-manage-header">
        <div className="attend-manage-actions">
          <button type="button" className="button" onClick={onRefresh} disabled={refresh.isPending}>
            {refresh.isPending ? 'Refreshing…' : 'Refresh from WCL'}
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setConfirmingCommit(true)}
            disabled={commit.isPending || !season.isSuccess || !season.data.code}
          >
            Commit Attendance Scores
          </button>
        </div>
      </div>
      {confirmingCommit && (
        <Dialog title="Commit attendance scores" onClose={() => setConfirmingCommit(false)}>
          <p>Calculate and write attendance scores for all players to Scoring?</p>
          <div className="dialog-actions">
            <span className="grow" />
            <button type="button" className="button" onClick={() => setConfirmingCommit(false)}>
              Cancel
            </button>
            <button type="button" className="button button-primary" onClick={onCommit}>
              Yes, Commit
            </button>
          </div>
        </Dialog>
      )}

      {nights.length === 0 ? (
        <p className="text-muted">No raid nights recorded yet. Run "Refresh from WCL" first.</p>
      ) : (
        <NightGrid teamId={teamId} nights={nights} shown={shown} onShow={setShown} />
      )}
    </div>
  );
}

function NightGrid({
  teamId,
  nights,
  shown,
  onShow
}: {
  teamId: number;
  nights: Night[];
  shown: number;
  onShow: (index: number) => void;
}) {
  const { announce } = useStatus();
  const night = nights[Math.min(shown, nights.length - 1)]!;
  const setStatus = useSetAttendanceStatus(teamId);
  const toggleExcluded = useToggleReportExcluded(teamId);

  return (
    <>
      <div className="attend-night-row">
        <label className="visually-hidden" htmlFor="attend-night-select">
          Raid night
        </label>
        <select
          id="attend-night-select"
          className="input attend-night-select"
          value={shown}
          onChange={(e) => onShow(Number(e.target.value))}
        >
          {nights.map((n, i) => (
            <option key={n.date} value={i}>
              {n.title}
              {n.excluded ? ' [EXCLUDED]' : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="attend-grid-info">
        <span className="text-muted">
          {night.players.length} player{night.players.length !== 1 ? 's' : ''}
        </span>
        {night.excluded && <span className="attend-excluded-tag">Excluded from scoring</span>}
        <button
          type="button"
          className="button button-quiet attend-exclude-btn"
          disabled={toggleExcluded.isPending}
          onClick={() =>
            toggleExcluded.mutate(
              { raidDate: night.date, excluded: !night.excluded },
              { onError: (error) => announce('error', errorMessage(error)) }
            )
          }
        >
          {night.excluded ? 'Remove Exclusion' : 'Exclude Report'}
        </button>
      </div>
      <div className="attend-grid-rows">
        {night.players.map((p) => {
          const isLateFlag = p.source === 'WCL (Late?)';
          return (
            <div className="attend-grid-row" key={p.playerId}>
              <span className="attend-grid-name">{p.name}</span>
              <span className={`attend-grid-source${isLateFlag ? ' attend-late-flag' : ''}`}>{p.source || ''}</span>
              <label className="visually-hidden" htmlFor={`attend-status-${night.date}-${p.playerId}`}>
                {p.name}'s status for {night.title}
              </label>
              <select
                id={`attend-status-${night.date}-${p.playerId}`}
                className="input attend-status-select"
                value={p.status ?? ''}
                disabled={setStatus.isPending}
                onChange={(e) =>
                  setStatus.mutate(
                    { playerId: p.playerId, raidDate: night.date, status: e.target.value, oldStatus: p.status },
                    { onError: (error) => announce('error', errorMessage(error)) }
                  )
                }
              >
                {!p.status && (
                  <option value="" disabled>
                    (no status)
                  </option>
                )}
                {ATTENDANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </>
  );
}
