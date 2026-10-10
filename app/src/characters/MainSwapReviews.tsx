import { useId, useState } from 'react';
import { useStatus } from '../components/Status';
import { askedAgo, characterName, specLabel, type ReviewRow } from './mainSwap';
import { useReviewMainSwap } from './useMainSwaps';
import './characters.css';

// One main swap waiting for this team's officers (#631), as a line in the
// roster's Needs a look box (#1360). It moves to the Reviews page when that
// page is built.
export function SwapReview({ row, teamId }: { row: ReviewRow; teamId: number }) {
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
    <li className="look-row">
      <div className="main-swap-text">
        <p className="main-swap-line">
          <strong>{from}</strong> asks to raid as <strong>{row.name_realm}</strong>
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
        <span className="main-swap-buttons">
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
        </span>
      </div>
      {review.isError && (
        <p className="form-error" role="alert">
          That did not go through: {review.error.message}
        </p>
      )}
    </li>
  );
}
