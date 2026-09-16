import { useId, useState } from 'react';
import { DataState } from '../components/DataState';
import { useStatus } from '../components/Status';
import { askedAgo, characterName, specLabel, type ReviewRow } from './mainSwap';
import { useReviewMainSwap, useTeamMainSwaps } from './useMainSwaps';
import './characters.css';

// Main swaps waiting for this team's officers (#631), on the roster page,
// where officers already look at the team (Kat, 2026-09-16). It moves to the
// Reviews page when that page is built.
//
// Nothing shows when nothing is waiting, and nobody but an officer reads it.
export function MainSwapReviews({ teamId, officer }: { teamId: number; officer: boolean }) {
  const waiting = useTeamMainSwaps(teamId, officer);
  if (!officer) return null;
  if (waiting.isError) {
    return (
      <DataState query={waiting} label="main swaps">
        {() => null}
      </DataState>
    );
  }
  if (!waiting.isSuccess || waiting.data.length === 0) return null;

  return (
    <section className="card main-swaps" aria-labelledby="main-swaps-title">
      <h2 id="main-swaps-title" className="card-title">
        {waiting.data.length === 1 ? '1 main swap to review' : `${waiting.data.length} main swaps to review`}
      </h2>
      <ul className="main-swap-list">
        {waiting.data.map((row) => (
          <SwapReview key={row.id} row={row} teamId={teamId} />
        ))}
      </ul>
    </section>
  );
}

function SwapReview({ row, teamId }: { row: ReviewRow; teamId: number }) {
  const { announce } = useStatus();
  const review = useReviewMainSwap(teamId);
  const id = useId();
  const [note, setNote] = useState('');
  const from = characterName(row.from_player?.name_realm ?? 'Their character');

  const decide = (approve: boolean) =>
    review.mutate(
      { requestId: row.id, approve, note: note.trim() },
      {
        onSuccess: () => {
          announce(
            'success',
            approve ? `${from} is now raiding as ${row.name_realm}.` : `Turned down the swap to ${row.name_realm}.`
          );
        }
      }
    );

  return (
    <li className="main-swap-row">
      <div className="main-swap-text">
        <p className="main-swap-line">
          <strong>{from}</strong> to <strong>{row.name_realm}</strong>
          <span className="text-muted"> · {specLabel(row.classes_specs)}</span>
        </p>
        <p className="text-muted main-swap-when">{askedAgo(row.requested_at)}</p>
        {row.note && <p className="main-swap-note">“{row.note}”</p>}
      </div>
      <div className="main-swap-actions">
        <label className="visually-hidden" htmlFor={`${id}-note`}>
          Note back to {from} (optional)
        </label>
        <input
          id={`${id}-note`}
          className="input"
          value={note}
          placeholder="Note back to the raider (optional)"
          onChange={(e) => setNote(e.target.value)}
          disabled={review.isPending}
        />
        <button
          type="button"
          className="button button-primary"
          onClick={() => decide(true)}
          disabled={review.isPending}
        >
          Approve
        </button>
        <button type="button" className="button" onClick={() => decide(false)} disabled={review.isPending}>
          Decline
        </button>
      </div>
      {review.isError && (
        <p className="form-error" role="alert">
          That did not go through: {review.error.message}
        </p>
      )}
    </li>
  );
}
