import { useId, useState, type FormEvent } from 'react';
import { useSession } from '../auth/session';
import { useStatus } from '../components/Status';
import { useCreateOwnName } from './useNames';

// Someone on the team who holds no Member makes their own, claimed by them
// (#1355): on the Roster page as its own card, and inside the invite link's
// "Which Member is you?" step as a bare form.
export function OwnNameForm({ teamId, card = true }: { teamId: number; card?: boolean }) {
  const id = useId();
  const { user } = useSession();
  // Starts from what the guild knows them by; the placeholder name is not one.
  const [label, setLabel] = useState(user && user.name !== 'Signed in' ? user.name : '');
  const create = useCreateOwnName(teamId);
  const { announce } = useStatus();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    create.mutate({ label: trimmed }, { onSuccess: () => announce('success', `${trimmed} is your Member now.`) });
  };

  const form = (
    <>
      <form onSubmit={onSubmit} noValidate className="create-name-form">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-label`}>
            {card ? 'Your name' : 'Not listed? Your name'}
          </label>
          <input
            id={`${id}-label`}
            className="input"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <button type="submit" className="button" disabled={create.isPending || !label.trim()}>
          {create.isPending ? 'Saving…' : 'Make my Member'}
        </button>
      </form>
      {create.isError && (
        <p className="form-error" role="alert">
          That did not save: {create.error.message}
        </p>
      )}
    </>
  );

  if (!card) return form;
  return (
    <section className="card own-name-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="card-title">
        You don’t have a Member yet
      </h2>
      <p className="text-muted">
        If an officer already added you, press Claim under your name in the list. If you’re not listed, make your own.
      </p>
      {form}
    </section>
  );
}
