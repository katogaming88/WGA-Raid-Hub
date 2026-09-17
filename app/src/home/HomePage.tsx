import { useId, useState } from 'react';
import { Link } from 'react-router';
import { DataState } from '../components/DataState';
import { charactersOn, useAccess } from '../auth/access';
import { useAddress, useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import { useCurrentSeason } from '../profile/useProfile';
import { useRosterPlayers } from '../roster/useRoster';
import type { PlayerRow } from '../roster/roster';
import type { SeasonWindow } from '../profile/profile';
import { lootFeed, mainSpecCount, raiderCount, searchFeed, type FeedRow } from './home';
import { killDate, pullsText, raidCards, type DifficultyLine, type RaidCard } from './progression';
import { calendarMonth, raidNights, WEEKDAYS, type CalendarMonth } from '../calendar/nights';
import { useCalendarMonth, useRaidProgression, useSeasonLoot } from './useHome';
import './home.css';

// The team's Home page (#1102): the stats row, raid progression, this month's
// calendar and the recent loot feed, checked against the current site's
// landing view in tests/browser-app/home.test.js. The live stream widget sits
// in the shell, on every team page.
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
          <Home season={seasonWindow} roster={roster} feed={lootFeed(awards, seasonWindow)} />
        )}
      </DataState>
    </section>
  );
}

function Home({ season, roster, feed }: { season: SeasonWindow; roster: PlayerRow[]; feed: FeedRow[] }) {
  return (
    <>
      <dl className="home-stats">
        <Stat label="Raiders" value={raiderCount(roster)} />
        <Stat label="Items this season" value={mainSpecCount(feed)} />
      </dl>
      <div className="home-grid">
        <Progression />
        <Calendar roster={roster} />
      </div>
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

// Raid progression

function Progression() {
  const team = useTeam();
  const progression = useRaidProgression(team.id);
  const titleId = useId();

  // No raids listed for the season: nothing to show, as today.
  if (progression.isSuccess && progression.data.raids.length === 0) return null;

  return (
    <section className="card home-card home-progression" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        Raid progression
      </h2>
      <DataState query={progression} label="raid progression">
        {({ raids, rows }) => (
          <div className="raid-list">
            {raidCards(raids, rows).map((raid, i) => (
              <Raid key={`${i}-${raid.name}`} raid={raid} />
            ))}
          </div>
        )}
      </DataState>
    </section>
  );
}

function Raid({ raid }: { raid: RaidCard }) {
  const { score, bar } = raid;
  return (
    <article className="raid">
      <header className="raid-header">
        <h3 className="raid-name">{raid.name}</h3>
        <span className="raid-scores">
          {score.heroic !== null && (
            <span className="raid-score difficulty difficulty-heroic" data-difficulty="heroic">
              Heroic{' '}
              <span className="num">
                {score.heroic}/{score.total}
              </span>
            </span>
          )}
          {score.mythic !== null && (
            <span className="raid-score difficulty difficulty-mythic" data-difficulty="mythic">
              Mythic{' '}
              <span className="num">
                {score.mythic}/{score.total}
              </span>
            </span>
          )}
        </span>
      </header>
      {/* The score above says the same in words. */}
      {bar && (
        <div className="raid-bar" aria-hidden="true">
          <div className={`raid-bar-fill raid-bar-${bar.difficulty}`} style={{ width: `${bar.pct}%` }} />
        </div>
      )}
      {raid.aotc && (
        <p className="raid-aotc">
          Ahead of the Curve <time dateTime={raid.aotc}>{killDate(raid.aotc)}</time>
        </p>
      )}
      {raid.bosses.length > 0 && (
        <ol className="boss-list">
          {raid.bosses.map((boss) => (
            <li key={boss.number} className={`boss${boss.mythic?.date ? ' boss-killed' : ''}`}>
              <span className="boss-number num" aria-hidden="true">
                {boss.number}
              </span>
              <div className="boss-body">
                <span className="boss-name">{boss.name}</span>
                {boss.mythic && <BossLine difficulty="Mythic" line={boss.mythic} />}
                {boss.heroic && <BossLine difficulty="Heroic" line={boss.heroic} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

// "Mythic  Killed Apr 2, 2026  12 pulls", or "Heroic  17 pulls  best 3.2%".
function BossLine({ difficulty, line }: { difficulty: 'Mythic' | 'Heroic'; line: DifficultyLine }) {
  const pulls = pullsText(line);
  return (
    <span className="boss-line" data-difficulty={difficulty.toLowerCase()}>
      <span className={`boss-difficulty difficulty difficulty-${difficulty.toLowerCase()}`}>{difficulty}</span>
      {line.date && (
        <span className="boss-killed-on">
          Killed <time dateTime={line.date}>{killDate(line.date)}</time>
        </span>
      )}
      {pulls &&
        (line.link ? (
          <a className="boss-pulls" href={line.link} target="_blank" rel="noopener">
            {pulls}
            <span className="visually-hidden"> (Warcraft Logs, opens in a new tab)</span>
          </a>
        ) : (
          <span className="boss-pulls">{pulls}</span>
        ))}
      {line.best !== null && <span className="boss-best">best {line.best}%</span>}
    </span>
  );
}

// Calendar

function Calendar({ roster }: { roster: PlayerRow[] }) {
  const { guild } = useAddress();
  const team = useTeam();
  const access = useAccess();
  const titleId = useId();
  const [today] = useState(() => new Date());
  const year = today.getFullYear();
  const month = today.getMonth();

  // The reader's own characters on this team that are on the roster: their
  // answers colour the days. Signed out, there are none.
  const onRoster = roster.filter((p) => p.classes_specs?.role);
  const mine = charactersOn(access.data, team.id)
    .map((c) => c.playerId)
    .filter((id) => onRoster.some((p) => p.id === id));
  // Signed in, wait to know who the reader is rather than read the month twice.
  const knowsWho = !(access.isPending && access.fetchStatus !== 'idle');
  const calendar = useCalendarMonth(team.id, year, month, mine, knowsWho);
  const counts = { roster: onRoster.length, bench: onRoster.filter((p) => p.is_bench || p.is_rotator).length };
  const base = `/g/${guild.key}/t/${team.key}/calendar`;

  return (
    <section className="card home-card home-calendar" aria-labelledby={titleId}>
      <h2 id={titleId} className="section-title">
        Calendar
      </h2>
      <DataState query={calendar} label="the raid calendar">
        {({ schedule, exceptions, mine: answers }) => (
          <MonthGrid
            month={calendarMonth(year, month, raidNights(schedule, exceptions, year, month), counts, answers, today)}
            dayHref={(date) => `${base}?date=${date}`}
          />
        )}
      </DataState>
      <Link className="home-calendar-more" to={base}>
        View full calendar
      </Link>
    </section>
  );
}

const DAY_LABEL = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

function MonthGrid({ month, dayHref }: { month: CalendarMonth; dayHref: (date: string) => string }) {
  return (
    <div className="cal">
      <p className="cal-month">{month.label}</p>
      <div className="cal-grid">
        {WEEKDAYS.map((d) => (
          <span key={d} className="cal-weekday" aria-hidden="true">
            {d}
          </span>
        ))}
        {Array.from({ length: month.offset }, (_, i) => (
          <span key={`pad-${i}`} className="cal-pad" aria-hidden="true" />
        ))}
        {month.days.map((day) => {
          const className = `cal-day${day.raid ? ' cal-day-raid' : ''}${day.today ? ' cal-day-today' : ''}`;
          if (!day.raid) {
            return (
              <span key={day.date} className={className} aria-hidden="true">
                <span className="cal-daynum">{day.day}</span>
              </span>
            );
          }
          const [y, m, d] = day.date.split('-').map(Number);
          const label = [
            DAY_LABEL.format(new Date(y!, m! - 1, d!)),
            day.today ? 'today' : null,
            day.raid.status,
            day.raid.count ? `${day.raid.count.replace('/', ' of ')} raiders expected` : null
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <span key={day.date} className="cal-cell">
              <Link
                to={dayHref(day.date)}
                className={className}
                aria-label={label}
                aria-current={day.today ? 'date' : undefined}
              >
                <span className="cal-daynum">{day.day}</span>
                {day.raid.count && <span className="cal-count num">{day.raid.count}</span>}
                <span className={`cal-marker cal-marker-${day.raid.tone}`} title={day.raid.status} />
              </Link>
            </span>
          );
        })}
      </div>
      <ul className="cal-legend">
        {month.legend.map((item) => (
          <li key={item.label}>
            {item.tone && <span className={`cal-marker cal-marker-${item.tone}`} aria-hidden="true" />}
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Recent loot

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
