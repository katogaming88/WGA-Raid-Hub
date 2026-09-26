import { useId, useState, type FormEvent } from 'react';
import { Dialog } from '../components/Dialog';
import { useStatus } from '../components/Status';
import { useTeam } from '../data/address';
import type { PriorityRow } from './lootPriority';
import { useSubmitMplusRequest, useSubmitReport, type ProfilePlayer, type Report } from './useProfile';

// The profile's two forms (#868 part 4), each in a dialog. Both work on a
// phone (Kat, 2026-09-14): each has a Submit and a Cancel, so a stray tap
// saves nothing.

// Mark Received sources. Weekly quest and Pug raid are new (Kat, 2026-09-14);
// Other still goes to an officer.
export const REPORT_SOURCES = [
  'M+',
  'Great Vault',
  'Crafted',
  'Catalyst',
  'Bonus Roll',
  'Weekly quest',
  'Pug raid',
  'Other'
];

const DIFFICULTIES: { value: Report['track']; label: string }[] = [
  { value: 'Myth', label: 'Mythic' },
  { value: 'Hero', label: 'Heroic' },
  { value: 'Champion', label: 'Champion (Normal)' }
];

export function MarkReceivedButton({ player, row }: { player: ProfilePlayer; row: PriorityRow }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="button mark-received"
        aria-label={`Mark ${row.item} received`}
        onClick={() => setOpen(true)}
      >
        Mark received
      </button>
      {open && <MarkReceivedDialog player={player} row={row} onClose={() => setOpen(false)} />}
    </>
  );
}

function MarkReceivedDialog({
  player,
  row,
  onClose
}: {
  player: ProfilePlayer;
  row: PriorityRow;
  onClose: () => void;
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const submit = useSubmitReport(team.id, player.id);
  const id = useId();
  const [track, setTrack] = useState('');
  // A crafted or M+ pick starts on its own source: a real item by its catalog
  // source, a placeholder by its name.
  const [source, setSource] = useState(
    row.source === 'dungeon'
      ? 'M+'
      : row.source === 'crafted'
        ? 'Crafted'
        : row.placeholder && REPORT_SOURCES.includes(row.itemName)
          ? row.itemName
          : ''
  );
  const [note, setNote] = useState('');
  const [missing, setMissing] = useState(false);
  // Other goes to an officer, who needs to know where it came from (Kat,
  // 2026-09-14). The database refuses one without a note as well.
  const noteRequired = source === 'Other';
  const noteMissing = noteRequired && note.trim() === '';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!track || !source || noteMissing) {
      setMissing(true);
      return;
    }
    submit.mutate(
      {
        teamKey: team.key,
        nameRealm: player.name_realm,
        itemName: row.itemName,
        slot: row.slot,
        track: track as Report['track'],
        source,
        note: note.trim()
      },
      {
        onSuccess: ({ autoApproved }) => {
          announce(
            'success',
            autoApproved ? `Marked ${row.item} as received.` : `Sent ${row.item} to an officer for review.`
          );
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title="Mark received" onClose={onClose} busy={submit.isPending}>
      <form className="report-form" onSubmit={onSubmit} noValidate>
        <p>
          <span className="report-item">{row.item}</span> <span className="text-muted">{row.slot}</span>
        </p>
        <p className="field-hint">
          Only for gear from outside a guild raid. Guild raid drops show up on their own after the loot import.
        </p>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-track`}>
            Difficulty
          </label>
          <select
            id={`${id}-track`}
            className="select"
            value={track}
            aria-invalid={missing && !track}
            onChange={(e) => setTrack(e.target.value)}
          >
            <option value="">Choose…</option>
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-source`}>
            How did you get it?
          </label>
          <select
            id={`${id}-source`}
            className="select"
            value={source}
            aria-invalid={missing && !source}
            aria-describedby={`${id}-source-hint`}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="">Choose…</option>
            {REPORT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <p id={`${id}-source-hint`} className="field-hint">
            {source === 'Other'
              ? 'An officer reviews Other before it counts, so say where it came from below.'
              : 'Counts right away and takes you off this item’s Priority List.'}
          </p>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>
            {noteRequired ? 'Where did it come from?' : 'Notes (optional)'}
          </label>
          <textarea
            id={`${id}-note`}
            className="textarea"
            value={note}
            required={noteRequired}
            aria-invalid={missing && noteMissing}
            placeholder={noteRequired ? 'For example, Timewalking vendor, or traded by a teammate' : undefined}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {missing && (!track || !source) && (
          <p className="form-error" role="alert">
            Choose a difficulty and how you got it.
          </p>
        )}
        {missing && track && source && noteMissing && (
          <p className="form-error" role="alert">
            Say where it came from. An officer reviews Other reports.
          </p>
        )}
        {submit.isError && (
          <p className="form-error" role="alert">
            That did not save: {submit.error.message}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={submit.isPending}>
            {submit.isPending ? 'Saving…' : 'Mark received'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function MplusRequestButton({
  player,
  raiderIoUrl,
  again
}: {
  player: ProfilePlayer;
  raiderIoUrl: string;
  again: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="button mplus-request" onClick={() => setOpen(true)}>
        {again ? 'Request again' : 'Request M+ exclusion'}
      </button>
      {open && <MplusRequestDialog player={player} raiderIoUrl={raiderIoUrl} onClose={() => setOpen(false)} />}
    </>
  );
}

function MplusRequestDialog({
  player,
  raiderIoUrl,
  onClose
}: {
  player: ProfilePlayer;
  raiderIoUrl: string;
  onClose: () => void;
}) {
  const team = useTeam();
  const { announce } = useStatus();
  const submit = useSubmitMplusRequest(team.id, player.id);
  const id = useId();
  const [myth, setMyth] = useState(false);
  const [sockets, setSockets] = useState('');
  const [url, setUrl] = useState(raiderIoUrl);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  // Myth track in every M+ slot and at least 2 of 3 gem sockets, as today.
  const ready = myth && sockets !== '' && Number(sockets) >= 2 && url.trim() !== '';

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (!ready) return;
    submit.mutate(
      { teamKey: team.key, nameRealm: player.name_realm, raiderioUrl: url.trim(), reason: reason.trim() },
      {
        onSuccess: () => {
          announce('success', 'M+ exclusion request sent. An officer will review it.');
          onClose();
        }
      }
    );
  };

  return (
    <Dialog title="Request M+ exclusion" onClose={onClose} busy={submit.isPending}>
      <form className="mplus-form" onSubmit={onSubmit} noValidate>
        <p>Ask to stop being required to run the weekly M+ dungeons. An officer reviews every request.</p>

        <label className="checkbox">
          <input type="checkbox" checked={myth} onChange={(e) => setMyth(e.target.checked)} />
          <span>I am 6/6 Myth in every slot M+ can fill.</span>
        </label>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-sockets`}>
            Gem sockets filled (helm, bracers, belt)
          </label>
          <select
            id={`${id}-sockets`}
            className="select"
            value={sockets}
            aria-invalid={tried && (sockets === '' || Number(sockets) < 2)}
            onChange={(e) => setSockets(e.target.value)}
          >
            <option value="">Choose…</option>
            {[3, 2, 1, 0].map((n) => (
              <option key={n} value={n}>
                {n} of 3
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-url`}>
            Raider.IO profile
          </label>
          <input
            id={`${id}-url`}
            className="input"
            type="url"
            value={url}
            aria-invalid={tried && url.trim() === ''}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor={`${id}-reason`}>
            Notes (optional)
          </label>
          <textarea
            id={`${id}-reason`}
            className="textarea"
            placeholder="For example, still on a Heroic raid trinket with no Mythic M+ equivalent"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {tried && !ready && (
          <p className="form-error" role="alert">
            Confirm Myth track in every M+ slot and at least 2 of 3 gem sockets, with your Raider.IO profile.
          </p>
        )}
        {submit.isError && (
          <p className="form-error" role="alert">
            That did not send: {submit.error.message}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={submit.isPending}>
            {submit.isPending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
