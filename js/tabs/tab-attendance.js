var _attendanceGrid = null;

function switchAttendSubTab(name, btn) {
  document.querySelectorAll('[id^="attend-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  if (btn) btn.classList.add('active');
  var manage = document.getElementById('attend-sub-manage');
  var scores = document.getElementById('attend-sub-scores');
  var bench  = document.getElementById('attend-sub-bench');
  if (manage) manage.style.display = name === 'manage' ? '' : 'none';
  if (scores) scores.style.display = name === 'scores' ? '' : 'none';
  if (bench)  bench.style.display  = name === 'bench'  ? '' : 'none';
  if (name === 'bench') {
    if (Array.isArray(_attendanceGrid)) {
      buildBenchFairness();
    } else {
      var el = document.getElementById('benchFairnessContent');
      if (el) el.innerHTML = '<p style="color:var(--text-muted);padding:0.5rem 0;">Loading attendance data...</p>';
      ensureAttendanceGridLoaded();
    }
  }
}

function buildAttendanceTab() {
  var allDetails = DATA.attendanceDetails || {};
  var roster     = DATA.roster || [];
  var THRESHOLD  = parseInt((document.getElementById('attendThreshold') || { value: '95' }).value) || 95;
  var range      = getSeasonDateRange();

  // Filter penalty events to the active season window
  function filterPenalties(penalties) {
    if (!ACTIVE_SEASON) return penalties;
    return penalties.filter(function(ae) {
      return (!range.start || ae.date >= range.start) && (!range.end || ae.date <= range.end);
    });
  }

  var below = [];
  for (var i = 0; i < roster.length; i++) {
    var p   = roster[i];
    var att = getDisplayAttendancePct(p);
    var pct = parseFloat(att) || 0;
    if (pct <= THRESHOLD) below.push({ player: p, att: att, pct: pct });
  }
  below.sort(function(a, b) { return a.pct - b.pct; });

  var seasonLabel = ACTIVE_SEASON ? ' (' + ACTIVE_SEASON + ')' : '';
  var html = '';
  if (!below.length) {
    html = '<p style="color:var(--text);padding:1rem;">All raiders are at or above ' + THRESHOLD + '% attendance' + seasonLabel + '.</p>';
  } else {
    html += '<p style="font-size:1rem;color:var(--text);margin-bottom:1rem;">' + below.length + ' raider' + (below.length !== 1 ? 's' : '') + ' at or below ' + THRESHOLD + '% attendance' + seasonLabel + '</p>';
    for (var i = 0; i < below.length; i++) {
      var p       = below[i].player;
      var att     = below[i].att;
      var color   = attendColor(parseFloat(att) || 0);
      var penalty = filterPenalties(allDetails[p.firstName] || []);

      html += '<div class="attend-player-row">';
      html += '<div class="attend-player-header">';
      html += '<span class="attend-player-name">' + (p.nick || p.firstName) + (p.firstName !== (p.nick || p.firstName) ? ' <span style="font-size:0.95rem;color:var(--text-muted);">(' + p.firstName + ')</span>' : '') + '</span>';
      html += '<span style="font-size:1rem;font-weight:700;color:' + color + ';">' + att + '</span>';
      html += '</div>';
      html += '<div class="attend-row" style="margin-bottom:0.5rem;">';
      html += '<div class="attend-bar-wrap"><div class="attend-bar" style="width:' + att + ';background:' + color + ';"></div></div>';
      html += '</div>';
      if (penalty.length) {
        html += '<div class="attend-penalty-list">';
        for (var j = 0; j < penalty.length; j++) {
          var ae = penalty[j];
          var sc = ae.status === 'No Show' ? 'var(--melee)' : 'var(--gold)';
          html += '<div class="attend-penalty-entry">';
          html += '<span style="color:var(--text);">' + ae.date + '</span>';
          html += '<span style="color:' + sc + ';font-weight:600;">' + ae.status + '</span>';
          html += '</div>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
  }
  document.getElementById('attendanceContent').innerHTML = html;

  ensureAttendanceGridLoaded();
}

function ensureAttendanceGridLoaded() {
  if (_attendanceGrid !== null) return;
  _attendanceGrid = 'loading';
  loadAttendanceGrid();
}

function loadAttendanceGrid() {
  var status   = document.getElementById('attendGridStatus');
  var nightRow = document.getElementById('attendGridNightRow');
  var table    = document.getElementById('attendGridTable');
  if (status)   status.textContent = 'Loading attendance data...';
  if (nightRow) nightRow.style.display = 'none';
  if (table)    table.innerHTML = '';

  var cbName = '_getAttendanceGridCb_' + Date.now();
  window[cbName] = function(result) {
    delete window[cbName];
    if (!result || !result.success) {
      _attendanceGrid = null;
      if (status) {
        status.textContent = result && result.error ? 'Error: ' + result.error : 'No attendance data yet. Run "Refresh from WCL" first.';
        status.style.color = 'var(--text-muted)';
      }
      return;
    }
    _attendanceGrid = result.raids || [];
    if (status) status.textContent = '';
    renderAttendanceGrid();
    var benchEl = document.getElementById('attend-sub-bench');
    if (benchEl && benchEl.style.display !== 'none') buildBenchFairness();
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    _attendanceGrid = null;
    if (status) { status.textContent = 'Error loading attendance data.'; status.style.color = 'var(--melee)'; }
  };
  script.src = WEB_APP_URL + '?action=getAttendanceGrid&callback=' + cbName;
  document.head.appendChild(script);
}

function renderAttendanceGrid() {
  var nightRow   = document.getElementById('attendGridNightRow');
  var nightSelect = document.getElementById('attendNightSelect');
  var status     = document.getElementById('attendGridStatus');
  var table      = document.getElementById('attendGridTable');

  if (!_attendanceGrid || !Array.isArray(_attendanceGrid) || !_attendanceGrid.length) {
    if (status) { status.textContent = 'No raid nights in Attendance sheet. Run "Refresh from WCL" first.'; status.style.color = 'var(--text-muted)'; }
    if (nightRow) nightRow.style.display = 'none';
    if (table) table.innerHTML = '';
    return;
  }

  if (status)   { status.textContent = ''; }
  if (nightRow) nightRow.style.display = '';

  if (nightSelect) {
    var prevIndex = nightSelect.selectedIndex >= 0 ? nightSelect.selectedIndex : 0;
    nightSelect.innerHTML = '';
    for (var i = 0; i < _attendanceGrid.length; i++) {
      var raid = _attendanceGrid[i];
      var opt  = document.createElement('option');
      opt.value       = String(i);
      opt.textContent = raid.title + (raid.excluded ? ' [EXCLUDED]' : '');
      nightSelect.appendChild(opt);
    }
    nightSelect.selectedIndex = Math.min(prevIndex, _attendanceGrid.length - 1);
    renderNightGrid(nightSelect.selectedIndex);
  }
}

var ATTENDANCE_STATUSES = ['Present', 'Bench', 'Medical Leave', 'Excused', 'No Show', 'Not on Roster'];

function renderNightGrid(index) {
  var table = document.getElementById('attendGridTable');
  if (!table || !Array.isArray(_attendanceGrid)) return;

  var raid = _attendanceGrid[index];
  if (!raid) { table.innerHTML = ''; return; }

  var html = '<div class="attend-grid-info">';
  html += '<span style="color:var(--text-muted);">' + raid.players.length + ' player' + (raid.players.length !== 1 ? 's' : '') + '</span>';
  if (raid.excluded) html += '<span style="color:var(--melee);margin-left:0.75rem;">Excluded from scoring</span>';
  html += '</div>';
  html += '<div class="attend-grid-rows">';

  for (var i = 0; i < raid.players.length; i++) {
    var p = raid.players[i];
    html += '<div class="attend-grid-row">';
    html += '<span class="attend-grid-name">' + escHtml(p.name) + '</span>';
    var hasStatus = !!p.status;
    html += '<span class="attend-grid-source">' + escHtml(p.source || '') + '</span>';
    html += '<div class="attend-status-wrap">';
    html += '<select class="attend-status-select" data-date="' + escHtml(raid.date) + '" data-name="' + escHtml(p.name) + '" data-old="' + escHtml(p.status) + '" onchange="setPlayerStatus(this)">';
    if (!p.status) html += '<option value="" selected disabled>(no status)</option>';
    for (var j = 0; j < ATTENDANCE_STATUSES.length; j++) {
      var s = ATTENDANCE_STATUSES[j];
      html += '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + s + '</option>';
    }
    html += '</select>';
    html += '</div>';
    html += '<span class="attend-save-ind" style="color:var(--heal);">' + (hasStatus ? '&#10003;' : '') + '</span>';
    html += '</div>';
  }

  html += '</div>';
  table.innerHTML = html;
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setPlayerStatus(selectEl) {
  var date      = selectEl.getAttribute('data-date');
  var firstName = selectEl.getAttribute('data-name');
  var status    = selectEl.value;
  var oldStatus = selectEl.getAttribute('data-old');
  var row       = selectEl.parentElement;
  var indicator = row ? row.querySelector('.attend-save-ind') : null;

  if (!status) return;
  selectEl.disabled = true;
  if (indicator) { indicator.textContent = 'Saving...'; indicator.style.color = 'var(--text-muted)'; }

  var data    = { date: date, firstName: firstName, status: status, oldStatus: oldStatus };
  var cbName  = '_setAttendStatusCb_' + Date.now();
  window[cbName] = function(result) {
    delete window[cbName];
    selectEl.disabled = false;
    if (result && result.success) {
      selectEl.setAttribute('data-old', status);
      var nightSelect = document.getElementById('attendNightSelect');
      var idx = nightSelect ? parseInt(nightSelect.value) : -1;
      if (idx >= 0 && Array.isArray(_attendanceGrid) && _attendanceGrid[idx]) {
        var players = _attendanceGrid[idx].players;
        for (var i = 0; i < players.length; i++) {
          if (players[i].name === firstName) { players[i].status = status; players[i].source = 'Officer'; break; }
        }
      }
      if (indicator) {
        indicator.innerHTML = '&#10003;';
        indicator.style.color = 'var(--heal)';
      }
    } else {
      selectEl.value = oldStatus || '';
      if (indicator) {
        indicator.textContent = 'Error';
        indicator.style.color = 'var(--melee)';
        setTimeout(function() { if (indicator) indicator.textContent = ''; }, 3000);
      }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    selectEl.disabled = false;
    selectEl.value = oldStatus || '';
    if (indicator) { indicator.textContent = 'Error'; indicator.style.color = 'var(--melee)'; }
  };
  script.src = WEB_APP_URL + '?action=setAttendanceStatus&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function refreshAttendanceWCL() {
  var btn    = document.getElementById('refreshWCLBtn');
  var status = document.getElementById('refreshWCLStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing...'; }
  if (status) { status.textContent = 'This may take 30-60 seconds...'; status.style.color = 'var(--text-muted)'; }

  var cbName = '_refreshAttendWCLCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh from WCL'; }
    if (result && result.success) {
      if (status) {
        status.textContent = 'Done: ' + result.mainNights + ' night' + (result.mainNights !== 1 ? 's' : '') + ' found, ' + result.excluded + ' excluded.';
        status.style.color = 'var(--heal)';
      }
      _attendanceGrid = null;
      loadAttendanceGrid();
    } else {
      if (status) {
        status.textContent = result && result.error ? result.error : 'Error refreshing.';
        status.style.color = 'var(--melee)';
      }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh from WCL'; }
    if (status) { status.textContent = 'Error refreshing.'; status.style.color = 'var(--melee)'; }
  };
  script.src = WEB_APP_URL + '?action=refreshAttendanceWCL&callback=' + cbName;
  document.head.appendChild(script);
}

function confirmCommitScores() {
  var banner = document.getElementById('commitConfirmBanner');
  if (banner) banner.style.display = '';
}

function cancelCommitScores() {
  var banner = document.getElementById('commitConfirmBanner');
  if (banner) banner.style.display = 'none';
}

function executeCommitScores() {
  cancelCommitScores();
  var btn    = document.getElementById('commitScoresBtn');
  var status = document.getElementById('commitScoresStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Committing...'; }
  if (status) status.textContent = '';

  var cbName = '_commitAttendScoresCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Commit Scores to Sheet'; }
    if (result && result.success) {
      if (status) {
        status.textContent = result.committed + ' players scored (' + result.totalRaids + ' night' + (result.totalRaids !== 1 ? 's' : '') + ')';
        status.style.color = 'var(--heal)';
        setTimeout(function() { if (status) status.textContent = ''; }, 6000);
      }
    } else {
      if (status) {
        status.textContent = result && result.error ? result.error : 'Error committing scores.';
        status.style.color = 'var(--melee)';
      }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Commit Scores to Sheet'; }
    if (status) { status.textContent = 'Error committing scores.'; status.style.color = 'var(--melee)'; }
  };
  script.src = WEB_APP_URL + '?action=commitAttendanceScores&callback=' + cbName;
  document.head.appendChild(script);
}
