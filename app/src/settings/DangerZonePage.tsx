import { useState } from 'react';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { currentSeason } from '../profile/profile';
import { useSeasons } from '../calendar/useCalendar';
import { useAttendanceRows } from '../attendance/useAttendance';
import type { FullAttendanceRow } from '../attendance/attendance';
import { useRosterPlayers } from '../roster/useRoster';
import type { PlayerRow } from '../roster/roster';
import { closableSeasonCodes, closeSeasonTarget, type SeasonRow } from './settings';
import { useCloseSeason, useSeasonHistorySettings } from './useSettings';
import './settings.css';

// The officer dashboard's Danger zone (#1357, #1103 row 1): the season-close
// control, ported from tab-season.js's Close Season card and renamed to
// "Archive season" -- it files this team's own record of a tier that already
// ended, it doesn't end anything (#1103's decision). Behavior is unchanged:
// still records the ending tier into Season History and resets per-player
// BiS-source/M+-exclusion/Bench flags.
export function DangerZonePage() {
  const team = useTeam();
  const page = bothQueries(
    bothQueries(useSeasons(), useSeasonHistorySettings(team.id)),
    bothQueries(useRosterPlayers(team.id), useAttendanceRows(team.id))
  );

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Danger zone</h1>
      </div>
      <DataState query={page} label="danger zone settings">
        {([[seasons, history], [players, attendanceRows]]) => (
          <ArchiveSeasonCard
            teamId={team.id}
            seasons={seasons}
            closedCodes={history.map((h) => h.code).filter((c): c is string => !!c)}
            players={players}
            attendanceRows={attendanceRows}
          />
        )}
      </DataState>
    </section>
  );
}

function ArchiveSeasonCard({
  teamId,
  seasons,
  closedCodes,
  players,
  attendanceRows
}: {
  teamId: number;
  seasons: SeasonRow[];
  closedCodes: string[];
  players: PlayerRow[];
  attendanceRows: FullAttendanceRow[];
}) {
  const { announce } = useStatus();
  const current = currentSeason(seasons);
  const codes = closableSeasonCodes(current, seasons, closedCodes);
  const [picked, setPicked] = useState(() => codes[codes.length - 1] ?? '');
  const [confirming, setConfirming] = useState(false);
  const close = useCloseSeason(teamId);

  const target = closeSeasonTarget(codes, picked);
  const targetSeason = seasons.find((s) => s.code === target) ?? null;

  const onExecute = () => {
    setConfirming(false);
    if (!targetSeason) return;
    close.mutate(
      { code: targetSeason.code, tierEnd: targetSeason.ends_at, players, attendanceRows },
      {
        onSuccess: () => announce('success', 'Season archived.'),
        onError: (error) => announce('error', `Could not archive: ${errorMessage(error)}`)
      }
    );
  };

  return (
    <div className="card settings-card settings-danger-card">
      <h2>Archive Season</h2>
      <p className="text-muted">
        Files this team's own record of a tier that has ended: the roster with its attendance and the raids with their
        progress are recorded in Season History, and every player's submitted BiS source, M+ exclusion and Bench status
        reset. Nothing about the current tier changes -- it's Blizzard's, and starts on its own.
      </p>
      <div className="settings-row">
        {codes.length > 1 && (
          <>
            <label className="visually-hidden" htmlFor="archive-season-select">
              Tier to archive
            </label>
            <select
              id="archive-season-select"
              className="select"
              value={target}
              onChange={(e) => setPicked(e.target.value)}
            >
              {codes.map((code) => (
                <option key={code} value={code}>
                  {seasons.find((s) => s.code === code)?.display_name ?? code}
                </option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          className="button button-danger"
          onClick={() => setConfirming(true)}
          disabled={!codes.length || close.isPending}
        >
          Archive season
        </button>
        <span className="text-muted">
          {!codes.length
            ? current
              ? 'Every tier that has ended is closed for this team.'
              : 'No tier has started yet.'
            : codes.length === 1
              ? `Archives ${targetSeason?.display_name ?? target}.`
              : ''}
        </span>
      </div>

      {confirming && targetSeason && (
        <Dialog title="Archive season" onClose={() => setConfirming(false)} busy={close.isPending}>
          <p>
            File "{targetSeason.display_name}" into Season History? The roster with its attendance and the raids with
            their progress are recorded. Every player's submitted BiS source will be cleared, and M+ exclusion and Bench
            status will reset for the whole roster (Trial status is left alone). Nothing else changes: the tier everyone
            is on stays where it is.
          </p>
          <div className="dialog-actions">
            <span className="grow" />
            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={close.isPending}>
              Cancel
            </button>
            <button type="button" className="button button-danger" onClick={onExecute} disabled={close.isPending}>
              {close.isPending ? 'Archiving…' : 'Yes, Archive'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
