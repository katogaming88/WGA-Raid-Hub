import { useState } from 'react';
import { classColor } from '../roster/roster';
import {
  OWN_TYPES,
  PRIORITIES,
  PRIORITY_LABELS,
  SPOT_GROUPS,
  blankQuestion,
  newKey,
  roleOfSpec,
  spotName,
  type OwnDraft,
  type Priority,
  type Role,
  type Settings,
  type SpecRow,
  type Spot,
  type Starter,
  type StarterAnswer
} from './recruiting';
import type { Set } from './RecruitingSections';

// "Application questions" and "Who you're looking for" (#1548).

const TYPE_LABELS: Record<string, string> = {
  ...Object.fromEntries(OWN_TYPES.map((t) => [t.id, t.label])),
  recruiter: 'List of recruiters'
};

// ---------------------------------------------------------------------------
// 5. Application questions

export function QuestionsSection({
  starters,
  answers,
  onStarter,
  own,
  onOwn,
  joinsByForm
}: {
  starters: Starter[];
  answers: Record<string, StarterAnswer>;
  onStarter: (key: string, value: StarterAnswer) => void;
  own: OwnDraft[];
  onOwn: (list: OwnDraft[]) => void;
  joinsByForm: boolean;
}) {
  const groups = [...new Set(starters.map((s) => s.group))];
  const change = (key: number, patch: Partial<OwnDraft>) =>
    onOwn(own.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...own];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to]!, next[index]!];
    onOwn(next);
  };
  return (
    <>
      {!joinsByForm && (
        <p className="apply-note">
          These are only used with "Application on Raid Hub". Your apply page says "Discord ticket only" now.
        </p>
      )}
      <p className="text-dim rec-note">
        Always included, no question needed: their character, item level, M+ score, best and median logs, and their
        Discord account.
      </p>
      {groups.map((group) => (
        <fieldset key={group} className="rec-group">
          <legend className="rec-sub">{group}</legend>
          {starters
            .filter((s) => s.group === group)
            .map((s) => {
              const a = answers[s.key] ?? { on: s.on, required: s.required };
              return (
                <div key={s.key} className="rec-question">
                  <div className="rec-question-head">
                    <label>
                      <input
                        type="checkbox"
                        checked={a.on}
                        onChange={(e) =>
                          onStarter(s.key, { on: e.target.checked, required: e.target.checked && a.required })
                        }
                      />{' '}
                      <b>{s.label}</b>
                    </label>
                    <span className="text-dim rec-type">{TYPE_LABELS[s.answer_type] ?? s.answer_type}</span>
                    <label className="rec-required">
                      <input
                        type="checkbox"
                        checked={a.required}
                        disabled={!a.on}
                        onChange={(e) => onStarter(s.key, { on: a.on, required: e.target.checked })}
                      />{' '}
                      Required
                    </label>
                  </div>
                  <p className="text-dim rec-prompt">{s.prompt}</p>
                </div>
              );
            })}
        </fieldset>
      ))}

      <h3 className="rec-sub">Your own questions</h3>
      {own.length === 0 && <p className="text-dim rec-note">None yet.</p>}
      {own.map((q, i) => (
        <fieldset key={q.key} className="rec-own">
          <legend className="visually-hidden">Question {i + 1}</legend>
          <div className="rec-own-row">
            <div className="field">
              <label className="field-label" htmlFor={`own-label-${q.key}`}>
                Short name
              </label>
              <input
                id={`own-label-${q.key}`}
                className="input"
                maxLength={40}
                value={q.label}
                onChange={(e) => change(q.key, { label: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`own-type-${q.key}`}>
                Type of answer
              </label>
              <select
                id={`own-type-${q.key}`}
                className="select"
                value={q.answer_type}
                onChange={(e) =>
                  change(q.key, { answer_type: e.target.value, max: e.target.value === 'paragraph' ? '1000' : '100' })
                }
              >
                {OWN_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={`own-prompt-${q.key}`}>
              What applicants see
            </label>
            <textarea
              id={`own-prompt-${q.key}`}
              className="textarea"
              rows={2}
              maxLength={300}
              value={q.prompt}
              onChange={(e) => change(q.key, { prompt: e.target.value })}
            />
            <span className="field-hint">
              {'{team}'} and {'{raid nights}'} fill in themselves.
            </span>
          </div>
          {(q.answer_type === 'short_text' || q.answer_type === 'paragraph') && (
            <div className="field">
              <label className="field-label" htmlFor={`own-max-${q.key}`}>
                Character limit
              </label>
              <input
                id={`own-max-${q.key}`}
                className="input rec-narrow"
                type="number"
                min={1}
                max={q.answer_type === 'short_text' ? 200 : 4000}
                value={q.max}
                onChange={(e) => change(q.key, { max: e.target.value })}
              />
            </div>
          )}
          {q.answer_type === 'choice' && (
            <div className="field">
              <label className="field-label" htmlFor={`own-choices-${q.key}`}>
                Choices, one a line
              </label>
              <textarea
                id={`own-choices-${q.key}`}
                className="textarea"
                rows={3}
                value={q.choices}
                onChange={(e) => change(q.key, { choices: e.target.value })}
              />
            </div>
          )}
          <div className="rec-own-actions">
            <label>
              <input
                type="checkbox"
                checked={q.required}
                onChange={(e) => change(q.key, { required: e.target.checked })}
              />{' '}
              Required
            </label>
            <button
              type="button"
              className="button"
              aria-label={`Move question ${i + 1} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              Up
            </button>
            <button
              type="button"
              className="button"
              aria-label={`Move question ${i + 1} down`}
              disabled={i === own.length - 1}
              onClick={() => move(i, 1)}
            >
              Down
            </button>
            <button type="button" className="button" onClick={() => onOwn(own.filter((x) => x.key !== q.key))}>
              Remove question {i + 1}
            </button>
          </div>
        </fieldset>
      ))}
      <div>
        <button
          type="button"
          className="button"
          disabled={own.length >= 20}
          onClick={() => onOwn([...own, blankQuestion()])}
        >
          + Add a question
        </button>
      </div>
      <p className="text-dim rec-note">Want different wording on a starter question? Turn it off and add your own.</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. Who you're looking for

export function SpotsSection({
  spots,
  onSpots,
  specs,
  s,
  set
}: {
  spots: Spot[];
  onSpots: (list: Spot[]) => void;
  specs: SpecRow[];
  s: Settings;
  set: Set;
}) {
  return (
    <>
      <p className="text-dim rec-note">
        High shows first, and gets an orange "Needs you" tag when an applicant picks that role.
      </p>
      {SPOT_GROUPS.map((g) => (
        <SpotGroup key={g.id} label={g.label} roles={g.roles} spots={spots} onSpots={onSpots} specs={specs} />
      ))}
      <label className="rec-check">
        <input
          type="checkbox"
          checked={s.exceptional_line_on}
          onChange={(e) => set('exceptional_line_on', e.target.checked)}
        />{' '}
        <b>Welcome exceptional players of any class or spec</b>
      </label>
      <p className="text-dim rec-note">Adds a line under your list. You can reword it:</p>
      {s.exceptional_line_on && (
        <div className="field">
          <label className="visually-hidden" htmlFor="rec-exceptional">
            Exceptional players line
          </label>
          <input
            id="rec-exceptional"
            className="input"
            maxLength={200}
            value={s.exceptional_line}
            onChange={(e) => set('exceptional_line', e.target.value)}
          />
        </div>
      )}
    </>
  );
}

function SpotGroup({
  label,
  roles,
  spots,
  onSpots,
  specs
}: {
  label: string;
  roles: Role[];
  spots: Spot[];
  onSpots: (list: Spot[]) => void;
  specs: SpecRow[];
}) {
  const mine = spots.filter((sp) => roles.includes(sp.role));
  const [pick, setPick] = useState('');
  const options = [
    ...roles.map((r) => ({ value: `any:${r}`, label: `Any ${r}`, group: 'Any' })),
    ...specs
      .filter((sp) => roles.includes(roleOfSpec(sp) as Role))
      .map((sp) => ({ value: `spec:${sp.id}`, label: `${sp.spec} ${sp.class}`, group: sp.class }))
  ];
  const taken = new Set(mine.map((sp) => (sp.class_spec_id === null ? `any:${sp.role}` : `spec:${sp.class_spec_id}`)));
  const add = () => {
    const [kind, value] = pick.split(':');
    if (!kind || !value) return;
    const spot: Spot =
      kind === 'any'
        ? { key: newKey(), role: value as Role, class_spec_id: null, priority: 'medium' }
        : {
            key: newKey(),
            role: roleOfSpec(specs.find((x) => x.id === Number(value))!) as Role,
            class_spec_id: Number(value),
            priority: 'medium'
          };
    onSpots([...spots, spot]);
    setPick('');
  };
  const update = (key: number, priority: Priority) =>
    onSpots(spots.map((sp) => (sp.key === key ? { ...sp, priority } : sp)));
  return (
    <fieldset className="rec-group">
      <legend className="rec-sub">
        {label} <span className="text-dim">{mine.length ? '' : 'Full, not listed'}</span>
      </legend>
      {mine.map((sp) => {
        const spec = specs.find((x) => x.id === sp.class_spec_id);
        const name = spotName(sp, specs);
        return (
          <div key={sp.key} className="rec-spot">
            <span className="rec-spot-name" style={spec ? { color: classColor(spec.class) } : undefined}>
              {name}
            </span>
            <label className="visually-hidden" htmlFor={`prio-${sp.key}`}>
              Priority for {name}
            </label>
            <select
              id={`prio-${sp.key}`}
              className="select"
              value={sp.priority}
              onChange={(e) => update(sp.key, e.target.value as Priority)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button"
              aria-label={`Remove ${name}`}
              onClick={() => onSpots(spots.filter((x) => x.key !== sp.key))}
            >
              Remove
            </button>
          </div>
        );
      })}
      <div className="rec-inline">
        <label className="visually-hidden" htmlFor={`add-${label}`}>
          Add a {label.toLowerCase()} spot
        </label>
        <select id={`add-${label}`} className="select" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a spec, or "Any"</option>
          {options
            .filter((o) => !taken.has(o.value))
            .map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
        </select>
        <button type="button" className="button" disabled={!pick} onClick={add} aria-label={`Add to ${label}`}>
          Add
        </button>
      </div>
    </fieldset>
  );
}
