import { useId, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useSession } from '../auth/session';
import { useClaimName, useDeleteName, useDeleteTeamMember, useRemoveNameClaim, useRenameName } from './useNames';

// A Name's actions (#1355), embedded in its own roster row rather than a
// separate list: Claim on a bare row (anyone signed in), Edit/Remove
// claim/Delete Member once claimed, Edit/Delete Name while still bare.
// Everything but Claim is officer-only.
export function NameRowActions({
  teamId,
  officer,
  nameId,
  label,
  teamMemberId
}: {
  teamId: number;
  officer: boolean;
  nameId: number;
  label: string;
  teamMemberId: number | null;
}) {
  const { user } = useSession();
  const { announce } = useStatus();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const claim = useClaimName(teamId);
  const removeClaim = useRemoveNameClaim(teamId);
  const deleteMember = useDeleteTeamMember(teamId);
  const deleteName = useDeleteName(teamId);
  const deleting = teamMemberId !== null ? deleteMember : deleteName;

  if (!officer && teamMemberId !== null) return null;

  const onDeleted = () => {
    setConfirmDelete(false);
    announce('success', `${label} removed.`);
  };
  const onDelete = () =>
    teamMemberId !== null
      ? deleteMember.mutate({ teamMemberId }, { onSuccess: onDeleted })
      : deleteName.mutate({ nameId }, { onSuccess: onDeleted });

  return (
    <span className="name-actions">
      {teamMemberId === null && user && (
        <button
          type="button"
          className="button"
          disabled={claim.isPending}
          onClick={() => claim.mutate({ nameId }, { onSuccess: () => announce('success', `Claimed ${label}.`) })}
        >
          {claim.isPending ? 'Claiming…' : 'Claim'}
        </button>
      )}
      {officer && (
        <>
          <button type="button" className="link-button" onClick={() => setEditing(true)}>
            Edit
          </button>
          {teamMemberId !== null && (
            <button
              type="button"
              className="link-button"
              disabled={removeClaim.isPending}
              onClick={() =>
                removeClaim.mutate({ nameId }, { onSuccess: () => announce('success', `${label} is unclaimed again.`) })
              }
            >
              Remove claim
            </button>
          )}
          <button type="button" className="link-button" onClick={() => setConfirmDelete(true)}>
            {teamMemberId !== null ? 'Delete Member' : 'Delete Name'}
          </button>
        </>
      )}
      {claim.isError && (
        <p className="form-error" role="alert">
          That did not save: {claim.error.message}
        </p>
      )}
      {removeClaim.isError && (
        <p className="form-error" role="alert">
          That did not save: {removeClaim.error.message}
        </p>
      )}
      {editing && <RenameDialog teamId={teamId} nameId={nameId} label={label} onClose={() => setEditing(false)} />}
      {confirmDelete && (
        <Dialog title={`Delete ${label}?`} onClose={() => setConfirmDelete(false)} busy={deleting.isPending}>
          <p className="text-muted">
            {teamMemberId !== null
              ? `This removes ${label} from the team outright, for someone who left. This cannot be undone from here.`
              : `This deletes the bare Name "${label}". This cannot be undone from here.`}
          </p>
          {deleting.isError && (
            <p className="form-error" role="alert">
              That did not save: {deleting.error.message}
            </p>
          )}
          <div className="dialog-actions">
            <span className="grow" />
            <button
              type="button"
              className="button"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting.isPending}
            >
              Cancel
            </button>
            <button type="button" className="button" disabled={deleting.isPending} onClick={onDelete}>
              {deleting.isPending ? 'Deleting…' : teamMemberId !== null ? 'Delete Member' : 'Delete Name'}
            </button>
          </div>
        </Dialog>
      )}
    </span>
  );
}

function RenameDialog({
  teamId,
  nameId,
  label,
  onClose
}: {
  teamId: number;
  nameId: number;
  label: string;
  onClose: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(label);
  const rename = useRenameName(teamId);
  const { announce } = useStatus();
  const inputRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    rename.mutate(
      { nameId, label: trimmed },
      {
        onSuccess: () => {
          announce('success', 'Name updated.');
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title="Edit Name" onClose={onClose} busy={rename.isPending} initialFocus={inputRef}>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-label`}>
            Name
          </label>
          <input
            id={`${id}-label`}
            ref={inputRef}
            className="input"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
        {rename.isError && (
          <p className="form-error" role="alert">
            That did not save: {rename.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={rename.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={rename.isPending}>
            {rename.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
