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
      '<div class="pending-roster-actions" data-entry-safe="' + entrySafe + '" data-row="' + e.rowIndex + '" style="display:flex;gap:0.5rem;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">' +
        '<button class="btn request-approve-btn" onclick="handleAddToRoster(\'' + entrySafe + '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Add to Roster</button>' +
        '<button class="btn btn-danger" onclick="removePendingRosterRow(' + e.rowIndex + ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Remove</button>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html + '</div>';
}

function handleAddToRoster(entrySafe, btnEl) {
  var entry;
  try { entry = JSON.parse(decodeURIComponent(entrySafe)); } catch(e) { return; }

  var parts = (entry.nameRealm || '').split('-');
  var nameRealm = parts[0] + '-' + parts.slice(1).join('-');

  var existing = null;
  if (DATA && DATA.roster) {
    for (var i = 0; i < DATA.roster.length; i++) {
      if (normalise(DATA.roster[i].nameRealm) === normalise(nameRealm)) {
        existing = DATA.roster[i];
        break;
      }
    }
  }

  if (existing) {
    showPendingUpdatePrompt(entry, nameRealm, existing, btnEl);
  } else {
    showPendingNickPrompt(entry, nameRealm, parts[0], btnEl);
  }
}

function showPendingUpdatePrompt(entry, nameRealm, existing, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var sameSpec   = normalise(existing.spec) === normalise(entry.mainSpec);
  var sameRole   = normalise(existing.role) === normalise(entry.role);
  var changes    = [];
  if (!sameSpec) changes.push('spec <b style="color:var(--text);">' + entry.mainSpec + '</b>');
  if (!sameRole) changes.push('role <b style="color:var(--text);">' + entry.role + '</b>');
  var msg = changes.length
    ? 'Already on roster. Update ' + changes.join(' and ') + '?'
    : 'Already on roster with matching spec and role.';

  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.5rem;">' + msg + '</div>' +
      '<div style="display:flex;gap:0.5rem;">' +
        (changes.length ? '<button id="_pendingUpdateBtn' + entry.rowIndex + '" class="btn request-approve-btn" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Update</button>' : '') +
        '<button id="_pendingCancelBtn' + entry.rowIndex + '" class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Cancel</button>' +
      '</div>' +
    '</div>';

  var updateBtn = document.getElementById('_pendingUpdateBtn' + entry.rowIndex);
  if (updateBtn) {
    updateBtn.addEventListener('click', function() {
      confirmUpdateFromPending(nameRealm, entry.mainSpec, entry.role, entry.rowIndex, updateBtn);
    });
  }
  var cancelBtn = document.getElementById('_pendingCancelBtn' + entry.rowIndex);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() { cancelPendingAction(entry.rowIndex); });
  }
}

function showPendingNickPrompt(entry, nameRealm, firstName, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var inputId    = 'nickInput' + entry.rowIndex;
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.5rem;">Nickname for <b style="color:var(--text);">' + firstName + '</b>? <span style="font-weight:400;">(optional)</span></div>' +
      '<div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">' +
        '<input id="' + inputId + '" type="text" placeholder="Leave blank to skip" style="background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.25rem 0.5rem;font-size:0.88rem;min-width:0;flex:1;" />' +
        '<button id="_pendingAddBtn' + entry.rowIndex + '" class="btn request-approve-btn" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Add</button>' +
        '<button id="_pendingCancelBtn' + entry.rowIndex + '" class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Cancel</button>' +
      '</div>' +
    '</div>';

  var input = document.getElementById(inputId);
  if (input) input.focus();

  var addBtn = document.getElementById('_pendingAddBtn' + entry.rowIndex);
  if (addBtn) {
    addBtn.addEventListener('click', function() {
      var nick = input ? input.value.trim() : '';
      directAddFromPending(entry, nameRealm, nick, addBtn);
    });
  }
  var cancelBtn = document.getElementById('_pendingCancelBtn' + entry.rowIndex);
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() { cancelPendingAction(entry.rowIndex); });
  }
}

function cancelPendingAction(rowIndex) {
  var card = document.querySelector('.signup-response-card[data-row="' + rowIndex + '"]');
  if (!card) return;
  var actionsDiv = card.querySelector('.pending-roster-actions');
  if (!actionsDiv) return;
  var entrySafe = actionsDiv.getAttribute('data-entry-safe') || '';
  actionsDiv.innerHTML =
    '<button class="btn request-approve-btn" onclick="handleAddToRoster(\'' + entrySafe + '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Add to Roster</button>' +
    '<button class="btn btn-danger" onclick="removePendingRosterRow(' + rowIndex + ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Remove</button>';
}

function confirmUpdateFromPending(nameRealm, mainSpec, role, rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  nameRealm = decodeURIComponent(nameRealm);
  mainSpec  = decodeURIComponent(mainSpec);
  role      = decodeURIComponent(role);

  var dataSafe = encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: 'spec', value: mainSpec }));
  var cbName = '_updateSpecCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.error) { btnEl.disabled = false; btnEl.textContent = 'Update'; return; }
    var dataSafe2 = encodeURIComponent(JSON.stringify({ nameRealm: nameRealm, field: 'role', value: role }));
    var cbName2 = '_updateRoleCb' + rowIndex;
    window[cbName2] = function(result2) {
      delete window[cbName2];
      if (result2 && result2.error) { btnEl.disabled = false; btnEl.textContent = 'Update'; return; }
      removePendingRosterRow(rowIndex, null);
    };
    var s2 = document.createElement('script');
    s2.onerror = function() { delete window[cbName2]; btnEl.disabled = false; btnEl.textContent = 'Update'; };
    s2.src = WEB_APP_URL + '?action=updatePlayerField&data=' + dataSafe2 + '&callback=' + cbName2;
    document.head.appendChild(s2);
  };
  var s1 = document.createElement('script');
  s1.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'Update'; };
  s1.src = WEB_APP_URL + '?action=updatePlayerField&data=' + dataSafe + '&callback=' + cbName;
  document.head.appendChild(s1);
}

function directAddFromPending(entry, nameRealm, nick, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';

  var data = {
    nameRealm: nameRealm,
    nick:      nick || '',
    class:     entry.className || '',
    spec:      entry.mainSpec  || '',
    role:      entry.role      || 'Melee',
    isTrial:   false
  };

  var cbName = '_directAddCb' + entry.rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.error) {
      btnEl.disabled = false; btnEl.textContent = 'Add to Roster';
      return;
    }
    var parts = nameRealm.split('-');
    if (DATA && DATA.roster) {
      DATA.roster.push({
        nameRealm: nameRealm, firstName: parts[0], realm: parts.slice(1).join('-'),
        nick: nick || '', class: entry.className, spec: entry.mainSpec,
        role: entry.role || 'Melee', isTrial: false, isBench: false,
        attendance: '', bisLink: ''
      });
      if (typeof buildRosterTable === 'function') buildRosterTable();
      if (typeof buildStatsBar    === 'function') buildStatsBar();
    }
    removePendingRosterRow(entry.rowIndex, null);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    btnEl.disabled = false; btnEl.textContent = 'Add to Roster';
  };
  script.src = WEB_APP_URL + '?action=addPlayer&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
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
    updateNavBadges();
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Remove'; }
  };
  script.src = WEB_APP_URL + '?action=removePendingRoster&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}
