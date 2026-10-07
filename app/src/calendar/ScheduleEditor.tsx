import { useId, useState, type FormEvent } from 'react';
import { DataState } from '../components/DataState';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import {
  asDifficulty,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  defaultLabel,
  draftOf,
  draftProblem,
  NEW_NIGHT,
  sameDraft,
  TIMEZONES,
  WEEKDAY_NAMES,
  type Difficulty,
  type NightDraft
} from './schedule';
import {
  useRemoveWeeklyNight,
  useSaveTeamDefault,
  useSaveWeeklyNight,
  useScheduleEditor,
  type ScheduleEditorData
} from './useSchedule';

// The Calendar's "Edit schedule" panel (#1361): the team default difficulty
// and the weekly nights, which an officer sets about once a season. One-off
// changes are made from the day itself, on the month below.
export function ScheduleEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const team = useTeam();
  const editor = useScheduleEditor(team.id, true);
  const titleId = useId();
  return (
    <section id={id} className="card schedule-editor" aria-labelledby={titleId}>
      <div className="schedule-editor-head">
        <h2 id={titleId} className="schedule-editor-title">
          Raid schedule
        </h2>
        <p className="text-muted">Only officers see this. A change shows on the calendar as soon as it saves.</p>
        <span className="grow" />
        <button type="button" className="button" onClick={onClose}>
          Close
        </button>
      </div>
      <DataState query={editor} label="the raid schedule">
        {(data) => <Editor data={data} />}
      </DataState>
      <p className="schedule-editor-hint text-muted">
        To cancel one night or add an extra one, click that day on the calendar below.
      </p>
    </section>
  );
}

function Editor({ data }: { data: ScheduleEditorData }) {
  const [drafts, setDrafts] = useState<{ key: number; draft: NightDraft }[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const addNight = () => {
    setDrafts((d) => [...d, { key: nextKey, draft: NEW_NIGHT }]);
    setNextKey((k) => k + 1);
  };
  const dropDraft = (key: number) => setDrafts((d) => d.filter((x) => x.key !== key));

  return (
    <>
      <TeamDefault saved={data.teamDefault} />
      <section className="schedule-weekly" aria-labelledby="weekly-nights-title">
        <h3 id="weekly-nights-title" className="schedule-subtitle">
          Weekly nights
        </h3>
        {data.nights.length || drafts.length ? (
          <div className="schedule-table-wrap">
            <table className="schedule-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Start</th>
                  <th scope="col">Length (minutes)</th>
                  <th scope="col">Timezone</th>
                  <th scope="col">Optional</th>
                  <th scope="col">Difficulty</th>
                  <th scope="col">Active</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.nights.map((n) => (
                  <WeeklyRow key={n.id} saved={draftOf(n)} teamDefault={data.teamDefault} />
                ))}
                {drafts.map(({ key, draft }) => (
                  <WeeklyRow
                    key={`new-${key}`}
                    saved={draft}
                    teamDefault={data.teamDefault}
                    onDone={() => dropDraft(key)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">No weekly raid nights are set yet.</p>
        )}
        <div>
          <button type="button" className="button" onClick={addNight}>
            + Add a night
          </button>
        </div>
      </section>
    </>
  );
}

function DifficultyOptions({ teamDefault, allowDefault }: { teamDefault: Difficulty | null; allowDefault: boolean }) {
  return (
    <>
      {allowDefault && <option value="">{defaultLabel(teamDefault)}</option>}
      {DIFFICULTIES.map((d) => (
        <option key={d} value={d}>
          {DIFFICULTY_LABELS[d]}
        </option>
      ))}
    </>
  );
}

function TeamDefault({ saved }: { saved: Difficulty | null }) {
  const team = useTeam();
  const { announce } = useStatus();
  const save = useSaveTeamDefault(team.id);
  const [value, setValue] = useState<Difficulty | null>(saved);
  const fieldId = useId();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(value, {
      onSuccess: () => announce('success', `Team default saved: ${value ? DIFFICULTY_LABELS[value] : 'not set'}.`)
    });
  };

  return (
    <form className="schedule-default" onSubmit={onSubmit}>
      <div className="field">
        <label className="field-label" htmlFor={fieldId}>
          Team default difficulty
        </label>
        <select
          id={fieldId}
          className="select"
          value={value ?? ''}
          onChange={(e) => setValue(asDifficulty(e.target.value))}
        >
          <option value="">Not set</option>
          <DifficultyOptions teamDefault={saved} allowDefault={false} />
        </select>
      </div>
      <button type="submit" className="button" disabled={save.isPending || value === saved}>
        {save.isPending ? 'Saving…' : 'Save default'}
      </button>
      <p className="field-hint">Every weekly night left on “Team default” uses this.</p>
      {save.isError && (
        <p className="form-error" role="alert">
          That did not save: {save.error.message}
        </p>
      )}
    </form>
  );
}

// One weekly night, saved on its own. `onDone` is for a new night: it leaves
// the list of unsaved ones once it saves, or when it is discarded.
function WeeklyRow({
  saved,
  teamDefault,
  onDone
}: {
  saved: NightDraft;
  teamDefault: Difficulty | null;
  onDone?: () => void;
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const save = useSaveWeeklyNight(team.id);
  const remove = useRemoveWeeklyNight(team.id);
  const [draft, setDraft] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const isNew = saved.id === null;
  const day = WEEKDAY_NAMES[draft.weekday]!;
  const set = (change: Partial<NightDraft>) => setDraft((d) => ({ ...d, ...change }));
  const zones = TIMEZONES.includes(draft.timezone) ? TIMEZONES : [...TIMEZONES, draft.timezone];
  const differs = draft.difficulty !== null;

  const onSave = () => {
    const why = draftProblem(draft);
    setProblem(why);
    if (why) return;
    save.mutate(draft, {
      onSuccess: () => {
        announce('success', `Saved the ${day} night.`);
        onDone?.();
      }
    });
  };

  const onRemove = () =>
    remove.mutate(saved.id!, {
      onSuccess: () => {
        announce('success', `Removed the weekly ${WEEKDAY_NAMES[saved.weekday]} night.`);
        setConfirming(false);
      }
    });

  const error = problem ?? (save.isError ? `That did not save: ${save.error.message}` : null);

  return (
    <tr className={differs ? 'schedule-row-differs' : undefined}>
      <td>
        <select
          className="select"
          aria-label={isNew ? 'Day of the new night' : `Day of the ${WEEKDAY_NAMES[saved.weekday]} night`}
          value={draft.weekday}
          onChange={(e) => set({ weekday: Number(e.target.value) })}
        >
          {WEEKDAY_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="time"
          className="input"
          aria-label={`${day} start time`}
          value={draft.start}
          onChange={(e) => set({ start: e.target.value })}
        />
      </td>
      <td>
        <input
          type="number"
          className="input schedule-minutes"
          min={15}
          step={15}
          aria-label={`${day} length in minutes`}
          value={draft.duration}
          onChange={(e) => set({ duration: e.target.value })}
        />
      </td>
      <td>
        <select
          className="select"
          aria-label={`${day} timezone`}
          value={draft.timezone}
          onChange={(e) => set({ timezone: e.target.value })}
        >
          {zones.map((z) => (
            <option key={z} value={z}>
              {z}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`${day} is optional`}
          checked={draft.optional}
          onChange={(e) => set({ optional: e.target.checked })}
        />
      </td>
      <td>
        <select
          className="select"
          aria-label={`${day} difficulty`}
          value={draft.difficulty ?? ''}
          onChange={(e) => set({ difficulty: asDifficulty(e.target.value) })}
        >
          <DifficultyOptions teamDefault={teamDefault} allowDefault />
        </select>
      </td>
      <td>
        <input
          type="checkbox"
          aria-label={`${day} is active`}
          checked={draft.active}
          onChange={(e) => set({ active: e.target.checked })}
        />
      </td>
      <td className="schedule-actions">
        <button
          type="button"
          className="button"
          disabled={save.isPending || (!isNew && sameDraft(draft, saved))}
          onClick={onSave}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {isNew ? (
          <button type="button" className="button" onClick={onDone}>
            Discard
          </button>
        ) : (
          <button type="button" className="button" onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
        {error && (
          <p className="form-error schedule-row-error" role="alert">
            {error}
          </p>
        )}
        {confirming && (
          <Dialog
            title={`Remove the weekly ${WEEKDAY_NAMES[saved.weekday]} night?`}
            onClose={() => setConfirming(false)}
            busy={remove.isPending}
          >
            <p>
              Raiders stop seeing it on the calendar from now on. To skip a single week instead, cancel that night from
              its own page.
            </p>
            {remove.isError && (
              <p className="form-error" role="alert">
                That did not save: {remove.error.message}
              </p>
            )}
            <div className="dialog-actions">
              <span className="grow" />
              <button type="button" className="button" onClick={() => setConfirming(false)} disabled={remove.isPending}>
                Keep it
              </button>
              <button type="button" className="button button-primary" onClick={onRemove} disabled={remove.isPending}>
                {remove.isPending ? 'Removing…' : 'Remove the night'}
              </button>
            </div>
          </Dialog>
        )}
      </td>
    </tr>
  );
}
