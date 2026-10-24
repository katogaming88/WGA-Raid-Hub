import { CharacterIcon } from '../characters/CharacterIcon';
import { classColor } from '../roster/roster';
import { CHANGE_UNTIL_CLOSE } from './signup';
import type { OwnSignupRow } from './useSignup';

const STATUS_LABEL: Record<OwnSignupRow['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Denied',
  added: 'Rostered'
};

// The raider's own signup (#500): shown instead of a fresh form once one
// exists for the tier. Since #1466 it leads with the character, as the
// form's list shows it, and lays the rest out as labelled rows (Kat: the
// plain lines were bland).
export function SignupSummary({
  row,
  seasonName,
  onEdit
}: {
  row: OwnSignupRow;
  seasonName: string;
  onEdit: () => void;
}) {
  const statusClass =
    row.status === 'pending' || row.status === 'approved' ? 'signup-status-open' : 'signup-status-closed';
  const displayClass = row.main_swap ? row.swap_class : row.class;
  const displaySpec = row.main_swap ? row.swap_spec : row.spec;
  const [name, realm] = splitNameRealm(row.signup_name_realm);
  const offSpecs = (row.off_specs ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const backups = [row.is_backup_tank && 'Backup tank', row.is_backup_healer && 'Backup heal'].filter(Boolean);

  return (
    <div className="signup-summary">
      <div className="signup-summary-head">
        <div>
          <h2>Your signup</h2>
          <p className="text-muted">{seasonName}</p>
        </div>
        <span className={`status-tag ${statusClass}`}>{STATUS_LABEL[row.status]}</span>
      </div>

      <div className="signup-summary-character">
        <CharacterIcon className={displayClass} spec={displaySpec} size={48} />
        <div>
          <p className="signup-summary-name" style={displayClass ? { color: classColor(displayClass) } : undefined}>
            {name}
          </p>
          <p className="text-muted">
            {realm && `${realm} · `}
            {displaySpec ? `${displaySpec} ${displayClass}` : (displayClass ?? '–')}
          </p>
        </div>
      </div>
      {row.main_swap && row.swap_from_name_realm && (
        <p className="signup-reading signup-reading-new">New main: replaces {row.swap_from_name_realm}</p>
      )}

      <dl className="signup-summary-facts">
        <dt>Off specs</dt>
        <dd>
          {offSpecs.length ? (
            <span className="signup-summary-tags">
              {offSpecs.map((s) => (
                <span key={s} className="signup-summary-tag">
                  <CharacterIcon className={displayClass} spec={s} size={18} />
                  {s}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted">None</span>
          )}
        </dd>
        <dt>Backup roles</dt>
        <dd>
          {backups.length ? (
            <span className="signup-summary-tags">
              {backups.map((b) => (
                <span key={b as string} className="signup-summary-tag">
                  {b}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-muted">None</span>
          )}
        </dd>
        {row.player_note && (
          <>
            <dt>Note</dt>
            <dd>{row.player_note}</dd>
          </>
        )}
      </dl>

      {(row.status === 'pending' || row.status === 'approved') && <p className="text-muted">{CHANGE_UNTIL_CLOSE}</p>}
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

// "Leafy-Stormrage" -> ["Leafy", "Stormrage"]; the realm is everything after
// the first dash, so "Area 52" and hyphenated realms stay whole.
function splitNameRealm(nameRealm: string): [string, string] {
  const i = nameRealm.indexOf('-');
  return i < 0 ? [nameRealm, ''] : [nameRealm.slice(0, i), nameRealm.slice(i + 1)];
}
