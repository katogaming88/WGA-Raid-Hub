import { useStatus } from '../components/Status';
import { awardDate } from '../lib/dates';
import { classColor } from './roster';
import { specIcon } from './specIcons';
import { ARCHIVE_REASONS } from './useNames';
import { useRestorePlayer, type ArchivedRow } from './useRoster';

const reasonLabel = (value: string | null) => ARCHIVE_REASONS.find((r) => r.value === value)?.label ?? null;

// Officers: everyone archived off the team (#1360 part 3), with when and why,
// and Re-add to roster to put them back as they were.
export function ArchivedRoster({ teamId, rows }: { teamId: number; rows: ArchivedRow[] }) {
  const restore = useRestorePlayer(teamId);
  const { announce } = useStatus();

  if (rows.length === 0) {
    return (
      <div className="card placeholder">
        <p>No one has been archived from this team.</p>
      </div>
    );
  }

  return (
    <div className="roster-main">
      <p className="text-muted">
        Re-add puts a character back on the roster with the same spec and join date. Why they left stays on record.
      </p>
      {restore.isError && (
        <p className="form-error" role="alert">
          That did not go through: {restore.error.message}
        </p>
      )}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable on a phone, as the roster table */}
      <div className="card roster-table-wrap" tabIndex={0} role="region" aria-label="Archived">
        <table className="roster-table archived-table">
          <caption className="visually-hidden">Archived</caption>
          <thead>
            <tr>
              <th scope="col">Raider</th>
              <th scope="col">Archived</th>
              <th scope="col">Why</th>
              <th scope="col">
                <span className="visually-hidden">Re-add</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const [character] = row.name_realm.split('-');
              const name = row.nickname || character!;
              const cls = row.classes_specs?.class ?? '';
              const spec = row.classes_specs?.spec ?? '';
              const icon = specIcon(cls, spec);
              const notes = row.player_officer_notes;
              const reason = reasonLabel(notes?.archived_reason ?? null);
              return (
                <tr key={row.id}>
                  <th scope="row" className="raider-cell">
                    {icon && <img className="spec-icon" src={icon} alt="" width={20} height={20} loading="lazy" />}
                    <span className="raider-name" style={{ color: classColor(cls) }}>
                      {name}
                    </span>
                    {row.nickname && <span className="raider-character">{character}</span>}
                    {(spec || cls) && (
                      <span className="raider-spec">
                        {spec} {cls}
                      </span>
                    )}
                  </th>
                  <td className="num">{awardDate(row.archived_at)}</td>
                  <td className="archived-why">
                    {reason || notes?.archived_reason_detail ? (
                      <>
                        {reason && <span className="status-tag">{reason}</span>}
                        {notes?.archived_reason_detail && (
                          <span className="archived-detail">{notes.archived_reason_detail}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-dim">No reason recorded</span>
                    )}
                  </td>
                  <td className="status-cell">
                    <button
                      type="button"
                      className="button"
                      disabled={restore.isPending}
                      onClick={() =>
                        restore.mutate(
                          { playerId: row.id, name },
                          { onSuccess: () => announce('success', `${name} is back on the roster.`) }
                        )
                      }
                    >
                      Re-add to roster<span className="visually-hidden">: {name}</span>
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
