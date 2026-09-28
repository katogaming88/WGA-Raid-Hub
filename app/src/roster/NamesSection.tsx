import { useId, useState, type FormEvent } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useSession } from '../auth/session';
import { toNames, type NameEntry } from './names';
import {
  useCreateName,
  useDeleteTeamMember,
  useNames,
  useRemoveNameClaim,
  useRenameName,
  useClaimName
} from './useNames';

// Bare and claimed Names (#1355): self-service Claim for anyone signed in,
// create/rename/remove-claim/delete for officers. No display name is shown
// for who holds a claimed row -- nothing readable exposes one person's
// identity to another team member yet, only "Claimed" or "Not yet claimed".
export function NamesSection({ teamId, officer }: { teamId: number; officer: boolean }) {
  const names = useNames(teamId);

  return (
    <section className="card names-section" aria-labelledby="names-title">
      <h2 id="names-title" className="side-title">
        Names
      </h2>
      <DataState query={names} label="the team's Names">
        {(rows) => <NamesList teamId={teamId} officer={officer} entries={toNames(rows)} />}
      </DataState>
      {officer && <CreateNameForm teamId={teamId} />}
    </section>
  );
}

function NamesList({ teamId, officer, entries }: { teamId: number; officer: boolean; entries: NameEntry[] }) {
  if (entries.length === 0) return <p className="text-muted">No Names on this team yet.</p>;
  return (
    <ul className="names-list">
      {entries.map((entry) => (
        <NameRow key={entry.id} teamId={teamId} officer={officer} entry={entry} />
      ))}
    </ul>
  );
}

function NameRow({ teamId, officer, entry }: { teamId: number; officer: boolean; entry: NameEntry }) {
  const { user } = useSession();
  const { announce } = useStatus();
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const claim = useClaimName(teamId);
  const removeClaim = useRemoveNameClaim(teamId);
  const deleteMember = useDeleteTeamMember(teamId);

  const onClaim = () =>
    claim.mutate({ nameId: entry.id }, { onSuccess: () => announce('success', `Claimed ${entry.label}.`) });

  const onRemoveClaim = () =>
    removeClaim.mutate(
      { nameId: entry.id },
      { onSuccess: () => announce('success', `${entry.label} is unclaimed again.`) }
    );

  return (
    <li className="names-row">
      {renaming ? (
        <RenameForm teamId={teamId} entry={entry} onDone={() => setRenaming(false)} />
      ) : (
        <>
          <span className="names-label">{entry.label}</span>
          <span className={entry.status === 'claimed' ? 'status-tag status-claimed' : 'status-tag'}>
            {entry.status === 'claimed' ? 'Claimed' : 'Not yet claimed'}
          </span>
          <span className="names-actions">
            {entry.status === 'bare' && user && (
              <button type="button" className="button" disabled={claim.isPending} onClick={onClaim}>
                {claim.isPending ? 'Claiming…' : 'Claim'}
              </button>
            )}
            {officer && (
              <>
                <button type="button" className="link-button" onClick={() => setRenaming(true)}>
                  Edit
                </button>
                {entry.status === 'claimed' && (
                  <button
                    type="button"
                    className="link-button"
                    disabled={removeClaim.isPending}
                    onClick={onRemoveClaim}
                  >
                    Remove claim
                  </button>
                )}
                {entry.team_member_id !== null && (
                  <button type="button" className="link-button" onClick={() => setConfirmDelete(true)}>
                    Delete Member
                  </button>
                )}
              </>
            )}
          </span>
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
        </>
      )}
      {confirmDelete && entry.team_member_id !== null && (
        <Dialog title={`Delete ${entry.label}?`} onClose={() => setConfirmDelete(false)} busy={deleteMember.isPending}>
          <p className="text-muted">
            This removes {entry.label} from the team outright, for someone who left. This cannot be undone from here.
          </p>
          {deleteMember.isError && (
            <p className="form-error" role="alert">
              That did not save: {deleteMember.error.message}
            </p>
          )}
          <div className="dialog-actions">
            <span className="grow" />
            <button
              type="button"
              className="button"
              onClick={() => setConfirmDelete(false)}
              disabled={deleteMember.isPending}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button"
              disabled={deleteMember.isPending}
              onClick={() =>
                deleteMember.mutate(
                  { teamMemberId: entry.team_member_id! },
                  {
                    onSuccess: () => {
                      setConfirmDelete(false);
                      announce('success', `${entry.label} removed from the team.`);
                    }
                  }
                )
              }
            >
              {deleteMember.isPending ? 'Deleting…' : 'Delete Member'}
            </button>
          </div>
        </Dialog>
      )}
    </li>
  );
}

function RenameForm({ teamId, entry, onDone }: { teamId: number; entry: NameEntry; onDone: () => void }) {
  const id = useId();
  const [label, setLabel] = useState(entry.label);
  const rename = useRenameName(teamId);
  const { announce } = useStatus();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    rename.mutate(
      { nameId: entry.id, label: trimmed },
      {
        onSuccess: () => {
          announce('success', 'Name updated.');
          onDone();
        }
      }
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="names-rename-form">
      <label className="visually-hidden" htmlFor={`${id}-label`}>
        Name
      </label>
      <input
        id={`${id}-label`}
        className="input"
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      {rename.isError && (
        <p className="form-error" role="alert">
          That did not save: {rename.error.message}
        </p>
      )}
      <button type="submit" className="button button-primary" disabled={rename.isPending}>
        {rename.isPending ? 'Saving…' : 'Save'}
      </button>
      <button type="button" className="button" onClick={onDone} disabled={rename.isPending}>
        Cancel
      </button>
    </form>
  );
}

function CreateNameForm({ teamId }: { teamId: number }) {
  const id = useId();
  const [label, setLabel] = useState('');
  const create = useCreateName(teamId);
  const { announce } = useStatus();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    create.mutate(
      { label: trimmed },
      {
        onSuccess: () => {
          announce('success', `${trimmed} added.`);
          setLabel('');
        }
      }
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="names-create-form">
      <div className="field">
        <label className="field-label" htmlFor={`${id}-new-label`}>
          Add a bare Name
        </label>
        <input
          id={`${id}-new-label`}
          className="input"
          type="text"
          placeholder="Raider's display name"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      {create.isError && (
        <p className="form-error" role="alert">
          That did not save: {create.error.message}
        </p>
      )}
      <button type="submit" className="button" disabled={create.isPending || !label.trim()}>
        {create.isPending ? 'Adding…' : 'Add Name'}
      </button>
    </form>
  );
}
