// Raid calendar (#892, part of #640). Phase 1: schedule schema + a
// real-data, read-only calendar. Replaces the mock buildCalendarPreview()
// that lived on the redesign/visual-style-layout branch (js/roster.js,
// #864) -- same .mini-cal-* markup/CSS, real data instead of hardcoded
// weekdays and deterministic fake statuses.
//
// Raid nights are computed on the fly from raid_schedule (the recurring
// weekly rule) + raid_schedule_exceptions (one-off cancel/add), not stored
// as per-instance rows -- see the migration's header comment and
// docs/database-decisions.md for why.
//
// #893 (Phase 2) adds the signed-in raider's own override, and #903 (Phase 5)
// grows that into a full per-day detail view with its own URL
// (calendar.html?date=YYYY-MM-DD) instead of a modal: every raid day on both
// the full calendar and the Home widget is a real link to that URL (see
// _calDayViewHref/_renderCalGrid), the destination shows the own-status
// control at the top (still calling set_own_rsvp()) plus a full roster
// breakdown grouped by role, and an officer can correct another raider's
// status inline via the new officer_set_rsvp() RPC. The grid shows the
// caller's own override in place of the computed default (Present, or No
// Response on an optional night -- #895/Phase 4) once one exists. Bench
// raiders get no self-service override on a normal night (Bench is never
// raider-editable there, enforced server-side too) -- but DO get one on an
// optional night (#895), since an optional night has no default for anyone
// and bench is exactly who might get pulled in for it. See
// set_own_rsvp()'s relaxed bench guard; officer_set_rsvp() has no such gate
// at all, since a correction should be able to fix any player's row.

var _CAL_WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var _CAL_STATUS_LABELS = { present: 'Present', pending: 'No Response' };
// The four raider-facing override statuses offered on every raid night
// (#893). 'Attending' (#895) is also a valid raid_rsvps.status value, but
// only offered -- and accepted by set_own_rsvp() -- on an optional night;
// see _renderMyRsvpStatusOptions().
var _CAL_RSVP_STATUSES = ['Late', 'Leaving Early', 'Tentative', 'Absent'];

var _calDataCache = {};
var _calViewYear = null;
var _calViewMonth = null;

// Everything below through _calOfficerEditIsOptional is UNUSED as of the
// React-swap spike -- state now lives as useState in web/calendar/
// DayView.jsx. Kept only because the dead render functions further down
// still reference these names; delete both together.
//
// Own-status control state (day view, #903) -- mirrors the old RSVP modal's
// state, just rendered inline instead of in an overlay.
var _calMyStatus = null;
var _calMyIsOptional = false;

// Cache of the last day-view render's data (dead code below reads these by
// name) -- see _renderDayView's live version for the React equivalent.
var _calDayViewRsvpsByPlayer = {};
var _calDayViewNight = null;

// Officer correction popup state (#903) -- a separate small state block
// since it targets a different player than _calMyStatus.
var _calOfficerEditPlayerId = null;
var _calOfficerEditDate = null;
var _calOfficerEditStatus = null;
var _calOfficerEditIsOptional = false;

function _calDateParam() {
  return new URLSearchParams(location.search).get('date');
}

// Callbacks invoked by discord.js once login state is known. calendar.html
// also loads js/officer-quick-actions.js, which defines onDiscordInitNoSession
// (calls _qaRefresh()) but deliberately not onDiscordSessionRestored -- this
// file loads after it, so a same-named declaration here wins/shadows it
// (#371), same collision js/roster.js's own onDiscordSessionRestored already
// documents. Call _qaRefresh() ourselves in both so officer-quick-actions.js's
// UI still reacts on this page. Re-render here (rather than a one-shot deep
// link resolver) because the day view's own-status control and officer edit
// affordances both depend on login state that isn't known on first paint.
function onDiscordSessionRestored(session) {
  if (typeof _qaRefresh === 'function') _qaRefresh();
  buildCalendarWidget('full');
}
function onDiscordInitNoSession() {
  if (typeof _qaRefresh === 'function') _qaRefresh();
  buildCalendarWidget('full');
}

// Every raid day (full calendar + Home widget) and the day view's prev/next
// arrows link here (#903) -- a plain navigation/reload, matching this site's
// multi-page-static-site convention (no client-side router, no history API).
function _calDayViewHref(dateStr) {
  var qs = 'date=' + dateStr;
  if (TEAM_SLUG !== 'phoenix') qs += '&team=' + TEAM_SLUG;
  return 'calendar.html?' + qs;
}

function _calAddDays(dateStr, delta) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return _calIsoDate(d);
}

function _calIsoDate(d) {
  var mm = String(d.getMonth() + 1);
  if (mm.length < 2) mm = '0' + mm;
  var dd = String(d.getDate());
  if (dd.length < 2) dd = '0' + dd;
  return d.getFullYear() + '-' + mm + '-' + dd;
}

function fetchSupabaseRaidSchedule() {
  if (!supabaseClient) return Promise.resolve([]);
  // team-read-guard: raid_schedule is one row per weekday/time slot a team
  // raids (UNIQUE on team_id/weekday/start_time), nowhere near the 1000-row cap.
  return supabaseClient
    .from('raid_schedule')
    .select('weekday, start_time, duration_minutes, active, is_optional')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('active', true)
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase raid_schedule query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase raid_schedule query failed.', err);
        return [];
      }
    );
}

function fetchSupabaseRaidScheduleExceptions(rangeStart, rangeEnd) {
  if (!supabaseClient) return Promise.resolve([]);
  // team-read-guard: bounded to the one visible month below (rangeStart/
  // rangeEnd), well under the 1000-row cap -- unlike raid_schedule above,
  // this table is not bounded on its own (one row per exceptional date ever).
  return supabaseClient
    .from('raid_schedule_exceptions')
    .select('raid_date, exception_type, start_time, duration_minutes, is_optional, note')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .gte('raid_date', _calIsoDate(rangeStart))
    .lte('raid_date', _calIsoDate(rangeEnd))
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase raid_schedule_exceptions query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase raid_schedule_exceptions query failed.', err);
        return [];
      }
    );
}

// Returns every RSVP row an officer viewer can see (their own team's), not
// just the caller's own -- buildCalendarWidget() filters to the caller's
// own player_id since RLS widens for officers ("Officers read raid_rsvps").
function fetchSupabaseRaidRsvps(rangeStart, rangeEnd) {
  if (!supabaseClient) return Promise.resolve([]);
  // team-read-guard: bounded to the one visible month below, same shape
  // as fetchSupabaseRaidScheduleExceptions above.
  return supabaseClient
    .from('raid_rsvps')
    .select('player_id, raid_date, status, note')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .gte('raid_date', _calIsoDate(rangeStart))
    .lte('raid_date', _calIsoDate(rangeEnd))
    .then(
      function (result) {
        if (result.error) {
          console.warn('Supabase raid_rsvps query failed.', result.error.message);
          return [];
        }
        return result.data || [];
      },
      function (err) {
        console.warn('Supabase raid_rsvps query failed.', err);
        return [];
      }
    );
}

// The signed-in raider's own claimed roster character for this team, or
// null if signed out / unclaimed. Mirrors js/boe.js's session.nameRealm ->
// DATA.roster lookup -- no dedicated "who am I" resolver exists yet.
function _calResolveMyPlayer() {
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  if (!session || !session.nameRealm || !window.DATA || !DATA.roster) return null;
  for (var i = 0; i < DATA.roster.length; i++) {
    if (DATA.roster[i].nameRealm === session.nameRealm) return DATA.roster[i];
  }
  return null;
}

// The recurring schedule is cached across the whole page view (rarely
// changes mid-session); exceptions and RSVPs are cached per visible month,
// since a new month means a new bounded fetch anyway.
function _loadCalendarScheduleData(rangeStart, rangeEnd) {
  var monthKey = rangeStart.getFullYear() + '-' + rangeStart.getMonth();
  if (_calDataCache[monthKey]) return _calDataCache[monthKey];
  var schedulePromise = (_calDataCache._schedule = _calDataCache._schedule || fetchSupabaseRaidSchedule());
  var promise = Promise.all([
    schedulePromise,
    fetchSupabaseRaidScheduleExceptions(rangeStart, rangeEnd),
    fetchSupabaseRaidRsvps(rangeStart, rangeEnd)
  ]).then(function (results) {
    return { scheduleRows: results[0], exceptionRows: results[1], rsvpRows: results[2] };
  });
  _calDataCache[monthKey] = promise;
  return promise;
}

function _calInvalidateMonthCache(rangeStart) {
  var monthKey = rangeStart.getFullYear() + '-' + rangeStart.getMonth();
  delete _calDataCache[monthKey];
}

/**
 * Computes the list of raid nights between rangeStart and rangeEnd
 * (inclusive, local dates) from a recurring weekly rule plus one-off
 * exceptions. A date can produce more than one night (multiple same-day
 * recurring rules, or a recurring night plus an added extra one), and a
 * 'cancelled' exception suppresses that date's recurring night(s) without
 * touching an 'added' one on the same date.
 * @param {any[]} scheduleRows
 * @param {any[]} exceptionRows
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {any[]} nights, each {date, startTime, durationMinutes, isOptional, isException, note}
 */
function computeRaidNights(scheduleRows, exceptionRows, rangeStart, rangeEnd) {
  var cancelledDates = {};
  var addedByDate = {};
  (exceptionRows || []).forEach(function (ex) {
    if (ex.exception_type === 'cancelled') cancelledDates[ex.raid_date] = true;
    else if (ex.exception_type === 'added') addedByDate[ex.raid_date] = ex;
  });

  var nights = [];
  var cur = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  var end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  while (cur <= end) {
    var dateStr = _calIsoDate(cur);
    var weekday = cur.getDay();
    if (!cancelledDates[dateStr]) {
      (scheduleRows || []).forEach(function (rule) {
        if (rule.weekday === weekday) {
          nights.push({
            date: dateStr,
            startTime: rule.start_time,
            durationMinutes: rule.duration_minutes,
            isOptional: !!rule.is_optional,
            isException: false
          });
        }
      });
    }
    var added = addedByDate[dateStr];
    if (added) {
      nights.push({
        date: dateStr,
        startTime: added.start_time,
        durationMinutes: added.duration_minutes,
        isOptional: !!added.is_optional,
        isException: true,
        note: added.note || ''
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return nights;
}

function _calNightsByDate(nights) {
  var byDate = {};
  nights.forEach(function (n) {
    (byDate[n.date] = byDate[n.date] || []).push(n);
  });
  return byDate;
}

// css class + aria label for an override status -- Absent gets its own
// color (red-ish, --melee), Attending (#895, optional nights only) and
// Rotator-In (#924, officer-assigned) both read as the same green/present
// style as the computed default, and the remaining three share the existing
// amber "tentative" treatment (still attending, just flagged).
function _calOverrideClass(status) {
  if (status === 'Absent') return 'absent';
  if (status === 'Attending' || status === 'Rotator-In') return 'present';
  return 'tentative';
}

/**
 * UNUSED as of the React-swap spike -- buildCalendarWidget() below now calls
 * window.mountCalendarGridReact() (web/calendar/CalendarGrid.jsx) instead.
 * Kept here, uncalled, as the "before" side of that comparison; delete once
 * the spike's outcome is decided one way or the other.
 *
 * Renders one month grid into containerEl. opts.compact suppresses the
 * "(mock ...)" style extras that don't fit a Home-page glance -- currently
 * just controls whether the "View full calendar" link is appended. Every
 * raid day, compact or full, links out to its day-detail view (#903, see
 * _calDayViewHref) -- self-service RSVP editing and officer corrections both
 * live there now, not in this grid. opts.myOverridesByDate is
 * {dateStr: {status, note}} for the signed-in raider's own raid_rsvps rows
 * (already filtered to their player_id by the caller) -- it still drives
 * this grid's own-status coloring.
 */
function _renderCalGrid(containerEl, year, month, nights, opts) {
  opts = opts || {};
  var myOverridesByDate = opts.myOverridesByDate || {};
  var today = new Date();
  var monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long' }) + ' ' + year;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var firstWeekday = new Date(year, month, 1).getDay();
  var nightsByDate = _calNightsByDate(nights);
  var rosterCount = (window.DATA && DATA.roster && DATA.roster.length) || 0;
  var benchCount =
    (window.DATA &&
      DATA.roster &&
      DATA.roster.filter(function (p) {
        return p.isBench || p.isRotator;
      }).length) ||
    0;
  var attending = Math.max(0, rosterCount - benchCount);

  var weekdayHtml = _CAL_WEEKDAY_LABELS
    .map(function (d) {
      return '<span class="mini-cal-weekday">' + d + '</span>';
    })
    .join('');

  var cellsHtml = '';
  for (var pad = 0; pad < firstWeekday; pad++) {
    cellsHtml += '<div class="mini-cal-day mini-cal-day-pad"></div>';
  }
  var usedStatuses = {};
  for (var day = 1; day <= daysInMonth; day++) {
    var cellDate = new Date(year, month, day);
    var dateStr = _calIsoDate(cellDate);
    var dayNights = nightsByDate[dateStr] || [];
    var isRaidDay = dayNights.length > 0;
    var isToday = _calIsoDate(today) === dateStr;
    var statusHtml = '';
    var countHtml = '';
    if (isRaidDay) {
      var myOverride = myOverridesByDate[dateStr];
      var anyOptional = dayNights.some(function (n) {
        return n.isOptional;
      });
      var statusClass, statusLabel;
      if (myOverride) {
        statusClass = _calOverrideClass(myOverride.status);
        statusLabel = myOverride.status;
      } else {
        statusClass = anyOptional ? 'tentative' : 'present';
        statusLabel = anyOptional ? _CAL_STATUS_LABELS.pending : _CAL_STATUS_LABELS.present;
      }
      usedStatuses[statusLabel] = statusClass;
      statusHtml =
        '<span class="calendar-status calendar-status-' +
        statusClass +
        '" role="img" aria-label="' +
        statusLabel +
        '" title="' +
        statusLabel +
        '"></span>';
      if (rosterCount && !myOverride && !anyOptional) {
        countHtml = '<span class="mini-cal-daycount">' + attending + '/' + rosterCount + '</span>';
      }
    }
    // Every raid day is a real link to its day-detail view (#903) -- both
    // the full calendar and the Home widget -- so a raid date is never a
    // dead cell. The destination view (not this grid) is what gates who can
    // edit what; opts.myPlayer/opts.compact no longer affect clickability.
    var dayTag = isRaidDay ? 'a' : 'div';
    cellsHtml +=
      '<' +
      dayTag +
      (isRaidDay ? ' href="' + _calDayViewHref(dateStr) + '"' : '') +
      ' class="mini-cal-day' +
      (isRaidDay ? ' mini-cal-day-raid mini-cal-day-clickable' : '') +
      (isToday ? ' mini-cal-day-today' : '') +
      '"><span class="mini-cal-daynum">' +
      day +
      '</span>' +
      countHtml +
      statusHtml +
      '</' +
      dayTag +
      '>';
  }

  var legendHtml = Object.keys(usedStatuses)
    .map(function (label) {
      return (
        '<span class="calendar-legend-item"><span class="calendar-status calendar-status-' +
        usedStatuses[label] +
        '" aria-hidden="true"></span>' +
        label +
        '</span>'
      );
    })
    .join('');
  if (benchCount) {
    legendHtml +=
      '<span class="calendar-legend-item">' + benchCount + ' on Bench (excluded from the count above)</span>';
  }

  var navHtml = opts.compact
    ? ''
    : '<div class="mini-cal-nav">' +
      '<button type="button" class="btn btn-muted mini-cal-nav-btn" onclick="_calNavMonth(-1)" aria-label="Previous month">&#8249;</button>' +
      '<button type="button" class="btn btn-muted mini-cal-nav-btn" onclick="_calNavMonth(1)" aria-label="Next month">&#8250;</button>' +
      '</div>';

  containerEl.innerHTML =
    '<div class="pub-loot-title">Calendar' +
    (opts.compact ? '' : ' -- ' + TEAM_NAME) +
    '</div>' +
    '<div class="mini-cal">' +
    '<div class="mini-cal-header">' +
    navHtml +
    '<span>' +
    monthLabel +
    '</span>' +
    '</div>' +
    '<div class="mini-cal-weekdays">' +
    weekdayHtml +
    '</div>' +
    '<div class="mini-cal-grid">' +
    cellsHtml +
    '</div>' +
    '</div>' +
    '<div class="calendar-legend">' +
    legendHtml +
    '</div>' +
    (opts.compact
      ? '<a class="footer-link" href="calendar.html' +
        (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG : '') +
        '">View full calendar &#8250;</a>'
      : '');
}

/**
 * mode: 'compact' (Home widget, #landingCalendar) or 'full' (calendar.html,
 * #fullCalendar, with month prev/next via _calNavMonth()). 'full' mode
 * additionally renders the #903 day-detail view instead of the month grid
 * whenever the URL carries a '?date=' -- every raid day link on both modes
 * points there (see _calDayViewHref).
 */
function buildCalendarWidget(mode) {
  var containerId = mode === 'full' ? 'fullCalendar' : 'landingCalendar';
  var el = document.getElementById(containerId);
  if (!el) return;

  if (mode === 'full') {
    var dateParam = _calDateParam();
    if (dateParam) {
      _renderDayView(el, dateParam);
      return;
    }
  }

  var today = new Date();
  if (_calViewYear === null) {
    _calViewYear = today.getFullYear();
    _calViewMonth = today.getMonth();
  }
  var year = mode === 'full' ? _calViewYear : today.getFullYear();
  var month = mode === 'full' ? _calViewMonth : today.getMonth();

  var rangeStart = new Date(year, month, 1);
  var rangeEnd = new Date(year, month + 1, 0);
  var myPlayer = _calResolveMyPlayer();
  _loadCalendarScheduleData(rangeStart, rangeEnd).then(function (data) {
    var nights = computeRaidNights(data.scheduleRows, data.exceptionRows, rangeStart, rangeEnd);
    var myOverridesByDate = {};
    if (myPlayer) {
      (data.rsvpRows || []).forEach(function (row) {
        if (row.player_id === myPlayer.id) myOverridesByDate[row.raid_date] = row;
      });
    }
    // React-swap spike (dist/calendar-widget/, built from web/calendar/):
    // this grid's view layer moved to CalendarGrid.jsx. Everything above --
    // fetching, computeRaidNights, resolving the signed-in player -- stays
    // exactly as it was; only the innerHTML-building _renderCalGrid() got
    // replaced with a call across the bridge in web/calendar/mount.jsx.
    var roster = (window.DATA && DATA.roster) || [];
    var benchCount = roster.filter(function (p) {
      return p.isBench || p.isRotator;
    }).length;
    window.mountCalendarGridReact(el, {
      year: year,
      month: month,
      nights: nights,
      myOverridesByDate: myOverridesByDate,
      compact: mode !== 'full',
      teamName: TEAM_NAME,
      teamSlug: TEAM_SLUG,
      rosterCount: roster.length,
      benchCount: benchCount,
      dayViewHref: _calDayViewHref,
      onNavMonth: _calNavMonth
    });
  });
}

function _calNavMonth(delta) {
  if (_calViewYear === null) {
    var today = new Date();
    _calViewYear = today.getFullYear();
    _calViewMonth = today.getMonth();
  }
  var next = new Date(_calViewYear, _calViewMonth + delta, 1);
  _calViewYear = next.getFullYear();
  _calViewMonth = next.getMonth();
  buildCalendarWidget('full');
}

// --- Raid day detail view (#903) -- calendar.html only; the Home widget
// deep-links here instead of duplicating any of this (see _calDayViewHref).
// Replaces the old #893 RSVP modal: the own-status control now lives inline
// at the top of this view instead of an overlay, still backed by
// set_own_rsvp(); the roster breakdown below it is new, and its per-row
// officer "Edit" affordance is backed by the new officer_set_rsvp() RPC.
//
// React-swap spike: the view layer (rendering + all interaction state --
// which status chip is picked, note text, the officer-edit modal's
// open/closed state) moved to web/calendar/DayView.jsx, mounted via
// window.mountDayViewReact(). Everything below this point that's still
// vanilla is either pure data-fetching/computation (unchanged) or a
// Supabase-write function refactored to take plain arguments and return its
// result, instead of reading form values off the DOM and pushing button-
// disabled/error-text state back into it by hand -- React owns that now.
function _renderDayView(el, dateStr) {
  var monthDate = new Date(dateStr + 'T00:00:00');
  var rangeStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  var rangeEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
  var myPlayer = _calResolveMyPlayer();
  var session = typeof getDiscordSession === 'function' ? getDiscordSession() : null;
  var isOfficer = !!(session && (session.isOfficer || session.isAdmin));

  _loadCalendarScheduleData(rangeStart, rangeEnd).then(function (data) {
    var nights = computeRaidNights(data.scheduleRows, data.exceptionRows, rangeStart, rangeEnd);
    var night =
      nights.find(function (n) {
        return n.date === dateStr;
      }) || null;
    var rsvpsByPlayer = {};
    (data.rsvpRows || []).forEach(function (row) {
      if (row.raid_date === dateStr) rsvpsByPlayer[row.player_id] = row;
    });
    window.mountDayViewReact(el, {
      dateStr: dateStr,
      night: night,
      rsvpsByPlayer: rsvpsByPlayer,
      myPlayer: myPlayer,
      isOfficer: isOfficer,
      roster: (window.DATA && DATA.roster) || [],
      teamSlug: TEAM_SLUG,
      groupRosterByRole: groupRosterByRole,
      classColors: CLASS_COLORS,
      dayViewHref: _calDayViewHref,
      addDays: _calAddDays,
      onSaveMyStatus: _saveMyRsvpStatus,
      onClearMyStatus: _clearMyRsvpStatus,
      onSaveOfficerStatus: _saveOfficerRsvpStatus,
      onClearOfficerStatus: _clearOfficerRsvpStatus,
      onToggleRotator: _toggleRotatorWeek
    });
  });
}

// UNUSED as of the React-swap spike -- DayView.jsx's local dayStatus()/
// statusClass() reimplement this and _calStatusClass below. The Vite bundle
// is a separate module graph from these plain <script> files, so it can't
// just call a global function defined here the way the rest of this
// codebase calls across files -- crossing that boundary means either
// passing a window.* reference in as a prop (done for _calDayViewHref,
// _calAddDays, groupRosterByRole below) or duplicating small pure logic on
// the React side, which is what happened here. That duplication is a real
// cost of a partial migration: this logic now needs to change in two
// places if it ever changes at all. Kept here, uncalled, as the "before"
// side of that comparison.
//
// A player's effective status for a night: their own override if one
// exists, else the same computed default the month grid uses (a bench
// player has none on a normal night -- shown as 'Bench' and excluded from
// the aggregate counts, same carve-out as the grid's benchCount legend).
// A rotator (#924) gets the same "not automatically Present" treatment,
// shown as 'Rotator' -- unless officer_set_rotator_week() already wrote a
// 'Rotator-In' override for this date, which the override check above
// picks up before this default ever applies.
function _calDayStatus(player, night, rsvpsByPlayer) {
  var override = rsvpsByPlayer[player.id];
  if (override) return { status: override.status, note: override.note || '', isOverride: true };
  if (!night) return { status: null, note: '', isOverride: false };
  if (player.isBench && !night.isOptional) return { status: 'Bench', note: '', isOverride: false };
  if (player.isRotator && !night.isOptional) return { status: 'Rotator', note: '', isOverride: false };
  return {
    status: night.isOptional ? _CAL_STATUS_LABELS.pending : _CAL_STATUS_LABELS.present,
    note: '',
    isOverride: false
  };
}

function _calStatusClass(status) {
  if (status === 'Bench' || status === 'Rotator' || status === _CAL_STATUS_LABELS.pending) return 'tentative';
  if (status === _CAL_STATUS_LABELS.present) return 'present';
  return _calOverrideClass(status);
}

// UNUSED as of the React-swap spike, along with every render/interaction
// function down to (not including) _saveMyRsvpStatus below --
// web/calendar/DayView.jsx replaces all of it. Kept, uncalled, as the
// "before" side of that comparison; delete this whole run once the spike's
// outcome is decided.
function _calRenderDayView(el, dateStr, night, rsvpsByPlayer, myPlayer, isOfficer) {
  var d = new Date(dateStr + 'T00:00:00');
  var dateLabel = d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
  var backHref = 'calendar.html' + (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG : '');

  var html =
    '<a class="footer-link day-view-back" href="' +
    backHref +
    '">&#8249; Back to calendar</a>' +
    '<div class="day-view-header">' +
    '<a class="btn btn-muted mini-cal-nav-btn" href="' +
    _calDayViewHref(_calAddDays(dateStr, -1)) +
    '" aria-label="Previous day">&#8592;</a>' +
    '<span class="day-view-date">' +
    dateLabel +
    '</span>' +
    '<a class="btn btn-muted mini-cal-nav-btn" href="' +
    _calDayViewHref(_calAddDays(dateStr, 1)) +
    '" aria-label="Next day">&#8594;</a>' +
    '</div>';

  if (!night) {
    html += '<p style="color:var(--text-muted);">No raid scheduled for this date.</p>';
    el.innerHTML = html;
    return;
  }

  var roster = (window.DATA && DATA.roster) || [];
  var counts = { inCount: 0, outCount: 0, noResponse: 0 };
  roster.forEach(function (p) {
    var s = _calDayStatus(p, night, rsvpsByPlayer);
    if (s.status === 'Bench') return;
    if (s.status === 'Absent') counts.outCount++;
    else if (s.status === _CAL_STATUS_LABELS.pending) counts.noResponse++;
    else counts.inCount++;
  });
  html +=
    '<div class="day-view-counts">' +
    '<span><strong>' +
    counts.inCount +
    '</strong> in</span>' +
    '<span><strong>' +
    counts.outCount +
    '</strong> out</span>' +
    '<span><strong>' +
    counts.noResponse +
    "</strong> haven't answered</span>" +
    '</div>';

  html += _calRenderMyStatusSection(dateStr, night, rsvpsByPlayer, myPlayer);
  html += _calRenderRosterBreakdown(dateStr, roster, night, rsvpsByPlayer, isOfficer);
  html += _calOfficerEditPopupHtml();

  el.innerHTML = html;
  _renderMyRsvpStatusOptions();
}

function _calRenderMyStatusSection(dateStr, night, rsvpsByPlayer, myPlayer) {
  if (!myPlayer) return '';
  // Defense in depth, same as the old modal's guard -- a bench player has
  // no self-service override on a normal night; set_own_rsvp() enforces
  // this too.
  if (myPlayer.isBench && !night.isOptional) return '';
  var existing = rsvpsByPlayer[myPlayer.id];
  _calMyStatus = existing ? existing.status : null;
  _calMyIsOptional = !!night.isOptional;
  // No override yet -- show the same computed default the grid/roster
  // breakdown use (Present, Rotator on a normal night for a rotator (#924),
  // or No Response on an optional night) so "no button picked" doesn't read
  // as "no status," which set_own_rsvp() would otherwise leave ambiguous at
  // a glance.
  var currentLabel = existing
    ? existing.status
    : myPlayer.isRotator && !night.isOptional
      ? 'Rotator'
      : night.isOptional
        ? _CAL_STATUS_LABELS.pending
        : _CAL_STATUS_LABELS.present;
  return (
    '<div class="day-view-my-status">' +
    '<div class="day-view-my-status-header">' +
    '<div class="pub-loot-title" style="margin:0;">Your status</div>' +
    '<span class="day-roster-status-label">' +
    '<span class="calendar-status calendar-status-' +
    _calStatusClass(currentLabel) +
    '"></span>' +
    currentLabel +
    '</span>' +
    '</div>' +
    '<div id="dayViewMyStatusOptions" class="rsvp-status-options"></div>' +
    '<textarea id="dayViewMyNote" class="rsvp-note" placeholder="Note (required, visible to officers)" rows="2">' +
    _esc(existing && existing.note) +
    '</textarea>' +
    '<p id="dayViewMyError" style="display:none;font-size:0.88rem;color:var(--melee);"></p>' +
    '<div class="prompt-buttons rsvp-prompt-buttons">' +
    '<button type="button" class="btn btn-muted" onclick="_clearMyRsvpStatus(\'' +
    dateStr +
    '\')">Clear (back to default)</button>' +
    '<button type="button" class="btn btn-gold" id="dayViewMySaveBtn" onclick="_saveMyRsvpStatus(\'' +
    dateStr +
    '\')">Save</button>' +
    '</div>' +
    '</div>'
  );
}

function _renderMyRsvpStatusOptions() {
  var el = document.getElementById('dayViewMyStatusOptions');
  if (!el) return;
  var statuses = _calMyIsOptional ? ['Attending'].concat(_CAL_RSVP_STATUSES) : _CAL_RSVP_STATUSES;
  el.innerHTML = statuses
    .map(function (status) {
      return (
        '<button type="button" class="filter-chip' +
        (status === _calMyStatus ? ' active' : '') +
        '" onclick="_selectMyRsvpStatus(\'' +
        status +
        '\')">' +
        status +
        '</button>'
      );
    })
    .join('');
}

function _selectMyRsvpStatus(status) {
  _calMyStatus = status;
  _renderMyRsvpStatusOptions();
}

// Refactored for the React-swap spike: takes status/note as plain arguments
// (DayView.jsx's MyStatusSection owns the chip-selection/note-text state
// that used to live in module-level _calMyStatus and a raw textarea read)
// and returns the Supabase result instead of pushing an error string and a
// disabled-button flag into the DOM itself -- React owns both of those
// through its own component state now. Still the same write, same side
// effects on success.
function _saveMyRsvpStatus(dateStr, status, note) {
  return supabaseClient
    .rpc('set_own_rsvp', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_raid_date: dateStr,
      p_status: status,
      p_note: note
    })
    .then(function (result) {
      if (result.error) return result;
      _notifyRsvpBot(dateStr, status, note);
      _syncSignupSheet(dateStr);
      _calInvalidateDateMonth(dateStr);
      buildCalendarWidget('full');
      return result;
    });
}

function _clearMyRsvpStatus(dateStr, note) {
  return supabaseClient
    .rpc('set_own_rsvp', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_raid_date: dateStr,
      p_status: null,
      p_note: note
    })
    .then(function (result) {
      if (result.error) return result;
      _syncSignupSheet(dateStr);
      _calInvalidateDateMonth(dateStr);
      buildCalendarWidget('full');
      return result;
    });
}

function _calInvalidateDateMonth(dateStr) {
  var monthDate = new Date(dateStr + 'T00:00:00');
  _calInvalidateMonthCache(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
}

// UNUSED as of the React-swap spike, down to (not including)
// _saveOfficerRsvpStatus below -- same "before" comparison as the block
// above _saveMyRsvpStatus.
function _calRenderRosterBreakdown(dateStr, roster, night, rsvpsByPlayer, isOfficer) {
  var grouped = groupRosterByRole(roster);
  var html = '<div class="pub-loot-title">Roster</div><table class="roster-table"><tbody>';
  grouped.order.forEach(function (role) {
    var players = grouped.groups[role];
    if (!players.length) return;
    html += '<tr class="group-header"><td colspan="2">' + grouped.labels[role] + '</td></tr>';
    players
      .slice()
      .sort(function (a, b) {
        return (a.nick || a.firstName).localeCompare(b.nick || b.firstName);
      })
      .forEach(function (p) {
        var s = _calDayStatus(p, night, rsvpsByPlayer);
        var dispName = p.nick || p.firstName;
        var classColor = CLASS_COLORS[p.class];
        html +=
          '<tr><td>' +
          (classColor ? '<span style="color:' + classColor + ';">' + dispName + '</span>' : dispName) +
          '</td><td class="day-roster-status">' +
          '<span class="day-roster-status-label">' +
          '<span class="calendar-status calendar-status-' +
          _calStatusClass(s.status) +
          '"></span>' +
          s.status +
          '</span>' +
          '<span class="day-roster-note">' +
          (s.note ? _esc(s.note) : '') +
          '</span>' +
          (isOfficer
            ? '<button type="button" class="day-roster-edit-btn" onclick="_openOfficerRsvpEdit(' +
              p.id +
              ",'" +
              dateStr +
              '\')">Edit</button>'
            : '') +
          (isOfficer && p.isRotator
            ? '<button type="button" class="day-roster-edit-btn" onclick="_toggleRotatorWeek(' +
              p.id +
              ",'" +
              dateStr +
              "'," +
              (s.status === 'Rotator-In' ? 'false' : 'true') +
              ')">' +
              (s.status === 'Rotator-In' ? 'Remove from week' : 'Set in for week') +
              '</button>'
            : '') +
          '</td></tr>';
      });
  });
  html += '</tbody></table>';
  return html;
}

// --- Officer RSVP correction popup (#903) -- same .officer-prompt overlay
// convention as every other modal in this codebase, but built as an HTML
// string (rather than static markup in calendar.html) since it's entirely
// part of the day view's dynamic render, gone as soon as the view re-renders.

function _calOfficerEditPopupHtml() {
  return (
    '<div id="officerRsvpEditModal" class="officer-prompt">' +
    '<div class="officer-prompt-box">' +
    '<h2>Correct status</h2>' +
    '<div id="officerRsvpEditOptions" class="rsvp-status-options"></div>' +
    '<textarea id="officerRsvpEditNote" class="rsvp-note" placeholder="Note (required, visible to the raider)" rows="2"></textarea>' +
    '<p id="officerRsvpEditError" style="display:none;font-size:0.88rem;color:var(--melee);"></p>' +
    '<div class="prompt-buttons rsvp-prompt-buttons">' +
    '<button type="button" class="btn btn-muted" onclick="_closeOfficerRsvpEdit()">Cancel</button>' +
    '<button type="button" class="btn btn-muted" onclick="_clearOfficerRsvpStatus()">Clear (back to default)</button>' +
    '<button type="button" class="btn btn-gold" id="officerRsvpEditSaveBtn" onclick="_saveOfficerRsvpStatus()">Save</button>' +
    '</div></div></div>'
  );
}

function _openOfficerRsvpEdit(playerId, dateStr) {
  var existing = _calDayViewRsvpsByPlayer[playerId];
  _calOfficerEditPlayerId = playerId;
  _calOfficerEditDate = dateStr;
  _calOfficerEditStatus = existing ? existing.status : null;
  _calOfficerEditIsOptional = !!(_calDayViewNight && _calDayViewNight.isOptional);
  var noteEl = document.getElementById('officerRsvpEditNote');
  if (noteEl) noteEl.value = (existing && existing.note) || '';
  var errEl = document.getElementById('officerRsvpEditError');
  if (errEl) errEl.style.display = 'none';
  _renderOfficerRsvpOptions();
  var modal = document.getElementById('officerRsvpEditModal');
  if (modal) modal.classList.add('active');
}

function _closeOfficerRsvpEdit() {
  var modal = document.getElementById('officerRsvpEditModal');
  if (modal) modal.classList.remove('active');
  _calOfficerEditPlayerId = null;
  _calOfficerEditDate = null;
  _calOfficerEditStatus = null;
}

function _renderOfficerRsvpOptions() {
  var el = document.getElementById('officerRsvpEditOptions');
  if (!el) return;
  var statuses = _calOfficerEditIsOptional ? ['Attending'].concat(_CAL_RSVP_STATUSES) : _CAL_RSVP_STATUSES;
  el.innerHTML = statuses
    .map(function (status) {
      return (
        '<button type="button" class="filter-chip' +
        (status === _calOfficerEditStatus ? ' active' : '') +
        '" onclick="_selectOfficerRsvpStatus(\'' +
        status +
        '\')">' +
        status +
        '</button>'
      );
    })
    .join('');
}

function _selectOfficerRsvpStatus(status) {
  _calOfficerEditStatus = status;
  _renderOfficerRsvpOptions();
}

// Refactored for the React-swap spike, same shape as _saveMyRsvpStatus
// above: plain arguments instead of module-level _calOfficerEdit* vars and
// a DOM read, returns the result instead of writing an error string and a
// disabled flag into the DOM. The success-path modal close moved into
// DayView.jsx's OfficerEditModal (it calls onClose() itself once this
// resolves with no error), so it's not this function's job anymore.
function _saveOfficerRsvpStatus(playerId, dateStr, status, note) {
  return supabaseClient
    .rpc('officer_set_rsvp', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_player_id: playerId,
      p_raid_date: dateStr,
      p_status: status,
      p_note: note
    })
    .then(function (result) {
      if (result.error) return result;
      _syncSignupSheet(dateStr);
      _calInvalidateDateMonth(dateStr);
      buildCalendarWidget('full');
      return result;
    });
}

function _clearOfficerRsvpStatus(playerId, dateStr, note) {
  return supabaseClient
    .rpc('officer_set_rsvp', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_player_id: playerId,
      p_raid_date: dateStr,
      p_status: null,
      p_note: note
    })
    .then(function (result) {
      if (result.error) return result;
      _syncSignupSheet(dateStr);
      _calInvalidateDateMonth(dateStr);
      buildCalendarWidget('full');
      return result;
    });
}

// Officer week-level Rotator assignment (#924): fans out into one
// Rotator-In raid_rsvps row per raid night via officer_set_rotator_week()
// (or clears them all with p_in=false). The week is always the Sunday-
// through-Saturday range containing dateStr, computed client-side the same
// way the day view's own date math works elsewhere in this file.
function _calWeekStartSunday(dateStr) {
  var d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() - d.getDay());
  return _calIsoDate(d);
}

function _toggleRotatorWeek(playerId, dateStr, isIn) {
  supabaseClient
    .rpc('officer_set_rotator_week', {
      p_team_id: _teamCfg.supabaseTeamId,
      p_player_id: playerId,
      p_week_start: _calWeekStartSunday(dateStr),
      p_in: isIn
    })
    .then(function (result) {
      if (result.error) {
        console.warn('officer_set_rotator_week failed.', result.error.message);
        return;
      }
      _syncSignupSheet(dateStr);
      _calInvalidateDateMonth(dateStr);
      buildCalendarWidget('full');
    });
}

// Fire-and-forget, same pattern as js/signup.js -- the Supabase write above
// is already committed and is the record of truth; a failed/slow Discord
// notification is not something the raider needs to see or wait on.
function _notifyRsvpBot(raidDate, status, note) {
  if (!supabaseClient || !window.DATA || !DATA.roster) return;
  var myPlayer = _calResolveMyPlayer();
  if (!myPlayer) return;
  supabaseClient.functions
    .invoke('discord-bot-webhook', {
      body: {
        action: 'rsvp',
        team: TEAM_SLUG,
        payload: { charName: myPlayer.nameRealm, raidDate: raidDate, status: status, note: note }
      }
    })
    .then(
      function () {},
      function () {}
    );
}

// Fire-and-forget trigger for the bot-owned aggregated signup sheet (#900,
// part of #640) -- fully separate from _notifyRsvpBot above, which is the
// existing per-status-change ping and stays untouched. All the actual
// grouping/embed/message-bookkeeping logic lives bot-side
// (wga-raid-bot's src/signupSheet.ts); this just tells it "the RSVP picture
// for this date changed, go re-sync." No player/status data needed in the
// payload -- the bot re-queries the full roster/RSVP state itself.
function _syncSignupSheet(raidDate) {
  if (!supabaseClient) return;
  supabaseClient.functions
    .invoke('discord-bot-webhook', {
      body: { action: 'signupSheetSync', team: TEAM_SLUG, payload: { raidDate: raidDate } }
    })
    .then(
      function () {},
      function () {}
    );
}
