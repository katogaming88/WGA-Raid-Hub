function renderBisToggle() {
  var badge = document.getElementById('bisStatusBadge');
  var btn   = document.getElementById('bisToggleBtn');
  if (!badge || !btn) return;
  var open = bisSubmissionsOpen();
  badge.textContent = open ? 'OPEN' : 'CLOSED';
  badge.className = 'signup-status-badge ' + (open ? 'signup-status-open' : 'signup-status-closed');
  btn.textContent = open ? 'Close Submissions' : 'Open Submissions';
}

function toggleBisSubmissionsOpen() {
  setBisSubmissionsOpen(!bisSubmissionsOpen());
}

function setBisSubmissionsOpen(open) {
  var btn = document.getElementById('bisToggleBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var cbName = '_setBisOpenCb';
  window[cbName] = function(result) {
    delete window[cbName];
    if (btn) btn.disabled = false;
    if (DATA) DATA.bisSubmissionsOpen = open;
    renderBisToggle();
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    if (btn) btn.disabled = false;
    renderBisToggle();
  };
  script.src = WEB_APP_URL + '?action=setBisSubmissionsOpen&value=' + (open ? 'true' : 'false') + '&callback=' + cbName;
  document.head.appendChild(script);
}

function buildBisTab() {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading submissions...</p>';

  var cbName = '_getPendingBisCb';
  window[cbName] = function(result) {
    delete window[cbName];
    renderBisSubmissions(result.submissions || []);
  };
  var script = document.createElement('script');
  script.onerror = function() {
    delete window[cbName];
    var c = document.getElementById('bisContainer');
    if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Failed to load submissions.</p>';
  };
  script.src = WEB_APP_URL + '?action=getPendingBiS&callback=' + cbName;
  document.head.appendChild(script);
}

function renderBisSubmissions(submissions) {
  var container = document.getElementById('bisContainer');
  if (!container) return;
  if (!submissions.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
    return;
  }
  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    submissions.length + ' pending submission' + (submissions.length !== 1 ? 's' : '') + '</div>';
  submissions.forEach(function(s) {
    html +=
      '<div class="request-card" data-row="' + s.rowIndex + '" data-name-realm="' + s.nameRealm.replace(/"/g,'&quot;') + '" data-bis-link="' + s.bisLink.replace(/"/g,'&quot;') + '">' +
        '<div class="request-card-header">' +
          '<span class="request-player">' + s.nameRealm + '</span>' +
          '<span class="signup-response-time">' + s.timestamp + '</span>' +
        '</div>' +
        '<div class="request-item" style="word-break:break-all;margin-top:0.35rem;">' +
          '<a href="' + s.bisLink + '" target="_blank" rel="noopener" style="color:var(--gold);font-size:1rem;">' + s.bisLink + '</a>' +
        '</div>' +
        (s.notes ? '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' + s.notes + '</div>' : '') +
        '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
          '<button class="btn request-approve-btn" onclick="approveBisSubmission(' + s.rowIndex + ', this)">Approve</button>' +
          '<button class="btn request-reject-btn" onclick="rejectBisSubmission(' + s.rowIndex + ', this)">Reject</button>' +
        '</div>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

function approveBisSubmission(rowIndex, btnEl) {
  var card      = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var bisLink   = card ? card.getAttribute('data-bis-link')   : '';
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var data   = { row: rowIndex, nameRealm: nameRealm, url: bisLink };
  var cbName = '_approveBisCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'Approve'; return; }
    if (card) card.remove();
    checkEmptyBisSubmissions();
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'Approve'; };
  script.src = WEB_APP_URL + '?action=approveBiS&data=' + encodeURIComponent(JSON.stringify(data)) + '&callback=' + cbName;
  document.head.appendChild(script);
}

function rejectBisSubmission(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var cbName = '_rejectBisCb' + rowIndex;
  window[cbName] = function(result) {
    delete window[cbName];
    if (result.error) { btnEl.disabled = false; btnEl.textContent = 'Reject'; return; }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyBisSubmissions();
  };
  var script = document.createElement('script');
  script.onerror = function() { delete window[cbName]; btnEl.disabled = false; btnEl.textContent = 'Reject'; };
  script.src = WEB_APP_URL + '?action=rejectBiS&row=' + rowIndex + '&callback=' + cbName;
  document.head.appendChild(script);
}

function checkEmptyBisSubmissions() {
  var container = document.getElementById('bisContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending BiS submissions.</p>';
  }
}
