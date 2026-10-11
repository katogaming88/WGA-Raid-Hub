import { useState } from 'react';
import { earlierOwners } from '../characters/characters';
import { useEarlierLoot } from '../characters/useCharacters';
import { DataState } from '../components/DataState';
import { useTeam } from '../data/address';
import { bothQueries } from '../data/query';
import type { Difficulty, SeasonWindow } from '../profile/profile';
import { useCurrentSeason } from '../profile/useProfile';
import { classColor, toRoster, type PlayerRow } from '../roster/roster';
import { useNames } from '../roster/useNames';
import { useRosterOfficerData, useRosterPlayers } from '../roster/useRoster';
import { benchFairness, lootFairness, oneDecimal, type Fairness } from './fairness';
import { ReportPage } from './ReportPage';

// Reports under the officer menu (#1359), one page each.

export function LootFairnessPage() {
  const team = useTeam();
  const data = bothQueries(useRosterPlayers(team.id), useCurrentSeason(team.id));
  return (
    <ReportPage
      title="Loot fairness"
      intro="Items each raider has received this season, by role, most first. The line is the raid average."
    >
      <DataState query={data} label="the roster">
        {([players, season]) => <LootFairness teamId={team.id} players={players} season={season} />}
      </DataState>
    </ReportPage>
  );
}

export function BenchFairnessPage() {
  const team = useTeam();
  const data = bothQueries(useRosterPlayers(team.id), useCurrentSeason(team.id));
  return (
    <ReportPage
      title="Bench fairness"
      intro="Nights each raider has sat on the bench this season, by role, most first, with their bench rate: the share of their raid nights spent benched. The line is the raid average."
    >
      <DataState query={data} label="the roster">
        {([players, season]) => <BenchFairness teamId={team.id} players={players} season={season} />}
      </DataState>
    </ReportPage>
  );
}

const DIFFICULTIES: { value: Difficulty | null; label: string }[] = [
  { value: null, label: 'Everything' },
  { value: 'Heroic', label: 'Heroic' },
  { value: 'Mythic', label: 'Mythic' }
];

type Props = { teamId: number; players: PlayerRow[]; season: SeasonWindow };

function LootFairness({ teamId, players, season }: Props) {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const names = useNames(teamId);
  const loot = bothQueries(useRosterOfficerData(teamId, season, true), useEarlierLoot(teamId, season, true));
  return (
    <>
      <div className="role-filter" role="group" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.label}
            type="button"
            className="role-filter-option"
            aria-pressed={difficulty === d.value}
            onClick={() => setDifficulty(d.value)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <DataState query={loot} label="this season's loot">
        {([own, earlier]) => {
          const report = lootFairness(
            toRoster(players, [], names.data ?? []),
            [...own.loot, ...earlier.loot],
            season,
            difficulty,
            earlierOwners(earlier.pairs)
          );
          return (
            <FairnessChart
              report={report}
              caption="Items received"
              average={`${season.name ? `${season.name}: ` : ''}average ${oneDecimal(report.average)} items`}
            />
          );
        }}
      </DataState>
    </>
  );
}

function BenchFairness({ teamId, players, season }: Props) {
  const names = useNames(teamId);
  const nights = useRosterOfficerData(teamId, season, true);
  return (
    <DataState query={nights} label="this season's attendance">
      {({ attendance }) => {
        const report = benchFairness(toRoster(players, [], names.data ?? []), attendance, season);
        return (
          <FairnessChart
            report={report}
            caption="Nights benched"
            average={`${season.name ? `${season.name}: ` : ''}average ${oneDecimal(report.average)} nights benched`}
          />
        );
      }}
    </DataState>
  );
}

// The bars are a picture of the numbers beside them, so they are hidden from
// screen readers; the average line is written out below.
function FairnessChart({ report, caption, average }: { report: Fairness; caption: string; average: string }) {
  if (report.groups.length === 0) {
    return (
      <div className="card placeholder">
        <p>No one is on this team's roster yet.</p>
      </div>
    );
  }
  const scale = Math.max(report.max, 1);
  const pct = (n: number) => `${Math.round((n / scale) * 100)}%`;
  return (
    <div className="card fairness">
      {report.groups.map((g) => (
        <section key={g.role} className="fairness-group" aria-label={g.label}>
          <h2 className="fairness-role">{g.label}</h2>
          <ul className="fairness-list">
            {g.rows.map((r) => (
              <li key={r.playerId} className="fairness-row">
                <span className="fairness-name" style={{ color: classColor(r.className) }}>
                  {r.name}
                </span>
                <span className="fairness-bar" aria-hidden="true">
                  <span className="fairness-fill" style={{ width: pct(r.value) }} />
                  <span className="fairness-average" style={{ left: pct(report.average) }} />
                </span>
                <span className="fairness-value num">
                  <span className="visually-hidden">{caption}: </span>
                  {r.value}
                  {r.note && <span className="fairness-note"> ({r.note})</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="fairness-legend text-muted">
        <span className="fairness-legend-line" aria-hidden="true" />
        {average}
      </p>
    </div>
  );
}
