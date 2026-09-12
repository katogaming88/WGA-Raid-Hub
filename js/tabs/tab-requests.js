// Raw rows behind the Recent decisions list, cached so the search filter
// (renderRecentDecisions) can re-render without refetching.
var _requestsDecisionRows = [];

function buildRequestsTab() {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading requests...</p>';

  if (!supabaseClient) {
    container.innerHTML =
      '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">Not connected to Supabase.</p>';
    return;
  }

  // team-read-guard: approved requests only, one row per item a player self-reported.
  supabaseClient
    .from('self_received_requests')
    .select('id, track, source, note, submitted_at, players(name_realm), items(name, slot)')
    .eq('team_id', _teamCfg.supabaseTeamId)
    .eq('status', 'pending')
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      if (result.error) {
        var c = document.getElementById('requestsContainer');
        if (c)
          c.innerHTML =
            '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + result.error.message + '</p>';
        return;
      }
      var requests = (result.data || []).map(function (row) {
        var itemRow = row.items || {};
        var diff = row.track === 'Myth' ? 'Mythic' : row.track === 'Hero' ? 'Heroic' : row.track || '';
        return {
          id: row.id,
          nameRealm: (row.players && row.players.name_realm) || '',
          item: itemRow.name || '',
          slot: itemRow.slot || '',
          source: (diff ? diff + ': ' : '') + (row.source || ''),
          notes: row.note || '',
          timestamp: formatDateTime(row.submitted_at)
        };
      });
      renderPendingRequests(requests);
    });

  // Recent decisions (#756): approved and rejected rows, so a mistaken or
  // duplicate decision stops being a one-way door. Rendered into its own
  // container so the two queries can resolve in either order.
  // team-read-guard: one row per item a player self-reported (48 across both
  // teams today; the admin danger-zone clear resets it each season).
  supabaseClient
    .from('self_received_requests')
    .select(
      'id, status, track, source, note, officer_notes, slot, submitted_at, player_id, self_item_id, players(name_realm), items(name, slot)'
    )
    .eq('team_id', _teamCfg.supabaseTeamId)
    .in('status', ['approved', 'rejected'])
    .order('submitted_at', { ascending: false })
    .then(function (result) {
      var c = document.getElementById('requestsDecisions');
      if (!c) return;
      if (result.error) {
        c.innerHTML =
          '<p style="color:var(--melee);font-size:1rem;margin-top:1.5rem;">' + result.error.message + '</p>';
        return;
      }
      _requestsDecisionRows = result.data || [];
      renderRecentDecisions();
    });
}

// The passive BiS Manager hint (#756): an approved request whose matching
// bis_items row is obtained. Deleting or reverting the request deliberately
// does NOT untick that box (the one-way sync decision in the
// 20260725100000 migration: an officer may have ticked it by hand for an
// unrelated reason), so the card points the officer at BiS Manager instead.
// Slot rule mirrors the sync trigger's coalesce(b.slot, '') = new.slot
// match. getBisItems() (js/common.js) absorbs the bisList key-casing
// caveat; DATA.bisList may not be loaded yet on a very fast first click,
// which just means no hint on that render.
function selfReceivedObtainedBisEntry(row) {
  if (row.status !== 'approved') return null;
  var nameRealm = row.players && row.players.name_realm;
  if (!nameRealm || typeof getBisItems !== 'function') return null;
  var entries = getBisItems(nameRealm) || [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!e.obtained) continue;
    if (e.itemId !== row.self_item_id) continue;
    if (row.slot && (e.dbSlot || '') !== row.slot) continue;
    return e;
  }
  return null;
}

function renderRecentDecisions() {
  var container = document.getElementById('requestsDecisions');
  if (!container) return;
  var searchEl = document.getElementById('requestsDecisionsSearch');
  var searchLow = searchEl ? searchEl.value.trim().toLowerCase() : '';
  var rows = searchLow
    ? _requestsDecisionRows.filter(function (row) {
        var itemRow = row.items || {};
        var nameRealm = (row.players && row.players.name_realm) || '';
        var haystack = [nameRealm, itemRow.name || '', row.source || '', row.note || '', row.slot || '']
          .join(' ')
          .toLowerCase();
        return haystack.indexOf(searchLow) !== -1;
      })
    : _requestsDecisionRows;
  if (!rows.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">' +
      (searchLow ? 'No decisions match your search.' : 'No decisions yet.') +
      '</p>';
    return;
  }
  var html =
    localTimeZoneNote() +
    '<div style="margin-top:2rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    rows.length +
    ' recent decision' +
    (rows.length !== 1 ? 's' : '') +
    '</div>';
  rows.forEach(function (row) {
    var itemRow = row.items || {};
    var nameRealm = (row.players && row.players.name_realm) || '';
    var item = itemRow.name || '';
    var diff = row.track === 'Myth' ? 'Mythic' : row.track === 'Hero' ? 'Heroic' : row.track || '';
    var source = (diff ? diff + ': ' : '') + (row.source || '');
    var approved = row.status === 'approved';
    var obtainedHint = selfReceivedObtainedBisEntry(row);
    html +=
      '<div class="request-card" data-row="' +
      row.id +
      '" data-name-realm="' +
      nameRealm.replace(/"/g, '&quot;') +
      '" data-item="' +
      item.replace(/"/g, '&quot;') +
      '" data-player-id="' +
      (row.player_id || '') +
      '" data-status="' +
      row.status +
      '">' +
      '<div class="request-card-header">' +
      '<span class="request-player">' +
      (nameRealm.split('-')[0] || '(player no longer on roster)') +
      '</span>' +
      '<span style="font-size:0.95rem;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:var(--' +
      (approved ? 'heal' : 'melee') +
      ');">' +
      (approved ? 'Approved' : 'Rejected') +
      '</span>' +
      '<span class="signup-response-time">' +
      formatDateTime(row.submitted_at) +
      '</span>' +
      '</div>' +
      '<div class="request-item">' +
      item +
      (row.slot ? ' <span style="color:var(--text-muted);font-weight:400;">(' + row.slot + ')</span>' : '') +
      '</div>' +
      '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">Source: <span style="color:var(--text);">' +
      source +
      '</span></div>' +
      (row.note
        ? '<div style="font-size:1rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
          row.note +
          '</div>'
        : '') +
      (obtainedHint
        ? '<div style="font-size:0.98rem;color:var(--text-muted);margin-top:0.5rem;">Also marked obtained in BiS Manager. If this approval was a mistake, untick it there.</div>'
        : '') +
      (!approved && row.officer_notes
        ? '<div style="font-size:1rem;color:var(--text-muted);margin-top:0.5rem;">Rejection reason: <span style="color:var(--text);">' +
          row.officer_notes +
          '</span></div>'
        : '') +
      '<p class="request-action-error" id="decision-error-' +
      row.id +
      '" role="status" style="display:none;color:var(--melee);font-size:1rem;margin:0.5rem 0 0;"></p>' +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="revertRequest(' +
      row.id +
      ', this)">Revert to pending</button>' +
      '<button class="btn request-reject-btn" onclick="deleteRequest(' +
      row.id +
      ', this)">Delete</button>' +
      '</div>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

function _decisionError(requestId, message) {
  var el = document.getElementById('decision-error-' + requestId);
  if (!el) return;
  el.textContent = message;
  el.style.display = '';
}

function deleteRequest(requestId, btnEl) {
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var item = card ? card.getAttribute('data-item') : '';
  var status = card ? card.getAttribute('data-status') : '';
  if (
    !confirm(
      'Delete this ' +
        (status || 'decided') +
        ' request for ' +
        (item || 'this item') +
        "? It disappears from the raider's profile loot history."
    )
  )
    return;
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var revertBtn = btnEl.previousElementSibling;
  if (revertBtn) revertBtn.disabled = true;

  // The RPC locks the row, checks the officer gate against the row's own
  // team, and writes the 'Self-Received Deleted' audit entry itself (the row
  // is gone afterwards, so a client-side follow-up could go unlogged). No
  // notification on delete: it is bookkeeping, usually duplicate cleanup.
  supabaseClient.rpc('delete_self_received_request', { p_id: requestId }).then(function (result) {
    if (result.error) {
      btnEl.disabled = false;
      btnEl.textContent = 'Delete';
      if (revertBtn) revertBtn.disabled = false;
      _decisionError(requestId, result.error.message);
      return;
    }
    _requestsDecisionRows = _requestsDecisionRows.filter(function (row) {
      return row.id !== requestId;
    });
    renderRecentDecisions();
  });
}

function revertRequest(requestId, btnEl) {
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var item = card ? card.getAttribute('data-item') : '';
  var status = card ? card.getAttribute('data-status') : '';
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var deleteBtn = btnEl.nextElementSibling;
  if (deleteBtn) deleteBtn.disabled = true;

  // Same plain UPDATE shape as approveRequest/rejectRequest -- the existing
  // officer UPDATE policy carries it. The team-check trigger re-validates on
  // the way through, so a row whose player changed teams errors here.
  supabaseClient
    .from('self_received_requests')
    .update({ status: 'pending' })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Revert to pending';
        if (deleteBtn) deleteBtn.disabled = false;
        _decisionError(requestId, result.error.message);
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      writeAuditLog(
        'Self-Received Reverted',
        'players',
        player ? player.id : null,
        'Back to pending: ' + item + ' (was ' + status + ')'
      );
      if (player) notifyPlayer(player.id, 'Your self-received item (' + item + ') was returned to pending review.');
      buildRequestsTab();
      updateNavBadges();
    });
}

function renderPendingRequests(requests) {
  var container = document.getElementById('requestsContainer');
  if (!container) return;
  if (!requests.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
    return;
  }
  var html =
    localTimeZoneNote() +
    '<div style="margin-top:1.5rem;">' +
    '<div style="font-size:1.02rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:0.75rem;">' +
    requests.length +
    ' pending request' +
    (requests.length !== 1 ? 's' : '') +
    '</div>';
  requests.forEach(function (r) {
    html +=
      '<div class="request-card" data-row="' +
      r.id +
      '" data-name-realm="' +
      r.nameRealm.replace(/"/g, '&quot;') +
      '" data-item="' +
      r.item.replace(/"/g, '&quot;') +
      '">' +
      '<div class="request-card-header">' +
      '<span class="request-player">' +
      r.nameRealm.split('-')[0] +
      '</span>' +
      '<span class="signup-response-time">' +
      r.timestamp +
      '</span>' +
      '</div>' +
      '<div class="request-item">' +
      r.item +
      (r.slot ? ' <span style="color:var(--text-muted);font-weight:400;">(' + r.slot + ')</span>' : '') +
      '</div>' +
      '<div style="font-size:1.04rem;color:var(--text-muted);margin-top:0.2rem;">Source: <span style="color:var(--text);">' +
      r.source +
      '</span></div>' +
      (r.notes
        ? '<div style="font-size:1rem;color:var(--text);margin-top:0.6rem;padding-top:0.6rem;border-top:1px solid var(--border);">' +
          r.notes +
          '</div>'
        : '') +
      '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;">' +
      '<button class="btn request-approve-btn" onclick="approveRequest(' +
      r.id +
      ', this)">Approve</button>' +
      '<button class="btn request-reject-btn" onclick="rejectRequestPrompt(' +
      r.id +
      ', this)">Reject</button>' +
      '</div>' +
      '</div>';
  });
  container.innerHTML = html + '</div>';
}

// Approve/reject are plain updates -- self_received_requests already has
// Officers update RLS in place (#406), unlike the insert path which has to
// go through submit_self_received()/direct_mark_received() since request
// tables have no INSERT policy for anyone.
function approveRequest(requestId, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var item = card ? card.getAttribute('data-item') : '';

  supabaseClient
    .from('self_received_requests')
    .update({ status: 'approved' })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Approve';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      writeAuditLog('Self-Received Approved', 'players', player ? player.id : null, item);
      if (player) notifyPlayer(player.id, 'Your self-received item (' + item + ') was approved.');
      if (card) card.remove();
      checkEmptyRequests();
    });
}

// Swaps the Approve/Reject buttons for a note field, same pattern as
// tab-mplus.js's rejectMPlusExclusion -- an officer can leave a reason
// (shown to the raider and kept on the row) before confirming.
function rejectRequestPrompt(requestId, btnEl) {
  var actionsDiv = btnEl.parentNode;
  var noteId = '_requestRejectNote' + requestId;
  actionsDiv.innerHTML =
    '<div style="width:100%;">' +
    '<div style="font-size:1.04rem;color:var(--text-muted);margin-bottom:0.4rem;">Rejection reason (optional, shown to raider):</div>' +
    '<textarea id="' +
    noteId +
    '" rows="2" placeholder="e.g. Not on the wishlist for this character" style="width:100%;box-sizing:border-box;background:var(--bg-alt);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:0.4rem 0.5rem;font-size:1rem;resize:vertical;"></textarea>' +
    '<div style="display:flex;gap:0.5rem;margin-top:0.5rem;">' +
    '<button id="_requestRejectConfirm' +
    requestId +
    '" class="btn btn-danger" style="font-size:1rem;padding:0.25rem 0.75rem;">Reject</button>' +
    '<button id="_requestRejectCancel' +
    requestId +
    '" class="btn btn-muted" style="font-size:1rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '</div>';

  var noteInput = document.getElementById(noteId);
  var confirmBtn = document.getElementById('_requestRejectConfirm' + requestId);
  var cancelBtn = document.getElementById('_requestRejectCancel' + requestId);

  if (cancelBtn) {
    cancelBtn.addEventListener('click', function () {
      actionsDiv.innerHTML =
        '<button class="btn request-approve-btn" onclick="approveRequest(' +
        requestId +
        ',this)">Approve</button>' +
        '<button class="btn request-reject-btn" onclick="rejectRequestPrompt(' +
        requestId +
        ',this)">Reject</button>';
    });
  }

  if (confirmBtn) {
    confirmBtn.addEventListener('click', function () {
      var note = noteInput ? noteInput.value.trim() : '';
      rejectRequest(requestId, note, confirmBtn);
    });
  }
}

function rejectRequest(requestId, note, btnEl) {
  btnEl.disabled = true;
  btnEl.textContent = '...';
  var card = document.querySelector('.request-card[data-row="' + requestId + '"]');
  var nameRealm = card ? card.getAttribute('data-name-realm') : '';
  var item = card ? card.getAttribute('data-item') : '';

  supabaseClient
    .from('self_received_requests')
    .update({ status: 'rejected', officer_notes: note || null })
    .eq('id', requestId)
    .eq('team_id', _teamCfg.supabaseTeamId)
    .then(function (result) {
      if (result.error) {
        btnEl.disabled = false;
        btnEl.textContent = 'Reject';
        return;
      }
      var player = findRosterPlayerByNameRealm(nameRealm);
      writeAuditLog('Self-Received Rejected', 'players', player ? player.id : null, item + (note ? ' -- ' + note : ''));
      if (player) {
        notifyPlayer(
          player.id,
          'Your self-received item (' + item + ') was rejected.' + (note ? ' Reason: ' + note : '')
        );
      }
      if (card) card.remove();
      checkEmptyRequests();
    });
}

function checkEmptyRequests() {
  var container = document.getElementById('requestsContainer');
  if (container && !container.querySelector('.request-card')) {
    container.innerHTML =
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No pending requests.</p>';
  }
  updateNavBadges();
}
