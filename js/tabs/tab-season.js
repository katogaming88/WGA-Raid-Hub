function buildSeasonTab() {
  var startInput = document.getElementById('seasonStartInput');
  if (startInput) startInput.value = (DATA && DATA.seasonStart) || '';
  var nameInput = document.getElementById('seasonNameInput');
  if (nameInput) nameInput.value = (DATA && DATA.seasonName) || '';
  var endInput = document.getElementById('seasonEndInput');
  if (endInput) endInput.value = (DATA && DATA.seasonEnd) || '';
  renderSeasonHistory();
}

function renderSeasonHistory() {
  var history = (DATA && DATA.seasonHistory) || [];
  var wrap    = document.getElementById('seasonHistoryWrap');
  var list    = document.getElementById('seasonHistoryList');
  if (!wrap || !list) return;
  if (!history.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  var html = '';
  for (var i = 0; i < history.length; i++) {
    var s = history[i];
    html += '<div style="padding:0.3rem 0;border-bottom:1px solid rgba(255,255,255,0.06);">';
    html += '<strong style="color:var(--text);">' + (s.name || '(unnamed)') + '</strong>';
    html += ' &nbsp; ' + (s.start || '-') + ' to ' + (s.end || 'ongoing');
    html += '</div>';
  }
  list.innerHTML = html;
}

function confirmClearSeasonStart() {
  var el = document.getElementById('seasonClearConfirm');
  if (el) el.style.display = '';
}

function executeClearSeasonStart() {
  var el = document.getElementById('seasonClearConfirm');
  if (el) el.style.display = 'none';
  var input = document.getElementById('seasonStartInput');
  if (input) input.value = '';
  saveSeasonStart();
}

function confirmClearSeasonEnd() {
  var el = document.getElementById('seasonEndClearConfirm');
  if (el) el.style.display = '';
}

function executeClearSeasonEnd() {
  var el = document.getElementById('seasonEndClearConfirm');
  if (el) el.style.display = 'none';
  var input = document.getElementById('seasonEndInput');
  if (input) input.value = '';
  saveSeasonEnd();
}

function confirmArchiveSeason() {
  var name = (DATA && DATA.seasonName) || '';
  var msg  = document.getElementById('seasonArchiveConfirmMsg');
  if (msg) {
    if (!name) {
      msg.textContent = 'No current season name is set. Please set a Season Name before archiving.';
      document.getElementById('seasonArchiveExecBtn').style.display = 'none';
    } else {
      msg.textContent = 'Archive "' + name + '"? The current season name, start date, and end date will be moved to history and cleared. Set a new Season Name and Start Date for the next season afterward.';
      document.getElementById('seasonArchiveExecBtn').style.display = '';
    }
  }
  var el = document.getElementById('seasonArchiveConfirm');
  if (el) el.style.display = '';
}

function executeArchiveSeason() {
  var el     = document.getElementById('seasonArchiveConfirm');
  var status = document.getElementById('seasonArchiveStatus');
  var btn    = document.getElementById('seasonArchiveExecBtn');
  if (el) el.style.display = 'none';
  if (btn) { btn.disabled = true; }

  var cbName = '_archiveSeasonCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) btn.disabled = false;
    if (result && result.success) {
      var archived = { name: DATA.seasonName, start: DATA.seasonStart, end: DATA.seasonEnd || '' };
      if (!DATA.seasonHistory) DATA.seasonHistory = [];
      DATA.seasonHistory.push(archived);
      DATA.seasonName  = '';
      DATA.seasonStart = '';
      DATA.seasonEnd   = '';
      buildSeasonTab();
      populateSeasonSelector();
      if (status) {
        status.textContent = 'Season archived.';
        setTimeout(function() { if (status) status.textContent = ''; }, 3000);
      }
    } else {
      if (status) { status.textContent = 'Error archiving season.'; }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) btn.disabled = false;
    if (status) { status.textContent = 'Error archiving season.'; }
  };
  script.src = WEB_APP_URL + '?action=archiveSeason&callback=' + cbName;
  document.head.appendChild(script);
}

function syncAttendancePct() {
  var btn    = document.getElementById('syncAttendPctBtn');
  var status = document.getElementById('syncAttendPctStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing...'; }

  var cbName = '_syncAttendPctCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Sync to Roster Sheet'; }
    if (result && result.success) {
      if (status) {
        status.textContent = 'Synced!';
        setTimeout(function() { if (status) status.textContent = ''; }, 2000);
      }
    } else {
      if (status) { status.textContent = 'Error syncing.'; }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Sync to Roster Sheet'; }
    if (status) { status.textContent = 'Error syncing.'; }
  };
  script.src = WEB_APP_URL + '?action=syncAttendancePct&callback=' + cbName;
  document.head.appendChild(script);
}

function saveSeasonName() {
  var input  = document.getElementById('seasonNameInput');
  var val    = input ? input.value.trim() : '';
  var btn    = document.getElementById('seasonNameSaveBtn');
  var status = document.getElementById('seasonNameStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var cbName = '_setSeasonNameCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (result && result.success) {
      if (DATA) DATA.seasonName = result.seasonName;
      if (input) input.value = result.seasonName || '';
      populateSeasonSelector();
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function() { if (status) status.textContent = ''; }, 2000);
      }
    } else {
      if (status) { status.textContent = 'Error saving.'; }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (status) { status.textContent = 'Error saving.'; }
  };
  script.src = WEB_APP_URL + '?action=setSeasonName&value=' + encodeURIComponent(val) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function saveSeasonStart() {
  var input = document.getElementById('seasonStartInput');
  var val   = input ? input.value.trim() : '';
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    alert('Enter a date in YYYY-MM-DD format.');
    return;
  }
  var btn    = document.getElementById('seasonStartSaveBtn');
  var status = document.getElementById('seasonStartStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var cbName = '_setSeasonStartCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (result && result.success) {
      if (DATA) DATA.seasonStart = result.seasonStart;
      if (input) input.value = result.seasonStart || '';
      populateSeasonSelector();
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function() { if (status) status.textContent = ''; }, 2000);
      }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (status) { status.textContent = 'Error saving.'; }
  };
  script.src = WEB_APP_URL + '?action=setSeasonStart&value=' + encodeURIComponent(val) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function saveSeasonEnd() {
  var input = document.getElementById('seasonEndInput');
  var val   = input ? input.value.trim() : '';
  if (val && !/^\d{4}-\d{2}-\d{2}$/.test(val)) {
    alert('Enter a date in YYYY-MM-DD format.');
    return;
  }
  var btn    = document.getElementById('seasonEndSaveBtn');
  var status = document.getElementById('seasonEndStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var cbName = '_setSeasonEndCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (result && result.success) {
      if (DATA) DATA.seasonEnd = result.seasonEnd;
      if (input) input.value = result.seasonEnd || '';
      if (status) {
        status.textContent = val ? 'Saved!' : 'Cleared.';
        setTimeout(function() { if (status) status.textContent = ''; }, 2000);
      }
    } else {
      if (status) { status.textContent = 'Error saving.'; }
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (status) { status.textContent = 'Error saving.'; }
  };
  script.src = WEB_APP_URL + '?action=setSeasonEnd&value=' + encodeURIComponent(val) + '&callback=' + cbName;
  document.head.appendChild(script);
}
