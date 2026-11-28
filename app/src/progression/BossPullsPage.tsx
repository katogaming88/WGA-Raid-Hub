import { Link, useParams, useSearchParams } from 'react-router';
import { DataState } from '../components/DataState';
import { TipArea } from '../components/Tooltip';
import { useAddress, useTeam } from '../data/address';
import { isoDateShort } from '../lib/dates';
import { bossPlace, killDate, raidCards } from '../home/progression';
import { useRaidProgression } from '../home/useHome';
import { useBossPulls } from './usePulls';
import {
  bestText,
  nightLog,
  nightLong,
  nightShort,
  pullChart,
  pullWord,
  xPct,
  type Difficulty,
  type PullChart,
  type PullRow
} from './pulls';
import './pulls.css';

const DIFFICULTIES: { key: Difficulty; label: string }[] = [
  { key: 'mythic', label: 'Mythic' },
  { key: 'heroic', label: 'Heroic' }
];

// One boss's pull chart on its own page (#1474): how each pull ended, night
// by night. Open to anyone who can see the team's progression card.
export function BossPullsPage() {
  const team = useTeam();
  const { guild } = useAddress();
  const encounterId = Number(useParams().encounterId);
  const progression = useRaidProgression(team.id);
  const pulls = useBossPulls(team.id, encounterId);
  const base = `/g/${guild.key}/t/${team.key}`;

  return (
    <section className="page pulls-page" aria-labelledby="page-title">
      <DataState query={progression} label="raid progression">
        {({ raids, rows }) => {
          const place = bossPlace(raidCards(raids, rows), encounterId);
          if (!place) return <p className="text-muted">This boss is not on the team’s progression card.</p>;
          const { boss } = place;
          return (
            <>
              <nav aria-label="Breadcrumb" className="text-muted pulls-crumbs">
                {guild.name} / {team.name} / <Link to={base}>Raid progression</Link> / {boss.name}
              </nav>
              <div className="pulls-head">
                <div className="page-header">
                  <h1 id="page-title">{boss.name}</h1>
                  <p className="text-muted page-subtitle">
                    {place.raid}, boss {boss.number} of {place.of}
                  </p>
                </div>
                <div className="pulls-siblings">
                  {place.prev && (
                    <Link to={`${base}/progression/${place.prev.encounterId}`}>&larr; {place.prev.name}</Link>
                  )}
                  {place.next && (
                    <Link to={`${base}/progression/${place.next.encounterId}`}>{place.next.name} &rarr;</Link>
                  )}
                </div>
              </div>
              <DataState query={pulls} label="the pulls">
                {(data) => <Pulls rows={data} />}
              </DataState>
            </>
          );
        }}
      </DataState>
    </section>
  );
}

function Pulls({ rows }: { rows: PullRow[] }) {
  const [params, setParams] = useSearchParams();
  const has = (d: Difficulty) => rows.some((r) => r.difficulty === d);
  const asked = params.get('d');
  // Mythic first, falling back to Heroic when Mythic has no pulls.
  const difficulty: Difficulty =
    asked === 'heroic' || asked === 'mythic' ? asked : has('mythic') || !has('heroic') ? 'mythic' : 'heroic';
  const chart = pullChart(rows, difficulty);

  return (
    <>
      <div className="pulls-tabs" role="group" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`pulls-tab difficulty-${d.key}`}
            aria-pressed={d.key === difficulty}
            onClick={() => setParams({ d: d.key }, { replace: true })}
          >
            {d.label}
          </button>
        ))}
      </div>
      {chart.total === 0 ? (
        <p className="text-muted">No {difficulty === 'mythic' ? 'Mythic' : 'Heroic'} pulls yet.</p>
      ) : (
        <>
          <Figures chart={chart} />
          <Chart chart={chart} difficulty={difficulty} />
          <Table chart={chart} />
        </>
      )}
    </>
  );
}

function Figures({ chart }: { chart: PullChart }) {
  const first = chart.nights[0]!;
  const last = chart.nights.at(-1)!;
  const figures: { value: string; note: string; good?: boolean }[] = [
    chart.kill
      ? { value: `Killed ${killDate(chart.kill.date)}`, note: `on pull ${chart.kill.pull}`, good: true }
      : { value: 'Not killed yet', note: 'still being pulled' },
    { value: String(chart.total), note: chart.total === 1 ? 'pull' : 'pulls' },
    {
      value: String(chart.nights.length),
      note:
        chart.nights.length === 1
          ? `night, ${nightShort(first)}`
          : `nights, ${nightShort(first)} to ${nightShort(last)}`
    }
  ];
  if (chart.furthest)
    figures.push({ value: chart.furthest.label, note: `first reached ${isoDateShort(chart.furthest.date)}` });
  return (
    <div className="pulls-figures">
      {figures.map((f) => (
        <div key={f.note}>
          <span className={`pulls-figure-value${f.good ? ' pulls-good' : ''}`}>{f.value}</span>
          <span className="text-muted pulls-figure-note">{f.note}</span>
        </div>
      ))}
    </div>
  );
}

// One dot per pull in order, its height the boss's health left; the night's
// best a brighter dot joined to the next night's by a line; a kill a diamond
// at 0. The table below says all of it in words.
function Chart({ chart, difficulty }: { chart: PullChart; difficulty: Difficulty }) {
  const { total } = chart;
  const best = chart.nights.filter((n) => n.best && n.best.health !== null).map((n) => n.best!);
  return (
    <div
      className="pulls-scroll"
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label="Pull chart; the Night by night table has the same facts"
    >
      <div className={`pulls-chart difficulty-${difficulty}`} aria-hidden="true">
        <TipArea className="pulls-plot">
          {[100, 75, 50, 25, 0].map((v) => (
            <span key={v} className="pulls-tick" style={{ bottom: `${v}%` }}>
              {v}%
            </span>
          ))}
          {chart.nights.map((n, i) => (
            <div
              key={n.date}
              className={`pulls-band${i % 2 ? ' pulls-band-odd' : ''}`}
              style={{ left: `${(n.start / total) * 100}%`, width: `${(n.pulls.length / total) * 100}%` }}
            />
          ))}
          {chart.kill && (
            <span className="pulls-kill-label" style={{ left: `${xPct(chart.kill.pull - 1, total)}%` }}>
              Kill, {isoDateShort(chart.kill.date)}
            </span>
          )}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="pulls-line">
            <polyline
              points={best.map((p) => `${xPct(p.number - 1, total)},${100 - (p.health ?? 0)}`).join(' ')}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {chart.nights.flatMap((n) =>
            n.pulls
              .filter((p) => p.health !== null)
              .map((p) => {
                const isBest = n.best === p;
                return (
                  <span
                    key={p.number}
                    className={`${p.kill ? 'pulls-kill' : 'pulls-dot'}${isBest ? ' pulls-best' : ''}`}
                    style={{ left: `${xPct(p.number - 1, total)}%`, bottom: `${p.health}%` }}
                    data-tip={p.kill ? `Pull ${p.number}: kill` : `Pull ${p.number}: ${p.health}% left`}
                  />
                );
              })
          )}
        </TipArea>
        <div className="pulls-nights">
          {chart.nights.map((n) => (
            <span
              key={n.date}
              className="pulls-night"
              style={{ left: `${xPct(n.start + n.pulls.length / 2 - 0.5, total)}%` }}
            >
              {nightShort(n)}
              <br />
              <span className="text-dim">{pullWord(n.pulls.length)}</span>
            </span>
          ))}
        </div>
      </div>
      <p className="text-muted pulls-legend" aria-hidden="true">
        Each dot is a pull, as high as the boss’s health when it ended. The brighter dot is the night’s best pull, and a
        diamond at 0% is the kill.
      </p>
    </div>
  );
}

function Table({ chart }: { chart: PullChart }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="pulls-scroll" tabIndex={0} role="region" aria-label="Night by night table">
      <table className="pulls-table">
        <caption>Night by night</caption>
        <thead>
          <tr>
            <th scope="col">Night</th>
            <th scope="col" className="pulls-num">
              Pulls
            </th>
            <th scope="col" className="pulls-num">
              Best pull
            </th>
            <th scope="col">Got to</th>
            <th scope="col">Log</th>
          </tr>
        </thead>
        <tbody>
          {chart.nights.map((n) => {
            const log = nightLog(n);
            return (
              <tr key={n.date}>
                <td>{nightLong(n)}</td>
                <td className="pulls-num num">{n.pulls.length}</td>
                <td className={`pulls-num num${n.best?.kill ? ' pulls-good' : ''}`}>{bestText(n)}</td>
                <td className="text-muted">{n.best?.kill ? 'Kill' : (n.phase?.label ?? '')}</td>
                <td>
                  {log && (
                    <a href={log} target="_blank" rel="noopener">
                      Warcraft Logs<span className="visually-hidden"> (opens in a new tab)</span>
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
