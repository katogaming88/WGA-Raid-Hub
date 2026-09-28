import { useState } from 'react';
import { useTeam } from '../data/address';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { useCurrentSeason } from '../profile/useProfile';
import {
  defaultZoneIndex,
  newestHistoryIndex,
  normalizeRaids,
  perfZoneGroups,
  seasonPerfFetchedText,
  type SettingsHistoryEntry
} from './settings';
import { useSeasonHistorySettings, useSeasonPerfFetch, useSeasonPerfFetchedCount } from './useSettings';
import './settings.css';

// The officer dashboard's Season settings (#1357, #1103 row 1): the Season
// History list, ported from tab-season.js's History sub-tab (Close Season
// moved to Danger zone, #1103's decision).
export function SeasonSettingsPage() {
  const team = useTeam();
  const query = useSeasonHistorySettings(team.id);

  return (
    <section className="page settings-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">Season settings</h1>
      </div>
      <DataState query={query} label="season history">
        {(history) => <SeasonHistoryCard teamId={team.id} history={history} />}
      </DataState>
    </section>
  );
}

function SeasonHistoryCard({ teamId, history }: { teamId: number; history: SettingsHistoryEntry[] }) {
  if (!history.length) {
    return (
      <div className="card settings-card">
        <h2>Season History</h2>
        <p className="text-muted">No tier closed for this team yet.</p>
      </div>
    );
  }

  const newest = newestHistoryIndex(history);

  return (
    <div className="card settings-card">
      <h2>Season History</h2>
      <p className="text-muted">
        Tiers this team has closed. The most recent entry offers a WCL Performance Baseline fetch -- run once at the
        start of a new tier to seed heroic priority scoring before it has raid reports of its own.
      </p>
      <div className="settings-history-list">
        {history
          .map((entry, i) => ({ entry, i }))
          .reverse()
          .map(({ entry, i }) => (
            <SeasonHistoryRow key={i} teamId={teamId} entry={entry} index={i} showPerfFetch={i === newest} />
          ))}
      </div>
    </div>
  );
}

function SeasonHistoryRow({
  teamId,
  entry,
  index,
  showPerfFetch
}: {
  teamId: number;
  entry: SettingsHistoryEntry;
  index: number;
  showPerfFetch: boolean;
}) {
  const [showRoster, setShowRoster] = useState(false);
  const raidCount = entry.raids?.length ?? 0;

  return (
    <div className="settings-history-row">
      <div className="settings-history-header">
        <div>
          <strong>{entry.name || '(unnamed)'}</strong>
          {raidCount > 0 && (
            <span className="text-muted settings-history-raids">
              ({raidCount} raid{raidCount !== 1 ? 's' : ''})
            </span>
          )}
        </div>
        {!!entry.roster?.length && (
          <button type="button" className="button" onClick={() => setShowRoster((v) => !v)}>
            {showRoster ? 'Hide Roster' : 'View Roster'}
          </button>
        )}
      </div>
      {showRoster && entry.roster && (
        <table className="settings-roster-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th>Status</th>
              <th>Join Date</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {entry.roster.map((p, i) => (
              <tr key={i}>
                <td>{p.nameRealm}</td>
                <td>{p.role || '-'}</td>
                <td>{p.isBench ? 'Bench' : p.isTrial ? 'Trial' : 'Roster'}</td>
                <td>{p.joinDate || '-'}</td>
                <td>{p.attendance || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showPerfFetch && <SeasonPerfFetchRow teamId={teamId} entry={entry} historyIndex={index} />}
    </div>
  );
}

function SeasonPerfFetchRow({
  teamId,
  entry,
  historyIndex
}: {
  teamId: number;
  entry: SettingsHistoryEntry;
  historyIndex: number;
}) {
  const { announce } = useStatus();
  const raids = normalizeRaids(entry.raids ?? []);
  const groups = perfZoneGroups(raids);
  const [zoneId, setZoneId] = useState(() => groups[defaultZoneIndex(groups)]?.zoneId ?? 0);
  const seasonCode = entry.code ?? null;
  const liveSeason = useCurrentSeason(teamId);
  const fetchedCount = useSeasonPerfFetchedCount(teamId, seasonCode);
  const fetchPerf = useSeasonPerfFetch(teamId);

  if (!groups.length) return null;

  const onFetch = () => {
    if (!zoneId || !seasonCode) return;
    fetchPerf.mutate(
      { season: seasonCode, zoneId, liveSeasonCode: liveSeason.isSuccess ? liveSeason.data.code : null },
      {
        onSuccess: (result) => {
          announce(
            'success',
            `${result.updated} player(s) updated${result.noData ? `, ${result.noData} with no data` : ''}.`
          );
        },
        onError: (error) => announce('error', errorMessage(error))
      }
    );
  };

  return (
    <div className="settings-perf-fetch-row">
      <span className="text-muted">WCL Performance Baseline:</span>
      <label className="visually-hidden" htmlFor={`perf-zone-select-${historyIndex}`}>
        Raid zone
      </label>
      <select
        id={`perf-zone-select-${historyIndex}`}
        className="select settings-perf-select"
        value={zoneId}
        onChange={(e) => setZoneId(Number(e.target.value))}
      >
        {groups.map((g, j) => (
          <option key={g.zoneId} value={g.zoneId}>
            {g.label || `Raid ${j + 1}`}
          </option>
        ))}
      </select>
      <button type="button" className="button" onClick={onFetch} disabled={fetchPerf.isPending}>
        {fetchPerf.isPending ? 'Fetching…' : 'Fetch WCL Performance'}
      </button>
      <span className="text-muted">
        {fetchedCount.isSuccess ? seasonPerfFetchedText(fetchedCount.data) : 'Checking…'}
      </span>
    </div>
  );
}
