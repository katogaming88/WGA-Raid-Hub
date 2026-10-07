import { useId, useState, type ChangeEvent } from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useLeaveGuard } from '../calendar/leaveGuard';
import type { OfficerBio } from '../guild/guild';
import { classColor, type PlayerRow } from '../roster/roster';
import {
  biosChanged,
  biosOf,
  draftsOf,
  moved,
  newDraft,
  photoProblem,
  PHOTO_TYPES,
  WOW_CLASSES,
  type BioDraft
} from './officers';
import { useUploadBioPhoto } from './useOfficers';

// Editing officer bios in place (#1361): on Team officers and Guild officers,
// an officer's Edit turns every card into a form. One save bar below the
// cards, pinned to the bottom of the screen (Kat, 2026-10-07), stays put while
// editing (Kat, 2026-09-18: a bar must not come and go), and saves the whole
// list at once, as the current site's editor does.
export function BiosEditor({
  saved,
  save,
  roster,
  what,
  onDone
}: {
  saved: OfficerBio[];
  save: UseMutationResult<unknown, Error, OfficerBio[]>;
  // The team's raiders, to start a card from; none on Guild officers.
  roster: PlayerRow[] | null;
  // "the team officers", for the leave and discard questions.
  what: string;
  onDone: () => void;
}) {
  const { announce } = useStatus();
  const [drafts, setDrafts] = useState<BioDraft[]>(() => draftsOf(saved));
  const [nextKey, setNextKey] = useState(saved.length);
  const [picked, setPicked] = useState('');
  const [leaving, setLeaving] = useState(false);
  const pickerId = useId();
  const dirty = biosChanged(saved, drafts);
  const leaveDialog = useLeaveGuard(dirty, 1, what);

  const update = (key: number, change: Partial<BioDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...change } : d)));

  const add = () => {
    const player = roster?.find((p) => String(p.id) === picked) ?? null;
    setDrafts((ds) => [...ds, newDraft(nextKey, player)]);
    setNextKey((k) => k + 1);
    setPicked('');
  };

  const onSave = () => save.mutate(biosOf(drafts), { onSuccess: () => announce('success', `Saved ${what}.`) });

  const discard = () => {
    setDrafts(draftsOf(saved));
    setLeaving(false);
  };

  const sorted = [...(roster ?? [])].sort((a, b) =>
    (a.nickname || a.name_realm).localeCompare(b.nickname || b.name_realm)
  );

  return (
    <div className="bios-editor">
      {drafts.length ? (
        <ol className="bios-edit-list">
          {drafts.map((d, i) => (
            <BioCardEditor
              key={d.key}
              draft={d}
              position={i}
              count={drafts.length}
              onChange={(change) => update(d.key, change)}
              onMove={(by) => setDrafts((ds) => moved(ds, i, by))}
              onRemove={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
            />
          ))}
        </ol>
      ) : (
        <p className="text-muted">No officers listed. Add one below.</p>
      )}

      <section className="card bios-add" aria-labelledby={`${pickerId}-title`}>
        <h2 id={`${pickerId}-title`} className="bios-add-title">
          Add an officer
        </h2>
        {roster && (
          <div className="field">
            <label className="field-label" htmlFor={pickerId}>
              Start from someone on the roster (optional)
            </label>
            <select id={pickerId} className="select" value={picked} onChange={(e) => setPicked(e.target.value)}>
              <option value="">Not on the roster: start blank</option>
              {sorted.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nickname ? `${p.nickname} (${p.name_realm.split('-')[0]})` : p.name_realm.split('-')[0]}
                </option>
              ))}
            </select>
            <p className="field-hint">
              Fills in their name, class and spec now. If those change on the roster later, edit the card to match.
            </p>
          </div>
        )}
        <div>
          <button type="button" className="button" onClick={add}>
            + Add officer
          </button>
        </div>
      </section>

      <div className="card bios-save-bar">
        <span className="bios-save-status" role="status">
          {save.isPending ? 'Saving…' : dirty ? 'You have unsaved changes.' : 'No unsaved changes.'}
        </span>
        <button type="button" className="button" onClick={() => (dirty ? setLeaving(true) : onDone())}>
          Done editing
        </button>
        <button type="button" className="button" disabled={!dirty || save.isPending} onClick={discard}>
          Discard
        </button>
        <button type="button" className="button button-primary" disabled={!dirty || save.isPending} onClick={onSave}>
          {save.isPending ? 'Saving…' : 'Save officers'}
        </button>
      </div>
      {save.isError && (
        <p className="form-error" role="alert">
          That did not save: {save.error.message}
        </p>
      )}

      {leaving && (
        <Dialog title="Stop editing without saving?" onClose={() => setLeaving(false)}>
          <p className="text-muted">Your changes to {what} haven’t been saved. If you stop now, they’re lost.</p>
          <div className="dialog-actions">
            <span className="grow" />
            <button
              type="button"
              className="button"
              onClick={() => {
                discard();
                onDone();
              }}
            >
              Discard and stop
            </button>
            <button type="button" className="button button-primary" onClick={() => setLeaving(false)}>
              Keep editing
            </button>
          </div>
        </Dialog>
      )}
      {leaveDialog}
    </div>
  );
}

function BioCardEditor({
  draft,
  position,
  count,
  onChange,
  onMove,
  onRemove
}: {
  draft: BioDraft;
  position: number;
  count: number;
  onChange: (change: Partial<BioDraft>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = useId();
  const upload = useUploadBioPhoto();
  const [photoError, setPhotoError] = useState<string | null>(null);
  const label = draft.name.trim() || `Officer ${position + 1}`;
  const initials = (draft.name.trim() || '?').slice(0, 2).toUpperCase();

  const onPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const problem = photoProblem(file);
    setPhotoError(problem);
    if (problem) return;
    upload.mutate(file, {
      onSuccess: (url) => onChange({ imagePath: url }),
      onError: (e) => setPhotoError(e.message)
    });
  };

  const text = (field: 'name' | 'characterName' | 'title' | 'pronouns' | 'spec', title: string, hint: string) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${field}`}>
        {title}
      </label>
      <input
        id={`${id}-${field}`}
        className="input"
        value={draft[field]}
        placeholder={hint}
        onChange={(e) => onChange({ [field]: e.target.value })}
      />
    </div>
  );

  return (
    <li className="card bio-edit-card">
      <fieldset className="bio-edit-fieldset">
        <legend className="visually-hidden">Editing {label}</legend>
        <div className="bio-edit-photo">
          {draft.imagePath ? (
            <img className="bio-photo" src={draft.imagePath} alt={label} />
          ) : (
            <span
              className="bio-photo bio-photo-fallback"
              aria-hidden="true"
              style={draft.classKey ? { color: classColor(draft.classKey) } : undefined}
            >
              {initials}
            </span>
          )}
          <label className={`button bio-upload${upload.isPending ? ' is-busy' : ''}`}>
            {upload.isPending ? 'Uploading…' : draft.imagePath ? 'Change photo' : 'Upload photo'}
            <input
              type="file"
              className="visually-hidden"
              accept={PHOTO_TYPES.join(',')}
              disabled={upload.isPending}
              onChange={onPhoto}
            />
          </label>
          {draft.imagePath && (
            <button type="button" className="button" onClick={() => onChange({ imagePath: '' })}>
              Remove photo
            </button>
          )}
          <span className="text-dim bio-photo-hint">PNG, JPEG or WebP, under 5 MB</span>
          {photoError && (
            <p className="form-error" role="alert">
              {photoError}
            </p>
          )}
        </div>
        <div className="bio-edit-fields">
          <div className="bio-edit-grid">
            {text('name', 'Display name', 'For example, Kat')}
            {text('characterName', 'Character name', 'For example, Katorri')}
            {text('title', 'Title', 'For example, Loot Officer')}
            {text('pronouns', 'Pronouns', 'For example, she/her')}
            <div className="field">
              <label className="field-label" htmlFor={`${id}-class`}>
                Class
              </label>
              <select
                id={`${id}-class`}
                className="select"
                value={draft.classKey}
                onChange={(e) => onChange({ classKey: e.target.value })}
              >
                <option value="">No class</option>
                {WOW_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                {draft.classKey && !WOW_CLASSES.includes(draft.classKey) && (
                  <option value={draft.classKey}>{draft.classKey}</option>
                )}
              </select>
            </div>
            {text('spec', 'Spec', 'For example, Protection')}
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-bio`}>
              Bio
            </label>
            <textarea
              id={`${id}-bio`}
              className="textarea"
              rows={4}
              value={draft.bio}
              onChange={(e) => onChange({ bio: e.target.value })}
            />
          </div>
          <div className="bio-edit-actions">
            <button
              type="button"
              className="button"
              disabled={position === 0}
              aria-label={`Move ${label} up`}
              onClick={() => onMove(-1)}
            >
              Move up
            </button>
            <button
              type="button"
              className="button"
              disabled={position === count - 1}
              aria-label={`Move ${label} down`}
              onClick={() => onMove(1)}
            >
              Move down
            </button>
            <button type="button" className="button bio-remove" aria-label={`Remove ${label}`} onClick={onRemove}>
              Remove officer
            </button>
          </div>
        </div>
      </fieldset>
    </li>
  );
}
