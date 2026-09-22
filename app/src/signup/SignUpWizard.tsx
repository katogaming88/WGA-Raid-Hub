import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BATTLENET, useSession } from '../auth/session';
import { CharacterIcon } from '../characters/CharacterIcon';
import { pickerRows, type CharactersAnswer } from '../characters/characters';
import { useBattlenetCharacters } from '../characters/useCharacters';
import '../characters/characters.css';
import { RealmField } from './RealmField';
import { buildSubmission, classMismatch, claimDiffers, type ClassmateRow, type SignupFields } from './signup';
import { useSubmitSignup } from './useSignup';
import { CLASS_NAMES, CLASS_SPECS, resolveRole, validateCharName } from './wowData';

const EMPTY: SignupFields = {
  charName: '',
  realm: '',
  className: '',
  mainSpec: '',
  offSpecs: [],
  primaryRole: null,
  notes: ''
};

export type WizardEdit = { signupId: number; fields: SignupFields };

type Setter = <K extends keyof SignupFields>(key: K, value: SignupFields[K]) => void;

const classColorVar = (className: string) =>
  `var(--class-${className.toLowerCase().replace(/\s+/g, '-')}, var(--text))`;

// The Sign Up form (#1102): the current site's 4-step wizard, ported rule for
// rule (js/signup.js), plus editing an existing signup (#500). Step logic
// lives in ./signup.ts and ./wowData.ts, tested apart from this render.
export function SignUpWizard({
  teamId,
  season,
  edit,
  claimNameRealm,
  claimedClass,
  classmates,
  roleTargets,
  onDone,
  sideHost
}: {
  teamId: number;
  season: string;
  edit: WizardEdit | null;
  claimNameRealm: string | null;
  claimedClass: string | null;
  classmates: ClassmateRow[];
  roleTargets: { tank: number | null; heal: number | null };
  onDone: () => void;
  // The card Back/Next/Submit portal into (#1162), owned by the page so it
  // sits beside the step content as its own box rather than under it.
  sideHost: HTMLDivElement | null;
}) {
  const [step, setStep] = useState(1);
  const [fields, setFields] = useState<SignupFields>(edit?.fields ?? EMPTY);
  const [claimDiffersConfirmed, setClaimDiffersConfirmed] = useState(false);
  const [classMismatchConfirmed, setClassMismatchConfirmed] = useState(false);
  const [error, setError] = useState('');
  const submit = useSubmitSignup(teamId, season);
  const id = useId();

  const set: Setter = (key, value) => setFields((f) => ({ ...f, [key]: value }));
  const differs = claimDiffers(claimNameRealm, fields.charName, fields.realm);
  const mismatch = classMismatch(claimedClass, claimNameRealm, fields.charName, fields.realm, fields.className || null);

  if (step === 5) {
    return (
      <div className="signup-confirm">
        <p className="signup-confirm-check" aria-hidden="true">
          &#10003;
        </p>
        <h2>{edit ? 'Signup updated' : 'Signup submitted'}</h2>
        <p className="text-muted">
          {edit
            ? 'Your signup has been updated. Officers will see the changes on their next review.'
            : 'Your signup has been submitted. Officers will review your application and be in touch. If you need to update anything, message an officer on Discord; do not resubmit without officer approval.'}
        </p>
        <button type="button" className="button button-primary" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }

  const canPickFromBattlenet = edit === null;

  const next = () => {
    setError('');
    if (step === 1) {
      if (canPickFromBattlenet) {
        if (!fields.charName) return setError('Please pick the character you’re signing up with.');
      } else {
        const nameError = validateCharName(fields.charName.trim());
        if (nameError) return setError(nameError);
        if (!fields.realm) return setError('Please select your realm.');
      }
      if (differs && !claimDiffersConfirmed)
        return setError('Please confirm you meant to sign up a different character.');
      setStep(2);
    } else if (step === 2) {
      if (!fields.className) return setError('Please select a class.');
      setStep(3);
    } else if (step === 3) {
      const spec = CLASS_SPECS[fields.className];
      if (!fields.mainSpec) return setError('Please select your main spec.');
      if (spec?.roles && !fields.primaryRole) return setError('Please select your primary role.');
      if (mismatch && !classMismatchConfirmed)
        return setError('Please confirm the class change, or go back and re-check your character selection.');
      setStep(4);
    } else {
      setStep(step + 1);
    }
  };

  const back = () => setStep(step === 3 ? 2 : Math.max(1, step - 1));

  const onSubmit = () => {
    const submission = buildSubmission(fields, differs, differs ? claimNameRealm : null);
    submit.mutate(
      { isEdit: !!edit, signupId: edit?.signupId ?? null, fields: submission },
      {
        onSuccess: () => setStep(5),
        onError: (e) => setError(e.message || 'Submission failed. Please try again or contact an officer on Discord.')
      }
    );
  };

  return (
    <>
      {step === 1 && (
        <Step1
          fields={fields}
          set={set}
          resetClaimDiffersConfirmed={() => setClaimDiffersConfirmed(false)}
          canPickFromBattlenet={canPickFromBattlenet}
          id={id}
        />
      )}
      {step === 2 && <Step2 fields={fields} set={set} />}
      {step === 3 && <Step3 fields={fields} set={set} classmates={classmates} roleTargets={roleTargets} id={id} />}
      {step === 4 && <Step4 fields={fields} set={set} differs={differs} claimNameRealm={claimNameRealm} id={id} />}
      {/* Its own card, portaled beside the step content (#1162): Step 1's
          character list can run to dozens of rows, and Next scrolling off
          with it left no visible way to move on. Same box on every step, so
          it does not jump around as the step changes. The differs/mismatch
          confirmations live here too (Kat, 2026-09-22): they block Next the
          same way the error message does, so they belong next to it. */}
      {sideHost &&
        createPortal(
          <div className="card signup-side-card">
            <p className="signup-step-label">Step {step} of 4</p>
            {step === 1 && claimNameRealm && differs && (
              <div className="signup-warning">
                <p>
                  Are you sure you want to sign up with a different character? You are signed in with{' '}
                  <strong>{claimNameRealm}</strong> claimed, but picked{' '}
                  <strong>
                    {fields.charName}-{fields.realm}
                  </strong>
                  .
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={claimDiffersConfirmed}
                    onChange={(e) => setClaimDiffersConfirmed(e.target.checked)}
                  />
                  <span>
                    Yes, I meant to sign up {fields.charName}-{fields.realm}, not {claimNameRealm}
                  </span>
                </label>
              </div>
            )}
            {step === 3 && mismatch && claimedClass && claimNameRealm && (
              <div className="signup-warning">
                <p>
                  Your claimed character <strong>{claimNameRealm}</strong> is on file as a{' '}
                  <strong>{claimedClass}</strong>, but you selected <strong>{fields.className}</strong>. A
                  character&#39;s class does not change, so this usually means the wrong class got clicked. If you meant
                  to sign up a different character instead, go back and check the name/realm.
                </p>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={classMismatchConfirmed}
                    onChange={(e) => setClassMismatchConfirmed(e.target.checked)}
                  />
                  <span>
                    Yes, I meant to pick {fields.className} for {claimNameRealm}
                  </span>
                </label>
              </div>
            )}
            {error && (
              <p className="signup-error form-error" role="alert">
                {error}
              </p>
            )}
            <div className="signup-actions">
              {step > 1 && (
                <button type="button" className="button" onClick={back} disabled={submit.isPending}>
                  Back
                </button>
              )}
              {step < 4 ? (
                <button type="button" className="button button-primary" onClick={next}>
                  Next
                </button>
              ) : (
                <button type="button" className="button button-primary" onClick={onSubmit} disabled={submit.isPending}>
                  {submit.isPending ? 'Submitting…' : 'Submit'}
                </button>
              )}
            </div>
          </div>,
          sideHost
        )}
    </>
  );
}

function Step1({
  fields,
  set,
  resetClaimDiffersConfirmed,
  canPickFromBattlenet,
  id
}: {
  fields: SignupFields;
  set: Setter;
  resetClaimDiffersConfirmed: () => void;
  canPickFromBattlenet: boolean;
  id: string;
}) {
  const pick: Setter = (key, value) => {
    set(key, value);
    resetClaimDiffersConfirmed();
  };

  return (
    <>
      <h2>Sign up for next season</h2>
      {canPickFromBattlenet ? (
        <>
          <p className="text-muted">Pick the character you’re signing up from your Battle.net account.</p>
          <BattlenetCharacterPicker fields={fields} set={pick} />
        </>
      ) : (
        <>
          <p className="text-muted">Enter your exact in-game character name and select your realm.</p>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-name`}>
              Character name
            </label>
            <input
              id={`${id}-name`}
              className="input"
              type="text"
              autoComplete="off"
              value={fields.charName}
              onChange={(e) => pick('charName', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-realm`}>
              Realm
            </label>
            <RealmField id={`${id}-realm`} value={fields.realm} onChange={(realm) => pick('realm', realm)} />
          </div>
        </>
      )}
    </>
  );
}

// Picks a character straight from the raider's Battle.net account instead of
// typing name/realm/class by hand (#1162): reuses the alts picker's read
// (battlenet-characters), matched to the same roster-outcome rows the profile
// picker shows, but a single pick rather than a multi-select alt list. There
// is no manual fallback (Kat, 2026-09-21): asks for every level, not just max
// level, so a character still leveling shows up too.
function BattlenetCharacterPicker({ fields, set }: { fields: SignupFields; set: Setter }) {
  const { user, battlenetToken, connect, refreshBattlenet } = useSession();
  const list = useBattlenetCharacters();
  const [answer, setAnswer] = useState<CharactersAnswer | null>(null);
  const started = useRef<string | null>(null);

  const { mutate: read } = list;
  const load = useCallback((token: string) => read({ token, allLevels: true }, { onSuccess: setAnswer }), [read]);

  useEffect(() => {
    if (!battlenetToken || started.current === battlenetToken) return;
    started.current = battlenetToken;
    load(battlenetToken);
  }, [battlenetToken, load]);

  if (!user?.hasBattlenet) {
    return (
      <div className="signup-bnet-picker">
        <p className="text-muted">Connect Battle.net to pick your character automatically.</p>
        <button type="button" className="button" onClick={() => void connect(BATTLENET, 'signup-character')}>
          Connect Battle.net
        </button>
      </div>
    );
  }
  if (!battlenetToken) {
    return (
      <div className="signup-bnet-picker">
        <p className="text-muted">
          Battle.net needs to confirm it’s you before WGA Raid Hub can read your characters. You’ll come straight back
          here.
        </p>
        <button type="button" className="button" onClick={() => void refreshBattlenet('signup-character')}>
          Load your characters from Battle.net
        </button>
      </div>
    );
  }
  if (list.isError) {
    return (
      <p className="form-error" role="alert">
        Could not read your characters from Battle.net: {list.error.message}
      </p>
    );
  }
  if (!answer) {
    return (
      <p className="text-muted" role="status">
        Reading your characters from Battle.net…
      </p>
    );
  }

  const rows = pickerRows(answer, new Map());
  const pickedKey = fields.charName && fields.realm ? `${fields.charName}-${fields.realm}`.toLowerCase() : null;

  return (
    <>
      {rows.length === 0 ? (
        <p className="text-muted">No characters found on this Battle.net account.</p>
      ) : (
        <div className="signup-bnet-list" role="radiogroup" aria-label="Your characters">
          {rows.map((row) => {
            const { character } = row;
            const blocked = row.kind === 'claimed';
            const key = `${character.name}-${character.realm}`.toLowerCase();
            const picked = pickedKey === key;
            return (
              <button
                key={character.blizzard_id}
                type="button"
                role="radio"
                aria-checked={picked}
                disabled={blocked}
                className="signup-bnet-row"
                onClick={() => {
                  set('charName', character.name);
                  set('realm', character.realm);
                  const specs = character.class_name ? CLASS_SPECS[character.class_name]?.specs : undefined;
                  set('className', specs ? character.class_name! : '');
                  set(
                    'mainSpec',
                    specs && character.spec_name && specs.includes(character.spec_name) ? character.spec_name : ''
                  );
                  set('offSpecs', []);
                  set('primaryRole', null);
                }}
              >
                <CharacterIcon className={character.class_name} spec={character.spec_name} />
                <span className="character-text">
                  <span className="character-name">{character.name}</span>
                  <span className="character-sub">
                    {character.realm}
                    {character.class_name && ` · ${character.class_name}`}
                    {character.spec_name ? ` (${character.spec_name})` : ` · Level ${character.level}`}
                  </span>
                </span>
                {blocked && <span className="status-tag character-tag">Claimed by another player</span>}
                {picked && (
                  <svg className="signup-bnet-check" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-muted signup-bnet-help">
        Don’t see the character you want to sign up? Make sure you’re connected with the right Battle.net account, then
        message an officer on Discord if it’s still missing.
      </p>
    </>
  );
}

function Step2({ fields, set }: { fields: SignupFields; set: Setter }) {
  return (
    <>
      <h2>Select your class</h2>
      <div className="signup-class-grid" role="radiogroup" aria-label="Class">
        {CLASS_NAMES.map((cls) => (
          <button
            key={cls}
            type="button"
            role="radio"
            aria-checked={fields.className === cls}
            className={`signup-class-btn${fields.className === cls ? ' signup-class-btn-selected' : ''}`}
            style={{ '--cls-color': classColorVar(cls) } as CSSProperties}
            onClick={() => {
              const changed = cls !== fields.className;
              set('className', cls);
              if (changed) {
                set('mainSpec', '');
                set('offSpecs', []);
                set('primaryRole', null);
              }
            }}
          >
            {cls}
          </button>
        ))}
      </div>
    </>
  );
}

function Step3({
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
      <h2 style={{ color: classColorVar(fields.className) }}>{fields.className}</h2>
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
    </>
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

function Step4({
  fields,
  set,
  differs,
  claimNameRealm,
  id
}: {
  fields: SignupFields;
  set: Setter;
  differs: boolean;
  claimNameRealm: string | null;
  id: string;
}) {
  return (
    <>
      <h2>Additional information</h2>
      {differs && claimNameRealm && (
        <p className="text-muted">
          This will be recorded as switching from your claimed character <strong>{claimNameRealm}</strong>.
        </p>
      )}
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
    </>
  );
}
