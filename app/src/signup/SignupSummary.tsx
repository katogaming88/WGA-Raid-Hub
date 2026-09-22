import { seasonName } from '../profile/profile';
import type { OwnSignupRow } from './useSignup';

const STATUS_LABEL: Record<OwnSignupRow['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Denied',
  added: 'Rostered'
};

// The raider's own signup (#500): shown instead of a fresh form once one
// exists for the tier. Ported from js/signup.js's renderSignupSummary().
export function SignupSummary({ row, tier, onEdit }: { row: OwnSignupRow; tier: string; onEdit: () => void }) {
  const statusClass =
    row.status === 'pending' || row.status === 'approved' ? 'signup-status-open' : 'signup-status-closed';
  const displayClass = row.main_swap ? row.swap_class : row.class;
  const displaySpec = row.main_swap ? row.swap_spec : row.spec;

  return (
    <div className="signup-summary">
      <h2>Your signup</h2>
      <p className="text-muted">{seasonName(tier)}</p>
      <p>
        <span className={`status-tag ${statusClass}`}>{STATUS_LABEL[row.status]}</span>
      </p>
      <p>
        <strong>{row.signup_name_realm}</strong> &mdash;{' '}
        {displaySpec ? `${displaySpec} ${displayClass}` : (displayClass ?? '–')}
      </p>
      {row.main_swap && row.swap_from_name_realm && (
        <p className="text-muted">Switching from {row.swap_from_name_realm}.</p>
      )}
      {row.off_specs && <p className="text-muted">Off-specs: {row.off_specs}</p>}
      {row.player_note && <p className="text-muted">Note: {row.player_note}</p>}
      <div className="signup-actions">
        {(row.status === 'pending' || row.status === 'approved') && (
          <button type="button" className="button button-primary" onClick={onEdit}>
            Edit signup
          </button>
        )}
        {row.status === 'added' && (
          <>
            <p className="text-muted">
              You are on the roster for this season. You can still update your signup while signups are open; it will go
              back to an officer for review.
            </p>
            <button type="button" className="button button-primary" onClick={onEdit}>
              Edit signup
            </button>
          </>
        )}
        {row.status === 'rejected' && (
          <p className="text-muted">
            This signup was not approved. Contact an officer on Discord if you have questions.
          </p>
        )}
      </div>
    </div>
  );
}
