import { useId, useState } from 'react';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { killDate } from '../home/progression';
import { rosterRows, rosterStatus, seasonHistory, type SeasonRecap } from './history';
import { useSeasonHistory } from './useHistory';
import './history.css';

// History (#1102): past seasons' progression and rosters, newest first. The
// roster snapshot was officer-only on the current site (Season Settings'
// "View Roster"); it moves onto this public page on purpose.
export function HistoryPage() {
  const team = useTeam();
  const history = useSeasonHistory(team.id);

  return (
    <section className="page history-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">History</h1>
        <p className="text-muted page-subtitle">Past seasons' progression and rosters, newest first.</p>
      </div>
      <DataState query={history} label="the season history">
        {(rows) => {
          const seasons = seasonHistory(rows);
          if (!seasons.length) return <p className="text-muted">No past seasons yet.</p>;
          return (
            <ol className="history-list">
              {seasons.map((season, i) => (
                <li key={i}>
                  <SeasonCard season={season} />
                </li>
              ))}
            </ol>
          );
        }}
      </DataState>
    </section>
  );
}

function SeasonCard({ season }: { season: SeasonRecap }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const roster = rosterRows(season.roster);

  return (
    <article className="card history-season">
      <h2 className="history-season-name">{season.name}</h2>
      <p className="history-season-score">
        {season.killed}/{season.total} Mythic
        {season.lastKillDate && <> &middot; Last boss kill {killDate(season.lastKillDate)}</>}
      </p>
      {season.currentBoss && (
        <p className="text-muted history-season-progress">
          Working on {season.currentBoss.name} &mdash; {season.currentBoss.pulls}{' '}
          {season.currentBoss.pulls === 1 ? 'pull' : 'pulls'}
          {season.currentBoss.bestPct != null && <>, best {season.currentBoss.bestPct}%</>}
        </p>
      )}
      {roster.length > 0 && (
        <>
          <button
            type="button"
            className="link-button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide roster' : 'View roster'}
          </button>
          {open && (
            <div id={panelId} className="history-roster-wrap">
              <table className="history-roster">
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Role</th>
                    <th scope="col">Status</th>
                    <th scope="col">Join date</th>
                    <th scope="col">Attendance</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((row) => (
                    <tr key={row.nameRealm}>
                      <td>{row.nameRealm}</td>
                      <td>{row.role || '\u2013'}</td>
                      <td>{rosterStatus(row)}</td>
                      <td>{row.joinDate ? killDate(row.joinDate) : '\u2013'}</td>
                      <td>{row.attendance || '\u2013'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </article>
  );
}
