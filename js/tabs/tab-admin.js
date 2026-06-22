// ── Admin subtab management ───────────────────────────────────────────────

function buildAdminTab() {
  switchAdminSubTab('properties', document.getElementById('admin-subtab-btn-properties'));
}

function switchAdminSubTab(name, btnEl) {
  document.querySelectorAll('[id^="admin-subtab-btn-"]').forEach(function(b) { b.classList.remove('active'); });
  if (btnEl) btnEl.classList.add('active');
  ['properties', 'botconfig', 'export', 'discord', 'danger'].forEach(function(sub) {
    var el = document.getElementById('admin-sub-' + sub);
    if (el) el.style.display = (sub === name) ? '' : 'none';
  });
  if (name === 'properties') loadAdminProperties();
  if (name === 'botconfig')  loadBotConfig();
  if (name === 'discord')    renderDiscordClaims();
  if (name === 'danger')     renderDangerZone();
}

// ── Properties Inspector ──────────────────────────────────────────────────

function loadAdminProperties() {
  var content = document.getElementById('adminPropsContent');
  if (content) content.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">Loading...</p>';

  jsonpRequest(WEB_APP_URL + '?action=getAdminProperties', function(err, result) {
    if (err || !result) {
      if (content) content.innerHTML = '<p style="color:var(--melee);">' + (err ? err.message : 'Error loading properties') + '</p>';
      return;
    }
    var rows = [
      ['Season Name',          result.seasonName          || '(not set)'],
      ['Season Start',         result.seasonStart         || '(not set)'],
      ['Season End',           result.seasonEnd           || '(not set)'],
      ['Archived Seasons',     result.seasonHistoryCount  + ' season(s)'],
      ['Raid Progression',     result.raidProgressionCount + ' raid(s)'],
      ['Signups Open',         result.signupsOpen         === 'true' ? 'Yes' : 'No'],
      ['BiS Submissions Open', result.bisSubmissionsOpen  === 'true' ? 'Yes' : 'No'],
      ['M+ Exclusions Open',   result.mPlusExclusionsOpen === 'true' ? 'Yes' : 'No'],
      ['Bot URL',              result.botUrl              || '(using default)'],
      ['Bot Secret',           result.botSecretMasked     || '(not set)'],
    ];
    var html = '<table class="admin-props-table">';
    rows.forEach(function(r) {
      html += '<tr><td class="admin-prop-key">' + r[0] + '</td><td class="admin-prop-val">' + r[1] + '</td></tr>';
    });
    html += '</table>';
    if (content) content.innerHTML = html;
  });
}

// ── Bot Config ────────────────────────────────────────────────────────────

function loadBotConfig() {
  var urlInput = document.getElementById('adminBotUrlInput');
  if (urlInput) urlInput.placeholder = 'Loading...';

  jsonpRequest(WEB_APP_URL + '?action=getAdminProperties', function(err, result) {
    if (!err && result) {
      if (urlInput) { urlInput.value = result.botUrl || ''; urlInput.placeholder = 'e.g. http://server:3000'; }
    } else {
      if (urlInput) urlInput.placeholder = 'Could not load current value';
    }
  });
}

function saveBotUrl() {
  var input  = document.getElementById('adminBotUrlInput');
  var status = document.getElementById('adminBotUrlStatus');
  var btn    = document.getElementById('adminBotUrlBtn');
  var val    = input ? input.value.trim() : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  jsonpRequest(WEB_APP_URL + '?action=setBotUrl&value=' + encodeURIComponent(val), function(err, result) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (!err && result && result.success) {
      if (status) { status.textContent = 'Saved!'; setTimeout(function() { if (status) status.textContent = ''; }, 2500); }
    } else {
      if (status) { status.textContent = err ? err.message : 'Error saving.'; }
    }
  });
}

function saveBotSecret() {
  var input  = document.getElementById('adminBotSecretInput');
  var status = document.getElementById('adminBotSecretStatus');
  var btn    = document.getElementById('adminBotSecretBtn');
  var val    = input ? input.value.trim() : '';
  if (!val) {
    if (status) { status.textContent = 'Enter a secret first.'; setTimeout(function() { if (status) status.textContent = ''; }, 2000); }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  jsonpRequest(WEB_APP_URL + '?action=setBotSecret&value=' + encodeURIComponent(val), function(err, result) {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    if (!err && result && result.success) {
      if (input) input.value = '';
      if (status) { status.textContent = 'Saved!'; setTimeout(function() { if (status) status.textContent = ''; }, 2500); }
    } else {
      if (status) { status.textContent = err ? err.message : 'Error saving.'; }
    }
  });
}

// ── Data Export ───────────────────────────────────────────────────────────

function downloadExport() {
  var btn = document.getElementById('adminExportBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing...'; }
  try {
    var payload = {
      exportedAt: new Date().toISOString(),
      team:       TEAM_NAME,
      version:    VERSION,
      data:       DATA,
    };
    var json = JSON.stringify(payload, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = TEAM_SLUG + '-export-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Download JSON'; }
  }
}

// ── Danger Zone ───────────────────────────────────────────────────────────

var DANGER_OPS = [
  { key: 'clearSeasonHistory', label: 'Clear Season History',    desc: 'Permanently deletes all archived seasons from script properties.',                  action: 'dangerClearSeasonHistory', sheet: null },
  { key: 'clearLootData',      label: 'Clear Loot Data Sheet',   desc: 'Wipes all imported RCLootCouncil loot entries from the Loot Data sheet.',           action: 'dangerClearSheet',         sheet: 'Loot Data' },
  { key: 'clearPastedLoot',    label: 'Clear Pasted Loot Sheet', desc: 'Wipes all rows from the Pasted Loot sheet.',                                        action: 'dangerClearSheet',         sheet: 'Pasted Loot' },
  { key: 'clearBisSubs',       label: 'Clear BiS Submissions',   desc: 'Wipes all rows from the BiS Responses sheet.',                                      action: 'dangerClearSheet',         sheet: 'BiS Responses' },
  { key: 'clearSignups',       label: 'Clear Signups',           desc: 'Wipes all rows from the Roster Responses (signup applications) sheet.',              action: 'dangerClearSheet',         sheet: 'Roster Responses' },
  { key: 'clearMplus',         label: 'Clear M+ Exclusions',     desc: 'Wipes all rows from the M+ Exclusion Requests sheet.',                              action: 'dangerClearSheet',         sheet: 'M+ Exclusion Requests' },
  { key: 'clearPending',       label: 'Clear Pending Roster',    desc: 'Wipes all rows from the Pending Roster sheet.',                                     action: 'dangerClearSheet',         sheet: 'Pending Roster' },
  { key: 'clearSelfReceived',  label: 'Clear Self-Received',     desc: 'Wipes all rows from the Self Received Requests sheet.',                             action: 'dangerClearSheet',         sheet: 'Self Received Requests' },
];

function renderDangerZone() {
  var content = document.getElementById('adminDangerContent');
  if (!content) return;
  var html = '<p style="font-size:0.88rem;color:var(--melee);margin-bottom:1rem;">' +
    'These operations are permanent and cannot be undone. Type <strong>' + TEAM_NAME + '</strong> to confirm each action.' +
    '</p>';
  DANGER_OPS.forEach(function(op) {
    html += '<div class="admin-danger-card">';
    html += '<div class="admin-danger-label">' + op.label + '</div>';
    html += '<p class="admin-danger-desc">' + op.desc + '</p>';
    html += '<div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">';
    html += '<input type="text" class="add-player-input" id="danger-confirm-' + op.key + '"' +
            ' placeholder="Type team name to confirm" style="max-width:240px;font-size:0.88rem;">';
    html += '<button class="btn btn-danger" id="danger-btn-' + op.key + '"' +
            ' onclick="executeDangerOp(\'' + op.key + '\')">' + op.label + '</button>';
    html += '<span id="danger-status-' + op.key + '" style="font-size:0.85rem;"></span>';
    html += '</div></div>';
  });
  content.innerHTML = html;
}

function executeDangerOp(key) {
  var op = null;
  for (var i = 0; i < DANGER_OPS.length; i++) { if (DANGER_OPS[i].key === key) { op = DANGER_OPS[i]; break; } }
  if (!op) return;

  var input  = document.getElementById('danger-confirm-' + key);
  var btn    = document.getElementById('danger-btn-'    + key);
  var status = document.getElementById('danger-status-' + key);

  if (!input || input.value.trim() !== TEAM_NAME) {
    if (status) { status.style.color = 'var(--melee)'; status.textContent = 'Team name does not match.'; setTimeout(function() { if (status) { status.textContent = ''; } }, 2500); }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Working...'; }

  var url = WEB_APP_URL + '?action=' + encodeURIComponent(op.action);
  if (op.sheet) url += '&sheet=' + encodeURIComponent(op.sheet);

  jsonpRequest(url, function(err, result) {
    if (btn) { btn.disabled = false; btn.textContent = op.label; }
    if (!err && result && result.success) {
      if (input) input.value = '';
      if (status) { status.style.color = 'var(--heal)'; status.textContent = 'Done.'; setTimeout(function() { if (status) status.textContent = ''; }, 3000); }
    } else {
      if (status) { status.style.color = 'var(--melee)'; status.textContent = err ? err.message : 'Error.'; }
    }
  });
}

// ── Discord Claims ────────────────────────────────────────────────────────────

function renderDiscordClaims() {
  var el = document.getElementById('adminDiscordClaimsContent');
  if (!el) return;
  var claims = (window.DATA && DATA.discordClaims) ? DATA.discordClaims : [];
  if (!claims.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.9rem;">No characters have been claimed yet.</p>';
    return;
  }
  var rows = claims.slice().sort(function(a, b) { return a.nameRealm.localeCompare(b.nameRealm); }).map(function(c) {
    var date = c.claimedAt ? new Date(c.claimedAt).toLocaleDateString() : '--';
    return '<tr>'
      + '<td>' + escHtml(c.username) + '</td>'
      + '<td>' + escHtml(c.nameRealm) + '</td>'
      + '<td>' + escHtml(date) + '</td>'
      + '<td><button class="btn btn-muted" style="padding:0.2rem 0.6rem;font-size:0.75rem;" onclick="removeDiscordClaim(' + JSON.stringify(c.nameRealm) + ')">Remove</button></td>'
      + '</tr>';
  }).join('');
  el.innerHTML = '<table class="loot-table" style="width:100%;">'
    + '<thead><tr><th>Discord User</th><th>Character</th><th>Claimed</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table>';
}

function removeDiscordClaim(nameRealm) {
  if (!confirm('Remove claim for ' + nameRealm + '? The raider will need to re-claim their character on next login.')) return;
  jsonpRequest(
    WEB_APP_URL + '?action=removeDiscordClaim&nameRealm=' + encodeURIComponent(nameRealm),
    function(err, result) {
      if (err || !result || !result.success) {
        alert('Failed to remove claim: ' + ((result && result.error) || (err && err.message) || 'Unknown error'));
        return;
      }
      if (window.DATA && DATA.discordClaims) {
        DATA.discordClaims = DATA.discordClaims.filter(function(c) { return c.nameRealm !== nameRealm; });
      }
      renderDiscordClaims();
    }
  );
}
