// React port of js/calendar.js's day-detail view (_renderDayView and its
// RSVP-editing family, #903). Same split as CalendarGrid.jsx: every Supabase
// call (set_own_rsvp, officer_set_rsvp, officer_set_rotator_week) and the
// post-save side effects (_notifyRsvpBot, _syncSignupSheet,
// _calInvalidateDateMonth, re-running buildCalendarWidget) stay in vanilla
// js/calendar.js and are passed in as callback props -- this component only
// owns view state (which status chip is selected, note text, the officer
// modal's open/closed state) that used to live in module-level _cal* vars
// and be pushed into the DOM by hand.
//
// This is a much better fit for React than the grid was: the grid was a
// static render with no interaction state of its own, so JSX only bought
// authoring convenience. This view has five pieces of state that used to be
// tracked as bare module-level variables and manually kept in sync with the
// DOM on every change (_calMyStatus, the note textarea's value, the error
// message, the officer-edit modal's target player/date/status, its own
// note/error) -- useState replaces all of that bookkeeping outright.

import { Fragment, useState } from 'react';

const CAL_RSVP_STATUSES = ['Late', 'Leaving Early', 'Tentative', 'Absent'];
const CAL_STATUS_LABELS = { present: 'Present', pending: 'No Response' };

function overrideClass(status) {
  if (status === 'Absent') return 'absent';
  if (status === 'Attending' || status === 'Rotator-In') return 'present';
  return 'tentative';
}

function statusClass(status) {
  if (status === 'Bench' || status === 'Rotator' || status === CAL_STATUS_LABELS.pending) return 'tentative';
  if (status === CAL_STATUS_LABELS.present) return 'present';
  return overrideClass(status);
}

// Mirrors js/calendar.js's _calDayStatus exactly -- a player's effective
// status for this night: their own override if one exists, else the same
// computed default the month grid uses.
function dayStatus(player, night, rsvpsByPlayer) {
  const override = rsvpsByPlayer[player.id];
  if (override) return { status: override.status, note: override.note || '', isOverride: true };
  if (!night) return { status: null, note: '', isOverride: false };
  if (player.isBench && !night.isOptional) return { status: 'Bench', note: '', isOverride: false };
  if (player.isRotator && !night.isOptional) return { status: 'Rotator', note: '', isOverride: false };
  return {
    status: night.isOptional ? CAL_STATUS_LABELS.pending : CAL_STATUS_LABELS.present,
    note: '',
    isOverride: false
  };
}

function StatusChips({ statuses, selected, onSelect }) {
  return (
    <>
      {statuses.map((status) => (
        <button
          key={status}
          type="button"
          className={'filter-chip' + (status === selected ? ' active' : '')}
          onClick={() => onSelect(status)}
        >
          {status}
        </button>
      ))}
    </>
  );
}

function MyStatusSection({ dateStr, night, myPlayer, existing, onSave, onClear }) {
  const isOptional = !!night.isOptional;
  const [status, setStatus] = useState(existing ? existing.status : null);
  const [note, setNote] = useState((existing && existing.note) || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const currentLabel = existing
    ? existing.status
    : myPlayer.isRotator && !night.isOptional
      ? 'Rotator'
      : night.isOptional
        ? CAL_STATUS_LABELS.pending
        : CAL_STATUS_LABELS.present;

  const statuses = isOptional ? ['Attending', ...CAL_RSVP_STATUSES] : CAL_RSVP_STATUSES;

  function handleSave() {
    if (!status) return;
    const trimmed = note.trim();
    if (status !== 'Attending' && !trimmed) {
      setError('A note is required so officers know why.');
      return;
    }
    setSaving(true);
    onSave(dateStr, status, trimmed).then((result) => {
      setSaving(false);
      if (result.error) setError(result.error.message);
    });
  }

  function handleClear() {
    setSaving(true);
    onClear(dateStr, note.trim() || null).then((result) => {
      setSaving(false);
      if (result.error) setError(result.error.message);
    });
  }

  return (
    <div className="day-view-my-status">
      <div className="day-view-my-status-header">
        <h3 className="pub-loot-title" style={{ margin: 0 }}>
          Your status
        </h3>
        <span className="day-roster-status-label">
          <span className={'calendar-status calendar-status-' + statusClass(currentLabel)} />
          {currentLabel}
        </span>
      </div>
      <div className="rsvp-status-options">
        <StatusChips statuses={statuses} selected={status} onSelect={setStatus} />
      </div>
      <textarea
        className="rsvp-note"
        placeholder="Note (required, visible to officers)"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p style={{ fontSize: '0.88rem', color: 'var(--melee)' }}>{error}</p>}
      <div className="prompt-buttons rsvp-prompt-buttons">
        <button type="button" className="btn btn-muted" disabled={saving} onClick={handleClear}>
          Clear (back to default)
        </button>
        <button type="button" className="btn btn-gold" disabled={saving} onClick={handleSave}>
          Save
        </button>
      </div>
    </div>
  );
}

function OfficerEditModal({ target, isOptional, onClose, onSave, onClear }) {
  const [status, setStatus] = useState(target ? target.status : null);
  const [note, setNote] = useState((target && target.note) || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // target flips on every "Edit" click (see RosterBreakdown below); reset
  // the form's local state to match whichever row was just opened instead of
  // carrying over the previous player's in-progress edit.
  const [openedFor, setOpenedFor] = useState(target);
  if (target !== openedFor) {
    setOpenedFor(target);
    setStatus(target ? target.status : null);
    setNote((target && target.note) || '');
    setError('');
  }

  const statuses = isOptional ? ['Attending', ...CAL_RSVP_STATUSES] : CAL_RSVP_STATUSES;

  function handleSave() {
    const trimmed = note.trim();
    if (!trimmed) {
      setError('A note is required so the raider knows why.');
      return;
    }
    setSaving(true);
    onSave(target.playerId, target.dateStr, status, trimmed).then((result) => {
      setSaving(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      onClose();
    });
  }

  function handleClear() {
    setSaving(true);
    onClear(target.playerId, target.dateStr, note.trim() || null).then((result) => {
      setSaving(false);
      if (result.error) {
        setError(result.error.message);
        return;
      }
      onClose();
    });
  }

  return (
    <div id="officerRsvpEditModal" className={'officer-prompt' + (target ? ' active' : '')}>
      <div className="officer-prompt-box">
        <h2>Correct status</h2>
        <div className="rsvp-status-options">
          <StatusChips statuses={statuses} selected={status} onSelect={setStatus} />
        </div>
        <textarea
          className="rsvp-note"
          placeholder="Note (required, visible to the raider)"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {error && <p style={{ fontSize: '0.88rem', color: 'var(--melee)' }}>{error}</p>}
        <div className="prompt-buttons rsvp-prompt-buttons">
          <button type="button" className="btn btn-muted" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-muted" disabled={saving} onClick={handleClear}>
            Clear (back to default)
          </button>
          <button type="button" className="btn btn-gold" disabled={saving} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RosterBreakdown({
  dateStr,
  roster,
  night,
  rsvpsByPlayer,
  isOfficer,
  groupRosterByRole,
  classColors,
  onEdit,
  onToggleRotator
}) {
  const { order, labels, groups } = groupRosterByRole(roster);
  return (
    <>
      <h3 className="pub-loot-title">Roster</h3>
      <table className="roster-table">
        <tbody>
          {order.map((role) => {
            const players = groups[role];
            if (!players.length) return null;
            const sorted = [...players].sort((a, b) => (a.nick || a.firstName).localeCompare(b.nick || b.firstName));
            return (
              <Fragment key={role}>
                <tr className="group-header">
                  <td colSpan={2}>{labels[role]}</td>
                </tr>
                {sorted.map((p) => {
                  const s = dayStatus(p, night, rsvpsByPlayer);
                  const dispName = p.nick || p.firstName;
                  const color = classColors[p.class];
                  return (
                    <tr key={p.id}>
                      <td>{color ? <span style={{ color }}>{dispName}</span> : dispName}</td>
                      <td className="day-roster-status">
                        <span className="day-roster-status-label">
                          <span className={'calendar-status calendar-status-' + statusClass(s.status)} />
                          {s.status}
                        </span>
                        <span className="day-roster-note">{s.note || ''}</span>
                        {isOfficer && (
                          <button type="button" className="day-roster-edit-btn" onClick={() => onEdit(p.id, dateStr)}>
                            Edit
                          </button>
                        )}
                        {isOfficer && p.isRotator && (
                          <button
                            type="button"
                            className="day-roster-edit-btn"
                            onClick={() => onToggleRotator(p.id, dateStr, s.status !== 'Rotator-In')}
                          >
                            {s.status === 'Rotator-In' ? 'Remove from week' : 'Set in for week'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

export default function DayView({
  dateStr,
  night,
  rsvpsByPlayer,
  myPlayer,
  isOfficer,
  roster,
  teamSlug,
  groupRosterByRole,
  classColors,
  dayViewHref,
  addDays,
  onSaveMyStatus,
  onClearMyStatus,
  onSaveOfficerStatus,
  onClearOfficerStatus,
  onToggleRotator
}) {
  const [officerTarget, setOfficerTarget] = useState(null);

  const d = new Date(dateStr + 'T00:00:00');
  const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const backHref = 'calendar.html' + (teamSlug !== 'phoenix' ? '?team=' + teamSlug : '');

  function openOfficerEdit(playerId, editDateStr) {
    const existing = rsvpsByPlayer[playerId];
    setOfficerTarget({
      playerId,
      dateStr: editDateStr,
      status: existing ? existing.status : null,
      note: (existing && existing.note) || ''
    });
  }

  const header = (
    <>
      <a className="footer-link day-view-back" href={backHref}>
        &#8249; Back to calendar
      </a>
      <div className="day-view-header">
        <a
          className="btn btn-muted mini-cal-nav-btn"
          href={dayViewHref(addDays(dateStr, -1))}
          aria-label="Previous day"
        >
          &#8592;
        </a>
        {/* h2, not the vanilla bare <span> -- this is the page's content
            heading (the page's <h1> is the site/team name in the header). */}
        <h2 className="day-view-date">{dateLabel}</h2>
        <a className="btn btn-muted mini-cal-nav-btn" href={dayViewHref(addDays(dateStr, 1))} aria-label="Next day">
          &#8594;
        </a>
      </div>
    </>
  );

  if (!night) {
    return (
      <>
        {header}
        <p style={{ color: 'var(--text-muted)' }}>No raid scheduled for this date.</p>
      </>
    );
  }

  const counts = { inCount: 0, outCount: 0, noResponse: 0 };
  roster.forEach((p) => {
    const s = dayStatus(p, night, rsvpsByPlayer);
    if (s.status === 'Bench') return;
    if (s.status === 'Absent') counts.outCount++;
    else if (s.status === CAL_STATUS_LABELS.pending) counts.noResponse++;
    else counts.inCount++;
  });

  const showMyStatus = myPlayer && !(myPlayer.isBench && !night.isOptional);

  return (
    <>
      {header}
      <div className="day-view-counts">
        <span>
          <strong>{counts.inCount}</strong> in
        </span>
        <span>
          <strong>{counts.outCount}</strong> out
        </span>
        <span>
          <strong>{counts.noResponse}</strong> haven&apos;t answered
        </span>
      </div>
      {showMyStatus && (
        <MyStatusSection
          dateStr={dateStr}
          night={night}
          myPlayer={myPlayer}
          existing={rsvpsByPlayer[myPlayer.id]}
          onSave={onSaveMyStatus}
          onClear={onClearMyStatus}
        />
      )}
      <RosterBreakdown
        dateStr={dateStr}
        roster={roster}
        night={night}
        rsvpsByPlayer={rsvpsByPlayer}
        isOfficer={isOfficer}
        groupRosterByRole={groupRosterByRole}
        classColors={classColors}
        onEdit={openOfficerEdit}
        onToggleRotator={onToggleRotator}
      />
      <OfficerEditModal
        target={officerTarget}
        isOptional={!!night.isOptional}
        onClose={() => setOfficerTarget(null)}
        onSave={onSaveOfficerStatus}
        onClear={onClearOfficerStatus}
      />
    </>
  );
}
