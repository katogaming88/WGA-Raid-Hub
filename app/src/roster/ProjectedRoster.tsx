import { useState } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { errorMessage } from '../lib/errors';
import { classColor, type ProjectedGroup, type ProjectedRaider } from './roster';
import { specIcon } from './specIcons';
import { useRemoveSignup, useSetSignupFlag, useSignupFlags, type SignupFlag, type SignupFlags } from './useRoster';

const FLAGS: { flag: SignupFlag; label: string }[] = [
  { flag: 'is_trial', label: 'Trial' },
  { flag: 'is_backup_tank', label: 'Backup tank' },
  { flag: 'is_backup_healer', label: 'Backup healer' }
];

// Next season's Projected Roster (#1342): everyone who has signed up, as it
// will look when signups close. The team sees who and on what; its officers
// also set Trial and the backup roles, and remove a signup that should not
// count. Signups go on the roster when the team leader closes them
// (Settings > Signups).
export function ProjectedRoster({
  teamId,
  groups,
  officer
}: {
  teamId: number;
  groups: ProjectedGroup[];
  officer: boolean;
}) {
  const ids = groups.flatMap((g) => g.raiders.map((r) => r.signupId));
  const flags = useSignupFlags(teamId, ids, officer);
  const total = ids.length;

  return (
    <div className="roster-main">
      <h2 className="section-title">{total} signed up</h2>
      <p className="text-muted">
        {officer
          ? 'Everyone who has signed up so far. Trial and the backup roles apply when signups close; someone staying on the character they already play keeps their own.'
          : 'Everyone who has signed up so far. Not final until signups close.'}
      </p>
      {officer && flags.isError && (
        <DataState query={flags} label="Trial and backup flags">
          {() => null}
        </DataState>
      )}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
      <div className="card roster-table-wrap" tabIndex={0} role="region" aria-label="Projected roster">
        <table className="roster-table">
          <caption className="visually-hidden">Projected roster</caption>
          <thead>
            <tr>
              <th scope="col">Raider</th>
              {officer && (
                <>
                  {FLAGS.map((f) => (
                    <th key={f.flag} scope="col" className="col-check">
                      {f.label}
                    </th>
                  ))}
                  <th scope="col">
                    <span className="visually-hidden">Remove</span>
                  </th>
                </>
              )}
            </tr>
          </thead>
          {groups.map((group) => (
            <tbody key={group.role}>
              <tr className="role-row">
                <th scope="rowgroup" colSpan={officer ? 5 : 1}>
                  <span className="role-name">{group.label}</span>{' '}
                  <span className="role-count num">{group.raiders.length}</span>
                </th>
              </tr>
              {group.raiders.map((raider) => (
                <ProjectedRow
                  key={raider.signupId}
                  teamId={teamId}
                  raider={raider}
                  officer={officer}
                  flags={flags.data?.get(raider.signupId) ?? null}
                />
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}

function ProjectedRow({
  teamId,
  raider,
  officer,
  flags
}: {
  teamId: number;
  raider: ProjectedRaider;
  officer: boolean;
  flags: SignupFlags | null;
}) {
  const icon = specIcon(raider.className, raider.spec);
  const setFlag = useSetSignupFlag(teamId);
  const { announce } = useStatus();
  const [removing, setRemoving] = useState(false);

  // An unset Trial means a trial, as the promotion reads it.
  const checked = (flag: SignupFlag) =>
    flag === 'is_trial' ? (flags?.is_trial ?? true) : (flags?.[flag] ?? false);

  return (
    <tr>
      <th scope="row" className="raider-cell">
        {icon && <img className="spec-icon" src={icon} alt="" width={20} height={20} loading="lazy" />}
        <span className="raider-name" style={{ color: classColor(raider.className) }}>
          {raider.name}
        </span>
        {raider.kind === 'new' && <span className="signup-tag signup-tag-new">New</span>}
        {raider.kind === 'swap' && <span className="signup-tag signup-tag-swap">Changing from {raider.swapFrom}</span>}
        <span className="raider-spec">
          {raider.spec} {raider.className}
        </span>
      </th>
      {officer && (
        <>
          {FLAGS.map((f) => (
            <td key={f.flag} className="col-check">
              {raider.kind === 'stays' ? (
                <span className="text-dim">
                  <span aria-hidden="true">–</span>
                  <span className="visually-hidden">Keeps their own</span>
                </span>
              ) : (
                <input
                  type="checkbox"
                  aria-label={`${f.label}: ${raider.name}`}
                  checked={checked(f.flag)}
                  disabled={!flags || setFlag.isPending}
                  onChange={(e) =>
                    setFlag.mutate(
                      { signupId: raider.signupId, flag: f.flag, value: e.target.checked },
                      { onError: (error) => announce('error', errorMessage(error)) }
                    )
                  }
                />
              )}
            </td>
          ))}
          <td className="col-actions">
            <button type="button" className="button" onClick={() => setRemoving(true)}>
              Remove
            </button>
            {removing && <RemoveSignupDialog teamId={teamId} raider={raider} onClose={() => setRemoving(false)} />}
          </td>
        </>
      )}
    </tr>
  );
}

function RemoveSignupDialog({
  teamId,
  raider,
  onClose
}: {
  teamId: number;
  raider: ProjectedRaider;
  onClose: () => void;
}) {
  const remove = useRemoveSignup(teamId);
  const { announce } = useStatus();
  const onConfirm = () =>
    remove.mutate(
      { signupId: raider.signupId, name: raider.nameRealm },
      {
        onSuccess: () => {
          announce('success', `${raider.name}’s signup is removed.`);
          onClose();
        }
      }
    );
  return (
    <Dialog title={`Remove ${raider.name}’s signup?`} onClose={onClose} busy={remove.isPending}>
      <p>
        {raider.name} comes off the Projected Roster and won’t go on the roster when signups close. They can sign up
        again while signups are open.
      </p>
      {remove.isError && (
        <p className="form-error" role="alert">
          {errorMessage(remove.error)}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onClose} disabled={remove.isPending}>
          Cancel
        </button>
        <button type="button" className="button button-primary" onClick={onConfirm} disabled={remove.isPending}>
          {remove.isPending ? 'Removing…' : 'Remove signup'}
        </button>
      </div>
    </Dialog>
  );
}
