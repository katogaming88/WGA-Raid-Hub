// React port of js/calendar.js's _renderCalGrid (#892/#903). Pure view layer
// only -- every bit of data-fetching and business logic (fetchSupabase*,
// computeRaidNights, _calResolveMyPlayer) stays in vanilla js/calendar.js and
// is passed in here as already-computed props. That split is the point of
// this spike: prove the view layer can swap to React while the rest of the
// site's shared data/state model stays untouched.
//
// Markup/classnames are kept byte-for-byte identical to the vanilla version
// so the existing css/styles.css rules (.mini-cal-*, .calendar-status-*,
// .calendar-legend-*) keep working with zero CSS changes.

const CAL_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CAL_STATUS_LABELS = { present: 'Present', pending: 'No Response' };

function isoDate(d) {
  let mm = String(d.getMonth() + 1);
  if (mm.length < 2) mm = '0' + mm;
  let dd = String(d.getDate());
  if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}

// Mirrors js/calendar.js's _calOverrideClass exactly (see that file for the
// reasoning behind which statuses share the "present"/"tentative" styling).
function overrideClass(status) {
  if (status === 'Absent') return 'absent';
  if (status === 'Attending' || status === 'Rotator-In') return 'present';
  return 'tentative';
}

function groupNightsByDate(nights) {
  const byDate = {};
  nights.forEach((n) => {
    (byDate[n.date] = byDate[n.date] || []).push(n);
  });
  return byDate;
}

export default function CalendarGrid({
  year,
  month,
  nights,
  myOverridesByDate = {},
  compact = false,
  teamName,
  teamSlug,
  rosterCount = 0,
  benchCount = 0,
  dayViewHref,
  onNavMonth
}) {
  const today = new Date();
  const monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' }) + ' ' + year;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const byDate = groupNightsByDate(nights);
  const attending = Math.max(0, rosterCount - benchCount);
  const usedStatuses = {};

  const cells = [];
  for (let pad = 0; pad < firstWeekday; pad++) {
    cells.push(<div key={'pad' + pad} className="mini-cal-day mini-cal-day-pad" />);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cellDate = new Date(year, month, day);
    const dateStr = isoDate(cellDate);
    const dayNights = byDate[dateStr] || [];
    const isRaidDay = dayNights.length > 0;
    const isToday = isoDate(today) === dateStr;

    let statusEl = null;
    let countEl = null;
    if (isRaidDay) {
      const myOverride = myOverridesByDate[dateStr];
      const anyOptional = dayNights.some((n) => n.isOptional);
      let statusClass, statusLabel;
      if (myOverride) {
        statusClass = overrideClass(myOverride.status);
        statusLabel = myOverride.status;
      } else {
        statusClass = anyOptional ? 'tentative' : 'present';
        statusLabel = anyOptional ? CAL_STATUS_LABELS.pending : CAL_STATUS_LABELS.present;
      }
      usedStatuses[statusLabel] = statusClass;
      statusEl = (
        <span
          className={'calendar-status calendar-status-' + statusClass}
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        />
      );
      if (rosterCount && !myOverride && !anyOptional) {
        countEl = (
          <span className="mini-cal-daycount">
            {attending}/{rosterCount}
          </span>
        );
      }
    }

    const className =
      'mini-cal-day' +
      (isRaidDay ? ' mini-cal-day-raid mini-cal-day-clickable' : '') +
      (isToday ? ' mini-cal-day-today' : '');
    const dayNum = <span className="mini-cal-daynum">{day}</span>;

    cells.push(
      isRaidDay ? (
        <a key={dateStr} href={dayViewHref(dateStr)} className={className}>
          {dayNum}
          {countEl}
          {statusEl}
        </a>
      ) : (
        <div key={dateStr} className={className}>
          {dayNum}
        </div>
      )
    );
  }

  const legendItems = Object.keys(usedStatuses).map((label) => (
    <span key={label} className="calendar-legend-item">
      <span className={'calendar-status calendar-status-' + usedStatuses[label]} aria-hidden="true" />
      {label}
    </span>
  ));
  if (benchCount) {
    legendItems.push(
      <span key="bench" className="calendar-legend-item">
        {benchCount} on Bench (excluded from the count above)
      </span>
    );
  }

  return (
    <>
      <h2 className="pub-loot-title">Calendar{compact ? '' : ' -- ' + teamName}</h2>
      <div className="mini-cal">
        <div className="mini-cal-header">
          {!compact && (
            <div className="mini-cal-nav">
              <button
                type="button"
                className="btn btn-muted mini-cal-nav-btn"
                onClick={() => onNavMonth(-1)}
                aria-label="Previous month"
              >
                &#8249;
              </button>
              <button
                type="button"
                className="btn btn-muted mini-cal-nav-btn"
                onClick={() => onNavMonth(1)}
                aria-label="Next month"
              >
                &#8250;
              </button>
            </div>
          )}
          {/* h3, not the bare <span> the vanilla version used -- "January
              2026" is the heading for this widget's content, and a screen
              reader needs it in the heading outline to jump here directly.
              font: inherit keeps .mini-cal-header's own type styling instead
              of the browser's default h3 size/weight/margin. */}
          <h3 style={{ font: 'inherit', margin: 0 }}>{monthLabel}</h3>
        </div>
        <div className="mini-cal-weekdays">
          {CAL_WEEKDAY_LABELS.map((d) => (
            <span key={d} className="mini-cal-weekday">
              {d}
            </span>
          ))}
        </div>
        <div className="mini-cal-grid">{cells}</div>
      </div>
      <div className="calendar-legend">{legendItems}</div>
      {compact && (
        <a className="footer-link" href={'calendar.html' + (teamSlug !== 'phoenix' ? '?team=' + teamSlug : '')}>
          View full calendar &#8250;
        </a>
      )}
    </>
  );
}
