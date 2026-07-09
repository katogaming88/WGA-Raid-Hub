// Officer quick-actions bar + player selector gating (index.html only).
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

// ── Player selector gating ────────────────────────────────────────────────────
// No session / unclaimed  -> hide card entirely
// Logged in, non-officer  -> "View My Profile" button only
// Logged in, officer      -> full dropdown + "View My Profile" link

function _renderPlayerSelector() {
  var card = document.getElementById('playerSelectorCard');
  var label = document.getElementById('playerSelectorLabel');
  var dropOuter = document.getElementById('playerDropdownOuter');
  var profileOuter = document.getElementById('myProfileOuter');
  var profileBtn = document.getElementById('myProfileBtn');
  if (!card) return;

  var session = typeof getDiscordSession === 'function' && getDiscordSession();

  if (!session || !session.nameRealm) {
    card.style.display = 'none';
    return;
  }

  card.style.display = '';
  var firstName = session.nameRealm.split('-')[0];

  if (profileBtn) {
    profileBtn.onclick = function () {
      if (typeof showView === 'function') showView('profile');
      if (typeof renderProfile === 'function') renderProfile(firstName, 'landing');
      var sel = document.getElementById('playerSelect');
      if (sel) sel.value = firstName;
    };
  }

  if (session.isOfficer) {
    if (label) label.textContent = 'Look Up a Raider';
    if (dropOuter) dropOuter.style.display = '';
    if (profileOuter) profileOuter.style.display = '';
  } else {
    if (label) label.textContent = 'Your Profile';
    if (dropOuter) dropOuter.style.display = 'none';
    if (profileOuter) profileOuter.style.display = '';
  }
}

// Persistent "claim your character" prompt on the landing view, shown only when
// logged in with no claimed character -- the same session state where
// _renderPlayerSelector hides the profile card. display:none keeps it out of the
// accessibility tree. The box's dialog/focus a11y and the modal it opens are
// tracked in the Accessibility milestone; this is just the entry point.
function _renderClaimPrompt() {
  var card = document.getElementById('claimPromptCard');
  if (!card) return;
  var session = typeof getDiscordSession === 'function' && getDiscordSession();
  if (session && !session.nameRealm) {
    var nameEl = document.getElementById('claimPromptName');
    if (nameEl) nameEl.textContent = session.username || '';
    card.style.display = '';
  } else {
    card.style.display = 'none';
  }
}

// Officer bar + player selector + claim prompt all react to the Discord session;
// refresh the three together on every transition.
function _qaRefresh() {
  _qaRender();
  _renderPlayerSelector();
  _renderClaimPrompt();
}

// Callbacks invoked by discord.js
function onDiscordSessionRestored(session) {
  _qaRefresh();
}
function onDiscordLoginComplete(session) {
  _qaRefresh();
}
function onDiscordLogout() {
  _qaRefresh();
}
function onDiscordInitNoSession() {
  _qaRefresh();
}
function onDiscordClaimComplete(session) {
  _qaRefresh();
}

function _qaSetStatus(msg, color) {
  var el = document.getElementById('oqaStatus');
  if (!el) return;
  el.textContent = msg;
  el.style.color = color || 'var(--text-muted)';
}

// ── Copy Priority Export ──────────────────────────────────────────────────────

function qaExportString() {
  var btn = document.getElementById('oqaExportBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Loading...';
  }
  _qaSetStatus('Fetching export string...', 'var(--text-muted)');

  jsonpRequest(
    WEB_APP_URL + '?action=getExportString',
    function (err, result) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Copy Priority Export';
      }
      var str = !err && result && result.exportString ? result.exportString : '';
      if (!str) {
        _qaSetStatus(err ? err.message : 'No export string found.', 'var(--melee)');
        return;
      }
      navigator.clipboard
        .writeText(str)
        .then(function () {
          _qaSetStatus('Copied!', 'var(--heal)');
          setTimeout(function () {
            _qaSetStatus('', '');
          }, 3000);
        })
        .catch(function () {
          _qaSetStatus('Copy failed -- check browser permissions.', 'var(--melee)');
        });
    },
    20000
  );
}

// ── Refresh Attendance ────────────────────────────────────────────────────────

function qaRefreshAttendance() {
  var btn = document.getElementById('oqaAttendBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
  }
  _qaSetStatus('This may take 30-60 seconds...', 'var(--text-muted)');

  jsonpRequest(
    WEB_APP_URL + '?action=refreshAttendanceWCL',
    function (err, result) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Refresh Attendance';
      }
      if (!err && result && result.success) {
        var msg =
          'Done: ' +
          result.mainNights +
          ' night' +
          (result.mainNights !== 1 ? 's' : '') +
          ' found, ' +
          result.excluded +
          ' excluded.';
        var officerBase =
          'officer.html' + (TEAM_SLUG !== 'phoenix' ? '?team=' + TEAM_SLUG + '&' : '?') + 'tab=attendance';
        var el = document.getElementById('oqaStatus');
        if (el) {
          el.style.color = 'var(--heal)';
          el.innerHTML =
            msg +
            ' <a href="' +
            officerBase +
            '" style="color:var(--gold-light);text-decoration:underline;">Review in Dashboard</a>';
        }
      } else {
        _qaSetStatus(err ? err.message : result && result.error ? result.error : 'Error refreshing.', 'var(--melee)');
      }
    },
    90000
  );
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
  var pasteEl = document.getElementById('oqaLootPaste');
  var paste = pasteEl ? pasteEl.value.trim() : '';
  var statusEl = document.getElementById('oqaLootStatus');
  var importBtn = document.getElementById('oqaLootImportBtn');

  function setStatus(msg, color) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = color || 'var(--text-muted)';
  }

  if (!paste) {
    setStatus('Paste the RCLC JSON export first.', 'var(--melee)');
    return;
  }

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
    var ent = entries[i];
    var id = String(ent.id || '').trim();
    var player = String(ent.player || '').trim();
    var rawDate = ent.date;
    var date = (function (raw) {
      if (!raw) return '';
      var d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw).trim();
      var mo = String(d.getMonth() + 1).padStart(2, '0');
      var dy = String(d.getDate()).padStart(2, '0');
      return d.getFullYear() + '-' + mo + '-' + dy;
    })(rawDate);
    var itemName = String(ent.itemName || '').trim();
    var instance = String(ent.instance || '').trim();
    if (id && player && instance) {
      rows.push({ id: id, player: player, date: date, itemName: itemName, instance: instance });
    }
  }

  if (rows.length === 0) {
    setStatus('No valid entries found -- check that the JSON has id, player, and instance fields.', 'var(--melee)');
    return;
  }

  var season = window.DATA && DATA.seasonName ? DATA.seasonName.trim() : '';
  if (importBtn) importBtn.disabled = true;
  setStatus('Importing ' + rows.length + ' entries...', 'var(--text-muted)');

  _qaLootChunks(
    season,
    rows,
    0,
    0,
    0,
    statusEl,
    function (written, skipped) {
      if (importBtn) importBtn.disabled = false;
      var msg = 'Done. ' + written + ' new entries added';
      if (skipped > 0) msg += ', ' + skipped + ' duplicates skipped';
      setStatus(msg + '.', 'var(--heal)');
      if (pasteEl) pasteEl.value = '';
    },
    function (errMsg) {
      if (importBtn) importBtn.disabled = false;
      setStatus(errMsg, 'var(--melee)');
    }
  );
}

function _qaLootChunks(season, rows, offset, written, skipped, statusEl, onDone, onError) {
  if (offset >= rows.length) {
    onDone(written, skipped);
    return;
  }
  var chunk = rows.slice(offset, offset + _QA_LOOT_CHUNK);
  if (statusEl) {
    statusEl.textContent =
      'Importing... (' + Math.min(offset + _QA_LOOT_CHUNK, rows.length) + ' / ' + rows.length + ')';
  }
  jsonpRequest(
    WEB_APP_URL +
      '?action=appendLootRows&season=' +
      encodeURIComponent(season) +
      '&rows=' +
      encodeURIComponent(JSON.stringify(chunk)),
    function (err, result) {
      if (err || !result || !result.success) {
        onError(err ? err.message : 'Import failed after ' + written + ' entries.');
        return;
      }
      _qaLootChunks(
        season,
        rows,
        offset + _QA_LOOT_CHUNK,
        written + (result.written || 0),
        skipped + (result.skipped || 0),
        statusEl,
        onDone,
        onError
      );
    }
  );
}

// Eagerly render from the cached session without waiting for validation.
// The onDiscord* callbacks correct these once session validation completes.
_qaRefresh();
