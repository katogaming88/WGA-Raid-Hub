var _pendingRosterEntries = [];
var _pendingMissingSignups = [];
var _pendingFilterRole = null;
var _pendingSwapOnly = false;
var _pendingSortKey = 'name';

// Map of nameRealm.toLowerCase() -> current roster player, for diff/conflict checks.
function buildPendingRosterMap() {
  var map = {};
  var roster = (window.DATA && DATA.roster) || [];
  roster.forEach(function (p) {
    if (p.nameRealm) map[p.nameRealm.toLowerCase()] = p;
  });
  return map;
}

function buildPendingRosterTab() {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">Loading...</p>';

  var loaded = { entries: false, missing: false };
  _pendingRosterEntries = [];
  _pendingMissingSignups = [];

  function tryRender() {
    if (!loaded.entries || !loaded.missing) return;
    renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
  }

  jsonpRequest(WEB_APP_URL + '?action=getPendingRoster', function (err, result) {
    _pendingRosterEntries = err ? [] : result.entries || [];
    loaded.entries = true;
    tryRender();
  });

  jsonpRequest(WEB_APP_URL + '?action=getMissingSignups', function (err, result) {
    _pendingMissingSignups = err ? [] : result.missing || [];
    loaded.missing = true;
    tryRender();
  });
}

function renderPendingRoster(entries, missing) {
  var container = document.getElementById('pendingRosterContainer');
  if (!container) return;

  var rosterMap = buildPendingRosterMap();
  var html = '<div style="margin-top:1.5rem;">';

  html += buildPendingStatsHtml(entries);
  html += buildMissingSignupsHtml(missing);

  if (entries.length) {
    var coverage = computeBuffCoverage(entries, 'className', 'mainSpec', 'nameRealm');
    html += buildPendingBuffCoverageHtml(coverage);
  }

  if (!entries.length) {
    html +=
      '<p style="color:var(--text-muted);font-size:1rem;margin-top:1.5rem;">No approved signups in the pending roster.</p>';
  } else {
    html += buildPushAreaHtml(entries, missing, rosterMap);
    html += buildPendingControlsHtml();
    var visible = getFilteredSortedPendingEntries(entries);
    if (!visible.length) {
      html +=
        '<p style="color:var(--text-muted);font-size:1rem;margin-top:1rem;">No pending entries match the current filter.</p>';
    } else {
      visible.forEach(function (e) {
        html += buildPendingCardHtml(e, rosterMap);
      });
    }
  }

  html += '</div>';
  container.innerHTML = html;
}

// ── Filter / sort controls ────────────────────────────────────────────────────

function getFilteredSortedPendingEntries(entries) {
  var filtered = entries.filter(function (e) {
    if (_pendingFilterRole && e.role !== _pendingFilterRole) return false;
    if (_pendingSwapOnly && !e.mainSwap) return false;
    return true;
  });
  filtered.sort(function (a, b) {
    if (_pendingSortKey === 'class') {
      return (
        (a.className || '').localeCompare(b.className || '') || (a.nameRealm || '').localeCompare(b.nameRealm || '')
      );
    }
    return (a.nameRealm || '').localeCompare(b.nameRealm || '');
  });
  return filtered;
}

function buildPendingControlsHtml() {
  var roles = ['Tank', 'Heal', 'Melee', 'Ranged'];
  var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };

  function chip(active, color, label, onclick) {
    return (
      '<button onclick="' +
      onclick +
      '" style="cursor:pointer;font-size:0.82rem;padding:0.2rem 0.65rem;border-radius:4px;' +
      'border:1px solid ' +
      (active ? color : 'var(--border)') +
      ';background:' +
      (active ? color : 'var(--bg)') +
      ';color:' +
      (active ? 'var(--bg)' : 'var(--text-muted)') +
      ';font-weight:600;">' +
      label +
      '</button>'
    );
  }

  var roleChips = roles
    .map(function (r) {
      return chip(_pendingFilterRole === r, roleColors[r], r, "setPendingFilterRole('" + r + "')");
    })
    .join('');

  var swapChip = chip(_pendingSwapOnly, 'var(--gold-light)', 'Main Swap Only', 'togglePendingSwapOnly()');

  var sortChip = chip(
    _pendingSortKey === 'class',
    'var(--text)',
    'Sort: ' + (_pendingSortKey === 'class' ? 'Class' : 'Name'),
    'togglePendingSortKey()'
  );

  return (
    '<div style="display:flex;flex-wrap:wrap;gap:0.4rem;align-items:center;margin-bottom:1rem;">' +
    roleChips +
    swapChip +
    '<span style="flex:1;"></span>' +
    sortChip +
    '</div>'
  );
}

function setPendingFilterRole(role) {
  _pendingFilterRole = _pendingFilterRole === role ? null : role;
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function togglePendingSwapOnly() {
  _pendingSwapOnly = !_pendingSwapOnly;
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

function togglePendingSortKey() {
  _pendingSortKey = _pendingSortKey === 'class' ? 'name' : 'class';
  renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
}

// ── Stats panel ──────────────────────────────────────────────────────────────

function buildPendingStatsHtml(entries) {
  var roles = { Tank: 0, Heal: 0, Melee: 0, Ranged: 0 };
  entries.forEach(function (e) {
    if (roles[e.role] !== undefined) roles[e.role]++;
  });

  var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };
  var rolePills = Object.keys(roles)
    .map(function (r) {
      return (
        '<span style="display:inline-flex;align-items:center;gap:0.3rem;background:var(--bg-alt);' +
        'border:1px solid var(--border);border-radius:4px;padding:0.2rem 0.6rem;font-size:0.85rem;">' +
        '<span style="color:' +
        roleColors[r] +
        ';font-weight:700;">' +
        r +
        '</span>' +
        '<span style="color:var(--text);font-weight:600;">' +
        roles[r] +
        '</span>' +
        '</span>'
      );
    })
    .join('');

  return (
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:0.5rem;margin-bottom:1.25rem;">' +
    '<span style="font-size:0.85rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;' +
    'letter-spacing:0.12em;margin-right:0.25rem;">' +
    entries.length +
    ' Pending</span>' +
    rolePills +
    '</div>'
  );
}

// ── Missing signups section ──────────────────────────────────────────────────

function buildMissingSignupsHtml(missing) {
  var collapsed = missing.length > 0;
  var collapseId = 'pendingMissingCollapse';

  var headerColor = missing.length ? 'var(--melee)' : 'var(--text-muted)';
  var icon = missing.length ? '&#9660;' : '&#9654;';

  var html =
    '<div style="margin-bottom:1.25rem;border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
    '<div onclick="toggleMissingSignups()" style="cursor:pointer;display:flex;align-items:center;' +
    'justify-content:space-between;padding:0.6rem 0.85rem;background:var(--bg-alt);">' +
    '<span style="font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;color:' +
    headerColor +
    ';">Missing Signups (' +
    missing.length +
    ')</span>' +
    '<span id="pendingMissingIcon" style="font-size:0.8rem;color:var(--text-muted);">' +
    icon +
    '</span>' +
    '</div>' +
    '<div id="' +
    collapseId +
    '" style="display:' +
    (collapsed ? 'block' : 'none') +
    ';padding:0.75rem 0.85rem;">';

  if (!missing.length) {
    html +=
      '<p style="color:var(--text-muted);font-size:0.9rem;margin:0;">All roster members have submitted a signup.</p>';
  } else {
    var byRole = { Tank: [], Heal: [], Melee: [], Ranged: [] };
    missing.forEach(function (p) {
      var r = p.role || 'Melee';
      if (!byRole[r]) byRole[r] = [];
      byRole[r].push(p);
    });
    var roleColors = { Tank: 'var(--tank)', Heal: 'var(--heal)', Melee: 'var(--melee)', Ranged: 'var(--ranged)' };
    Object.keys(byRole).forEach(function (role) {
      if (!byRole[role].length) return;
      html +=
        '<div style="margin-bottom:0.5rem;">' +
        '<span style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.1em;color:' +
        roleColors[role] +
        ';font-weight:700;">' +
        role +
        ' (' +
        byRole[role].length +
        ')</span>' +
        '<div style="margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.35rem;">';
      byRole[role].forEach(function (p) {
        var clsColor = classColor(p.className);
        html +=
          '<span style="font-size:0.82rem;background:var(--bg);border:1px solid var(--border);' +
          'border-radius:4px;padding:0.15rem 0.5rem;color:' +
          clsColor +
          ';">' +
          (p.nameRealm ? p.nameRealm.split('-')[0] : p.nameRealm) +
          '<span style="color:var(--text-muted);font-weight:400;"> (' +
          (p.spec || p.className || '') +
          ')</span>' +
          '</span>';
      });
      html += '</div></div>';
    });
  }

  html += '</div></div>';
  return html;
}

function toggleMissingSignups() {
  var panel = document.getElementById('pendingMissingCollapse');
  var icon = document.getElementById('pendingMissingIcon');
  if (!panel) return;
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (icon) icon.innerHTML = visible ? '&#9654;' : '&#9660;';
}

// ── Buff / debuff coverage panel ─────────────────────────────────────────────

function buildPendingBuffCoverageHtml(coverage) {
  var sections = [
    { label: 'Raid Buffs', buffs: RAID_BUFFS },
    { label: 'Boss Debuffs', buffs: BOSS_DEBUFFS },
    { label: 'Utility', buffs: RAID_UTILITY }
  ];

  var bodyHtml = '';
  sections.forEach(function (sec) {
    bodyHtml +=
      '<div style="margin-bottom:0.6rem;">' +
      '<span style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.1em;' +
      'color:var(--text-muted);font-weight:700;display:block;margin-bottom:0.35rem;">' +
      sec.label +
      '</span>' +
      '<div style="display:flex;flex-wrap:wrap;gap:0.3rem;">';
    sec.buffs.forEach(function (buff) {
      var data = coverage[buff.name] || { count: 0, providers: [] };
      var count = data.count;
      var indicator, color;
      if (count >= 2) {
        indicator = '&#10003;';
        color = 'var(--heal)';
      } else if (count === 1) {
        indicator = '!';
        color = 'var(--gold-light)';
      } else {
        indicator = '&#10007;';
        color = 'var(--melee)';
      }
      var nameColor = buff.classes.length === 1 ? classColor(buff.classes[0]) : 'var(--text)';
      var titleAttr = data.providers.length ? ' title="' + data.providers.join(', ') + '"' : '';
      bodyHtml +=
        '<span' +
        titleAttr +
        ' style="display:inline-flex;align-items:center;gap:0.3rem;' +
        'background:var(--bg);border:1px solid var(--border);border-radius:4px;' +
        'padding:0.2rem 0.6rem;font-size:0.88rem;cursor:default;">' +
        '<span style="color:' +
        color +
        ';font-weight:700;">' +
        indicator +
        '</span>' +
        '<span style="color:' +
        nameColor +
        ';">' +
        buff.name +
        '</span>' +
        (count > 0 ? '<span style="color:' + color + ';font-weight:600;font-size:0.8rem;">' + count + '</span>' : '') +
        '</span>';
    });
    bodyHtml += '</div></div>';
  });

  return (
    '<div style="margin-bottom:1.25rem;border:1px solid var(--border);border-radius:6px;overflow:hidden;">' +
    '<div onclick="togglePendingBuffCoverage()" style="cursor:pointer;display:flex;align-items:center;' +
    'justify-content:space-between;padding:0.6rem 0.85rem;background:var(--bg-alt);">' +
    '<span style="font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.12em;' +
    'color:var(--text-muted);">Buff Coverage</span>' +
    '<span id="pendingBuffIcon" style="font-size:0.8rem;color:var(--text-muted);">&#9654;</span>' +
    '</div>' +
    '<div id="pendingBuffCollapse" style="display:none;padding:0.75rem 0.85rem;">' +
    bodyHtml +
    '</div>' +
    '</div>'
  );
}

function togglePendingBuffCoverage() {
  var panel = document.getElementById('pendingBuffCollapse');
  var icon = document.getElementById('pendingBuffIcon');
  if (!panel) return;
  var visible = panel.style.display !== 'none';
  panel.style.display = visible ? 'none' : 'block';
  if (icon) icon.innerHTML = visible ? '&#9654;' : '&#9660;';
}

// ── Push to Roster area ──────────────────────────────────────────────────────

function buildPushAreaHtml(entries, missing, rosterMap) {
  var missingCount = missing.length;
  var added = 0,
    updated = 0;
  entries.forEach(function (e) {
    if (e.nameRealm && rosterMap[e.nameRealm.toLowerCase()]) updated++;
    else added++;
  });

  var diffParts = [];
  if (added) diffParts.push('<span style="color:var(--heal);font-weight:600;">' + added + ' new</span>');
  if (updated) diffParts.push('<span style="color:var(--gold-light);font-weight:600;">' + updated + ' updated</span>');
  if (missingCount)
    diffParts.push(
      '<span style="color:var(--melee);font-weight:600;">' +
        missingCount +
        ' missing signup' +
        (missingCount !== 1 ? 's' : '') +
        '</span> (only removed if checked below)'
    );

  return (
    '<div id="pendingPushArea" style="margin-bottom:1.25rem;padding:0.85rem;background:var(--bg-alt);' +
    'border:1px solid var(--border);border-radius:6px;">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">' +
    '<span style="font-size:0.9rem;color:var(--text-muted);">Push all ' +
    entries.length +
    ' pending entries to the official roster: ' +
    diffParts.join(', ') +
    '.</span>' +
    '<button class="btn request-approve-btn" id="pendingPushBtn" onclick="showPushConfirm()" ' +
    'style="font-size:0.88rem;padding:0.3rem 1rem;white-space:nowrap;">Push to Roster</button>' +
    '</div>' +
    '<div id="pendingPushConfirm" style="display:none;margin-top:0.85rem;padding-top:0.75rem;' +
    'border-top:1px solid var(--border);">' +
    '<label style="display:flex;align-items:flex-start;gap:0.5rem;font-size:0.9rem;color:var(--text);' +
    'cursor:pointer;margin-bottom:0.75rem;">' +
    '<input type="checkbox" id="pendingPushRemoveAbsent" style="margin-top:0.15rem;accent-color:var(--melee);">' +
    '<span>Also remove roster members not in the pending roster' +
    (missingCount
      ? ' <span style="color:var(--melee);font-weight:600;">(' +
        missingCount +
        ' missing signup' +
        (missingCount !== 1 ? 's' : '') +
        ')</span>'
      : '') +
    '</span>' +
    '</label>' +
    '<div style="display:flex;gap:0.5rem;">' +
    '<button class="btn request-approve-btn" id="pendingPushConfirmBtn" onclick="confirmPushToRoster(this)" ' +
    'style="font-size:0.88rem;padding:0.25rem 0.75rem;">Confirm Push</button>' +
    '<button class="btn btn-muted" onclick="hidePushConfirm()" ' +
    'style="font-size:0.88rem;padding:0.25rem 0.75rem;">Cancel</button>' +
    '</div>' +
    '<div id="pendingPushResult" style="margin-top:0.6rem;font-size:0.88rem;"></div>' +
    '</div>' +
    '</div>'
  );
}

function showPushConfirm() {
  var confirm = document.getElementById('pendingPushConfirm');
  var btn = document.getElementById('pendingPushBtn');
  if (confirm) confirm.style.display = 'block';
  if (btn) btn.style.display = 'none';
}

function hidePushConfirm() {
  var confirm = document.getElementById('pendingPushConfirm');
  var btn = document.getElementById('pendingPushBtn');
  if (confirm) confirm.style.display = 'none';
  if (btn) btn.style.display = '';
}

function confirmPushToRoster(btnEl) {
  var removeAbsent = document.getElementById('pendingPushRemoveAbsent');
  var remove = removeAbsent && removeAbsent.checked;
  var resultEl = document.getElementById('pendingPushResult');

  btnEl.disabled = true;
  btnEl.textContent = 'Pushing...';

  jsonpRequest(
    WEB_APP_URL + '?action=pushPendingToRoster&removeAbsent=' + (remove ? 'true' : 'false'),
    function (err, result) {
      btnEl.disabled = false;
      btnEl.textContent = 'Confirm Push';

      if (err || !result || result.error) {
        if (resultEl)
          resultEl.innerHTML =
            '<span style="color:var(--melee);">' +
            (result && result.error ? result.error : 'Push failed. Try again.') +
            '</span>';
        return;
      }

      var lines = [];
      if (result.added) lines.push(result.added + ' player' + (result.added !== 1 ? 's' : '') + ' added');
      if (result.updated) lines.push(result.updated + ' player' + (result.updated !== 1 ? 's' : '') + ' updated');
      if (result.removedAbsent && result.removed && result.removed.length)
        lines.push(result.removed.length + ' removed: ' + result.removed.join(', '));
      else if (!result.removedAbsent && result.removed && result.removed.length)
        lines.push(result.removed.length + ' not in pending (not removed): ' + result.removed.join(', '));

      if (resultEl)
        resultEl.innerHTML =
          '<span style="color:var(--text-muted);">Done. ' + (lines.join('; ') || 'No changes.') + '</span>';

      // Reload after short delay
      setTimeout(function () {
        buildPendingRosterTab();
        updateNavBadges();
      }, 1800);
    }
  );
}

// ── Pending entry cards ──────────────────────────────────────────────────────

function buildPendingCardHtml(e, rosterMap) {
  rosterMap = rosterMap || {};
  var clsColor = classColor(e.className);
  var isNew = !(e.nameRealm && rosterMap[e.nameRealm.toLowerCase()]);
  var borderStyle = e.mainSwap ? 'border-left:3px solid var(--gold-light);' : '';

  var html =
    '<div class="signup-response-card" style="' +
    borderStyle +
    '" data-row="' +
    e.rowIndex +
    '">' +
    '<div class="signup-response-header">' +
    '<span class="signup-response-name">' +
    e.nameRealm +
    '</span>' +
    '<span style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;' +
    'margin-left:0.4rem;color:' +
    (isNew ? 'var(--heal)' : 'var(--text-muted)') +
    ';">' +
    (isNew ? 'New' : 'Update') +
    '</span>';

  if (e.season)
    html +=
      '<span style="font-size:0.7rem;color:var(--text-muted);background:var(--bg-alt);' +
      'border:1px solid var(--border);border-radius:3px;padding:0.1rem 0.4rem;margin-left:0.4rem;">' +
      e.season +
      '</span>';

  html += '</div>';
  html +=
    '<div style="font-size:1rem;color:' +
    clsColor +
    ';margin-top:0.35rem;font-weight:600;">' +
    e.className +
    ' &middot; ' +
    e.mainSpec +
    (e.offSpecs ? '<span style="color:var(--text-muted);font-weight:400;"> / ' + e.offSpecs + '</span>' : '') +
    '</div>';

  if (e.role)
    html +=
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Role: <span style="color:var(--text);">' +
      e.role +
      '</span></div>';
  if (e.discord)
    html +=
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Discord: <span style="color:var(--text);">' +
      e.discord +
      '</span></div>';
  if (e.mainSwap) {
    var swapStillOnRoster = !!rosterMap[e.mainSwap.toLowerCase()];
    html +=
      '<div style="font-size:0.92rem;color:var(--text-muted);margin-top:0.2rem;">Main swap: ' +
      '<span style="color:var(--gold-light);font-weight:600;">' +
      e.mainSwap +
      '</span>' +
      (swapStillOnRoster
        ? ' <span style="color:var(--melee);font-size:0.85rem;">(still on roster -- check "remove absent" to clean up)</span>'
        : ' <span style="color:var(--text-muted);font-size:0.85rem;">(already off roster)</span>') +
      '</div>';
  }
  if (e.notes)
    html +=
      '<div style="font-size:0.9rem;color:var(--text-muted);margin-top:0.35rem;font-style:italic;">' +
      e.notes +
      '</div>';

  html +=
    '<div style="display:flex;gap:0.5rem;margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border);">' +
    '<button class="btn btn-danger" onclick="removePendingRosterRow(' +
    e.rowIndex +
    ',this)" style="font-size:0.88rem;padding:0.25rem 0.75rem;">Remove from Pending</button>' +
    '</div>' +
    '</div>';

  return html;
}

// ── Remove from pending ──────────────────────────────────────────────────────

function removePendingRosterRow(rowIndex, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '...';
  }

  jsonpRequest(WEB_APP_URL + '?action=removePendingRoster&row=' + rowIndex, function (err, result) {
    if (err || (result && result.error)) {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = 'Remove from Pending';
      }
      return;
    }
    var card = document.querySelector('.signup-response-card[data-row="' + rowIndex + '"]');
    if (card) card.remove();
    _pendingRosterEntries = _pendingRosterEntries.filter(function (e) {
      return e.rowIndex !== rowIndex;
    });
    // Re-render stats and push area with updated list
    renderPendingRoster(_pendingRosterEntries, _pendingMissingSignups);
    updateNavBadges();
  });
}
