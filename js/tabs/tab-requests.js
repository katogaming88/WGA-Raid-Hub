function buildRequestsTab() {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading requests...</p>';

  jsonpRequest(WEB_APP_URL + '?action=getPendingRequests', function(err, result) {
    if (err) {
      var c = document.getElementById('requestsContainer');
      if (c) c.innerHTML = '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + err.message + '</p>';
      return;
    }
    renderPendingRequests(result.requests || []);
  });
}

function renderPendingRequests(requests) {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  if (!requests.length) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
    return;
  }
  var html = '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:0.9rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    requests.length + ' pending request' + (requests.length !== 1 ? 's' : '') + '</div>';
  requests.forEach(function(r) {
    html += '<div class="request-card" data-row="' + r.rowIndex + '">' +
      '<div class="request-card-header">' +
        '<span class="request-player">' + r.player + '</span>' +
        '<span class="signup-response-time">' + r.timestamp + '</span>' +
      '</div>' +
      '<div class="request-item">' + r.item + (r.slot ? ' <span style="color:var(--text-muted);font-weight:400;">(' + r.slot + ')</span>' : '') + '</div>' +
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Source: <span style="color:var(--text);">' + r.source + '</span></div>' +
      (r.notes ? '<div style="font-size:0.97rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' + r.notes + '</div>' : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
        '<button class="btn request-approve-btn" onclick="approveRequest(' + r.rowIndex + ', this)">Approve</button>' +
        '<button class="btn request-reject-btn" onclick="rejectRequest(' + r.rowIndex + ', this)">Reject</button>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html + '</div>';
}

function approveRequest(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  jsonpRequest(WEB_APP_URL + '?action=approveRequest&row=' + rowIndex, function(err, result) {
    if (err || (result && result.error)) { btnEl.disabled = false; btnEl.textContent = 'Approve'; return; }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyRequests();
  });
}

function rejectRequest(rowIndex, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  jsonpRequest(WEB_APP_URL + '?action=rejectRequest&row=' + rowIndex, function(err, result) {
    if (err || (result && result.error)) { btnEl.disabled = false; btnEl.textContent = 'Reject'; return; }
    var card = document.querySelector('.request-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    checkEmptyRequests();
  });
}

function checkEmptyRequests() {
  var container = document.getElementById('requestsContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
  }
  updateNavBadges();
}
