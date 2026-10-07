import { useCallback, useId, useRef, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { Menu, type MenuAction } from '../components/Menu';
import { useStatus } from '../components/Status';
import { useSession } from '../auth/session';
import { ROLE_LABELS, ROLE_ORDER } from './roster';
import {
  ARCHIVE_REASONS,
  useArchiveTeamMember,
  useClaimName,
  useDeleteName,
  useRemoveNameClaim,
  useRenameName
} from './useNames';

// A roster row's actions (#1355), all behind one "..." menu (Kat, 2026-09-29):
// Claim on a bare row (anyone signed in), Edit/Remove claim/Archive Member
// once claimed, Edit/Delete Name while still bare, and Archive Member alone on
// a member's row with no Name. Everything but Claim is officer-only. No menu
// at all when nothing in it applies (a raider looking at an already-claimed
// row).
export function NameRowActions({
  teamId,
  officer,
  nameId,
  label,
  role,
  teamMemberId
}: {
  teamId: number;
  officer: boolean;
  // Null on a member's row that holds no Name.
  nameId: number | null;
  label: string;
  // The raid role guess a bare Name carries; meaningless once claimed.
  role?: string | null;
  teamMemberId: number | null;
}) {
  const { user } = useSession();
  const { announce } = useStatus();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // The roster table this row sits in, learned once when the row mounts: when
  // a write takes the row away, focus goes to the table instead of falling to
  // the page itself.
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const wrapRef = useCallback((el: HTMLSpanElement | null) => {
    if (el) setRegion(el.closest<HTMLElement>('[role="region"]'));
  }, []);
  const refocus = () => {
    window.setTimeout(() => {
      if (region?.isConnected && document.activeElement === document.body) region.focus();
    }, 0);
  };
  const claim = useClaimName(teamId, refocus);
  const removeClaim = useRemoveNameClaim(teamId, refocus);
  const deleteName = useDeleteName(teamId, refocus);

  const menuActions: MenuAction[] = [];
  if (nameId !== null && teamMemberId === null && user) {
    menuActions.push({
      label: claim.isPending ? 'Claiming…' : 'Claim',
      disabled: claim.isPending,
      onSelect: () => claim.mutate({ nameId }, { onSuccess: () => announce('success', `Claimed ${label}.`) })
    });
  }
  if (officer && nameId !== null) {
    menuActions.push({ label: 'Edit', onSelect: () => setEditing(true) });
    if (teamMemberId !== null) {
      menuActions.push({
        label: 'Remove claim',
        disabled: removeClaim.isPending,
        onSelect: () =>
          removeClaim.mutate(
            { nameId, label, teamMemberId },
            { onSuccess: () => announce('success', `${label} is unclaimed again.`) }
          )
      });
    }
  }
  if (officer && (teamMemberId !== null || nameId !== null)) {
    menuActions.push({
      label: teamMemberId !== null ? 'Archive Member' : 'Delete Member',
      onSelect: () => {
        // A failure from an earlier try is not this one's.
        deleteName.reset();
        setConfirmDelete(true);
      }
    });
  }

  if (menuActions.length === 0) return null;

  return (
    <span className="name-actions" ref={wrapRef}>
      <Menu label={`More actions for ${label}`} actions={menuActions} />
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
      {editing && nameId !== null && (
        <RenameDialog
          teamId={teamId}
          nameId={nameId}
          label={label}
          role={role ?? null}
          bare={teamMemberId === null}
          onClose={() => setEditing(false)}
          onRenamed={refocus}
        />
      )}
      {confirmDelete && teamMemberId !== null && (
        <ArchiveMemberDialog
          teamId={teamId}
          teamMemberId={teamMemberId}
          label={label}
          hasName={nameId !== null}
          onClose={() => setConfirmDelete(false)}
          onArchived={refocus}
        />
      )}
      {confirmDelete && teamMemberId === null && nameId !== null && (
        <DeleteNameDialog
          label={label}
          busy={deleteName.isPending}
          error={deleteName.error?.message ?? null}
          onCancel={() => setConfirmDelete(false)}
          onDelete={() =>
            deleteName.mutate(
              { nameId, label },
              {
                onSuccess: () => {
                  setConfirmDelete(false);
                  announce('success', `${label} removed.`);
                }
              }
            )
          }
        />
      )}
    </span>
  );
}

function DeleteNameDialog({
  label,
  busy,
  error,
  onCancel,
  onDelete
}: {
  label: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <Dialog title={`Delete ${label}?`} onClose={onCancel} busy={busy}>
      <p className="text-muted">This deletes the unclaimed Member "{label}". This cannot be undone from here.</p>
      {error && (
        <p className="form-error" role="alert">
          That did not save: {error}
        </p>
      )}
      <div className="dialog-actions">
        <span className="grow" />
        <button type="button" className="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="button" disabled={busy} onClick={onDelete}>
          {busy ? 'Saving…' : 'Delete Member'}
        </button>
      </div>
    </Dialog>
  );
}

// Someone left. Takes a reason and a detail, the same two archive_player()
// takes on the Roster tab (js/tabs/tab-roster.js) -- this ends the whole
// membership and their active characters instead of one character, but
// officers already know this vocabulary from removing a character there.
function ArchiveMemberDialog({
  teamId,
  teamMemberId,
  label,
  hasName,
  onClose,
  onArchived
}: {
  teamId: number;
  teamMemberId: number;
  label: string;
  // A member's row with no Name has none to keep.
  hasName: boolean;
  onClose: () => void;
  // Runs once the archive is done, even if this row has gone by then.
  onArchived: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const archiveMember = useArchiveTeamMember(teamId, onArchived);
  const { announce } = useStatus();
  const selectRef = useRef<HTMLSelectElement>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = detail.trim();
    if (!reason || !trimmed) return;
    archiveMember.mutate(
      { teamMemberId, reason, detail: trimmed },
      {
        onSuccess: () => {
          announce('success', `${label} archived.`);
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title={`Archive ${label}?`} onClose={onClose} busy={archiveMember.isPending} initialFocus={selectRef}>
      <p className="text-muted">
        {label} and their characters leave the active roster, for someone who left. Their history stays -- their{' '}
        {hasName && 'name, '}loot and attendance are not deleted, and an officer can bring them back.
      </p>
      <form onSubmit={onSubmit} noValidate className="archive-reason-form">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-reason`}>
            Reason
          </label>
          <select
            id={`${id}-reason`}
            ref={selectRef}
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Reason…</option>
            {ARCHIVE_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-detail`}>
            Detail
          </label>
          <input
            id={`${id}-detail`}
            className="input"
            type="text"
            placeholder="Details…"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </div>
        {archiveMember.isError && (
          <p className="form-error" role="alert">
            That did not save: {archiveMember.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={archiveMember.isPending}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={archiveMember.isPending || !reason || !detail.trim()}>
            {archiveMember.isPending ? 'Saving…' : 'Archive Member'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RenameDialog({
  teamId,
  nameId,
  label,
  role,
  bare,
  onClose,
  onRenamed
}: {
  teamId: number;
  nameId: number;
  label: string;
  role: string | null;
  // Role only means anything while the Name has no claimed membership --
  // once claimed, a character's own class_spec_id decides it instead.
  bare: boolean;
  onClose: () => void;
  // Runs once the rename is done, even if a new role moved the row by then.
  onRenamed: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(label);
  const [roleValue, setRoleValue] = useState(role ?? '');
  const rename = useRenameName(teamId, onRenamed);
  const { announce } = useStatus();
  const inputRef = useRef<HTMLInputElement>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    rename.mutate(
      { nameId, label: trimmed, previousLabel: label, ...(bare ? { role: roleValue || null } : {}) },
      {
        onSuccess: () => {
          announce('success', 'Member updated.');
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title="Edit Member" onClose={onClose} busy={rename.isPending} initialFocus={inputRef}>
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
        {bare && (
          <div className="field">
            <label className="field-label" htmlFor={`${id}-role`}>
              Role (optional, until they have a character)
            </label>
            <select
              id={`${id}-role`}
              className="input"
              value={roleValue}
              onChange={(e) => setRoleValue(e.target.value)}
            >
              <option value="">Not sure yet</option>
              {ROLE_ORDER.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>
        )}
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
