import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import type { SavedCharacter } from './characters';
import { specsFor } from './mainSwap';
import { useAddCharacter } from './useAddCharacter';
import { useClassSpecs } from './useMainSwaps';

// "Add character to roster" (#1464): pick the spec, and the character is on
// the roster at once. Works on a phone, like the main swap form.
export function AddCharacterDialog({
  character,
  onClose
}: {
  character: SavedCharacter;
  onClose: () => void;
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const specs = useClassSpecs();
  const add = useAddCharacter(team.id, team.key);
  const id = useId();
  const choices = specs.isSuccess ? specsFor(specs.data, character.class_name) : [];
  const suggested = choices.find((s) => s.spec === character.spec_name)?.id;
  const [specId, setSpecId] = useState('');
  const [tried, setTried] = useState(false);
  const chosen = specId || (suggested ? String(suggested) : '');

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!chosen) return;
    const spec = choices.find((s) => String(s.id) === chosen)!;
    add.mutate(
      {
        characterId: character.id,
        classSpecId: spec.id
      },
      {
        onSuccess: () => {
          announce('success', `${character.name} is on the ${team.name} roster.`);
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title="Add character to roster" onClose={onClose} busy={add.isPending}>
      <form className="main-swap-form" onSubmit={onSubmit} noValidate>
        <p>
          <strong>
            {character.name}-{character.realm}
          </strong>{' '}
          goes on the {team.name} roster as a trial, joining today. Your officers are told in Discord.
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
              We do not have a class for {character.name} yet. Import your characters again to read it from Battle.net.
            </p>
          )}
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
        {add.isError && (
          <p className="form-error" role="alert">
            That did not save: {add.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={add.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={add.isPending}>
            {add.isPending ? 'Adding…' : 'Add to roster'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
