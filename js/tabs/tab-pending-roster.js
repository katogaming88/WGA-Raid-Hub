function buildPendingRosterTab() {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading...</p>';

  var cbName = '_getPendingRosterCb';
  window[cbName] = function(result) {
    delete window[cbName];
    renderPendingRoster(result.entries || []);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('pendingRosterContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load pending roster.</p>';
  };
  script.src = WEB_APP_URL + '?action=getPendingRoster&callback=' + cbName;
  document.head.appendChild(script);
}

function renderPendingRoster(entries) {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;

  if (!entries.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending applicants.</p>';
    return;
  }

  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    entries.length + ' applicant' + (entries.length !== 1 ? 's' : '') + ' awaiting roster placement</div>';

  entries.forEach(function(e) {
    var clsColor  = classColor(e.className);
    var entrySafe = encodeURIComponent(JSON.stringify(e)).replace(/'/g, '%27');
    html += '<div class="signup-response-card" data-row="' + e.rowIndex + '">' +
      '<div class="signup-response-header">' +
        '<span class="signup-response-name">' + e.nameRealm + '</span>' +
      '</div>' +
      '<div style="font-size:1rem;color:' + clsColor + ';margin-top:0.35rem;font-weight:600;">' +
        e.className + ' &middot; ' + e.mainSpec +
        (e.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + e.offSpecs + '</span>' : '') +
      '</div>';
    if (e.role)    html += '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' + e.role + '</span></div>';
    if (e.discord) html += '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Discord: <span style="color:var(--text);">' + e.discord + '</span></div>';
    html +=
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">' +
        '<button class="btn request-approve-btn" onclick="openAddFromPendingModal(\'' + entrySafe + '\')" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Add to Roster</button>' +
        '<button class="btn btn-danger" onclick="removePendingRosterRow(' + e.rowIndex + ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Remove</button>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html + '</div>';
}

function openAddFromPendingModal(entrySafe) {
  var entry;
  try { entry = JSON.parse(decodeURIComponent(entrySafe)); } catch(e) { return; }

  window._pendingRosterOnSuccess = function() {
    removePendingRosterRow(entry.rowIndex, null);
  };

  showAddPlayerModal();

  var parts = (entry.nameRealm || '').split('-');
  document.getElementById('addPlayerName').value  = parts[0] || '';
  document.getElementById('addPlayerRealm').value = parts.slice(1).join('-') || '';

  var classSel = document.getElementById('addPlayerClass');
  if (classSel && entry.className) {
    classSel.value = entry.className;
    addPlayerClassChanged();
    var specSel = document.getElementById('addPlayerSpec');
    if (specSel && entry.mainSpec) specSel.value = entry.mainSpec;
  }

  var roleSel = document.getElementById('addPlayerRole');
  if (roleSel && entry.role) roleSel.value = entry.role;
}

function removePendingRosterRow(rowIndex, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = '...'; }

  var cbName = '_removePendingRosterCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.error) {
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Remove'; }
      return;
    }
    var card = document.querySelector('.signup-response-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    var container = document.getElementById('pendingRosterContainer');
    if (container && !container.querySelector('.signup-response-card')) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending applicants.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Remove'; }
  };
  script.src = WEB_APP_URL + '?action=removePendingRoster&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}
