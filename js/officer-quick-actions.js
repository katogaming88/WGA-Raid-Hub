// Officer quick-actions bar (index.html only).
// Shows only to Discord-authenticated officers. Provides one-click access to:
// copy priority export string, trigger WCL attendance refresh, paste loot import.
// Depends on: common.js (WEB_APP_URL, jsonpRequest), discord.js (getDiscordSession)

var _QA_LOOT_CHUNK = 25;

function _qaIsOfficer() {
  var s = typeof getDiscordSession === 'function' && getDiscordSession();
  return !!(s && s.isOfficer);
}

function _qaRender() {
  var bar = document.getElementById('officerQuickActions');
  if (!bar) return;
  bar.style.display = _qaIsOfficer() ? '' : 'none';
}

// Callbacks invoked by discord.js
function onDiscordSessionRestored(session) { _qaRender(); }
function onDiscordLoginComplete(session)   { _qaRender(); }
function onDiscordLogout()                 { _qaRender(); }
function onDiscordInitNoSession()          { _qaRender(); }

function _qaSetStatus(msg, color) {
  var el = document.getElementById('oqaStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || 'var(--text-muted)';
}

// ── Copy Priority Export ──────────────────────────────────────────────────────

function qaExportString() {
  var btn = document.getElementById('oqaExportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  _qaSetStatus('Fetching export string...', 'var(--text-muted)');

  jsonpRequest(WEB_APP_URL + '?action=getExportString', function(err, result) {
    if (btn) { btn.disabled = false; btn.textContent = 'Copy Priority Export'; }
    var str = (!err && result && result.exportString) ? result.exportString : '';
    if (!str) {
      _qaSetStatus(err ? err.message : 'No export string found.', 'var(--melee)');
      return;
    }
    navigator.clipboard.writeText(str).then(function() {
      _qaSetStatus('Copied!', 'var(--heal)');
      setTimeout(function() { _qaSetStatus('', ''); }, 3000);
    }).catch(function() {
      _qaSetStatus('Copy failed -- check browser permissions.', 'var(--melee)');
    });
  }, 20000);
}

// ── Refresh Attendance ────────────────────────────────────────────────────────

function qaRefreshAttendance() {
  var btn = document.getElementById('oqaAttendBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Refreshing...'; }
  _qaSetStatus('This may take 30-60 seconds...', 'var(--text-muted)');

  jsonpRequest(WEB_APP_URL + '?action=refreshAttendanceWCL', function(err, result) {
    if (btn) { btn.disabled = false; btn.textContent = 'Refresh Attendance'; }
    if (!err && result && result.success) {
      var msg = 'Done: ' + result.mainNights + ' night' + (result.mainNights !== 1 ? 's' : '') + ' found, ' + result.excluded + ' excluded.';
      var officerBase = 'officer.html' + (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG + '&' : '?') + 'tab=attendance';
      var el = document.getElementById('oqaStatus');
      if (el) {
        el.style.color = 'var(--heal)';
        el.innerHTML = msg + ' <a href="' + officerBase + '" style="color:var(--gold-light);text-decoration:underline;">Review in Dashboard</a>';
      }
    } else {
      _qaSetStatus(err ? err.message : (result && result.error ? result.error : 'Error refreshing.'), 'var(--melee)');
    }
  }, 90000);
}

// ── Paste Loot Import ─────────────────────────────────────────────────────────

function qaPasteLootToggle() {
  var panel = document.getElementById('oqaLootPanel');
  if (!panel) return;
  var open = panel.style.display !== 'none';
  panel.style.display = open ? 'none' : '';
  var btn = document.getElementById('oqaLootBtn');
  if (btn) btn.textContent = open ? 'Paste Loot' : 'Hide Loot Import';
  if (!open) _qaSetStatus('', '');
}

function qaSubmitLoot() {
  var pasteEl  = document.getElementById('oqaLootPaste');
  var paste    = pasteEl ? pasteEl.value.trim() : '';
  var statusEl = document.getElementById('oqaLootStatus');
  var importBtn = document.getElementById('oqaLootImportBtn');

  function setStatus(msg, color) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = color || 'var(--text-muted)';
  }

  if (!paste) { setStatus('Paste the RCLC JSON export first.', 'var(--melee)'); return; }

  var entries;
  try {
    entries = JSON.parse(paste);
    if (!Array.isArray(entries)) throw new Error('Expected a JSON array.');
  } catch (e) {
    setStatus('Invalid JSON: ' + e.message, 'var(--melee)');
    return;
  }

  var rows = [];
  for (var i = 0; i < entries.length; i++) {
    var ent      = entries[i];
    var id       = String(ent.id       || '').trim();
    var player   = String(ent.player   || '').trim();
    var rawDate  = ent.date;
    var date     = (function(raw) {
      if (!raw) return '';
      var d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw).trim();
      var mo = String(d.getMonth() + 1).padStart(2, '0');
      var dy = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + mo + '-' + dy;
    })(rawDate);
    var itemName = String(ent.itemName  || '').trim();
    var instance = String(ent.instance  || '').trim();
    if (id && player && instance) {
      rows.push({ id: id, player: player, date: date, itemName: itemName, instance: instance });
    }
  }

  if (rows.length === 0) {
    setStatus('No valid entries found -- check that the JSON has id, player, and instance fields.', 'var(--melee)');
    return;
  }

  var season = (window.DATA && DATA.seasonName) ? DATA.seasonName.trim() : '';
  if (importBtn) importBtn.disabled = true;
  setStatus('Importing ' + rows.length + ' entries...', 'var(--text-muted)');

  _qaLootChunks(season, rows, 0, 0, 0, statusEl,
    function(written, skipped) {
      if (importBtn) importBtn.disabled = false;
      var msg = 'Done. ' + written + ' new entries added';
      if (skipped > 0) msg += ', ' + skipped + ' duplicates skipped';
      setStatus(msg + '.', 'var(--heal)');
      if (pasteEl) pasteEl.value = '';
    },
    function(errMsg) {
      if (importBtn) importBtn.disabled = false;
      setStatus(errMsg, 'var(--melee)');
    }
  );
}

function _qaLootChunks(season, rows, offset, written, skipped, statusEl, onDone, onError) {
  if (offset >= rows.length) { onDone(written, skipped); return; }
  var chunk = rows.slice(offset, offset + _QA_LOOT_CHUNK);
  if (statusEl) {
    statusEl.textContent = 'Importing... (' + Math.min(offset + _QA_LOOT_CHUNK, rows.length) + ' / ' + rows.length + ')';
  }
  jsonpRequest(
    WEB_APP_URL + '?action=appendLootRows&season=' + encodeURIComponent(season) + '&rows=' + encodeURIComponent(JSON.stringify(chunk)),
    function(err, result) {
      if (err || !result || !result.success) {
        onError(err ? err.message : 'Import failed after ' + written + ' entries.');
        return;
      }
      _qaLootChunks(season, rows, offset + _QA_LOOT_CHUNK, written + (result.written || 0), skipped + (result.skipped || 0), statusEl, onDone, onError);
    }
  );
}
