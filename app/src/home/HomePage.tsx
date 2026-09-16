import { useId, useState } from 'react';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { useCurrentSeason } from '../profile/useProfile';
import { useRosterPlayers } from '../roster/useRoster';
import type { SeasonWindow } from '../profile/profile';
import { lootFeed, mainSpecCount, raiderCount, searchFeed, type FeedRow } from './home';
import { useSeasonLoot } from './useHome';
import './home.css';

// The team's Home page (#1102). Two blocks so far -- the stats row and the
// recent loot feed -- checked against the current site's landing view in
// tests/browser-app/home.test.js. Raid progression and the live stream widget
// come next.
export function HomePage() {
  const team = useTeam();
  const season = useCurrentSeason(team.id);
  const players = useRosterPlayers(team.id);
  const loot = useSeasonLoot(team.id, season.data ?? null);
  const page = bothQueries(bothQueries(season, players), loot);

  return (
    <section className="page home-page" aria-labelledby="page-title">
      <div className="page-header">
        <h1 id="page-title">{team.name}</h1>
        {season.isSuccess && season.data.name && <p className="text-muted page-subtitle">{season.data.name}</p>}
      </div>

      <DataState query={page} label="the team’s season">
        {([[seasonWindow, roster], awards]) => (
          <Home season={seasonWindow} raiders={raiderCount(roster)} feed={lootFeed(awards, seasonWindow)} />
        )}
      </DataState>
    </section>
  );
}

function Home({ season, raiders, feed }: { season: SeasonWindow; raiders: number; feed: FeedRow[] }) {
  return (
    <>
      <dl className="home-stats">
        <Stat label="Raiders" value={raiders} />
        <Stat label="Items this season" value={mainSpecCount(feed)} />
      </dl>
      <RecentLoot season={season} feed={feed} />
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card home-stat">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function RecentLoot({ season, feed }: { season: SeasonWindow; feed: FeedRow[] }) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const rows = searchFeed(feed, query);
  const searching = query.trim() !== '';

  return (
    <section className="card home-loot" aria-labelledby={`${searchId}-title`}>
      <div className="home-loot-header">
        <h2 id={`${searchId}-title`} className="section-title">
          Recent loot
        </h2>
        <div className="home-loot-search">
          <label className="visually-hidden" htmlFor={searchId}>
            Search item name
          </label>
          <input
            id={searchId}
            type="search"
            className="input"
            placeholder="Search item name..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {/* What the list is showing right now, announced when a search changes it. */}
      <p className="text-dim home-loot-note" role="status">
        {!feed.length
          ? `No loot recorded${season.name ? ` in ${season.name}` : ''} yet.`
          : searching
            ? rows.length
              ? `${rows.length} matching ${rows.length === 1 ? 'item' : 'items'}.`
              : 'No matching items.'
            : `The ${rows.length} newest awards${season.name ? ` in ${season.name}` : ''}.`}
      </p>

      {rows.length > 0 && (
        <div className="home-loot-table-wrap">
          <table className="home-loot-table">
            <caption className="visually-hidden">
              {searching ? 'Matching items, newest first' : 'The newest items awarded, newest first'}
            </caption>
            <thead>
              <tr>
                <th scope="col">Raider</th>
                <th scope="col">Item</th>
                <th scope="col">Difficulty</th>
                <th scope="col">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row" className="loot-player">
                    {row.player}
                  </th>
                  <td className="loot-item">
                    <span className="loot-name">{row.item}</span>
                    {row.offSpec && (
                      <span className="loot-offspec" title="Won on an off-spec or Mythic+ roll, so it is not counted">
                        OS/M+
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`difficulty difficulty-${row.difficulty.toLowerCase()}`}>{row.difficulty}</span>
                  </td>
                  <td className="loot-date">{row.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
