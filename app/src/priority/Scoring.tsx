import { useEffect, useId, useRef, useState } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { classColor, firstName, type PlayerRow } from '../roster/roster';
import { committedScores, parseOutOf100, pending, scored, showOutOf100, sortScores, type PerfScore } from './priority';
import { useCommitPerformance, useFetchPerformance, useScoring, type Metric } from './usePriority';

// Scores fetched or edited and not committed yet. Kept by the page, so
// looking at another tab loses nothing.
export type ScoreDraft = { scores: PerfScore[]; note: string };

const METRIC_LABEL: Record<Metric, string> = { bracket: 'Item level bracket %', overall: 'Overall %' };

// The Scoring tab (#1362 part 5, mockup on the canvas): each raider's Warcraft
// Logs performance, fetched on demand, edited by hand where it is wrong, and
// committed as the score Suggest order uses. Out of 100 (Kat, 2026-10-18).
export function ScoringTab({
  teamId,
  season,
  players,
  officer,
  draft,
  onDraft
}: {
  teamId: number;
  season: string;
  players: PlayerRow[];
  officer: boolean;
  draft: ScoreDraft | null;
  onDraft: (draft: ScoreDraft | null) => void;
}) {
  const saved = useScoring(teamId, season);
  return (
    <DataState query={saved} label="the scores">
      {(rows) => (
        <Scores
          teamId={teamId}
          season={season}
          players={players}
          officer={officer}
          committed={committedScores(players, rows)}
          saved={new Map(rows.map((r) => [r.player_id, r.performance_score ?? r.recent_score]))}
          draft={draft}
          onDraft={onDraft}
        />
      )}
    </DataState>
  );
}

function Scores({
  teamId,
  season,
  players,
  officer,
  committed,
  saved,
  draft,
  onDraft
}: {
  teamId: number;
  season: string;
  players: PlayerRow[];
  officer: boolean;
  committed: PerfScore[];
  saved: ReadonlyMap<number, number | null>;
  draft: ScoreDraft | null;
  onDraft: (draft: ScoreDraft | null) => void;
}) {
  const { announce } = useStatus();
  const fetchScores = useFetchPerformance(teamId);
  const commit = useCommitPerformance(teamId, season);
  const [metric, setMetric] = useState<Metric>('bracket');
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const metricId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  // After typing a score, focus goes back to that raider's Edit button.
  const focusEdit = useRef<number | null>(null);
  useEffect(() => {
    const id = focusEdit.current;
    if (id === null) return;
    focusEdit.current = null;
    tableRef.current?.querySelector<HTMLButtonElement>(`button[data-edit="${id}"]`)?.focus();
  });
  const byId = new Map(players.map((p) => [p.id, p]));
  // A raider wcl-sync scored who is not on the roster any more is left out.
  const scores = sortScores((draft?.scores ?? committed).filter((s) => byId.has(s.playerId)));
  const toCommit = scores.filter((s) => pending(s, saved));

  const setRecent = (playerId: number, recent: number) =>
    onDraft({
      note: draft?.note ?? '',
      scores: scores.map((s) => (s.playerId === playerId ? { ...s, recent, noData: false, usedTrend: false } : s))
    });

  const onFetch = () =>
    fetchScores.mutate(metric, {
      onSuccess: (r) => {
        const note = `${r.updated} ${r.updated === 1 ? 'raider' : 'raiders'} updated (${r.recentReports} recent / ${r.trendReports} trend reports, ${METRIC_LABEL[metric]}). Not committed yet.`;
        onDraft({ scores: r.scores, note });
        announce('success', note);
      },
      onError: (error) => announce('error', errorMessage(error))
    });

  const onCommit = () =>
    commit.mutate(toCommit, {
      onSuccess: (n) => {
        setConfirming(false);
        onDraft(null);
        announce(
          'success',
          `Committed ${n} ${n === 1 ? "raider's score" : "raiders' scores"}. Suggest order uses them now.`
        );
      },
      onError: (error) => announce('error', errorMessage(error))
    });

  return (
    <div className="priority-scoring">
      <p className="text-muted">
        Warcraft Logs performance for each raider, out of 100. Suggest order uses the committed Recent score. Healers
        and tanks are left out: their priority comes from attendance.
      </p>
      {officer && (
        <div className="priority-scoring-controls">
          <label className="priority-scoring-metric" htmlFor={metricId}>
            <span className="field-label">Measure</span>
            <select
              id={metricId}
              className="select"
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
            >
              {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="button" disabled={fetchScores.isPending} onClick={onFetch}>
            {fetchScores.isPending ? 'Fetching… (about a minute)' : 'Fetch from Warcraft Logs'}
          </button>
          {draft?.note && <span className="priority-scoring-note">{draft.note}</span>}
          {draft && (
            <button type="button" className="button priority-scoring-push" onClick={() => onDraft(null)}>
              Undo changes
            </button>
          )}
          <button
            type="button"
            className={draft ? 'button button-primary' : 'button button-primary priority-scoring-push'}
            disabled={toCommit.length === 0 || commit.isPending}
            onClick={() => setConfirming(true)}
          >
            {toCommit.length
              ? `Commit ${toCommit.length} ${toCommit.length === 1 ? 'score' : 'scores'}`
              : 'Commit scores'}
          </button>
        </div>
      )}

      {scores.length === 0 ? (
        <div className="card placeholder">
          <p>Nobody on the roster yet.</p>
        </div>
      ) : (
        <div className="card priority-scoring-table-wrap">
          <table ref={tableRef} className="priority-scoring-table">
            <caption className="visually-hidden">Performance scores, out of 100</caption>
            <thead>
              <tr>
                <th scope="col">Raider</th>
                <th scope="col">Recent</th>
                <th scope="col">Trend</th>
                <th scope="col">Best (all)</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => {
                const p = byId.get(s.playerId)!;
                const name = p.nickname?.trim() || firstName(p.name_realm);
                const klass = p.classes_specs?.class;
                return (
                  <tr key={s.playerId}>
                    <th scope="row" style={klass ? { color: classColor(klass) } : undefined}>
                      {name}
                    </th>
                    {!scored(s) ? (
                      <td colSpan={3} className="text-muted">
                        Left out ({s.role === 'healer' ? 'healer' : 'tank'})
                      </td>
                    ) : (
                      <>
                        <td>
                          {editing === s.playerId ? (
                            <ScoreInput
                              name={name}
                              score={s.recent}
                              onDone={(value) => {
                                setEditing(null);
                                focusEdit.current = s.playerId;
                                if (value === undefined) return;
                                if (value === null) announce('error', 'A score is a number from 0 to 100.');
                                else setRecent(s.playerId, value);
                              }}
                            />
                          ) : (
                            <span className="priority-scoring-cell">
                              <span className={`priority-score-num ${tone(s.recent)}`}>
                                {s.recent === null ? 'No data' : showOutOf100(s.recent)}
                              </span>
                              {s.usedTrend && <span className="text-muted">(trend fallback)</span>}
                              {pending(s, saved) && <span className="priority-unsaved">Not committed</span>}
                              {officer && (
                                <button
                                  type="button"
                                  className="button priority-scoring-small"
                                  data-edit={s.playerId}
                                  aria-label={`Edit ${name}'s Recent score`}
                                  onClick={() => setEditing(s.playerId)}
                                >
                                  Edit
                                </button>
                              )}
                            </span>
                          )}
                        </td>
                        <td className={`priority-score-num ${tone(s.trend)}`}>{showOutOf100(s.trend)}</td>
                        <td>
                          <span className="priority-scoring-cell">
                            <span className="priority-score-num">{showOutOf100(s.best)}</span>
                            {officer && s.best !== null && s.best !== s.recent && (
                              <button
                                type="button"
                                className="button priority-scoring-small"
                                aria-label={`Use ${name}'s best score as Recent`}
                                onClick={() => setRecent(s.playerId, s.best!)}
                              >
                                Use
                              </button>
                            )}
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirming && (
        <Dialog title="Commit performance scores?" onClose={() => setConfirming(false)} busy={commit.isPending}>
          <p>
            {toCommit.length} {toCommit.length === 1 ? "raider's Recent score is" : "raiders' Recent scores are"} saved
            as the score Suggest order uses. Orders already saved don't change until someone suggests them again.
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => setConfirming(false)} disabled={commit.isPending}>
              Cancel
            </button>
            <button type="button" className="button button-primary" onClick={onCommit} disabled={commit.isPending}>
              {commit.isPending ? 'Committing…' : 'Commit'}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

const tone = (score: number | null) =>
  score === null ? 'text-muted' : score >= 7 ? 'score-good' : score >= 5 ? 'score-mid' : 'score-low';

// Typing a Recent score by hand, out of 100. Enter or leaving the box keeps
// it, Escape drops it. `undefined` means nothing changed; `null` means it was
// not a score.
function ScoreInput({
  name,
  score,
  onDone
}: {
  name: string;
  score: number | null;
  onDone: (value: number | null | undefined) => void;
}) {
  const [text, setText] = useState(score === null ? '' : showOutOf100(score));
  const cancelled = useRef(false);
  return (
    <input
      className="input priority-score-input"
      type="number"
      inputMode="decimal"
      min={0}
      max={100}
      step={0.1}
      aria-label={`${name}'s Recent score, out of 100`}
      // Opened on purpose by its Edit button, so it takes focus.
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (cancelled.current || text.trim() === '' || text === (score === null ? '' : showOutOf100(score))) {
          onDone(undefined);
          return;
        }
        onDone(parseOutOf100(text));
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          // Without this the key would reach the button focus lands on.
          e.preventDefault();
          cancelled.current = e.key === 'Escape';
          e.currentTarget.blur();
        }
      }}
    />
  );
}
