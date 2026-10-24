import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Character } from '../auth/access';
import { useOpenAltsPicker } from '../characters/AltsPicker';
import { CharacterIcon } from '../characters/CharacterIcon';
import { nameRealmKey, type SavedCharacter } from '../characters/characters';
import { useClassSpecs } from '../characters/useMainSwaps';
import '../characters/characters.css';
import { useTouchScreen } from '../lib/device';
import { backupRolesFor, readingLabel, readPick, type ClassmateRow, type SignupFields } from './signup';
import { useDeclareSignup } from './useSignup';
import { CLASS_SPECS, resolveRole } from './wowData';

const EMPTY: SignupFields = {
  characterId: null,
  className: '',
  mainSpec: '',
  offSpecs: [],
  primaryRole: null,
  notes: '',
  backupTank: false,
  backupHealer: false
};

export type FormEdit = { signupId: number; fields: SignupFields };

type Setter = <K extends keyof SignupFields>(key: K, value: SignupFields[K]) => void;

const classColorVar = (className: string) =>
  `var(--class-${className.toLowerCase().replace(/\s+/g, '-')}, var(--text))`;

const nameRealmOf = (c: SavedCharacter) => `${c.name}-${c.realm}`;

// The Sign Up form (#1102), one page since #1466 (Kat: nothing is typed by
// hand any more, so steps only slowed it down). The character is picked from
// the person's saved characters, the ones Battle.net confirmed are theirs, so
// there is no class to choose -- Blizzard already knows it. What the pick
// means (same main, a new one, a first one) shows beside Submit as they pick,
// and the database decides it the same way. Signing up again or editing goes
// through the same form and replaces the signup. Rules live in ./signup.ts and
// ./wowData.ts, tested apart from this render.
export function SignUpForm({
  teamId,
  season,
  seasonName,
  edit,
  saved,
  rosterCharacters,
  classmates,
  roleTargets,
  onDone,
  sideHost
}: {
  teamId: number;
  season: string;
  seasonName: string;
  edit: FormEdit | null;
  saved: SavedCharacter[];
  // Their characters on this team's roster now, for what a pick means.
  rosterCharacters: Character[];
  classmates: ClassmateRow[];
  roleTargets: { tank: number | null; heal: number | null };
  onDone: () => void;
  // The card Submit portals into (#1162), owned by the page so it sits beside
  // the form as its own box and does not scroll off under a long list.
  sideHost: HTMLDivElement | null;
}) {
  const [fields, setFields] = useState<SignupFields>(edit?.fields ?? EMPTY);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const declare = useDeclareSignup(teamId, season);
  const specs = useClassSpecs();
  const id = useId();

  const set: Setter = (key, value) => setFields((f) => ({ ...f, [key]: value }));
  const picked = saved.find((c) => c.id === fields.characterId) ?? null;
  const reading = picked ? readPick(nameRealmOf(picked), rosterCharacters) : null;

  if (done && picked) {
    return (
      <div className="signup-confirm">
        <p className="signup-confirm-check" aria-hidden="true">
          &#10003;
        </p>
        <h2>You’re signed up</h2>
        <p className="text-muted">
          You are now signed up for {seasonName} as{' '}
          <strong>
            {nameRealmOf(picked)} ({fields.mainSpec} {fields.className})
          </strong>
          . You’re welcome to change this any time until signups close, around the start of the season.
        </p>
        <button type="button" className="button button-primary" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  const onSubmit = () => {
    setError('');
    if (!picked) return setError('Please pick the character you’re signing up with.');
    const classSpecs = CLASS_SPECS[fields.className];
    if (!classSpecs)
      return setError(`We don’t know ${picked.name}’s class yet. Import your characters again, then pick it.`);
    if (!fields.mainSpec) return setError('Please select your main spec.');
    if (classSpecs.roles && !fields.primaryRole) return setError('Please select your primary role.');
    const classSpecId = specs.data?.find((s) => s.class === fields.className && s.spec === fields.mainSpec)?.id;
    if (!classSpecId) return setError('The spec list did not load. Reload the page and try again.');
    // A tick left on from a spec that hid it is not sent.
    const backups = backupRolesFor(fields.className, fields.mainSpec);
    declare.mutate(
      {
        characterId: picked.id,
        classSpecId,
        offSpecs: fields.offSpecs.join(', '),
        note: fields.notes,
        backupTank: fields.backupTank && backups.includes('Tank'),
        backupHealer: fields.backupHealer && backups.includes('Heal')
      },
      {
        onSuccess: () => setDone(true),
        onError: (e) => setError(e.message || 'Submission failed. Please try again or contact an officer on Discord.')
      }
    );
  };

  return (
    <>
      <h2>Sign up for {seasonName}</h2>
      <CharacterList saved={saved} rosterCharacters={rosterCharacters} fields={fields} set={set} />
      {picked && CLASS_SPECS[fields.className] && (
        <SpecFields fields={fields} set={set} classmates={classmates} roleTargets={roleTargets} id={id} />
      )}
      {saved.length > 0 && (
        <div className="field">
          <label className="field-label" htmlFor={`${id}-notes`}>
            Anything else officers should know? <span className="text-muted">(optional)</span>
          </label>
          <textarea
            id={`${id}-notes`}
            className="input"
            rows={4}
            placeholder="e.g. applying as a trial, recently changed mains, availability caveats…"
            value={fields.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      )}
      {sideHost &&
        createPortal(
          <div className="card signup-side-card">
            {picked && reading ? (
              <p className={`signup-reading signup-reading-${reading.kind}`} role="status">
                <strong>{picked.name}</strong>: {readingLabel(reading)}
              </p>
            ) : (
              <p className="text-muted">Pick a character to sign up with.</p>
            )}
            {error && (
              <p className="signup-error form-error" role="alert">
                {error}
              </p>
            )}
            <div className="signup-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={onSubmit}
                disabled={declare.isPending || saved.length === 0}
              >
                {declare.isPending ? 'Submitting…' : edit ? 'Save changes' : 'Sign up'}
              </button>
            </div>
          </div>,
          sideHost
        )}
    </>
  );
}

// Their saved characters, roster characters first, then by item level: the
// list the import fills. With none saved it offers the import instead, which
// needs a computer the first time (Kat, 2026-10-24); after that the form
// works on a phone.
function CharacterList({
  saved,
  rosterCharacters,
  fields,
  set
}: {
  saved: SavedCharacter[];
  rosterCharacters: Character[];
  fields: SignupFields;
  set: Setter;
}) {
  const openPicker = useOpenAltsPicker();
  const touch = useTouchScreen();
  const onRoster = new Set(rosterCharacters.map((c) => nameRealmKey(c.nameRealm)));
  const isOnRoster = (c: SavedCharacter) => onRoster.has(nameRealmKey(nameRealmOf(c)));
  const rows = [...saved].sort(
    (a, b) =>
      Number(isOnRoster(b)) - Number(isOnRoster(a)) ||
      (b.item_level ?? 0) - (a.item_level ?? 0) ||
      a.name.localeCompare(b.name)
  );
  const importButton =
    openPicker && !touch ? (
      <button type="button" className="button" onClick={openPicker}>
        {rows.length ? 'Import your characters again' : 'Import your characters'}
      </button>
    ) : (
      <p className="text-muted">Importing characters works on a computer.</p>
    );

  if (rows.length === 0) {
    return (
      <div className="signup-bnet-picker">
        <p className="text-muted">
          You have no characters saved yet. Import them from Battle.net, then pick the one you’ll main next season.
        </p>
        {importButton}
      </div>
    );
  }

  return (
    <fieldset className="field">
      <legend className="field-label">Which character will you main?</legend>
      <div className="signup-bnet-list" role="radiogroup" aria-label="Your characters">
        {rows.map((character) => {
          const pickedHere = fields.characterId === character.id;
          return (
            <button
              key={character.id}
              type="button"
              role="radio"
              aria-checked={pickedHere}
              className="signup-bnet-row"
              onClick={() => {
                const classSpecs = character.class_name ? CLASS_SPECS[character.class_name]?.specs : undefined;
                set('characterId', character.id);
                set('className', classSpecs ? character.class_name! : '');
                set(
                  'mainSpec',
                  classSpecs && character.spec_name && classSpecs.includes(character.spec_name)
                    ? character.spec_name
                    : ''
                );
                set('offSpecs', []);
                set('primaryRole', null);
                set('backupTank', false);
                set('backupHealer', false);
              }}
            >
              <CharacterIcon className={character.class_name} spec={character.spec_name} />
              <span className="character-text">
                <span className="character-name">{character.name}</span>
                <span className="character-sub">
                  {character.realm}
                  {character.class_name && ` · ${character.class_name}`}
                  {character.spec_name && ` (${character.spec_name})`}
                </span>
              </span>
              {isOnRoster(character) && <span className="status-tag character-tag">Raiding now</span>}
              {pickedHere && (
                <svg className="signup-bnet-check" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
      <div className="signup-bnet-help">
        <p className="text-muted">Don’t see the character you want? Import your characters again.</p>
        {importButton}
      </div>
    </fieldset>
  );
}

function SpecFields({
  fields,
  set,
  classmates,
  roleTargets,
  id
}: {
  fields: SignupFields;
  set: Setter;
  classmates: ClassmateRow[];
  roleTargets: { tank: number | null; heal: number | null };
  id: string;
}) {
  const spec = CLASS_SPECS[fields.className]!;
  const classmatesInClass = classmates.filter((c) => c.class === fields.className);
  const offSpecOptions = spec.specs.filter((s) => s !== fields.mainSpec);

  return (
    <>
      <h3 style={{ color: classColorVar(fields.className) }}>{fields.className}</h3>
      {classmatesInClass.length ? (
        <p className="text-muted">
          Already playing {fields.className}: {classmatesInClass.map((c) => c.nameRealm.split('-')[0]).join(', ')}
        </p>
      ) : (
        <p className="text-muted">No one else is currently playing {fields.className}.</p>
      )}
      <fieldset className="field">
        <legend className="field-label">Main spec</legend>
        <div className="signup-chip-group" role="radiogroup" aria-label="Main spec">
          {spec.specs.map((s) => (
            <label key={s} className="signup-chip">
              <input
                type="radio"
                name={`${id}-mainSpec`}
                className="visually-hidden"
                checked={fields.mainSpec === s}
                onChange={() => set('mainSpec', s)}
              />
              <CharacterIcon className={fields.className} spec={s} size={20} />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend className="field-label">
          Off spec <span className="text-muted">(optional; select all that apply)</span>
        </legend>
        <div className="signup-chip-group">
          {offSpecOptions.map((s) => {
            const checked = fields.offSpecs.includes(s);
            return (
              <label key={s} className="signup-chip">
                <input
                  type="checkbox"
                  className="visually-hidden"
                  checked={checked}
                  onChange={() =>
                    set('offSpecs', checked ? fields.offSpecs.filter((x) => x !== s) : [...fields.offSpecs, s])
                  }
                />
                <CharacterIcon className={fields.className} spec={s} size={20} />
                <span>{s}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {spec.roles && (
        <fieldset className="field">
          <legend className="field-label">Primary role</legend>
          <div className="signup-chip-group" role="radiogroup" aria-label="Primary role">
            {spec.roles.map((r) => (
              <label key={r} className="signup-chip">
                <input
                  type="radio"
                  name={`${id}-role`}
                  className="visually-hidden"
                  checked={fields.primaryRole === r}
                  onChange={() => set('primaryRole', r)}
                />
                <span>{r}</span>
              </label>
            ))}
          </div>
          <RoleAdvisory fields={fields} classmates={classmates} roleTargets={roleTargets} />
        </fieldset>
      )}
      <BackupTicks fields={fields} set={set} />
    </>
  );
}

// "I can backup tank / heal" (#1466): the same flags as the officer boxes on
// the Projected Roster, offered only for a role the class can fill and not the
// one they main.
function BackupTicks({ fields, set }: { fields: SignupFields; set: Setter }) {
  const roles = backupRolesFor(fields.className, fields.mainSpec);
  if (!roles.length) return null;
  return (
    <fieldset className="field">
      <legend className="field-label">
        Backup roles <span className="text-muted">(optional)</span>
      </legend>
      <div className="signup-chip-group">
        {roles.map((r) => {
          const key = r === 'Tank' ? 'backupTank' : 'backupHealer';
          return (
            <label key={r} className="signup-chip">
              <input
                type="checkbox"
                className="visually-hidden"
                checked={fields[key]}
                onChange={() => set(key, !fields[key])}
              />
              <span>{r === 'Tank' ? 'I can backup tank' : 'I can backup heal'}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function RoleAdvisory({
  fields,
  classmates,
  roleTargets
}: {
  fields: SignupFields;
  classmates: ClassmateRow[];
  roleTargets: { tank: number | null; heal: number | null };
}) {
  const role = resolveRole(fields.className, fields.mainSpec, fields.primaryRole);
  if (role !== 'Tank' && role !== 'Heal') return null;
  const target = role === 'Tank' ? roleTargets.tank : roleTargets.heal;
  const count = classmates.filter((c) => c.role === role).length;
  const roleLabel = role === 'Tank' ? 'tank' : 'healer';
  if (target == null) {
    return (
      <p className="signup-role-info">
        {count} {roleLabel}
        {count === 1 ? '' : 's'} already signed up.
      </p>
    );
  }
  if (count >= target) {
    return (
      <p className="signup-role-info signup-role-info-warn">
        {count} {roleLabel}
        {count === 1 ? '' : 's'} already signed up (target: {target}). Consider signing up as DPS and being a backup{' '}
        {roleLabel}, or talk to an officer if you are set on {roleLabel}ing.
      </p>
    );
  }
  return (
    <p className="signup-role-info">
      {count} of {target} {roleLabel}s currently signed up.
    </p>
  );
}
