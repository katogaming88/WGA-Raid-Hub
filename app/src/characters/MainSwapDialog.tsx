import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import type { SavedCharacter } from './characters';
import { characterName, specsFor } from './mainSwap';
import { useClassSpecs, useRequestMainSwap } from './useMainSwaps';

// "Ask to raid on this one" (#631). A small form, not a roster write: it sends
// the ask to the team's officers, who approve it on the roster page. It works
// on a phone, like the profile's other two forms (#868 part 4) -- there is a
// Send and a Cancel, so a stray tap sends nothing.
export function MainSwapDialog({
  alt,
  fromNameRealm,
  onClose
}: {
  alt: SavedCharacter;
  fromNameRealm: string;
  onClose: () => void;
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const specs = useClassSpecs();
  const ask = useRequestMainSwap(team.id);
  const id = useId();
  // The spec Blizzard last saw them in, which is often but not always the one
  // they mean to raid as.
  const choices = specs.isSuccess ? specsFor(specs.data, alt.class_name) : [];
  const suggested = choices.find((s) => s.spec === alt.spec_name)?.id;
  const [specId, setSpecId] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const chosen = specId || (suggested ? String(suggested) : '');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!chosen) return;
    ask.mutate(
      { characterId: alt.id, classSpecId: Number(chosen), note: note.trim() },
      {
        onSuccess: () => {
          announce('success', `Asked your officers to move you to ${alt.name}.`);
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title="Ask to raid on this character" onClose={onClose} busy={ask.isPending}>
      <form className="main-swap-form" onSubmit={onSubmit} noValidate>
        <p>
          You would move from <strong>{characterName(fromNameRealm)}</strong> to{' '}
          <strong>
            {alt.name}-{alt.realm}
          </strong>
          . An officer has to approve it.
        </p>
        <p className="field-hint">
          {characterName(fromNameRealm)} comes off the roster but keeps its loot and raid history, and your join date
          and attendance move across. Loot you already had this season still counts toward your total.
        </p>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-spec`}>
            Which spec will you raid?
          </label>
          <select
            id={`${id}-spec`}
            className="select"
            value={chosen}
            aria-invalid={tried && !chosen}
            disabled={!specs.isSuccess || choices.length === 0}
            onChange={(e) => setSpecId(e.target.value)}
          >
            <option value="">Choose…</option>
            {choices.map((s) => (
              <option key={s.id} value={s.id}>
                {s.spec}
              </option>
            ))}
          </select>
          {specs.isSuccess && choices.length === 0 && (
            <p className="field-hint">
              We do not have a class for {alt.name} yet. Choose alts again to read it from Battle.net, then ask.
            </p>
          )}
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>
            Anything the officers should know? (optional)
          </label>
          <textarea
            id={`${id}-note`}
            className="textarea"
            value={note}
            placeholder="For example, geared it over the break and it is ahead of my Mage"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {tried && !chosen && (
          <p className="form-error" role="alert">
            Choose the spec you will raid.
          </p>
        )}
        {specs.isError && (
          <p className="form-error" role="alert">
            The spec list did not load: {specs.error.message}
          </p>
        )}
        {ask.isError && (
          <p className="form-error" role="alert">
            That did not send: {ask.error.message}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={ask.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={ask.isPending}>
            {ask.isPending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
