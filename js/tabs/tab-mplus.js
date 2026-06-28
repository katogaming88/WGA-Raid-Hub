function renderMPlusToggle() {
  var badge = document.getElementById('mplusStatusBadge');
  var btn = document.getElementById('mplusToggleBtn');
  if (!badge || !btn) return;
  var open = !!(DATA && DATA.mPlusExclusionsOpen);
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Requests' : 'Open Requests';
}

function toggleMPlusOpen() {
  var open = !(DATA && DATA.mPlusExclusionsOpen);
  var btn = document.getElementById('mplusToggleBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  jsonpRequest(
    WEB_APP_URL + '?action=setMPlusExclusionsOpen&value=' + (open ? 'true' : 'false'),
    function (err, result) {
      if (btn) btn.disabled = false;
      if (!err && result && result.success) {
        if (DATA) DATA.mPlusExclusionsOpen = result.mPlusExclusionsOpen;
      }
      renderMPlusToggle();
    }
  );
}

function confirmClearAllMPlusExclusions() {
  var el = document.getElementById('mplusClearConfirm');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

function executeClearAllMPlusExclusions() {
  var confirmEl = document.getElementById('mplusClearConfirm');
  if (confirmEl) confirmEl.style.display = 'none';

  jsonpRequest(WEB_APP_URL + '?action=clearAllMPlusExclusions', function (err, result) {
    if (!err && result && result.success && DATA && DATA.roster) {
      DATA.roster.forEach(function (p) {
        p.mPlusExcluded = false;
      });
    }
  });
}

function buildMPlusTab() {
  renderMPlusToggle();
  renderActiveExclusions();
  var container = document.getElementById('mplusContainer');
  if (!container) return;
  container.innerHTML =
    '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  jsonpRequest(WEB_APP_URL + '?action=getMPlusExclusions', function (err, result) {
    if (err) {
      var c = document.getElementById('mplusContainer');
      if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + err.message + '</p>';
      return;
    }
    renderMPlusSubmissions(result.submissions || []);
  });
}

function renderActiveExclusions() {
  var container = document.getElementById('mplusActiveContainer');
  if (!container) return;
  var active = ((DATA && DATA.roster) || []).filter(function (p) {
    return p.mPlusExcluded;
  });
  if (!active.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:0.95rem;margin-top:0.75rem;">No players currently excluded.</p>';
    return;
  }
  var html = '<div style="margin-top:0.75rem;display:flex;flex-direction:column;gap:0.4rem;">';
  active.forEach(function (p) {
    html +=
      '<div style="display:flex;align-items:baseline;gap:0.6rem;padding:0.4rem 0;border-bottom:1px solid var(--border);">' +
      '<span style="font-size:0.97rem;font-weight:600;color:var(--text);min-width:140px;">' +
      p.nameRealm +
      '</span>' +
      (p.mPlusNote
        ? '<span style="font-size:0.88rem;color:var(--text-muted);font-style:italic;">' + p.mPlusNote + '</span>'
        : '') +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

function renderMPlusSubmissions(submissions) {
  var container = document.getElementById('mplusContainer');
  if (!container) return;

  if (!submissions.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
    return;
  }

  var html =
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length +
    ' pending request' +
    (submissions.length !== 1 ? 's' : '') +
    '</div>';

  submissions.forEach(function (s) {
    var nrSafe = s.nameRealm.replace(/'/g, "\\'");
    html +=
      '<div class="request-card" data-row="' +
      s.rowIndex +
      '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
      '<div>' +
      '<div style="font-size:1.05rem;font-weight:600;color:var(--text);">' +
      s.nameRealm +
      '</div>' +
      '<div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.15rem;">' +
      s.timestamp +
      '</div>' +
      '</div>' +
      '</div>' +
      (s.raiderioUrl
        ? '<div style="margin-top:0.5rem;"><a href="' +
          s.raiderioUrl +
          '" target="_blank" rel="noopener" style="color:var(--gold);font-size:0.95rem;">View Raider.io Profile</a></div>'
        : '') +
      (s.notes
        ? '<div style="font-size:0.95rem;color:var(--text);margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">' +
          s.notes +
          '</div>'
        : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' +
      s.rowIndex +
      ",'" +
      nrSafe +
      '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
      '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' +
      s.rowIndex +
      ",'" +
      nrSafe +
      '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Reject</button>' +
      '</div>' +
      '</div>';
  });

  container.innerHTML = html + '</div>';
}

function approveMPlusExclusion(rowIndex, nameRealm, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId = '_mplusNote' + rowIndex;
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.4rem;">Officer note (optional):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. Focus on getting sockets this week instead" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:0.88rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_mplusApproveConfirm' +
    rowIndex +
    '" class="btn request-approve-btn" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
    '<button id="_mplusApproveCancel' +
    rowIndex +
    '" class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_mplusApproveConfirm' + rowIndex);
  var cancelBtn = document.getElementById('_mplusApproveCancel' + rowIndex);

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmApproveMPlusExclusion(rowIndex, nameRealm, note, confirmBtn);
    });
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      var nrSafe = nameRealm.replace(/'/g, "\\'");
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Reject</button>';
    });
  }
}

function confirmApproveMPlusExclusion(rowIndex, nameRealm, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';

  var data = { row: rowIndex, nameRealm: nameRealm, note: note };
  jsonpRequest(
    WEB_APP_URL + '?action=approveMPlusExclusion&data=' + encodeURIComponent(JSON.stringify(data)),
    function (err, result) {
      if (err || (result && result.error)) {
        btnEl.disabled = false;
        btnEl.textContent = 'Approve';
        return;
      }
      var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
      if (card) card.remove();
      var container = document.getElementById('mplusContainer');
      if (container && !container.querySelector('.request-card')) {
        container.innerHTML =
          '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
      }
      updateNavBadges();
    }
  );
}

function rejectMPlusExclusion(rowIndex, nameRealm, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId = '_mplusRejectNote' + rowIndex;
  var nrSafe = nameRealm.replace(/'/g, "\\'");
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:0.92rem;color:var(--text-muted);margin-bottom:0.4rem;">Rejection reason (optional, shown to raider):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. You still need to meet the weekly M+ requirement" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:0.88rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_mplusRejectConfirm' +
    rowIndex +
    '" class="btn btn-danger" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Reject</button>' +
    '<button id="_mplusRejectCancel' +
    rowIndex +
    '" class="btn btn-muted" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_mplusRejectConfirm' + rowIndex);
  var cancelBtn = document.getElementById('_mplusRejectCancel' + rowIndex);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
        '<button class="btn btn-danger" onclick="rejectMPlusExclusion(' +
        rowIndex +
        ",'" +
        nrSafe +
        '\',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Reject</button>';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      confirmRejectMPlusExclusion(rowIndex, note, confirmBtn);
    });
  }
}

function confirmRejectMPlusExclusion(rowIndex, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';

  var data = { row: rowIndex, note: note };
  jsonpRequest(
    WEB_APP_URL + '?action=rejectMPlusExclusion&data=' + encodeURIComponent(JSON.stringify(data)),
    function (err, result) {
      if (err || (result && result.error)) {
        btnEl.disabled = false;
        btnEl.textContent = 'Reject';
        return;
      }
      var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
      if (card) card.remove();
      var container = document.getElementById('mplusContainer');
      if (container && !container.querySelector('.request-card')) {
        container.innerHTML =
          '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending M+ exclusion requests.</p>';
      }
      updateNavBadges();
    }
  );
}
