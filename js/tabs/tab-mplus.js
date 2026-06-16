function renderMPlusToggle() {
  var badge = document.getElementById('mplusStatusBadge');
  var btn   = document.getElementById('mplusToggleBtn');
  if (!badge || !btn) return;
  var open = !!(DATA && DATA.mPlusExclusionsOpen);
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Requests' : 'Open Requests';
}

function toggleMPlusOpen() {
  var open = !(DATA && DATA.mPlusExclusionsOpen);
  var btn  = document.getElementById('mplusToggleBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var cbName = '_setMPlusOpenCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) btn.disabled = false;
    if (result && result.success) {
      if (DATA) DATA.mPlusExclusionsOpen = result.mPlusExclusionsOpen;
    }
    renderMPlusToggle();
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) btn.disabled = false;
    renderMPlusToggle();
  };
  script.src = WEB_APP_URL + '?action=setMPlusExclusionsOpen&value=' + (open ? 'true' : 'false') + '&callback=' + cbName;
  document.head.appendChild(script);
}

function confirmClearAllMPlusExclusions() {
  var el = document.getElementById('mplusClearConfirm');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function executeClearAllMPlusExclusions() {
  var confirmEl = document.getElementById('mplusClearConfirm');
  if (confirmEl) confirmEl.style.display = 'none';

  var cbName = '_clearMPlusCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (result && result.success && DATA && DATA.roster) {
      DATA.roster.forEach(function(p) { p.mPlusExcluded = false; });
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; };
  script.src = WEB_APP_URL + '?action=clearAllMPlusExclusions&callback=' + cbName;
  document.head.appendChild(script);
}

function buildMPlusTab() {
  renderMPlusToggle();
  var container = document.getElementById('mplusContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  var cbName = '_getMPlusExclusionsCb';
  window[cbName] = function(result) {
    delete window[cbName];
    renderMPlusSubmissions(result.submissions || []);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('mplusContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load submissions.</p>';
  };
  script.src = WEB_APP_URL + '?action=getMPlusExclusions&callback=' + cbName;
  document.head.appendChild(script);
}

function renderMPlusSubmissions(submissions) {
  var container = document.getElementById('mplusContainer');
  if (!container) return;

  if (!submissions.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
    return;
  }

  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length + ' pending request' + (submissions.length !== 1 ? 's' : '') + '</div>';

  submissions.forEach(function(s) {
    var nrSafe = s.nameRealm.replace(/'/g, "\\'");
    html += '<div class="request-card" data-row="' + s.rowIndex + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<div>' +
          '<div style="font-size:1.05rem;font-weight:600;color:var(--text);">' + s.nameRealm + '</div>' +
          '<div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.15rem;">' + s.timestamp + '</div>' +
        '</div>' +
      '</div>' +
      (s.raiderioUrl
        ? '<div style="margin-top:0.5rem;"><a href="' + s.raiderioUrl + '" target="_blank" rel="noopener" style="color:var(--gold);font-size:0.95rem;">View Raider.io Profile</a></div>'
        : '') +
      (s.notes
        ? '<div style="font-size:0.95rem;color:var(--text);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">' + s.notes + '</div>'
        : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
        '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' + s.rowIndex + ',\'' + nrSafe + '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' + s.rowIndex + ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Reject</button>' +
      '</div>' +
    '</div>';
  });

  container.innerHTML = html + '</div>';
}

function approveMPlusExclusion(rowIndex, nameRealm, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId     = '_mplusNote' + rowIndex;
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.4rem;">Officer note (optional):</div>' +
      '<textarea id="' + noteId + '" rows="2" placeholder="e.g. Focus on getting sockets this week instead" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:0.88rem;resize:vertical;"></textarea>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
        '<button id="_mplusApproveConfirm' + rowIndex + '" class="btn request-approve-btn" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button id="_mplusApproveCancel' + rowIndex + '" class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Cancel</button>' +
      '</div>' +
    '</div>';

  var noteInput  = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_mplusApproveConfirm' + rowIndex);
  var cancelBtn  = document.getElementById('_mplusApproveCancel' + rowIndex);

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function() {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmApproveMPlusExclusion(rowIndex, nameRealm, note, confirmBtn);
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() {
      var nrSafe = nameRealm.replace(/'/g, "\\'");
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' + rowIndex + ',\'' + nrSafe + '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' + rowIndex + ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Reject</button>';
    });
  }
}

function confirmApproveMPlusExclusion(rowIndex, nameRealm, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';

  var data   = { row: rowIndex, nameRealm: nameRealm, note: note };
  var cbName = '_approveMPlusCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) {
      btnEl.disabled = false; btnEl.textContent = 'Approve';
      return;
    }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    var container = document.getElementById('mplusContainer');
    if (container && !container.querySelector('.request-card')) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    btnEl.disabled = false; btnEl.textContent = 'Approve';
  };
  script.src = WEB_APP_URL + '?action=approveMPlusExclusion&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function rejectMPlusExclusion(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var approveBtn = btnEl.previousElementSibling;
  if (approveBtn) approveBtn.disabled = true;

  var cbName = '_rejectMPlusCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) {
      btnEl.disabled = false; btnEl.textContent = 'Reject';
      if (approveBtn) approveBtn.disabled = false;
      return;
    }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    var container = document.getElementById('mplusContainer');
    if (container && !container.querySelector('.request-card')) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    btnEl.disabled = false; btnEl.textContent = 'Reject';
    if (approveBtn) approveBtn.disabled = false;
  };
  script.src = WEB_APP_URL + '?action=rejectMPlusExclusion&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}
