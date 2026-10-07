import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import { longDay, shortDay, type CancelledNight, type RaidNight } from './calendar';
import {
  asDifficulty,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  extraNightProblem,
  NEW_EXTRA_NIGHT,
  type ExtraNight
} from './schedule';
import { useAddDateChange, useRemoveDateChange } from './useSchedule';

// One-off schedule changes, made from the day itself (#1361, Kat 2026-10-06):
// cancel a night from its own page, bring a cancelled one back, or add an
// extra night on an empty day. Only for today and later, and only on a
// computer, like the Calendar's other officer tools.

// The Officer bar on a raid night's page.
export function NightOfficerBar({ night, teamMemberId }: { night: RaidNight; teamMemberId: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card officer-bar">
      <span className="eyebrow">Officer</span>
      <span className="grow" />
      <button type="button" className="button" onClick={() => setOpen(true)}>
        {night.extra ? 'Remove this extra night' : 'Cancel this night'}
      </button>
      {open &&
        (night.extra ? (
          <RemoveExtraDialog night={night} onClose={() => setOpen(false)} />
        ) : (
          <CancelDialog night={night} teamMemberId={teamMemberId} onClose={() => setOpen(false)} />
        ))}
    </div>
  );
}

function CancelDialog({
  night,
  teamMemberId,
  onClose
}: {
  night: RaidNight;
  teamMemberId: number | null;
  onClose: () => void;
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const add = useAddDateChange(team.id);
  const [note, setNote] = useState('');
  const noteId = useId();
  const day = longDay(night.date);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate(
      { kind: 'cancelled', date: night.date, note, teamMemberId },
      {
        onSuccess: () => {
          announce('success', `${day} is cancelled.`);
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title={`Cancel ${day}?`} onClose={onClose} busy={add.isPending}>
      <form onSubmit={onSubmit} noValidate>
        <p>Only this date. The weekly night stays as it is. Raiders see this night marked Cancelled on the calendar.</p>
        <div className="field">
          <label className="field-label" htmlFor={noteId}>
            Why (raiders see it, optional)
          </label>
          <input
            id={noteId}
            className="input"
            value={note}
            placeholder="For example, Thanksgiving"
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {add.isError && (
          <p className="form-error" role="alert">
            That did not save: {add.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <span className="grow" />
          <button type="button" className="button" onClick={onClose} disabled={add.isPending}>
            Keep the night
          </button>
          <button type="submit" className="button button-primary" disabled={add.isPending}>
            {add.isPending ? 'Cancelling…' : 'Cancel the night'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RemoveExtraDialog({ night, onClose }: { night: RaidNight; onClose: () => void }) {
  const team = useTeam();
  const { announce } = useStatus();
  const remove = useRemoveDateChange(team.id);
  const day = longDay(night.date);
  const onRemove = () =>
    remove.mutate(night.changeId!, {
      onSuccess: () => {
        announce('success', `The extra night on ${shortDay(night.date)} is off the calendar.`);
        onClose();
      }
    });

  return (
    <Dialog title={`Remove the extra night on ${day}?`} onClose={onClose} busy={remove.isPending}>
      <p>It comes off the calendar for everyone.</p>
      {remove.isError && (
        <p className="form-error" role="alert">
          That did not save: {remove.error.message}
        </p>
      )}
      <div className="dialog-actions">
        <span className="grow" />
        <button type="button" className="button" onClick={onClose} disabled={remove.isPending}>
          Keep the night
        </button>
        <button type="button" className="button button-primary" onClick={onRemove} disabled={remove.isPending}>
          {remove.isPending ? 'Removing…' : 'Remove the night'}
        </button>
      </div>
    </Dialog>
  );
}

// A cancelled night's page: the reason, and for an officer a way back.
export function CancelledNightCard({ cancelled, officer }: { cancelled: CancelledNight; officer: boolean }) {
  const team = useTeam();
  const { announce } = useStatus();
  const remove = useRemoveDateChange(team.id);
  const bringBack = () =>
    remove.mutate(cancelled.changeId!, {
      onSuccess: () => announce('success', `${longDay(cancelled.date)} is back on the calendar.`)
    });

  return (
    <>
      <div className="card calendar-note">
        <p>This raid night was cancelled.</p>
        {cancelled.note && <p className="text-muted cancelled-note">{cancelled.note}</p>}
      </div>
      {officer && cancelled.changeId !== undefined && (
        <div className="card officer-bar">
          <span className="eyebrow">Officer</span>
          <span className="grow" />
          {remove.isError && (
            <p className="form-error" role="alert">
              That did not save: {remove.error.message}
            </p>
          )}
          <button type="button" className="button" onClick={bringBack} disabled={remove.isPending}>
            {remove.isPending ? 'Bringing it back…' : 'Bring this night back'}
          </button>
        </div>
      )}
    </>
  );
}

// An empty day's page, for an officer: add a one-off extra night. The night
// must name its difficulty (Kat, 2026-10-06).
export function AddNightForm({ date, teamMemberId }: { date: string; teamMemberId: number | null }) {
  const team = useTeam();
  const { announce } = useStatus();
  const add = useAddDateChange(team.id);
  const [night, setNight] = useState<ExtraNight>(NEW_EXTRA_NIGHT);
  const [problem, setProblem] = useState<string | null>(null);
  const id = useId();
  const set = (change: Partial<ExtraNight>) => setNight((n) => ({ ...n, ...change }));

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const why = extraNightProblem(night);
    setProblem(why);
    if (why) return;
    add.mutate(
      { kind: 'added', date, teamMemberId, ...night },
      { onSuccess: () => announce('success', `Added a raid night on ${longDay(date)}.`) }
    );
  };

  return (
    <form className="card add-night" aria-labelledby={`${id}-title`} onSubmit={onSubmit} noValidate>
      <span className="eyebrow">Officer</span>
      <h2 id={`${id}-title`} className="add-night-title">
        Add a raid night here
      </h2>
      <p className="text-muted">A one-off night on {longDay(date)} only. It doesn’t change the weekly schedule.</p>
      <div className="add-night-fields">
        <div className="field">
          <label className="field-label" htmlFor={`${id}-start`}>
            Start
          </label>
          <input
            id={`${id}-start`}
            type="time"
            className="input"
            value={night.start}
            onChange={(e) => set({ start: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-length`}>
            Length (minutes)
          </label>
          <input
            id={`${id}-length`}
            type="number"
            min={15}
            step={15}
            className="input"
            value={night.duration}
            onChange={(e) => set({ duration: e.target.value })}
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-difficulty`}>
            Difficulty (required)
          </label>
          <select
            id={`${id}-difficulty`}
            className="select"
            value={night.difficulty ?? ''}
            aria-invalid={problem !== null && !night.difficulty}
            aria-describedby={`${id}-difficulty-hint`}
            onChange={(e) => set({ difficulty: asDifficulty(e.target.value) })}
          >
            <option value="">Choose one</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p id={`${id}-difficulty-hint`} className="field-hint">
        Extra nights don’t follow the team default. Pick what this night is for, such as a Heroic reclear or extra
        Mythic progression.
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={night.optional} onChange={(e) => set({ optional: e.target.checked })} />
        Optional night: raiders say if they’re coming, instead of being expected
      </label>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-note`}>
          Note (raiders see it, optional)
        </label>
        <input
          id={`${id}-note`}
          className="input"
          value={night.note}
          placeholder="For example, extra progression night"
          onChange={(e) => set({ note: e.target.value })}
        />
      </div>
      {(problem || add.isError) && (
        <p className="form-error" role="alert">
          {problem ?? `That did not save: ${add.error!.message}`}
        </p>
      )}
      <div className="add-night-actions">
        <button type="submit" className="button button-primary" disabled={add.isPending || !night.difficulty}>
          {add.isPending ? 'Adding…' : 'Add the night'}
        </button>
      </div>
    </form>
  );
}
