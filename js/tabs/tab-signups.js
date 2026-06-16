function renderSignupToggle() {
  var badge = document.getElementById('signupStatusBadge');
  var btn   = document.getElementById('signupToggleBtn');
  if (!badge || !btn) return;
  var open = !!(DATA && DATA.signupsOpen);
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Signups' : 'Open Signups';
}

function toggleSignupsOpen() {
  setSignupsOpen(!(DATA && DATA.signupsOpen));
}

function setSignupsOpen(open) {
  var btn = document.getElementById('signupToggleBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var cbName = '_setSignupsOpenCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) btn.disabled = false;
    if (result && result.success) {
      if (DATA) DATA.signupsOpen = result.signupsOpen;
    }
    renderSignupToggle();
  };

  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) btn.disabled = false;
    renderSignupToggle();
  };
  script.src = WEB_APP_URL + '?action=setSignupsOpen&value=' + (open ? 'true' : 'false') + '&callback=' + cbName;
  document.head.appendChild(script);
}

function buildSignupsTab() {
  renderSignupToggle();
  var container = document.getElementById('signupsResponsesContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  var cbName = '_getSignupsCb';
  window[cbName] = function(result) {
    delete window[cbName];
    renderSignupResponses(result.signups || []);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('signupsResponsesContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load submissions.</p>';
  };
  script.src = WEB_APP_URL + '?action=getSignups&callback=' + cbName;
  document.head.appendChild(script);
}

function renderSignupResponses(signups) {
  var container = document.getElementById('signupsResponsesContainer');
  if (!container) return;

  signups = signups.filter(function(s) { return s.status !== 'Approved'; });

  if (!signups.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    return;
  }

  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    signups.length + ' submission' + (signups.length !== 1 ? 's' : '') + '</div>';

  signups.forEach(function(s) {
    var clsColor  = classColor(s.className);
    var isPending = s.status === 'Pending' || !s.status;
    var statusBadge = isPending ? '' :
      '<span class="signup-status-badge ' + (s.status === 'Approved' ? 'signup-status-open' : 'signup-status-closed') + '" style="font-size:0.7rem;padding:0.1rem 0.5rem;margin-left:0.4rem;">' + s.status + '</span>';
    var actionBtns = isPending
      ? '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">' +
          '<button class="btn request-approve-btn" onclick="approveSignupRow(' + s.rowIndex + ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Approve</button>' +
          '<button class="btn btn-danger" onclick="denySignupRow(' + s.rowIndex + ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Deny</button>' +
        '</div>'
      : '';
    html += '<div class="signup-response-card" data-row="' + s.rowIndex + '">' +
      '<div class="signup-response-header">' +
        '<div style="display:flex;align-items:center;">' +
          '<span class="signup-response-name">' + s.charName + '-' + s.realm + '</span>' +
          statusBadge +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:0.75rem;">' +
          '<span class="signup-response-time">' + s.timestamp + '</span>' +
          '<button class="signup-delete-btn" onclick="deleteSignupRow(' + s.rowIndex + ', this)" title="Delete signup">x</button>' +
        '</div>' +
      '</div>' +
      '<div style="font-size:1rem;color:' + clsColor + ';margin-top:0.35rem;font-weight:600;">' +
        s.className + ' &middot; ' + s.mainSpec +
        (s.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + s.offSpecs + '</span>' : '') +
      '</div>';
    if (s.role)    html += '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' + s.role + '</span></div>';
    if (s.discord) html += '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Discord: <span style="color:var(--text);">' + s.discord + '</span></div>';
    if (s.notes)   html += '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' + s.notes + '</div>';
    html += actionBtns + '</div>';
  });

  container.innerHTML = html + '</div>';
}

function deleteSignupRow(rowIndex, btnEl) {
  if (!confirm('Delete this signup? This cannot be undone.')) return;
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var cbName = '_deleteSignupCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'x'; return; }
    var card = document.querySelector('.signup-response-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    var container = document.getElementById('signupsResponsesContainer');
    if (container && !container.querySelector('.signup-response-card')) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'x'; };
  script.src = WEB_APP_URL + '?action=deleteSignup&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}

function approveSignupRow(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var denyBtn = btnEl.nextElementSibling;
  if (denyBtn) denyBtn.disabled = true;
  var cbName = '_approveSignupCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) {
      btnEl.disabled = false; btnEl.textContent = 'Approve';
      if (denyBtn) denyBtn.disabled = false;
      return;
    }
    var card = document.querySelector('.signup-response-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    var container = document.getElementById('signupsResponsesContainer');
    if (container && !container.querySelector('.signup-response-card')) {
      container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No signups submitted yet.</p>';
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    btnEl.disabled = false; btnEl.textContent = 'Approve';
    if (denyBtn) denyBtn.disabled = false;
  };
  script.src = WEB_APP_URL + '?action=approveSignup&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}

function denySignupRow(rowIndex, btnEl) {
  if (!confirm('Deny this signup?')) return;
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var approveBtn = btnEl.previousElementSibling;
  if (approveBtn) approveBtn.disabled = true;
  var cbName = '_denySignupCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) {
      btnEl.disabled = false; btnEl.textContent = 'Deny';
      if (approveBtn) approveBtn.disabled = false;
      return;
    }
    var card = document.querySelector('.signup-response-card[data-row="' + rowIndex + '"]');
    if (card) {
      var nameEl = card.querySelector('.signup-response-name');
      if (nameEl && nameEl.parentNode) {
        var badge = document.createElement('span');
        badge.className = 'signup-status-badge signup-status-closed';
        badge.style.cssText = 'font-size:0.7rem;padding:0.1rem 0.5rem;margin-left:0.4rem;';
        badge.textContent = 'Denied';
        nameEl.parentNode.appendChild(badge);
      }
      var actionRow = btnEl.parentNode;
      if (actionRow) actionRow.remove();
    }
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    btnEl.disabled = false; btnEl.textContent = 'Deny';
    if (approveBtn) approveBtn.disabled = false;
  };
  script.src = WEB_APP_URL + '?action=denySignup&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}
