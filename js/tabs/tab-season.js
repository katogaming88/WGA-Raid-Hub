function buildSeasonTab() {
  var input = document.getElementById('seasonStartInput');
  if (input) input.value = (DATA && DATA.seasonStart) || '';
}

function confirmClearSeasonStart() {
  var confirm = document.getElementById('seasonClearConfirm');
  if (confirm) confirm.style.display = '';
}

function executeClearSeasonStart() {
  var confirm = document.getElementById('seasonClearConfirm');
  if (confirm) confirm.style.display = 'none';
  var input = document.getElementById('seasonStartInput');
  if (input) input.value = '';
  saveSeasonStart();
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
