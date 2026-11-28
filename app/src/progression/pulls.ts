import { isoDateLong, isoDateShort } from '../lib/dates';
import { reportUrl } from '../home/progression';

// The pull chart (#1474): one boss's pulls from team_raid_pulls() (#1496),
// shaped for the chart and for the table that is its text alternative.

export type Difficulty = 'mythic' | 'heroic';

export type PullRow = {
  report_code: string;
  fight_id: number;
  difficulty: string;
  raid_date: string;
  started_at: string;
  boss_percentage: number | null;
  kill: boolean;
  last_phase: number | null;
  last_phase_is_intermission: boolean | null;
};

// A pull with its number in the boss's whole run at this difficulty, and the
// boss's health left (0 on a kill) when it ended; null when Warcraft Logs
// gave none, so the chart leaves it out but the counts keep it.
export type Pull = { number: number; health: number | null; kill: boolean; row: PullRow };

export type PhaseReached = { rank: number; label: string };

export type Night = {
  date: string;
  pulls: Pull[];
  best: Pull | null;
  // The furthest phase any pull of the night reached.
  phase: PhaseReached | null;
  // The night's first pull's place in the whole run, from 0, for the chart's x.
  start: number;
};

export type PullChart = {
  nights: Night[];
  total: number;
  kill: { date: string; pull: number } | null;
  furthest: { label: string; date: string } | null;
};

// An intermission sits after the phase of the same number and before the next.
const phaseOf = (row: PullRow): PhaseReached | null =>
  row.last_phase == null
    ? null
    : row.last_phase_is_intermission
      ? { rank: row.last_phase * 2 + 1, label: `Intermission ${row.last_phase}` }
      : { rank: row.last_phase * 2, label: `Phase ${row.last_phase}` };

// The better of a night's best so far and a later pull: the lower health
// left (a kill is 0); the earlier pull on a tie; a pull with no health never.
const better = (a: Pull | null, b: Pull): Pull => {
  if (!a || a.health === null) return b;
  if (b.health === null) return a;
  return b.health < a.health ? b : a;
};

export function pullChart(rows: PullRow[], difficulty: Difficulty): PullChart {
  const nights: Night[] = [];
  let total = 0;
  let kill: PullChart['kill'] = null;
  let furthest: { rank: number; label: string; date: string } | null = null;

  const ordered = rows
    .filter((r) => r.difficulty === difficulty)
    .sort(
      (a, b) =>
        a.started_at.localeCompare(b.started_at) ||
        a.report_code.localeCompare(b.report_code) ||
        a.fight_id - b.fight_id
    );

  for (const row of ordered) {
    // The story ends at the first kill; later kills are farm, not progress.
    if (kill) break;
    total += 1;
    const pull: Pull = { number: total, health: row.kill ? 0 : row.boss_percentage, kill: row.kill, row };
    let night = nights.at(-1);
    if (!night || night.date !== row.raid_date) {
      night = { date: row.raid_date, pulls: [], best: null, phase: null, start: total - 1 };
      nights.push(night);
    }
    night.pulls.push(pull);
    night.best = better(night.best, pull);
    const phase = phaseOf(row);
    if (phase && phase.rank > (night.phase?.rank ?? 0)) night.phase = phase;
    if (phase && phase.rank > (furthest?.rank ?? 0)) furthest = { ...phase, date: row.raid_date };
    if (row.kill && !kill) kill = { date: row.raid_date, pull: total };
  }

  return { nights, total, kill, furthest: furthest && { label: furthest.label, date: furthest.date } };
}

export const nightShort = (n: Night) => isoDateShort(n.date);
export const nightLong = (n: Night) => isoDateLong(n.date);
export const pullWord = (n: number) => `${n} ${n === 1 ? 'pull' : 'pulls'}`;
export const bestText = (n: Night) =>
  !n.best || n.best.health === null ? 'n/a' : n.best.kill ? 'Kill' : `${n.best.health}% left`;
// A night's log link: its best pull's own fight in its report.
export const nightLog = (n: Night) => (n.best ? reportUrl(n.best.row.report_code, n.best.row.fight_id) : null);

// The chart's x position of a pull, in percent of the width: the middle of its slot.
export const xPct = (index: number, total: number) => ((index + 0.5) / total) * 100;
