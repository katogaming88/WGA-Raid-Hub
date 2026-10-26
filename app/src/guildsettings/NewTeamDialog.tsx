import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useCreateTeam } from './useGuildSettings';

// New team (#1644): only a name is asked. The creator lands on the new team's
// home as its team leader; the address starts as a random code, which the
// Teams list can change to a readable one.
export function NewTeamDialog({
  guildId,
  guildKey,
  onClose
}: {
  guildId: number;
  guildKey: string;
  onClose: () => void;
}) {
  const id = useId();
  const navigate = useNavigate();
  const { announce } = useStatus();
  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const create = useCreateTeam(guildId);
  const trimmed = name.trim();
  const invalid = trimmed === '' || trimmed.length > 60;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid) return;
    create.mutate(
      { name: trimmed },
      {
        onSuccess: (rows) => {
          announce('success', `${trimmed} added. You are its team leader.`);
          onClose();
          const key = rows[0]?.team_key;
          if (key) navigate(`/g/${guildKey}/t/${key}`);
        }
      }
    );
  };

  return (
    <Dialog title="New team" onClose={onClose} busy={create.isPending} initialFocus={input}>
      <form onSubmit={onSubmit} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-name`}>
            Team name
          </label>
          <input
            ref={input}
            id={`${id}-name`}
            className="input"
            value={name}
            maxLength={60}
            aria-invalid={tried && invalid}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="field-hint">You will be the team's leader. You can change its name and address later.</p>
        </div>
        {tried && invalid && (
          <p className="form-error" role="alert">
            Give the team a name of up to 60 characters.
          </p>
        )}
        {create.isError && (
          <p className="form-error" role="alert">
            {create.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={create.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add team'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
